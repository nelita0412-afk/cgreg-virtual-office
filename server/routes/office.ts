import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { AppCtx } from '../context';
import { forbidden } from '../context';
import { makeGuards } from '../auth';
import { parse, u } from './util';
import type { PresenceService } from '../presence';
import { ESTADOS_MANUALES, TZ_INSTITUCIONAL, type EstadoPresencia } from '@shared/domain';
import { puede } from '@shared/permissions';
import { resumenSemanalInstitucional, type ReglaDisponibilidad } from '@shared/schedule';
import { audit } from '../audit';

function hoyGalapagos() {
  const d = DateTime.now().setZone(TZ_INSTITUCIONAL);
  return { ini: d.startOf('day').toUTC().toISO()!, fin: d.endOf('day').toUTC().toISO()! };
}

export function officeRoutes(app: FastifyInstance, ctx: AppCtx, presence: PresenceService) {
  const { requirePerm } = makeGuards(ctx);
  const db = ctx.db;

  app.get('/api/office/presencia', { preHandler: requirePerm('oficina.entrar') }, async () => presence.snapshot());

  app.post('/api/office/estado', { preHandler: requirePerm('presencia.propia') }, async (req) => {
    const b = parse(z.object({ estado: z.enum(ESTADOS_MANUALES as [EstadoPresencia, ...EstadoPresencia[]]) }), req.body);
    await presence.cambiarManual(u(req).id, b.estado);
    return { ok: true };
  });

  /** Feed general: solo textos públicos (sin nombres de servidores ni motivos clínicos). */
  app.get('/api/office/eventos', { preHandler: requirePerm('oficina.entrar') }, async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().min(1).max(100).default(20) }), req.query);
    const r = await db.query(
      `select e.id, e.ts, e.tipo, e.topic, e.texto_publico as texto, u.nombre as actor_nombre
         from ops.eventos e left join core.usuarios u on u.id = e.actor_usuario_id
        where e.texto_publico is not null and e.destinatarios is null order by e.id desc limit $1`,
      [q.limit],
    );
    return r.rows;
  });

  /** Indicadores del encabezado y resumen del día (hora de Galápagos). Datos reales. */
  app.get('/api/office/resumen', { preHandler: requirePerm('oficina.ver') }, async (req) => {
    const user = u(req);
    const { ini, fin } = hoyGalapagos();
    const snap = await presence.snapshot();
    const tele = snap.filter((s) => s.es_teleatencion);
    const at = (
      await db.query(
        `select count(*) filter (where estado in ('programada','confirmada','contacto_iniciado','en_atencion','atendida','no_realizada')) as agendadas_hoy,
                count(*) filter (where estado = 'atendida') as atendidas_hoy,
                count(*) filter (where estado in ('programada','confirmada','contacto_iniciado') and inicio > now()) as proximas_hoy,
                count(*) filter (where estado = 'no_realizada') as no_realizadas_hoy
           from ops.atenciones where inicio between $1 and $2`,
        [ini, fin],
      )
    ).rows[0];
    const der = (await db.query(`select count(*) filter (where estado not in ('cerrada','valorada','en_seguimiento')) as activas, count(*) filter (where estado in ('solicitada','en_revision','pendiente_coordinacion')) as pendientes from ops.derivaciones`)).rows[0];
    const sol = puede(user, 'solicitudes.gestionar')
      ? (await db.query(`select count(*) as n from ops.solicitudes where estado not in ('resuelta','cerrada')`)).rows[0].n
      : null;
    const proximas = await db.query(
      `select * from (
         select 'debriefing' as tipo, d.id, d.titulo, d.inicio, d.estado, p.nombre as facilitador from ops.debriefings d join core.profesionales p on p.id = d.facilitador_id
          where d.estado in ('programada','en_curso') and d.fin > now()
         union all
         select 'capacitacion', c.id, c.titulo, c.inicio, c.estado, p.nombre from ops.capacitaciones c join core.profesionales p on p.id = c.facilitador_id
          where c.estado in ('programada','en_curso') and c.inicio + (c.duracion_min || ' minutes')::interval > now()
       ) x order by inicio limit 6`,
    );
    const agendadas = Number(at.agendadas_hoy);
    const resueltas = Number(at.atendidas_hoy) + Number(at.no_realizadas_hoy);
    return {
      profesionales: tele.length,
      conectados: tele.filter((s) => s.conectado).length,
      disponibles: tele.filter((s) => s.estado === 'disponible').length,
      en_consulta: tele.filter((s) => s.estado === 'en_consulta').length,
      en_reunion: tele.filter((s) => s.estado === 'en_reunion').length,
      atenciones_hoy: agendadas,
      atendidas_hoy: Number(at.atendidas_hoy),
      proximas_citas: Number(at.proximas_hoy),
      cumplimiento_agenda_hoy: resueltas ? Math.round((Number(at.atendidas_hoy) / resueltas) * 100) : null,
      derivaciones_activas: Number(der.activas),
      derivaciones_pendientes: Number(der.pendientes),
      solicitudes_abiertas: sol == null ? null : Number(sol),
      proximas_actividades: proximas.rows,
      actualizado: new Date().toISOString(),
    };
  });

  // ---------------- Profesionales ----------------
  async function reglasDe(id?: string) {
    const r = await db.query(
      `select id, profesional_id, dia_semana, to_char(hora_inicio,'HH24:MI') as hora_inicio, to_char(hora_fin,'HH24:MI') as hora_fin, tz
         from core.disponibilidad where vigente ${id ? 'and profesional_id = $1' : ''} order by dia_semana, hora_inicio`,
      id ? [id] : [],
    );
    return r.rows as (ReglaDisponibilidad & { id: number; profesional_id: string })[];
  }

  /**
   * Ficha de directorio de consulta limitada: identidad profesional y función en la Brigada. Sin casos, cargas,
   * estadísticas individuales ni datos personales. La disponibilidad solo se informa para Psiquiatría (destino
   * de derivaciones), que es cuando hace falta para coordinar.
   */
  async function fichasDirectorio(soloOficial: boolean) {
    const pros = (await db.query(
      `select id, nombre, nombre_corto, titulo, especialidad, perfil, experiencia, instituciones, funcion_brigada, modalidad, es_teleatencion, color, orden
         from core.profesionales where activo ${soloOficial ? 'and en_directorio' : ''} order by orden, nombre`,
    )).rows;
    const franjas = (await db.query(
      `select f.profesional_id, f.inicio, f.fin from core.franjas_confirmadas f join core.profesionales p on p.id = f.profesional_id
        where f.activa and f.fin > now() and p.especialidad = 'psiquiatria' order by f.inicio`,
    )).rows;
    const snap = await presence.snapshot();
    return pros.map((p) => {
      const esPsiq = p.especialidad === 'psiquiatria';
      const pr = snap.find((x) => x.profesional_id === p.id);
      return {
        ...p,
        disponibilidad_derivacion: esPsiq
          ? { conectado: !!pr?.conectado, disponible_ahora: pr?.estado === 'disponible', proximas_franjas: franjas.filter((f) => f.profesional_id === p.id).slice(0, 5).map(({ inicio, fin }) => ({ inicio, fin })) }
          : null,
      };
    });
  }

  app.get('/api/directorio', { preHandler: requirePerm('directorio.ver') }, async (req) => {
    await audit(db, u(req), 'directorio.consulta', null, null, {}, req.ip);
    return fichasDirectorio(true);
  });

  app.get('/api/profesionales', { preHandler: requirePerm('equipo.ver', 'directorio.ver') }, async (req) => {
    // Sin «Mi Equipo», solo la ficha limitada (sirve para selectores: especialidad y duración de citas).
    if (!puede(u(req), 'equipo.ver')) return fichasDirectorio(false);
    const pros = (await db.query(`select p.*, exists(select 1 from core.usuarios u where u.profesional_id = p.id and u.activo) as tiene_cuenta from core.profesionales p where activo order by orden`)).rows;
    const reglas = await reglasDe();
    const franjas = (await db.query(`select id, profesional_id, inicio, fin, nota from core.franjas_confirmadas where activa and fin > now() order by inicio`)).rows;
    return pros.map((p) => {
      const rs = reglas.filter((r) => r.profesional_id === p.id);
      return {
        ...p,
        disponibilidad_origen: rs,
        disponibilidad_institucional: resumenSemanalInstitucional(rs),
        franjas_confirmadas: franjas.filter((f) => f.profesional_id === p.id),
      };
    });
  });

  /** Ficha para el panel lateral: datos operativos (sin información de servidores). */
  app.get('/api/profesionales/:id/panel', { preHandler: requirePerm('equipo.ver', 'oficina.entrar') }, async (req) => {
    const { id } = req.params as { id: string };
    const { ini, fin } = hoyGalapagos();
    const p = (await db.query(`select * from core.profesionales where id = $1`, [id])).rows[0];
    if (!p) throw forbidden('Profesional no encontrado');
    if (!puede(u(req), 'equipo.ver')) {
      // Tocar un avatar en la Oficina no da acceso a nada más: ficha de directorio y estado operativo básico.
      const pr = (await presence.snapshot()).find((s) => s.profesional_id === id);
      const { id: pid, nombre, nombre_corto, titulo, especialidad, perfil, experiencia, instituciones, funcion_brigada, modalidad, color } = p;
      return {
        limitado: true,
        profesional: { id: pid, nombre, nombre_corto, titulo, especialidad, perfil, experiencia, instituciones, funcion_brigada, modalidad, color },
        presencia: pr ? { estado: pr.estado, conectado: pr.conectado } : null,
      };
    }
    const prox = (await db.query(`select inicio, tipo from ops.atenciones where profesional_id = $1 and estado in ('programada','confirmada','contacto_iniciado') and inicio > now() order by inicio limit 1`, [id])).rows[0] ?? null;
    const hoy = (await db.query(`select count(*) filter (where estado = 'atendida') as atendidas, count(*) filter (where estado in ('programada','confirmada','contacto_iniciado','en_atencion','atendida','no_realizada')) as agendadas from ops.atenciones where profesional_id = $1 and inicio between $2 and $3`, [id, ini, fin])).rows[0];
    const seg = (await db.query(`select count(*) as n from ops.seguimientos where profesional_id = $1 and estado = 'pendiente'`, [id])).rows[0];
    const rs = await reglasDe(id);
    const snap = (await presence.snapshot()).find((s) => s.profesional_id === id);
    return {
      profesional: p,
      presencia: snap ?? null,
      disponibilidad_institucional: resumenSemanalInstitucional(rs),
      franjas_confirmadas: (await db.query(`select id, inicio, fin, nota from core.franjas_confirmadas where profesional_id = $1 and activa and fin > now() order by inicio limit 10`, [id])).rows,
      proxima_cita: prox,
      atenciones_hoy: Number(hoy.atendidas),
      agendadas_hoy: Number(hoy.agendadas),
      seguimientos_pendientes: Number(seg.n),
    };
  });

  /** Franjas confirmadas (Psiquiatría u horarios extraordinarios). */
  app.post('/api/profesionales/:id/franjas', { preHandler: requirePerm('agenda.gestionar', 'disponibilidad.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    if (user.rol === 'profesional' && user.profesional_id !== id) throw forbidden('Solo puede confirmar su propia disponibilidad.');
    const b = parse(z.object({ inicio: z.string().datetime({ offset: true }), fin: z.string().datetime({ offset: true }), nota: z.string().max(300).optional() }), req.body);
    if (new Date(b.fin) <= new Date(b.inicio)) throw forbidden('La franja debe terminar después de iniciar.');
    const r = await db.query(`insert into core.franjas_confirmadas (profesional_id, inicio, fin, confirmado_por, nota) values ($1,$2,$3,$4,$5) returning id`, [id, b.inicio, b.fin, user.id, b.nota ?? null]);
    await audit(db, user, 'disponibilidad.franja_confirmada', 'profesional', id, { inicio: b.inicio, fin: b.fin }, req.ip);
    const nombre = (await db.query(`select nombre from core.profesionales where id = $1`, [id])).rows[0]?.nombre;
    await ctx.bus.emit(db, { tipo: 'disponibilidad.confirmada', topic: 'agenda', actor: user.id, texto: `${nombre} confirmó disponibilidad de atención.` });
    presence.invalidarReglas();
    return { id: r.rows[0].id };
  });

  app.delete('/api/profesionales/:id/franjas/:fid', { preHandler: requirePerm('agenda.gestionar', 'disponibilidad.gestionar') }, async (req) => {
    const user = u(req);
    const { id, fid } = req.params as { id: string; fid: string };
    if (user.rol === 'profesional' && user.profesional_id !== id) throw forbidden();
    await db.query(`update core.franjas_confirmadas set activa = false where id = $1 and profesional_id = $2`, [fid, id]);
    await audit(db, user, 'disponibilidad.franja_anulada', 'profesional', id, { franja: fid }, req.ip);
    await ctx.bus.emit(db, { tipo: 'disponibilidad.anulada', topic: 'agenda', actor: user.id });
    presence.invalidarReglas();
    return { ok: true };
  });

  /** Reemplaza el horario semanal (en hora de origen del profesional). */
  app.put('/api/profesionales/:id/disponibilidad', { preHandler: requirePerm('disponibilidad.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const hm = z.string().regex(/^\d{2}:\d{2}$/);
    const b = parse(z.object({ reglas: z.array(z.object({ dia_semana: z.number().int().min(1).max(7), hora_inicio: hm, hora_fin: hm })).max(21) }), req.body);
    const tz = (await db.query(`select tz from core.profesionales where id = $1`, [id])).rows[0]?.tz;
    if (!tz) throw forbidden('Profesional no encontrado');
    for (const r of b.reglas) if (r.hora_fin <= r.hora_inicio) throw forbidden('Cada franja debe terminar después de iniciar.');
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query(`update core.disponibilidad set vigente = false where profesional_id = $1 and vigente`, [id]);
      for (const r of b.reglas) await c.query(`insert into core.disponibilidad (profesional_id, dia_semana, hora_inicio, hora_fin, tz, creado_por) values ($1,$2,$3,$4,$5,$6)`, [id, r.dia_semana, r.hora_inicio, r.hora_fin, tz, user.id]);
      await audit(c, user, 'disponibilidad.actualizada', 'profesional', id, { reglas: b.reglas.length }, req.ip);
      await ctx.bus.emit(c, { tipo: 'disponibilidad.actualizada', topic: 'agenda', actor: user.id });
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
    presence.invalidarReglas();
    return { ok: true };
  });
}
