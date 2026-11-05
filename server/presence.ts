import type { AppCtx } from './context';
import type { Queryable } from './db';
import { conflict } from './context';
import { expandirReglas, franjasAIntervalos, enHorario, type ReglaDisponibilidad } from '@shared/schedule';
import {
  ESTADO_PRESENCIA_LABEL,
  type EstadoPresencia,
  type PresenciaSnapshot,
  type Zona,
  type Especialidad,
  type Rol,
} from '@shared/domain';

const zonaConsulta: Record<Especialidad, Zona> = {
  psicologia: 'consultorio_psicologia',
  telemedicina: 'telemedicina',
  psiquiatria: 'psiquiatria',
  trabajo_social: 'estacion',
};

export function zonaBase(rol: Rol, profesionalId: string | null): Zona {
  if (rol === 'coordinacion') return 'coordinacion';
  if (rol === 'territorial' || profesionalId === 'andrea-mayorga') return 'territorial';
  return 'estacion';
}

interface UsuarioBasico {
  id: string;
  nombre: string;
  rol: Rol;
  profesional_id: string | null;
  especialidad: Especialidad | null;
}

async function usuario(c: Queryable, id: string): Promise<UsuarioBasico> {
  const r = await c.query(
    `select u.id, u.nombre, u.rol, u.profesional_id, p.especialidad
       from core.usuarios u left join core.profesionales p on p.id = u.profesional_id where u.id = $1`,
    [id],
  );
  return r.rows[0];
}

/** Determina el estado que corresponde por actividades reales en curso (recuperación de estado). */
async function estadoPorActividad(c: Queryable, u: UsuarioBasico): Promise<{ estado: EstadoPresencia; zona: Zona; ref_tipo: string; ref_id: string } | null> {
  if (!u.profesional_id) return null;
  const at = await c.query(`select id, tipo from ops.atenciones where profesional_id = $1 and estado = 'en_atencion' limit 1`, [u.profesional_id]);
  if (at.rows[0]) return { estado: 'en_consulta', zona: zonaConsulta[at.rows[0].tipo as Especialidad], ref_tipo: 'atencion', ref_id: at.rows[0].id };
  const db = await c.query(`select id from ops.debriefings where facilitador_id = $1 and estado = 'en_curso' limit 1`, [u.profesional_id]);
  if (db.rows[0]) return { estado: 'en_reunion', zona: 'debriefing', ref_tipo: 'debriefing', ref_id: db.rows[0].id };
  const cap = await c.query(`select id from ops.capacitaciones where facilitador_id = $1 and estado = 'en_curso' limit 1`, [u.profesional_id]);
  if (cap.rows[0]) return { estado: 'en_reunion', zona: 'capacitacion', ref_tipo: 'capacitacion', ref_id: cap.rows[0].id };
  return null;
}

export class PresenceService {
  private reglasCache: { at: number; reglas: Map<string, ReglaDisponibilidad[]> } | null = null;

  constructor(private ctx: AppCtx) {}

  private async escribir(
    c: Queryable,
    u: UsuarioBasico,
    cambios: { conectado: boolean; estado: EstadoPresencia; zona: Zona; ref_tipo?: string | null; ref_id?: string | null },
    texto: string | null,
  ) {
    const prev = await c.query(`select conectado, estado, zona from ops.presencia where usuario_id = $1`, [u.id]);
    const p = prev.rows[0];
    if (p && p.conectado === cambios.conectado && p.estado === cambios.estado && p.zona === cambios.zona) {
      await c.query(`update ops.presencia set ref_tipo = $2, ref_id = $3 where usuario_id = $1`, [u.id, cambios.ref_tipo ?? null, cambios.ref_id ?? null]);
      return;
    }
    await c.query(
      `insert into ops.presencia (usuario_id, conectado, estado, zona, ref_tipo, ref_id, desde, ultimo_heartbeat)
       values ($1,$2,$3,$4,$5,$6, now(), case when $2 then now() else null end)
       on conflict (usuario_id) do update set conectado = excluded.conectado, estado = excluded.estado, zona = excluded.zona,
         ref_tipo = excluded.ref_tipo, ref_id = excluded.ref_id, desde = now(),
         ultimo_heartbeat = case when excluded.conectado then now() else ops.presencia.ultimo_heartbeat end`,
      [u.id, cambios.conectado, cambios.estado, cambios.zona, cambios.ref_tipo ?? null, cambios.ref_id ?? null],
    );
    await c.query(`insert into ops.presencia_historial (usuario_id, conectado, estado, zona) values ($1,$2,$3,$4)`, [
      u.id,
      cambios.conectado,
      cambios.estado,
      cambios.zona,
    ]);
    await this.ctx.bus.emit(c, {
      tipo: 'presencia.cambio',
      topic: 'presencia',
      actor: u.id,
      texto,
      payload: { usuario_id: u.id, profesional_id: u.profesional_id, estado: cambios.estado, zona: cambios.zona, conectado: cambios.conectado },
    });
  }

  /** Apertura de conexión real (WebSocket autenticado). */
  async conectar(userId: string) {
    const c = this.ctx.db;
    const u = await usuario(c, userId);
    const r = await c.query(`select conectado from ops.presencia where usuario_id = $1`, [userId]);
    if (r.rows[0]?.conectado) {
      await this.heartbeat(userId);
      return;
    }
    const act = await estadoPorActividad(c, u);
    if (act) await this.escribir(c, u, { conectado: true, ...act }, `${u.nombre} se reconectó (${ESTADO_PRESENCIA_LABEL[act.estado].toLowerCase()}).`);
    else await this.escribir(c, u, { conectado: true, estado: 'disponible', zona: zonaBase(u.rol, u.profesional_id) }, `${u.nombre} ingresó a la oficina virtual.`);
  }

  async heartbeat(userId: string) {
    await this.ctx.db.query(`update ops.presencia set ultimo_heartbeat = now() where usuario_id = $1 and conectado`, [userId]);
  }

  async desconectar(userId: string, motivo: 'cierre' | 'timeout' | 'logout') {
    const c = this.ctx.db;
    const u = await usuario(c, userId);
    const r = await c.query(`select conectado from ops.presencia where usuario_id = $1`, [userId]);
    if (!r.rows[0]?.conectado) return;
    await this.escribir(c, u, { conectado: false, estado: 'desconectado', zona: 'fuera' }, motivo === 'timeout' ? `${u.nombre} perdió la conexión.` : `${u.nombre} salió de la oficina virtual.`);
  }

  /** Marca desconectados a quienes dejaron de enviar heartbeat. */
  async barrer(segundos = this.ctx.cfg.PRESENCE_TIMEOUT_SECONDS) {
    const r = await this.ctx.db.query<{ usuario_id: string }>(
      `select usuario_id from ops.presencia where conectado and (ultimo_heartbeat is null or ultimo_heartbeat < now() - ($1 || ' seconds')::interval)`,
      [String(segundos)],
    );
    for (const row of r.rows) await this.desconectar(row.usuario_id, 'timeout');
    return r.rows.length;
  }

  /** Cambio manual de estado (solo estados permitidos y si no hay una actividad en curso). */
  async cambiarManual(userId: string, estado: EstadoPresencia) {
    const c = this.ctx.db;
    const u = await usuario(c, userId);
    const p = (await c.query(`select * from ops.presencia where usuario_id = $1`, [userId])).rows[0];
    if (!p?.conectado) throw conflict('No hay una conexión activa para este usuario.');
    const act = await estadoPorActividad(c, u);
    if (act) throw conflict('Hay una actividad en curso. Finalícela desde su módulo para cambiar de estado.');
    const zona: Zona = estado === 'en_pausa' ? 'descanso' : zonaBase(u.rol, u.profesional_id);
    await this.escribir(c, u, { conectado: true, estado, zona }, `${u.nombre} cambió su estado a ${ESTADO_PRESENCIA_LABEL[estado].toLowerCase()}.`);
  }

  /** Transición disparada por una actividad real confirmada (consulta, reunión...). */
  async porActividad(
    c: Queryable,
    profesionalId: string,
    cambio: { estado: EstadoPresencia; zona?: Zona; ref_tipo?: string | null; ref_id?: string | null },
    texto: string | null,
  ) {
    const r = await c.query(`select id from core.usuarios where profesional_id = $1`, [profesionalId]);
    if (!r.rows[0]) return;
    const u = await usuario(c, r.rows[0].id);
    const p = (await c.query(`select conectado from ops.presencia where usuario_id = $1`, [u.id])).rows[0];
    const conectado = !!p?.conectado;
    if (!conectado) {
      // La actividad se registra igualmente, pero no se representa presencia que no existe.
      if (texto) await this.ctx.bus.emit(c, { tipo: 'actividad', topic: 'actividades', actor: u.id, texto });
      return;
    }
    const zona = cambio.zona ?? (cambio.estado === 'en_pausa' ? 'descanso' : zonaBase(u.rol, u.profesional_id));
    await this.escribir(c, u, { conectado: true, estado: cambio.estado, zona, ref_tipo: cambio.ref_tipo, ref_id: cambio.ref_id }, texto);
  }

  zonaConsulta(e: Especialidad) {
    return zonaConsulta[e];
  }

  private async reglas(): Promise<Map<string, ReglaDisponibilidad[]>> {
    if (this.reglasCache && Date.now() - this.reglasCache.at < 60_000) return this.reglasCache.reglas;
    const r = await this.ctx.db.query(
      `select profesional_id, dia_semana, to_char(hora_inicio,'HH24:MI') as hora_inicio, to_char(hora_fin,'HH24:MI') as hora_fin, tz
         from core.disponibilidad where vigente`,
    );
    const m = new Map<string, ReglaDisponibilidad[]>();
    for (const row of r.rows) m.set(row.profesional_id, [...(m.get(row.profesional_id) ?? []), row]);
    this.reglasCache = { at: Date.now(), reglas: m };
    return m;
  }

  invalidarReglas() {
    this.reglasCache = null;
  }

  async snapshot(): Promise<PresenciaSnapshot[]> {
    const db = this.ctx.db;
    const ahora = new Date();
    const reglas = await this.reglas();
    const franjas = await db.query(
      `select profesional_id, inicio, fin from core.franjas_confirmadas where activa and fin > now() - interval '1 day' and inicio < now() + interval '1 day'`,
    );
    const filas = await db.query(`
      select p.id as profesional_id, p.nombre, p.nombre_corto, p.estacion, p.especialidad, p.es_teleatencion, p.color, p.cabello,
             u.id as usuario_id, coalesce(u.rol, case when p.es_teleatencion then 'profesional' else 'territorial' end) as rol,
             pr.conectado, pr.estado, pr.zona, pr.desde, p.orden
        from core.profesionales p
        left join core.usuarios u on u.profesional_id = p.id and u.activo
        left join ops.presencia pr on pr.usuario_id = u.id
       where p.activo and p.especialidad <> 'trabajo_social'
      union all
      select null, u.nombre, split_part(u.nombre, ' ', 1), null, null, false, null, null, u.id, u.rol, pr.conectado, pr.estado, pr.zona, pr.desde, 100
        from core.usuarios u left join ops.presencia pr on pr.usuario_id = u.id
       where u.activo and u.profesional_id is null and u.rol in ('coordinacion','territorial')
      order by orden`);
    return filas.rows.map((f) => {
      const ivs = f.profesional_id
        ? [
            ...expandirReglas(reglas.get(f.profesional_id) ?? [], new Date(ahora.getTime() - 86_400_000), new Date(ahora.getTime() + 86_400_000)),
            ...franjasAIntervalos(franjas.rows.filter((x) => x.profesional_id === f.profesional_id)),
          ]
        : [];
      const en_horario = f.profesional_id ? enHorario(ivs, ahora) : true;
      const conectado = !!f.conectado;
      const estado: EstadoPresencia = conectado ? f.estado : en_horario && f.profesional_id ? 'desconectado' : f.profesional_id ? 'fuera_de_horario' : 'desconectado';
      return {
        clave: f.profesional_id ?? f.usuario_id,
        usuario_id: f.usuario_id,
        profesional_id: f.profesional_id,
        tiene_cuenta: !!f.usuario_id,
        nombre: f.nombre,
        nombre_corto: f.nombre_corto,
        rol: f.rol,
        estacion: f.estacion,
        especialidad: f.especialidad,
        es_teleatencion: !!f.es_teleatencion,
        color: f.color,
        cabello: f.cabello,
        conectado,
        estado,
        zona: conectado ? f.zona : 'fuera',
        desde: f.desde ?? ahora.toISOString(),
        en_horario,
      } satisfies PresenciaSnapshot;
    });
  }
}
