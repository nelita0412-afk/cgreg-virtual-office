import type { AppCtx } from '../context';
import { tx } from '../db';
import { SheetsClient, SheetsNoConfigurado, type FilaFuente } from './client';
import { enUbicacion, mapeoMaestra, mapeoValoracion, normalizar, parseAviso, parseBooleano, parseFecha, type CampoMaestra, type CampoValoracion } from './columns';
import type { Queryable } from '../db';
import type { Config } from '../config';

export interface ResultadoSync {
  estado: 'ok' | 'error' | 'no_configurado';
  procesados: number;
  creados: number;
  actualizados: number;
  errores: { fila?: number; motivo: string }[];
  mensaje: string;
  detalle?: Record<string, unknown>;
}

const valoresRiesgo = (cfg: Config) => new Set(cfg.SHEETS_RIESGO_VALORES.split(',').map((v) => normalizar(v)).filter(Boolean));

/**
 * Clasificación de riesgo alto SOLO si la columna está configurada y el valor registrado por el
 * profesional coincide literalmente con un valor «alto». No se infiere riesgo a partir de otras respuestas.
 */
async function aplicarRiesgo(
  c: Queryable,
  cfg: Config,
  servidorId: string | null,
  registroId: string,
  v: { riesgo?: string; seguimiento?: string; fecha_registro?: string },
): Promise<'alto' | 'alto_sin_vinculo' | 'no' | 'no_configurado'> {
  if (!cfg.SHEETS_RIESGO_COLUMNA) return 'no_configurado';
  const esAlto = !!v.riesgo && valoresRiesgo(cfg).has(normalizar(v.riesgo));
  if (!esAlto) {
    await c.query(
      `update clinical.clasificaciones_riesgo set vigente = false, retirada_at = now(), motivo_retiro = 'Valor actualizado en la matriz de valoraciones'
        where fuente = 'matriz_valoraciones' and registro_fuente_id = $1 and vigente`,
      [registroId],
    );
    return 'no';
  }
  if (!servidorId) return 'alto_sin_vinculo';
  const seg = cfg.SHEETS_SEGUIMIENTO_COLUMNA ? parseBooleano(v.seguimiento) : null;
  await c.query(
    `insert into clinical.clasificaciones_riesgo (servidor_id, nivel, fuente, registro_fuente_id, valor_origen, fecha_valoracion, requiere_seguimiento)
     values ($1, 'alto', 'matriz_valoraciones', $2, $3, $4, $5)
     on conflict (fuente, registro_fuente_id) where registro_fuente_id is not null do update set
       servidor_id = excluded.servidor_id, valor_origen = excluded.valor_origen, fecha_valoracion = excluded.fecha_valoracion,
       requiere_seguimiento = excluded.requiere_seguimiento, vigente = true, retirada_at = null, motivo_retiro = null`,
    [servidorId, registroId, v.riesgo, parseFecha(v.fecha_registro), seg === 'invalido' ? null : seg],
  );
  return 'alto';
}

/**
 * Modo base maestra: «Personal» (identificación, filtrada a Santa Cruz) + «Valoraciones» (vínculo por ID_Distributivo).
 */
export async function aplicarMaestra(
  ctx: AppCtx,
  hojaPersonal: string,
  personal: { fila: number; valores: Partial<Record<CampoMaestra, string>> }[],
  hojaValoraciones: string,
  valoraciones: { fila: number; valores: Partial<Record<CampoValoracion, string>> }[],
): Promise<Omit<ResultadoSync, 'estado' | 'mensaje'>> {
  const cfg = ctx.cfg;
  const errores: ResultadoSync['errores'] = [];
  const d = { personal_leidos: personal.length, santa_cruz: 0, excluidos_fuera_santa_cruz: 0, contacto_validado_descartado: 0, valoraciones_leidas: valoraciones.length, valoraciones_vinculadas: 0, valoraciones_sin_vinculo: 0, riesgo_alto: 0, riesgo_alto_sin_vinculo: 0, riesgo_configurado: !!cfg.SHEETS_RIESGO_COLUMNA };
  let creados = 0;
  let actualizados = 0;
  await tx(ctx.db, async (c) => {
    const vistosP: string[] = [];
    for (const f of personal) {
      const v = f.valores;
      if (!v.codigo_institucional || !v.nombre) {
        errores.push({ fila: f.fila, motivo: `Personal: fila sin ${!v.codigo_institucional ? 'ID_Distributivo' : 'Nombres_Apellidos'}` });
        continue;
      }
      // Minimización: los registros fuera de Santa Cruz no se almacenan.
      if (!enUbicacion(v.ubicacion ?? v.unidad, cfg.SHEETS_UBICACION_VALOR)) {
        d.excluidos_fuera_santa_cruz++;
        continue;
      }
      d.santa_cruz++;
      let cv = parseBooleano(v.contacto_validado);
      if (cv === 'invalido') {
        d.contacto_validado_descartado++;
        cv = null;
      }
      const r = await c.query(
        `insert into ops.servidores (clave_fuente, codigo_institucional, nombre, unidad, estado_servidor, contacto_validado, en_base_maestra, en_santa_cruz, verificacion, origen)
         values ($1,$2,$3,$4,$5,$6,true,true,'verificado_maestra','matriz_personal')
         on conflict (clave_fuente) do update set nombre = excluded.nombre, codigo_institucional = excluded.codigo_institucional,
           unidad = excluded.unidad, estado_servidor = excluded.estado_servidor, contacto_validado = excluded.contacto_validado,
           en_base_maestra = true, en_santa_cruz = true, verificacion = 'verificado_maestra', activo_en_fuente = true, ultima_sincronizacion = now()
         returning id, (xmax = 0) as insertado`,
        [`DIST:${v.codigo_institucional}`, v.codigo_institucional, v.nombre, v.unidad ?? null, v.estado_servidor ?? null, cv],
      );
      if (r.rows[0].insertado) creados++;
      else actualizados++;
      const rid = `PER:${v.codigo_institucional}`;
      await c.query(
        `insert into ops.registros_fuente (registro_id, servidor_id, hoja, tipo, codigo_institucional, activo, ultima_vista) values ($1,$2,$3,'personal',$4,true,now())
         on conflict (registro_id) do update set servidor_id = excluded.servidor_id, activo = true, ultima_vista = now()`,
        [rid, r.rows[0].id, hojaPersonal, v.codigo_institucional],
      );
      vistosP.push(rid);
    }
    await c.query(`update ops.registros_fuente set activo = false where tipo = 'personal' and not (registro_id = any($1))`, [vistosP]);
    await c.query(
      `update ops.servidores s set en_base_maestra = false,
              verificacion = case when s.verificacion = 'verificado_maestra' then 'pendiente_verificacion' else s.verificacion end
        where s.en_base_maestra and not exists (select 1 from ops.registros_fuente r where r.servidor_id = s.id and r.tipo = 'personal' and r.activo)`,
    );

    const vistosV: string[] = [];
    for (const f of valoraciones) {
      const v = f.valores;
      if (!v.id_registro) {
        errores.push({ fila: f.fila, motivo: 'Valoraciones: fila sin ID_Valoracion' });
        continue;
      }
      const s = v.codigo_institucional
        ? (await c.query(`select id from ops.servidores where clave_fuente = $1 and en_base_maestra`, [`DIST:${v.codigo_institucional}`])).rows[0]
        : null;
      const sid: string | null = s?.id ?? null;
      if (sid) d.valoraciones_vinculadas++;
      else d.valoraciones_sin_vinculo++;
      const aviso = parseAviso(v.aviso_privacidad);
      await c.query(
        `insert into ops.registros_fuente (registro_id, servidor_id, hoja, tipo, codigo_institucional, fecha_registro, canal_contacto, aviso_privacidad, activo, ultima_vista)
         values ($1,$2,$3,'valoracion',$4,$5,$6,$7,true,now())
         on conflict (registro_id) do update set servidor_id = excluded.servidor_id, codigo_institucional = excluded.codigo_institucional,
           fecha_registro = excluded.fecha_registro, canal_contacto = excluded.canal_contacto, aviso_privacidad = excluded.aviso_privacidad, activo = true, ultima_vista = now()`,
        [v.id_registro, sid, hojaValoraciones, v.codigo_institucional ?? null, v.fecha_registro ?? null, v.canal_contacto ?? null, aviso],
      );
      if (sid) {
        // El aviso de privacidad se conserva como dato separado: NO equivale a consentimiento informado.
        await c.query(
          `update ops.servidores set canal_contacto = coalesce($2, canal_contacto), aviso_privacidad_aceptado = coalesce($3, aviso_privacidad_aceptado) where id = $1`,
          [sid, v.canal_contacto ?? null, aviso],
        );
      }
      const rr = await aplicarRiesgo(c, cfg, sid, v.id_registro, v);
      if (rr === 'alto') d.riesgo_alto++;
      if (rr === 'alto_sin_vinculo') d.riesgo_alto_sin_vinculo++;
      vistosV.push(v.id_registro);
    }
    await c.query(`update ops.registros_fuente set activo = false where tipo = 'valoracion' and hoja = $1 and not (registro_id = any($2))`, [hojaValoraciones, vistosV]);
    await c.query(`update ops.servidores s set activo_en_fuente = exists (select 1 from ops.registros_fuente r where r.servidor_id = s.id and r.activo)`);
  });
  return { procesados: d.santa_cruz + d.valoraciones_leidas, creados, actualizados, errores, detalle: d };
}

/** Aplica las filas leídas a la base operativa (sin escribir nada en Google Sheets). */
export async function aplicarFilas(ctx: AppCtx, hoja: string, filas: FilaFuente[]): Promise<Omit<ResultadoSync, 'estado' | 'mensaje'>> {
  const errores: ResultadoSync['errores'] = [];
  let creados = 0;
  let actualizados = 0;
  let procesados = 0;
  await tx(ctx.db, async (c) => {
    const vistos: string[] = [];
    for (const f of filas) {
      const v = f.valores;
      if (!v.id_registro) {
        errores.push({ fila: f.fila, motivo: 'Fila sin ID_Valoracion' });
        continue;
      }
      if (!v.nombre) {
        errores.push({ fila: f.fila, motivo: 'Fila sin nombre de servidor' });
        continue;
      }
      procesados++;
      const clave = v.codigo_institucional ? `DIST:${v.codigo_institucional}` : `VAL:${v.id_registro}`;
      const r = await c.query(
        `insert into ops.servidores (clave_fuente, codigo_institucional, nombre, canal_contacto, aviso_privacidad_aceptado)
         values ($1,$2,$3,$4,$5)
         on conflict (clave_fuente) do update set
           nombre = excluded.nombre,
           codigo_institucional = excluded.codigo_institucional,
           canal_contacto = coalesce(excluded.canal_contacto, ops.servidores.canal_contacto),
           aviso_privacidad_aceptado = coalesce(excluded.aviso_privacidad_aceptado, ops.servidores.aviso_privacidad_aceptado),
           activo_en_fuente = true,
           ultima_sincronizacion = now()
         returning id, (xmax = 0) as insertado`,
        [clave, v.codigo_institucional ?? null, v.nombre, v.canal_contacto ?? null, parseAviso(v.aviso_privacidad)],
      );
      const row = r.rows[0];
      if (row.insertado) creados++;
      else actualizados++;
      await c.query(
        `insert into ops.registros_fuente (registro_id, servidor_id, hoja, fecha_registro, activo, ultima_vista)
         values ($1,$2,$3,$4,true, now())
         on conflict (registro_id) do update set servidor_id = excluded.servidor_id, fecha_registro = excluded.fecha_registro, activo = true, ultima_vista = now()`,
        [v.id_registro, row.id, hoja, v.fecha_registro ?? null],
      );
      vistos.push(v.id_registro);
    }
    // Registros que ya no están en la pestaña: se marcan inactivos (no se borran: trazabilidad).
    await c.query(`update ops.registros_fuente set activo = false where hoja = $1 and not (registro_id = any($2))`, [hoja, vistos]);
    await c.query(
      `update ops.servidores s set activo_en_fuente = exists (select 1 from ops.registros_fuente r where r.servidor_id = s.id and r.activo)`,
    );
  });
  return { procesados, creados, actualizados, errores };
}

export class SheetsSync {
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  readonly client: SheetsClient;

  constructor(private ctx: AppCtx, client?: SheetsClient) {
    this.client = client ?? new SheetsClient(ctx.cfg);
  }

  async ejecutar(): Promise<ResultadoSync> {
    if (this.corriendo) return { estado: 'error', procesados: 0, creados: 0, actualizados: 0, errores: [], mensaje: 'Sincronización en curso' };
    this.corriendo = true;
    const db = this.ctx.db;
    try {
      if (!this.client.configurado) {
        const ult = await db.query(`select estado from ops.sync_ejecuciones order by id desc limit 1`);
        if (ult.rows[0]?.estado !== 'no_configurado') {
          await db.query(`insert into ops.sync_ejecuciones (estado, fin, mensaje) values ('no_configurado', now(), $1)`, [
            'Faltan credenciales de la cuenta de servicio de Google. Ver docs/GOOGLE_SHEETS.md.',
          ]);
        }
        return { estado: 'no_configurado', procesados: 0, creados: 0, actualizados: 0, errores: [], mensaje: 'Integración no configurada' };
      }
      const run = await db.query<{ id: number }>(`insert into ops.sync_ejecuciones (estado) values ('en_curso') returning id`);
      const id = run.rows[0].id;
      try {
        let hoja: string;
        let r: Omit<ResultadoSync, 'estado' | 'mensaje'>;
        if (this.ctx.cfg.SHEETS_MAESTRA_GID) {
          const tabs = await this.client.pestanas();
          const hp = tabs.get(this.ctx.cfg.SHEETS_MAESTRA_GID);
          const hv = tabs.get(this.ctx.cfg.SHEETS_GID);
          if (!hp) throw new Error(`No existe la pestaña maestra con gid ${this.ctx.cfg.SHEETS_MAESTRA_GID}.`);
          if (!hv) throw new Error(`No existe la pestaña de valoraciones con gid ${this.ctx.cfg.SHEETS_GID}.`);
          const p = await this.client.leerTabla(hp, mapeoMaestra(this.ctx.cfg.SHEETS_MAESTRA_COLUMNS, this.ctx.cfg.SHEETS_UBICACION_COLUMNA), ['codigo_institucional', 'nombre']);
          const mv = mapeoValoracion(this.ctx.cfg.SHEETS_RIESGO_COLUMNA, this.ctx.cfg.SHEETS_SEGUIMIENTO_COLUMNA);
          const oblig: CampoValoracion[] = ['id_registro', 'codigo_institucional', ...(this.ctx.cfg.SHEETS_RIESGO_COLUMNA ? (['riesgo'] as CampoValoracion[]) : [])];
          const v = await this.client.leerTabla(hv, mv, oblig);
          hoja = `${hp} + ${hv}`;
          r = await aplicarMaestra(this.ctx, hp, p.filas, hv, v.filas);
        } else {
          const l = await this.client.leerServidores();
          hoja = l.hoja;
          r = await aplicarFilas(this.ctx, hoja, l.filas);
        }
        const dd = r.detalle as Record<string, number> | undefined;
        const mensaje = dd
          ? `${dd.santa_cruz} servidores de Santa Cruz en base maestra (${r.creados} nuevos), ${dd.excluidos_fuera_santa_cruz} excluidos por ubicación; ${dd.valoraciones_vinculadas} valoraciones vinculadas, ${dd.valoraciones_sin_vinculo} sin vínculo.`
          : `${r.procesados} registros procesados (${r.creados} nuevos, ${r.actualizados} actualizados).`;
        await db.query(
          `update ops.sync_ejecuciones set estado='ok', fin=now(), hoja=$2, registros_procesados=$3, creados=$4, actualizados=$5, errores=$6, mensaje=$7, detalle=$8 where id=$1`,
          [id, hoja, r.procesados, r.creados, r.actualizados, JSON.stringify(r.errores.slice(0, 200)), mensaje, JSON.stringify(r.detalle ?? {})],
        );
        if (r.creados > 0) await this.ctx.bus.emit(db, { tipo: 'sync.ok', topic: 'servidores', payload: { creados: r.creados } });
        await this.ctx.bus.emit(db, { tipo: 'sync.ok', topic: 'sync' });
        return { estado: 'ok', ...r, mensaje };
      } catch (e) {
        const mensaje = e instanceof SheetsNoConfigurado ? e.message : `Error: ${(e as Error).message}`;
        await db.query(`update ops.sync_ejecuciones set estado='error', fin=now(), mensaje=$2 where id=$1`, [id, mensaje.slice(0, 1000)]);
        await this.ctx.bus.emit(db, { tipo: 'sync.error', topic: 'sync' });
        return { estado: 'error', procesados: 0, creados: 0, actualizados: 0, errores: [], mensaje };
      }
    } finally {
      this.corriendo = false;
    }
  }

  iniciar() {
    if (this.ctx.cfg.SHEETS_SYNC_ENABLED !== 'true') return;
    const tick = () => this.ejecutar().catch(() => {});
    setTimeout(tick, 3_000);
    this.timer = setInterval(tick, this.ctx.cfg.SHEETS_SYNC_INTERVAL_SECONDS * 1000);
  }

  detener() {
    if (this.timer) clearInterval(this.timer);
  }

  async estado() {
    const db = this.ctx.db;
    const ultimo = (await db.query(`select * from ops.sync_ejecuciones order by id desc limit 1`)).rows[0] ?? null;
    const exito = (await db.query(`select * from ops.sync_ejecuciones where estado='ok' order by id desc limit 1`)).rows[0] ?? null;
    const historial = (await db.query(`select id, inicio, fin, estado, registros_procesados, creados, actualizados, jsonb_array_length(errores) as n_errores, mensaje from ops.sync_ejecuciones order by id desc limit 15`)).rows;
    return {
      configurado: this.client.configurado,
      habilitado: this.ctx.cfg.SHEETS_SYNC_ENABLED === 'true',
      intervalo_segundos: this.ctx.cfg.SHEETS_SYNC_INTERVAL_SECONDS,
      spreadsheet_id: this.ctx.cfg.SHEETS_SPREADSHEET_ID,
      gid: this.ctx.cfg.SHEETS_GID,
      modo: 'Consulta periódica de solo lectura (no es sincronización instantánea)',
      fuentes: this.ctx.cfg.SHEETS_MAESTRA_GID
        ? { maestra_gid: this.ctx.cfg.SHEETS_MAESTRA_GID, valoraciones_gid: this.ctx.cfg.SHEETS_GID, modo: 'base_maestra' }
        : { maestra_gid: null, valoraciones_gid: this.ctx.cfg.SHEETS_GID, modo: 'solo_valoraciones' },
      filtro_ubicacion: { columna: this.ctx.cfg.SHEETS_UBICACION_COLUMNA, valor: this.ctx.cfg.SHEETS_UBICACION_VALOR },
      riesgo: this.ctx.cfg.SHEETS_RIESGO_COLUMNA
        ? { configurado: true, columna: this.ctx.cfg.SHEETS_RIESGO_COLUMNA, valores_alto: this.ctx.cfg.SHEETS_RIESGO_VALORES }
        : { configurado: false, nota: 'La pestaña «Valoraciones» no contiene un campo explícito de clasificación profesional de riesgo. No se importa ni se infiere riesgo.' },
      estado_conexion: !this.client.configurado ? 'no_configurado' : ultimo?.estado === 'ok' ? 'conectado' : ultimo?.estado === 'error' ? 'error' : 'pendiente',
      ultima_sincronizacion_exitosa: exito?.fin ?? null,
      ultimo_intento: ultimo,
      historial,
    };
  }
}
