import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { AppCtx } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import { makeGuards } from '../auth';
import { tx, type Queryable } from '../db';
import { audit } from '../audit';
import { notificar, usuariosPorRol } from '../notify';
import { fechaDia, parse, u, uuid } from './util';
import { ESTADO_SOLICITUD_LABEL, ESTADOS_SOLICITUD, PRIORIDADES, TIPOS_SOLICITUD, TZ_INSTITUCIONAL, type EstadoSolicitud } from '@shared/domain';

const ABIERTAS = `('nueva','recibida','en_gestion','pendiente_respuesta_externa','requiere_informacion')`;
const ORDEN = `case s.prioridad when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end, s.fecha_respuesta_requerida nulls last, s.created_at`;

export function solicitudesRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { requirePerm } = makeGuards(ctx);
  const db = ctx.db;

  const base = `select s.*, us.nombre as solicitante_nombre, us.rol as solicitante_rol, sv.nombre as servidor_nombre,
                       (select max(ts) from ops.solicitud_acciones a where a.solicitud_id = s.id) as ultima_accion
                  from ops.solicitudes s join core.usuarios us on us.id = s.solicitante_id left join ops.servidores sv on sv.id = s.servidor_id`;

  async function cargar(c: Queryable, id: string) {
    const r = await c.query(`${base} where s.id = $1`, [id]);
    if (!r.rows[0]) throw notFound('Solicitud no encontrada');
    return r.rows[0];
  }

  app.post('/api/solicitudes', { preHandler: requirePerm('solicitudes.crear') }, async (req) => {
    const user = u(req);
    const b = parse(
      z.object({
        tipo: z.enum(TIPOS_SOLICITUD),
        descripcion: z.string().trim().min(5).max(3000),
        accion_requerida: z.string().trim().min(3).max(1500),
        prioridad: z.enum(PRIORIDADES),
        fecha_respuesta_requerida: fechaDia.optional(),
        observaciones: z.string().max(1500).optional(),
        servidor_id: uuid.optional(),
      }),
      req.body,
    );
    const res = await tx(db, async (c) => {
      if (b.servidor_id && user.rol === 'profesional') {
        const ok = await c.query(`select 1 from ops.asignaciones where servidor_id = $1 and profesional_id = $2 and activa`, [b.servidor_id, user.profesional_id]);
        if (!ok.rows[0]) throw forbidden('Solo puede vincular servidores asignados a usted.');
      }
      if (b.servidor_id && user.rol === 'territorial') throw badRequest('Los colaboradores territoriales no vinculan servidores.');
      const r = await c.query(
        `insert into ops.solicitudes (solicitante_id, tipo, descripcion, accion_requerida, prioridad, fecha_respuesta_requerida, observaciones, servidor_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, codigo`,
        [user.id, b.tipo, b.descripcion, b.accion_requerida, b.prioridad, b.fecha_respuesta_requerida ?? null, b.observaciones ?? null, b.servidor_id ?? null],
      );
      const { id, codigo } = r.rows[0];
      await c.query(`insert into ops.solicitud_acciones (solicitud_id, accion, estado_nuevo, actor_id) values ($1,'creada','nueva',$2)`, [id, user.id]);
      await audit(c, user, 'solicitud.creada', 'solicitud', id, { tipo: b.tipo, prioridad: b.prioridad }, req.ip);
      await notificar(
        c,
        ctx.bus,
        await usuariosPorRol(c, 'coordinacion'),
        { tipo: 'solicitud', titulo: `${b.prioridad === 'urgente' ? '⚠ URGENTE · ' : ''}Nueva solicitud ${codigo} de ${user.nombre}`, cuerpo: b.accion_requerida.slice(0, 200), enlace: `/solicitudes/${id}` },
        user.id,
      );
      await ctx.bus.emit(c, { tipo: 'solicitud.creada', topic: 'solicitudes', actor: user.id, texto: `${user.nombre} envió una solicitud de apoyo a Coordinación General.` });
      return { id, codigo };
    });
    return res;
  });

  app.get('/api/solicitudes', { preHandler: requirePerm('solicitudes.crear', 'solicitudes.gestionar') }, async (req) => {
    const user = u(req);
    const q = parse(z.object({ estado: z.enum(ESTADOS_SOLICITUD).optional(), filtro: z.enum(['abiertas', 'urgentes', 'seguimiento_hoy', 'todas']).optional() }), req.query);
    const propias = user.rol !== 'coordinacion';
    const hoy = DateTime.now().setZone(TZ_INSTITUCIONAL).toISODate();
    const conds: string[] = [];
    const params: unknown[] = [];
    if (propias) {
      params.push(user.id);
      conds.push(`s.solicitante_id = $${params.length}`);
    }
    if (q.estado) {
      params.push(q.estado);
      conds.push(`s.estado = $${params.length}`);
    }
    if (q.filtro === 'abiertas') conds.push(`s.estado in ${ABIERTAS}`);
    if (q.filtro === 'urgentes') conds.push(`s.prioridad = 'urgente' and s.estado in ${ABIERTAS}`);
    if (q.filtro === 'seguimiento_hoy') {
      params.push(hoy);
      conds.push(`s.fecha_seguimiento <= $${params.length} and s.estado in ${ABIERTAS}`);
    }
    const r = await db.query(`${base} ${conds.length ? 'where ' + conds.join(' and ') : ''} order by ${ORDEN} limit 500`, params);
    return r.rows;
  });

  app.get('/api/solicitudes/:id', { preHandler: requirePerm('solicitudes.crear', 'solicitudes.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const s = await cargar(db, id);
    if (user.rol !== 'coordinacion' && s.solicitante_id !== user.id) throw forbidden();
    const acciones = (await db.query(`select a.*, u.nombre as actor_nombre, u.rol as actor_rol from ops.solicitud_acciones a join core.usuarios u on u.id = a.actor_id where solicitud_id = $1 order by ts`, [id])).rows;
    if (user.rol === 'coordinacion' && s.estado === 'nueva') {
      // Revisar = primera apertura por Coordinación; queda registrado.
      await tx(db, async (c) => {
        await c.query(`update ops.solicitudes set estado = 'recibida', updated_at = now() where id = $1 and estado = 'nueva'`, [id]);
        await c.query(`insert into ops.solicitud_acciones (solicitud_id, accion, estado_anterior, estado_nuevo, actor_id) values ($1,'revisada','nueva','recibida',$2)`, [id, user.id]);
        await notificar(c, ctx.bus, [s.solicitante_id], { tipo: 'solicitud', titulo: `Su solicitud ${s.codigo} fue recibida por Coordinación General`, enlace: `/solicitudes/${id}` }, user.id);
        await ctx.bus.emit(c, { tipo: 'solicitud.recibida', topic: 'solicitudes', actor: user.id });
      });
      return { solicitud: await cargar(db, id), acciones: (await db.query(`select a.*, u.nombre as actor_nombre, u.rol as actor_rol from ops.solicitud_acciones a join core.usuarios u on u.id = a.actor_id where solicitud_id = $1 order by ts`, [id])).rows };
    }
    return { solicitud: s, acciones };
  });

  const accionSchema = z.object({
    accion: z.enum(['aceptar', 'responder', 'solicitar_informacion', 'gestion_registrada', 'seguimiento_programado', 'estado_actualizado', 'respuesta_externa', 'cerrar', 'informacion_aportada', 'comentario']),
    comentario: z.string().max(3000).optional(),
    institucion: z.string().max(200).optional(),
    fecha_seguimiento: fechaDia.optional(),
    estado: z.enum(ESTADOS_SOLICITUD).optional(),
  });

  app.post('/api/solicitudes/:id/acciones', { preHandler: requirePerm('solicitudes.crear', 'solicitudes.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(accionSchema, req.body);
    const esCoord = user.rol === 'coordinacion';
    await tx(db, async (c) => {
      const s = (await c.query(`select * from ops.solicitudes where id = $1 for update`, [id])).rows[0];
      if (!s) throw notFound();
      const esSolicitante = s.solicitante_id === user.id;
      if (!esCoord && !esSolicitante) throw forbidden();
      const coordOnly = ['aceptar', 'responder', 'solicitar_informacion', 'gestion_registrada', 'seguimiento_programado', 'estado_actualizado', 'respuesta_externa', 'cerrar'];
      if (coordOnly.includes(b.accion) && !esCoord) throw forbidden('Acción reservada a Coordinación General.');
      if (b.accion === 'informacion_aportada' && !esSolicitante) throw forbidden();
      if (s.estado === 'cerrada') throw conflict('La solicitud está cerrada.');
      let nuevo: EstadoSolicitud = s.estado;
      const upd: Record<string, unknown> = {};
      const req_ = (cond: unknown, msg: string) => {
        if (!cond) throw badRequest(msg);
      };
      switch (b.accion) {
        case 'aceptar':
          nuevo = 'en_gestion';
          break;
        case 'responder':
          req_(b.comentario, 'Escriba la respuesta.');
          upd.respuesta = b.comentario;
          break;
        case 'solicitar_informacion':
          req_(b.comentario, 'Indique qué información necesita.');
          nuevo = 'requiere_informacion';
          break;
        case 'informacion_aportada':
          req_(b.comentario, 'Escriba la información solicitada.');
          if (s.estado === 'requiere_informacion') nuevo = 'en_gestion';
          break;
        case 'gestion_registrada':
          req_(b.comentario, 'Describa la gestión realizada.');
          if (b.institucion) upd.institucion_contactada = b.institucion;
          if (['nueva', 'recibida'].includes(s.estado)) nuevo = 'en_gestion';
          break;
        case 'seguimiento_programado':
          req_(b.fecha_seguimiento, 'Indique la fecha de seguimiento.');
          upd.fecha_seguimiento = b.fecha_seguimiento;
          break;
        case 'respuesta_externa':
          req_(b.comentario, 'Registre la respuesta recibida.');
          if (b.institucion) upd.institucion_contactada = b.institucion;
          nuevo = b.estado && ['en_gestion', 'resuelta'].includes(b.estado) ? b.estado : 'en_gestion';
          break;
        case 'estado_actualizado':
          req_(b.estado, 'Indique el nuevo estado.');
          if (b.estado === 'cerrada') throw badRequest('Use la acción «Cerrar».');
          if (b.estado === 'nueva') throw badRequest('Estado no válido.');
          nuevo = b.estado!;
          if (b.institucion) upd.institucion_contactada = b.institucion;
          if (b.fecha_seguimiento) upd.fecha_seguimiento = b.fecha_seguimiento;
          break;
        case 'cerrar':
          if (s.estado !== 'resuelta') throw conflict('Solo se cierran solicitudes resueltas. Marque primero la solicitud como «Resuelta».');
          nuevo = 'cerrada';
          upd.cerrada_at = new Date().toISOString();
          break;
        case 'comentario':
          req_(b.comentario, 'Escriba un comentario.');
          break;
      }
      const sets = Object.keys(upd).map((k, i) => `${k} = $${i + 3}`);
      await c.query(`update ops.solicitudes set estado = $2, updated_at = now() ${sets.length ? ', ' + sets.join(', ') : ''} where id = $1`, [id, nuevo, ...Object.values(upd)]);
      const accionReg = b.accion === 'cerrar' ? 'cerrada' : b.accion === 'aceptar' ? 'aceptada' : b.accion === 'responder' ? 'respuesta' : b.accion;
      await c.query(
        `insert into ops.solicitud_acciones (solicitud_id, accion, comentario, institucion, fecha_seguimiento, estado_anterior, estado_nuevo, actor_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, accionReg, b.comentario ?? null, b.institucion ?? null, b.fecha_seguimiento ?? null, s.estado, nuevo, user.id],
      );
      await audit(c, user, `solicitud.${accionReg}`, 'solicitud', id, { de: s.estado, a: nuevo }, req.ip);
      // Notificaciones: Coordinación → solicitante; solicitante → Coordinación.
      if (esCoord && !esSolicitante) {
        const titulo =
          b.accion === 'responder'
            ? `Coordinación respondió su solicitud ${s.codigo}`
            : b.accion === 'solicitar_informacion'
              ? `Coordinación solicita información adicional (${s.codigo})`
              : nuevo !== s.estado
                ? `Solicitud ${s.codigo}: ${ESTADO_SOLICITUD_LABEL[nuevo]}`
                : `Actualización en su solicitud ${s.codigo}`;
        await notificar(c, ctx.bus, [s.solicitante_id], { tipo: 'solicitud', titulo, cuerpo: b.comentario?.slice(0, 200), enlace: `/solicitudes/${id}` }, user.id);
      } else if (esSolicitante) {
        await notificar(c, ctx.bus, await usuariosPorRol(c, 'coordinacion'), { tipo: 'solicitud', titulo: `${user.nombre} aportó información en ${s.codigo}`, cuerpo: b.comentario?.slice(0, 200), enlace: `/solicitudes/${id}` }, user.id);
      }
      await ctx.bus.emit(c, { tipo: 'solicitud.accion', topic: 'solicitudes', actor: user.id });
    });
    return { ok: true };
  });

  /** Panel personal de Coordinación General. */
  app.get('/api/coordinacion/panel', { preHandler: requirePerm('solicitudes.gestionar') }, async () => {
    const hoy = DateTime.now().setZone(TZ_INSTITUCIONAL);
    const hoyD = hoy.toISODate();
    const necesitan = (await db.query(`${base} where s.estado in ('nueva','recibida','requiere_informacion','en_gestion') order by ${ORDEN} limit 50`)).rows;
    const seguimientoHoy = (await db.query(`${base} where s.fecha_seguimiento <= $1 and s.estado in ${ABIERTAS} order by s.fecha_seguimiento`, [hoyD])).rows;
    const externas = (await db.query(`${base} where s.estado = 'pendiente_respuesta_externa' order by s.updated_at`)).rows;
    const atrasadas = (await db.query(`${base} where s.fecha_respuesta_requerida < $1 and s.estado in ${ABIERTAS} order by s.fecha_respuesta_requerida`, [hoyD])).rows;
    const compromisos = (
      await db.query(
        `select * from (
           select 'debriefing' as tipo, id, titulo, inicio from ops.debriefings where estado = 'programada' and inicio between now() and now() + interval '48 hours'
           union all
           select 'capacitacion', id, titulo, inicio from ops.capacitaciones where estado = 'programada' and inicio between now() and now() + interval '48 hours'
         ) x order by inicio`,
      )
    ).rows;
    const conteo = (await db.query(`select estado, count(*)::int as n from ops.solicitudes group by estado`)).rows;
    const urgentes = (await db.query(`select count(*)::int as n from ops.solicitudes where prioridad = 'urgente' and estado in ${ABIERTAS}`)).rows[0].n;
    // Alertas operativas basadas en datos reales.
    const alertas: { nivel: 'alta' | 'media'; texto: string; enlace?: string }[] = [];
    const derUrg = (await db.query(`select count(*)::int as n from ops.derivaciones where prioridad in ('urgente','alta') and estado in ('solicitada','en_revision','pendiente_coordinacion')`)).rows[0].n;
    if (derUrg) alertas.push({ nivel: 'alta', texto: `${derUrg} derivación(es) prioritaria(s) a Psiquiatría sin cita.`, enlace: '/derivaciones' });
    const aceptadasSinCita = (await db.query(`select count(*)::int as n from ops.derivaciones where estado = 'aceptada'`)).rows[0].n;
    if (aceptadasSinCita) alertas.push({ nivel: 'media', texto: `${aceptadasSinCita} derivación(es) aceptada(s) pendiente(s) de programar cita.`, enlace: '/derivaciones' });
    const sinDoc = (await db.query(`select count(*)::int as n from ops.atenciones where estado = 'atendida' and documentada_at is null and finalizada_at < now() - interval '24 hours'`)).rows[0].n;
    if (sinDoc) alertas.push({ nivel: 'media', texto: `${sinDoc} atención(es) realizadas hace más de 24 h sin documentación.` });
    const sync = (await db.query(`select estado from ops.sync_ejecuciones order by id desc limit 1`)).rows[0];
    if (sync?.estado === 'error') alertas.push({ nivel: 'media', texto: 'La última sincronización con la matriz institucional falló.', enlace: '/configuracion' });
    if (sync?.estado === 'no_configurado') alertas.push({ nivel: 'media', texto: 'La integración con Google Sheets aún no tiene credenciales.', enlace: '/configuracion' });
    const abiertasPend = (await db.query(`select count(*)::int as n from ops.solicitudes_atencion where estado = 'pendiente_asignacion'`)).rows[0].n;
    if (abiertasPend) alertas.push({ nivel: 'media', texto: `${abiertasPend} solicitud(es) de atención abierta pendiente(s) de asignación.`, enlace: '/atencion-abierta' });
    const prioSinAsignar = (await db.query(
      `select count(distinct r.servidor_id)::int as n from clinical.clasificaciones_riesgo r where r.vigente and not exists (select 1 from ops.asignaciones a where a.servidor_id = r.servidor_id and a.activa)`,
    )).rows[0].n;
    if (prioSinAsignar) alertas.push({ nivel: 'alta', texto: `${prioSinAsignar} servidor(es) de seguimiento prioritario sin profesional asignado.`, enlace: '/atencion-prioritaria' });
    const urgentes2 = (await db.query(
      `select count(*)::int as n from ops.atenciones a where a.inicio_urgente and not exists (select 1 from ops.consentimientos k where k.servidor_id = a.servidor_id and k.estado = 'validado' and k.revocado_at is null)`,
    )).rows[0].n;
    if (urgentes2) alertas.push({ nivel: 'media', texto: `${urgentes2} atención(es) iniciada(s) por protocolo de urgencia con consentimiento pendiente de regularizar.` });
    const sinAsignar = (await db.query(`select count(*)::int as n from ops.servidores s where activo_en_fuente and not exists (select 1 from ops.asignaciones a where a.servidor_id = s.id and a.activa)`)).rows[0].n;
    if (sinAsignar) alertas.push({ nivel: 'media', texto: `${sinAsignar} servidor(es) registrados sin profesional asignado.`, enlace: '/servidores' });
    return { que_necesitan: necesitan, gestionar_hoy: { seguimiento_hoy: seguimientoHoy, respuestas_externas: externas, atrasadas, compromisos }, conteo, urgentes, alertas, fecha: hoyD };
  });
}
