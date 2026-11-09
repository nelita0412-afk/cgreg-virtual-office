import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx, SessionUser } from '../context';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../context';
import { makeGuards } from '../auth';
import { tx, type Queryable } from '../db';
import { audit } from '../audit';
import { guardarWhatsapp, normalizarCelularEc } from '../teleatencion';
import { hashClaveConsulta, igualesTiempoConstante, normalizarClaveConsulta, nuevaClaveConsulta, sha256 } from '../crypto';
import { notificar, usuarioDeProfesional, usuariosPorRol } from '../notify';
import { exigirAsignacion, parse, u, uuid } from './util';
import { ESPECIALIDADES_CLINICAS, exigirNivel, nivelAcceso } from '../hce';
import { normalizar } from '../sheets/columns';

const tokens = (x: string) => new Set(normalizar(x).split(' ').filter((w) => w.length > 1));
const coincidenNombres = (a: string, b: string) => {
  const ta = tokens(a);
  const tb = tokens(b);
  const comunes = [...ta].filter((w) => tb.has(w)).length;
  return comunes >= Math.min(2, ta.size, tb.size);
};

/**
 * Dos vías de acceso a la atención:
 *  A. Prioritaria: servidores con clasificación profesional de riesgo alto registrada (matriz confirmada o registro profesional).
 *  B. Abierta: cualquier servidor de Santa Cruz puede solicitar atención voluntariamente, sin valoración previa.
 */
export function rutasRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { requirePerm } = makeGuards(ctx);
  const db = ctx.db;

  // =================== A. ATENCIÓN PRIORITARIA ===================
  app.get('/api/atencion-prioritaria', { preHandler: requirePerm('prioritaria.ver') }, async (req) => {
    const user = u(req);
    const esCoord = user.rol === 'coordinacion';
    if (!esCoord && !ESPECIALIDADES_CLINICAS.includes(user.especialidad ?? '')) throw forbidden();
    const pid = esCoord ? null : user.profesional_id;
    const r = await db.query(
      `select s.id, s.nombre, s.codigo_institucional, s.unidad, s.en_santa_cruz, s.verificacion,
              coalesce((select json_agg(json_build_object('profesional_id', a.profesional_id, 'nombre', p.nombre_corto)) from ops.asignaciones a join core.profesionales p on p.id = a.profesional_id where a.servidor_id = s.id and a.activa), '[]') as asignados,
              exists(select 1 from ops.contactos c where c.servidor_id = s.id and c.resultado = 'contactado') as contactado,
              (select min(a.inicio) from ops.atenciones a where a.servidor_id = s.id and a.estado in ('programada','confirmada','contacto_iniciado') and a.inicio > now()) as proxima_cita,
              (select count(*)::int from ops.atenciones a where a.servidor_id = s.id and a.estado = 'atendida') as atendidas,
              (select count(*)::int from ops.seguimientos g where g.servidor_id = s.id and g.estado = 'pendiente') as seguimientos_pendientes,
              exists(select 1 from ops.consentimientos k where k.servidor_id = s.id and k.estado = 'validado' and k.revocado_at is null) as consentimiento_validado,
              (select json_agg(json_build_object('fuente', r.fuente, 'fecha_valoracion', r.fecha_valoracion, 'requiere_seguimiento', r.requiere_seguimiento, 'registrado', r.created_at) order by r.created_at desc)
                 from clinical.clasificaciones_riesgo r where r.servidor_id = s.id and r.vigente) as clasificacion
         from ops.servidores s
        where exists (select 1 from clinical.clasificaciones_riesgo r where r.servidor_id = s.id and r.vigente)
          and s.en_santa_cruz is not false
          and ($1::text is null or exists (select 1 from ops.asignaciones a where a.servidor_id = s.id and a.profesional_id = $1 and a.activa))
        order by (select count(*) from ops.asignaciones a where a.servidor_id = s.id and a.activa) = 0 desc, s.nombre`,
      [pid],
    );
    await audit(db, user, 'prioritaria.consulta', null, null, { registros: r.rows.length }, req.ip);
    // Coordinación: dato operativo (seguimiento prioritario), sin el detalle de la clasificación clínica.
    return r.rows.map((x) => (esCoord ? { ...x, clasificacion: undefined } : x));
  });

  /** Registro de una clasificación de riesgo alto resultante de la valoración del propio profesional (no algorítmica). */
  app.post('/api/servidores/:id/riesgo', { preHandler: requirePerm('riesgo.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(
      z.object({ fecha_valoracion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), requiere_seguimiento: z.boolean(), confirmacion_profesional: z.literal(true) }),
      req.body,
    );
    if (!ESPECIALIDADES_CLINICAS.includes(user.especialidad ?? '')) throw forbidden('Solo profesionales clínicos registran clasificaciones de riesgo.');
    const r = await tx(db, async (c) => {
      await exigirAsignacion(c, user, id);
      const ya = await c.query(`select 1 from clinical.clasificaciones_riesgo where servidor_id = $1 and vigente and fuente = 'registro_profesional'`, [id]);
      if (ya.rows[0]) throw conflict('Ya existe una clasificación profesional vigente para este servidor.');
      const ins = await c.query(
        `insert into clinical.clasificaciones_riesgo (servidor_id, nivel, fuente, fecha_valoracion, requiere_seguimiento, profesional_id, registrado_por)
         values ($1,'alto','registro_profesional',$2,$3,$4,$5) returning id`,
        [id, b.fecha_valoracion, b.requiere_seguimiento, user.profesional_id, user.id],
      );
      await audit(c, user, 'riesgo.clasificacion_registrada', 'servidor', id, { clasificacion: ins.rows[0].id }, req.ip);
      await ctx.bus.emit(c, { tipo: 'prioritaria.alta', topic: 'prioritaria', actor: user.id });
      return { id: ins.rows[0].id };
    });
    return r;
  });

  app.post('/api/riesgo/:id/retirar', { preHandler: requirePerm('riesgo.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ motivo: z.string().trim().min(5).max(500) }), req.body);
    await tx(db, async (c) => {
      const r = (await c.query(`select * from clinical.clasificaciones_riesgo where id = $1`, [id])).rows[0];
      if (!r || !r.vigente) throw notFound('Clasificación vigente no encontrada.');
      await exigirNivel(c, user, r.servidor_id, 'clinico');
      if (r.fuente === 'matriz_valoraciones') throw conflict('Las clasificaciones provenientes de la matriz se actualizan en la matriz institucional.');
      await c.query(`update clinical.clasificaciones_riesgo set vigente = false, retirada_at = now(), retirada_por = $2, motivo_retiro = $3 where id = $1`, [id, user.id, b.motivo]);
      await audit(c, user, 'riesgo.clasificacion_retirada', 'servidor', r.servidor_id, { clasificacion: id }, req.ip);
      await ctx.bus.emit(c, { tipo: 'prioritaria.retiro', topic: 'prioritaria', actor: user.id });
    });
    return { ok: true };
  });

  // =================== B. ATENCIÓN ABIERTA ===================
  /**
   * Verificación de vínculo institucional contra la base maestra (Santa Cruz).
   * Automática solo con identificador institucional + nombre coincidentes; en cualquier otro caso queda
   * «pendiente de verificación» sin rechazar la solicitud.
   */
  async function verificar(c: Queryable, nombre: string, codigo?: string | null) {
    if (codigo) {
      const s = (await c.query(`select id, nombre from ops.servidores where en_base_maestra and en_santa_cruz and upper(codigo_institucional) = upper($1)`, [codigo.trim()])).rows[0];
      if (s && coincidenNombres(nombre, s.nombre)) return { verificacion: 'verificado_maestra' as const, servidor_id: s.id as string, sugerido: null };
      if (s) return { verificacion: 'pendiente_verificacion' as const, servidor_id: null, sugerido: s.id as string };
    }
    const candidatos = (await c.query(`select id, nombre from ops.servidores where en_base_maestra and en_santa_cruz`)).rows.filter((s) => {
      const a = tokens(nombre);
      const b = tokens(s.nombre);
      return a.size >= 2 && [...a].every((w) => b.has(w));
    });
    return { verificacion: 'pendiente_verificacion' as const, servidor_id: null, sugerido: candidatos.length === 1 ? (candidatos[0].id as string) : null };
  }

  const solicitudSchema = z.object({
    nombre: z.string().trim().min(5).max(200),
    identificador: z.string().trim().max(60).optional(),
    unidad: z.string().trim().max(200).optional(),
    contacto: z.string().trim().min(6).max(200),
    preferencia: z.enum(['psicologia', 'medicina', 'no_sabe']),
    horario: z.string().trim().max(300).optional(),
    motivo: z.string().trim().max(1500).optional(),
    acepta_aviso: z.literal(true),
    /** Opcional: celular para la teleatención por WhatsApp, solo si la persona lo autoriza expresamente. */
    whatsapp: z.string().trim().max(20).optional(),
    autoriza_whatsapp: z.boolean().optional(),
  });

  async function crearSolicitud(c: Queryable, b: z.infer<typeof solicitudSchema>, canal: 'formulario_publico' | 'registro_interno', user: SessionUser | null, ip: string) {
    const v = await verificar(c, b.nombre, b.identificador);
    const r = await c.query(
      `insert into ops.solicitudes_atencion (canal, servidor_id, servidor_sugerido_id, codigo_declarado, nombre_declarado, unidad_declarada, contacto_cifrado, preferencia_servicio,
         horario_preferido, motivo_cifrado, acepta_aviso_privacidad, verificacion, registrada_por, ip_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13) returning id, codigo`,
      [
        canal,
        v.servidor_id,
        v.sugerido,
        b.identificador || null,
        b.nombre,
        b.unidad || null,
        ctx.cipher.encrypt(b.contacto),
        b.preferencia,
        b.horario || null,
        b.motivo ? ctx.cipher.encrypt(b.motivo) : null,
        v.verificacion,
        user?.id ?? null,
        sha256(`${ip}|${ctx.cfg.DATA_ENCRYPTION_KEY.slice(0, 8)}`),
      ],
    );
    const { id, codigo } = r.rows[0];
    if (b.whatsapp) {
      const numero = normalizarCelularEc(b.whatsapp);
      if (!numero) throw badRequest('El celular para WhatsApp no es válido (ejemplo: 09 9999 9999).');
      if (!b.autoriza_whatsapp) throw badRequest('Para registrar el WhatsApp debe autorizar que la brigada le contacte por ese medio.');
      await c.query(`update ops.solicitudes_atencion set whatsapp_cifrado = $2, autoriza_whatsapp = true where id = $1`, [id, ctx.cipher.encrypt(numero)]);
    }
    // Solo el formulario público entrega clave de consulta: se muestra una vez y se guarda únicamente su HMAC.
    const clave = canal === 'formulario_publico' ? nuevaClaveConsulta() : null;
    if (clave) await c.query(`update ops.solicitudes_atencion set clave_consulta_hash = $2 where id = $1`, [id, hashClaveConsulta(clave, ctx.cfg.DATA_ENCRYPTION_KEY)]);
    await c.query(`insert into ops.solicitud_atencion_historial (solicitud_id, accion, estado_nuevo, nota_operativa, actor) values ($1,'recibida','pendiente_asignacion',$2,$3)`, [
      id,
      `Verificación: ${v.verificacion}`,
      user?.id ?? null,
    ]);
    await audit(c, user, 'abierta.solicitud_recibida', 'solicitud_atencion', id, { canal, verificacion: v.verificacion }, ip);
    await notificar(c, ctx.bus, await usuariosPorRol(c, 'coordinacion'), { tipo: 'abierta', titulo: `Nueva solicitud de atención ${codigo}`, cuerpo: v.verificacion === 'verificado_maestra' ? 'Vinculación verificada en base maestra.' : 'Requiere verificación de vínculo institucional.', enlace: '/atencion-abierta' }, user?.id ?? null);
    await ctx.bus.emit(c, { tipo: 'abierta.solicitud', topic: 'abierta', actor: user?.id ?? null, texto: 'Se recibió una nueva solicitud de atención abierta.' });
    return { id, codigo, clave };
  }

  app.get('/api/publico/config', async () => ({
    formulario_habilitado: ctx.cfg.FORMULARIO_PUBLICO_HABILITADO === 'true',
    emergencia_texto: ctx.cfg.EMERGENCIA_PUBLICO_TEXTO,
    modo_demo: ctx.cfg.MODO_DEMO === 'true',
  }));

  /** Formulario público (sin cuenta). La respuesta es idéntica exista o no la persona en la base (evita enumeración). */
  app.post('/api/publico/solicitud-atencion', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    if (ctx.cfg.FORMULARIO_PUBLICO_HABILITADO !== 'true') throw new HttpError(503, 'El formulario no está disponible en este momento.');
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const mensaje = 'Recibimos su solicitud. Un integrante de la brigada le contactará por el medio indicado. Si se trata de una emergencia, llame al ECU 911.';
    if (typeof raw.sitio_web === 'string' && raw.sitio_web.trim()) {
      // Campo trampa para automatizaciones: se responde igual pero no se registra.
      return { codigo: `SA-${Math.floor(1000 + Math.random() * 8999)}`, clave: nuevaClaveConsulta(), mensaje };
    }
    const b = parse(solicitudSchema, raw);
    const r = await tx(db, (c) => crearSolicitud(c, b, 'formulario_publico', null, req.ip));
    return { codigo: r.codigo, clave: r.clave, mensaje };
  });

  /**
   * Consulta pública del estado (sin cuenta) con el código y la clave entregados al enviar el formulario.
   * Devuelve solo la etapa del trámite y el día de la última actualización: ni nombres, ni contacto, ni profesional,
   * ni horario, ni motivo. Cualquier dato incorrecto da la misma respuesta genérica (no revela si el código existe)
   * y la comparación es en tiempo constante. Límite estricto de intentos por dirección.
   */
  const ETAPA_PUBLICA: Record<string, string> = {
    pendiente_asignacion: 'recibida',
    asignada: 'asignada',
    programada: 'programada',
    atendida: 'atendida',
    cerrada: 'cerrada',
    cancelada: 'cerrada',
  };
  const HASH_FICTICIO = sha256('sin-solicitud');
  app.post('/api/publico/solicitud-estado', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req) => {
    const b = parse(z.object({ codigo: z.string().trim().max(20), clave: z.string().trim().max(40) }), req.body);
    const codigo = b.codigo.toUpperCase().replace(/\s+/g, '');
    const clave = normalizarClaveConsulta(b.clave);
    const s = /^SA-\d{1,8}$/.test(codigo) && clave.length === 10
      ? (await db.query(`select id, estado, clave_consulta_hash, updated_at from ops.solicitudes_atencion where codigo = $1 and canal = 'formulario_publico'`, [codigo])).rows[0]
      : undefined;
    const esperado = s?.clave_consulta_hash ?? HASH_FICTICIO;
    const ok = igualesTiempoConstante(hashClaveConsulta(clave || 'X', ctx.cfg.DATA_ENCRYPTION_KEY), esperado) && !!s?.clave_consulta_hash;
    if (!ok) throw new HttpError(404, 'No encontramos una solicitud con ese código y esa clave. Revise que estén bien escritos.', 'consulta_no_encontrada');
    await audit(db, null, 'abierta.estado_consultado', 'solicitud_atencion', s.id, {}, req.ip);
    return { codigo, etapa: ETAPA_PUBLICA[s.estado] ?? 'recibida', actualizada: new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Galapagos' }).format(new Date(s.updated_at)) };
  });

  app.post('/api/atencion-abierta', { preHandler: requirePerm('abierta.registrar') }, async (req) => {
    const b = parse(solicitudSchema, req.body);
    return tx(db, (c) => crearSolicitud(c, b, 'registro_interno', u(req), req.ip));
  });

  async function cargar(c: Queryable, id: string) {
    const s = (await c.query(
      `select sa.*, s.nombre as servidor_nombre, s.codigo_institucional as servidor_codigo, s.unidad as servidor_unidad,
              sg.nombre as sugerido_nombre, sg.codigo_institucional as sugerido_codigo, p.nombre as profesional_nombre
         from ops.solicitudes_atencion sa left join ops.servidores s on s.id = sa.servidor_id left join ops.servidores sg on sg.id = sa.servidor_sugerido_id
         left join core.profesionales p on p.id = sa.profesional_asignado_id where sa.id = $1`,
      [id],
    )).rows[0];
    if (!s) throw notFound('Solicitud no encontrada');
    return s;
  }

  /** Coordinación ve datos de contacto y verificación (operativos); el motivo solo el profesional asignado. */
  function vista(user: SessionUser, s: any) {
    const { contacto_cifrado, motivo_cifrado, ip_hash, whatsapp_cifrado, ...rest } = s;
    void whatsapp_cifrado; // el número solo se usa para el enlace de contacto del profesional, nunca en listados
    const asignado = user.rol === 'profesional' && user.profesional_id === s.profesional_asignado_id;
    return { ...rest, contacto: ctx.cipher.decrypt(contacto_cifrado), motivo: asignado && motivo_cifrado ? ctx.cipher.decrypt(motivo_cifrado) : undefined, tiene_motivo: !!motivo_cifrado };
  }

  app.get('/api/atencion-abierta', { preHandler: requirePerm('abierta.ver') }, async (req) => {
    const user = u(req);
    const q = parse(z.object({ estado: z.string().optional(), verificacion: z.string().optional() }), req.query);
    const pid = user.rol === 'profesional' ? user.profesional_id : null;
    const r = await db.query(
      `select sa.*, s.nombre as servidor_nombre, p.nombre as profesional_nombre, sg.nombre as sugerido_nombre
         from ops.solicitudes_atencion sa left join ops.servidores s on s.id = sa.servidor_id left join core.profesionales p on p.id = sa.profesional_asignado_id
         left join ops.servidores sg on sg.id = sa.servidor_sugerido_id
        where ($1::text is null or sa.profesional_asignado_id = $1) and ($2::text is null or sa.estado = $2) and ($3::text is null or sa.verificacion = $3)
        order by case sa.estado when 'pendiente_asignacion' then 0 when 'asignada' then 1 when 'programada' then 2 else 3 end, sa.created_at desc limit 500`,
      [pid, q.estado ?? null, q.verificacion ?? null],
    );
    await audit(db, user, 'abierta.consulta', null, null, { registros: r.rows.length }, req.ip);
    return r.rows.map((s) => vista(user, s));
  });

  app.get('/api/atencion-abierta/:id', { preHandler: requirePerm('abierta.ver') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const s = await cargar(db, id);
    if (user.rol === 'profesional' && s.profesional_asignado_id !== user.profesional_id) throw forbidden();
    const hist = (await db.query(`select h.*, u.nombre as actor_nombre from ops.solicitud_atencion_historial h left join core.usuarios u on u.id = h.actor where solicitud_id = $1 order by ts`, [id])).rows;
    if (s.motivo_cifrado && user.rol === 'profesional') await audit(db, user, 'abierta.lectura_motivo', 'solicitud_atencion', id, {}, req.ip);
    return { solicitud: vista(user, s), historial: hist };
  });

  /** Búsqueda en la base maestra para vincular manualmente (Coordinación). */
  app.get('/api/base-maestra/buscar', { preHandler: requirePerm('abierta.gestionar') }, async (req) => {
    const q = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const r = await db.query(
      `select id, nombre, codigo_institucional, unidad, estado_servidor from ops.servidores
        where en_base_maestra and (nombre ilike '%' || $1 || '%' or codigo_institucional ilike '%' || $1 || '%') order by nombre limit 20`,
      [q.q],
    );
    return r.rows;
  });

  async function historial(c: Queryable, id: string, accion: string, ant: string | null, nuevo: string | null, actor: string, nota?: string | null) {
    await c.query(`insert into ops.solicitud_atencion_historial (solicitud_id, accion, estado_anterior, estado_nuevo, nota_operativa, actor) values ($1,$2,$3,$4,$5,$6)`, [id, accion, ant, nuevo, nota ?? null, actor]);
  }

  /** Crea el registro del servidor cuando no está en la base maestra (provisional, verificación pendiente o manual). */
  async function asegurarServidor(c: Queryable, s: any) {
    if (s.servidor_id) return s.servidor_id as string;
    const r = await c.query(
      `insert into ops.servidores (clave_fuente, codigo_institucional, nombre, unidad, verificacion, verificacion_nota, origen, contacto_cifrado, en_base_maestra, activo_en_fuente)
       values ($1,$2,$3,$4,$5,$6,'solicitud_abierta',$7,false,false)
       on conflict (clave_fuente) do update set nombre = excluded.nombre returning id`,
      [`SA:${s.codigo}`, s.codigo_declarado, s.nombre_declarado, s.unidad_declarada, s.verificacion, s.verificacion_nota, s.contacto_cifrado],
    );
    await c.query(`update ops.solicitudes_atencion set servidor_id = $2 where id = $1`, [s.id, r.rows[0].id]);
    return r.rows[0].id as string;
  }

  app.post('/api/atencion-abierta/:id/verificar', { preHandler: requirePerm('abierta.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(
      z.union([
        z.object({ servidor_id: uuid }),
        z.object({ resultado: z.enum(['verificado_manual', 'no_verificable']), nota: z.string().trim().min(5).max(500) }),
      ]),
      req.body,
    );
    await tx(db, async (c) => {
      const s = await cargar(c, id);
      if (['cerrada', 'cancelada'].includes(s.estado)) throw conflict('La solicitud está cerrada.');
      if ('servidor_id' in b) {
        const m = (await c.query(`select id, en_base_maestra from ops.servidores where id = $1`, [b.servidor_id])).rows[0];
        if (!m) throw notFound('Servidor no encontrado');
        if (s.servidor_id && s.servidor_id !== b.servidor_id) throw conflict('La solicitud ya está vinculada a otro registro; cancele y registre de nuevo si corresponde.');
        await c.query(`update ops.solicitudes_atencion set servidor_id = $2, verificacion = $3, verificacion_nota = 'Vinculado manualmente', updated_at = now() where id = $1`, [
          id,
          b.servidor_id,
          m.en_base_maestra ? 'verificado_maestra' : 'verificado_manual',
        ]);
        await historial(c, id, 'vinculada', s.estado, s.estado, user.id, 'Vinculada a registro institucional');
      } else {
        // «No verificable» no bloquea la atención: solo deja constancia.
        await c.query(`update ops.solicitudes_atencion set verificacion = $2, verificacion_nota = $3, updated_at = now() where id = $1`, [id, b.resultado, b.nota]);
        if (s.servidor_id) await c.query(`update ops.servidores set verificacion = $2, verificacion_nota = $3 where id = $1 and not en_base_maestra`, [s.servidor_id, b.resultado, b.nota]);
        await historial(c, id, b.resultado, s.estado, s.estado, user.id, b.nota);
      }
      await audit(c, user, 'abierta.verificacion', 'solicitud_atencion', id, {}, req.ip);
      await ctx.bus.emit(c, { tipo: 'abierta.verificacion', topic: 'abierta', actor: user.id });
    });
    return { ok: true };
  });

  app.post('/api/atencion-abierta/:id/asignar', { preHandler: requirePerm('abierta.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ profesional_id: z.string() }), req.body);
    const r = await tx(db, async (c) => {
      const s = await cargar(c, id);
      if (!['pendiente_asignacion', 'asignada'].includes(s.estado)) throw conflict('Solo se asignan solicitudes pendientes o ya asignadas (reasignación).');
      const p = (await c.query(`select especialidad, es_teleatencion, nombre from core.profesionales where id = $1 and activo`, [b.profesional_id])).rows[0];
      if (!p?.es_teleatencion || p.especialidad === 'psiquiatria') throw badRequest('Asigne Psicología o Medicina; Psiquiatría se gestiona por derivación.');
      const sid = await asegurarServidor(c, s);
      // El WhatsApp autorizado en la solicitud pasa al servidor (sin reemplazar uno ya autorizado).
      if (s.autoriza_whatsapp && s.whatsapp_cifrado) {
        const ya = (await c.query(`select whatsapp_cifrado from ops.servidores where id = $1`, [sid])).rows[0]?.whatsapp_cifrado;
        if (!ya) {
          await guardarWhatsapp(c, ctx, sid, ctx.cipher.decrypt(s.whatsapp_cifrado), 'solicitud_publica', null);
          await audit(c, user, 'servidor.whatsapp_autorizado', 'servidor', sid, { fuente: 'solicitud_publica' }, req.ip);
        }
      }
      await c.query(
        `insert into ops.asignaciones (servidor_id, profesional_id, asignada_por) select $1,$2,$3 where not exists (select 1 from ops.asignaciones where servidor_id=$1 and profesional_id=$2 and activa)`,
        [sid, b.profesional_id, user.id],
      );
      // Atención pendiente para el profesional (se programa luego con la agenda existente).
      const at = await c.query(`insert into ops.atenciones (servidor_id, profesional_id, tipo, estado, creado_por) values ($1,$2,$3,'pendiente',$4) returning id`, [sid, b.profesional_id, p.especialidad, user.id]);
      await c.query(`insert into ops.atencion_historial (atencion_id, estado_anterior, estado_nuevo, actor, nota_operativa) values ($1,null,'pendiente',$2,$3)`, [at.rows[0].id, user.id, `Atención abierta ${s.codigo}`]);
      await c.query(`update ops.solicitudes_atencion set estado = 'asignada', profesional_asignado_id = $2, atencion_id = $3, updated_at = now() where id = $1`, [id, b.profesional_id, at.rows[0].id]);
      await historial(c, id, 'asignada', s.estado, 'asignada', user.id, `Asignada a ${p.nombre}`);
      const dest = await usuarioDeProfesional(c, b.profesional_id);
      if (dest) await notificar(c, ctx.bus, [dest], { tipo: 'abierta', titulo: `Se le asignó la solicitud de atención ${s.codigo}`, cuerpo: 'Contacte a la persona y programe la atención.', enlace: '/atencion-abierta' }, user.id);
      await audit(c, user, 'abierta.asignada', 'solicitud_atencion', id, { profesional: b.profesional_id }, req.ip);
      await ctx.bus.emit(c, { tipo: 'abierta.asignada', topic: 'abierta', actor: user.id });
      return { servidor_id: sid, atencion_id: at.rows[0].id };
    });
    return r;
  });

  app.post('/api/atencion-abierta/:id/:accion', { preHandler: requirePerm('abierta.gestionar') }, async (req) => {
    const user = u(req);
    const { id, accion } = req.params as { id: string; accion: string };
    if (!['cancelar', 'cerrar'].includes(accion)) throw notFound();
    const b = parse(z.object({ nota: z.string().trim().min(3).max(500) }), req.body);
    await tx(db, async (c) => {
      const s = await cargar(c, id);
      if (['cerrada', 'cancelada'].includes(s.estado)) throw conflict('La solicitud ya está cerrada.');
      const nuevo = accion === 'cancelar' ? 'cancelada' : 'cerrada';
      await c.query(`update ops.solicitudes_atencion set estado = $2, cerrada_at = now(), updated_at = now() where id = $1`, [id, nuevo]);
      await historial(c, id, nuevo, s.estado, nuevo, user.id, b.nota);
      await audit(c, user, `abierta.${nuevo}`, 'solicitud_atencion', id, {}, req.ip);
      await ctx.bus.emit(c, { tipo: `abierta.${nuevo}`, topic: 'abierta', actor: user.id });
    });
    return { ok: true };
  });

  // Nivel de acceso del usuario actual sobre un servidor (para la interfaz).
  app.get('/api/servidores/:id/acceso', { preHandler: requirePerm('hce.ver', 'servidores.ver_todos', 'servidores.ver_asignados') }, async (req) => {
    const { id } = req.params as { id: string };
    return { nivel: await nivelAcceso(db, u(req), id) };
  });
}
