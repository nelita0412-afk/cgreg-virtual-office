import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx, SessionUser } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import { makeGuards } from '../auth';
import { tx } from '../db';
import { audit } from '../audit';
import { notificar, usuarioDeProfesional } from '../notify';
import { parse, u } from './util';
import type { PresenceService } from '../presence';
import { TEMAS_CAPACITACION } from '@shared/domain';

const iso = z.string().datetime({ offset: true });

export function actividadesRoutes(app: FastifyInstance, ctx: AppCtx, presence: PresenceService) {
  const { requirePerm } = makeGuards(ctx);
  const db = ctx.db;

  const puedeGestionar = (user: SessionUser, facilitador: string) => user.rol === 'coordinacion' || (user.rol === 'profesional' && user.profesional_id === facilitador);

  // ---------------- Debriefing ----------------
  app.get('/api/debriefings', { preHandler: requirePerm('actividades.ver') }, async () => {
    const r = await db.query(`select d.*, p.nombre as facilitador_nombre from ops.debriefings d join core.profesionales p on p.id = d.facilitador_id order by d.inicio desc limit 300`);
    return r.rows;
  });

  const debSchema = z.object({
    titulo: z.string().trim().min(3).max(200),
    facilitador_id: z.string(),
    grupo_destinatario: z.string().trim().min(3).max(300),
    inicio: iso,
    fin: iso,
    participantes_previstos: z.number().int().min(0).max(1000),
  });

  app.post('/api/debriefings', { preHandler: requirePerm('actividades.gestionar') }, async (req) => {
    const user = u(req);
    const b = parse(debSchema, req.body);
    if (!puedeGestionar(user, b.facilitador_id)) throw forbidden('Solo Coordinación o el propio facilitador pueden programar.');
    if (new Date(b.fin) <= new Date(b.inicio)) throw badRequest('La actividad debe terminar después de iniciar.');
    const id = await tx(db, async (c) => {
      const r = await c.query(
        `insert into ops.debriefings (titulo, facilitador_id, grupo_destinatario, inicio, fin, participantes_previstos, creado_por) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [b.titulo, b.facilitador_id, b.grupo_destinatario, b.inicio, b.fin, b.participantes_previstos, user.id],
      );
      await audit(c, user, 'debriefing.programado', 'debriefing', r.rows[0].id, {}, req.ip);
      const dest = await usuarioDeProfesional(c, b.facilitador_id);
      if (dest && dest !== user.id) await notificar(c, ctx.bus, [dest], { tipo: 'actividad', titulo: 'Se le asignó la facilitación de un debriefing', cuerpo: b.titulo, enlace: '/debriefing' }, user.id);
      await ctx.bus.emit(c, { tipo: 'debriefing.programado', topic: 'actividades', actor: user.id, texto: `Se programó una sesión de debriefing: ${b.titulo}.` });
      return r.rows[0].id;
    });
    return { id };
  });

  app.post('/api/debriefings/:id/:accion', { preHandler: requirePerm('actividades.gestionar') }, async (req) => {
    const user = u(req);
    const { id, accion } = req.params as { id: string; accion: string };
    const b = parse(z.object({ participantes_asistentes: z.number().int().min(0).max(1000).optional(), seguimiento: z.string().max(2000).optional() }), req.body);
    await tx(db, async (c) => {
      const d = (await c.query(`select d.*, p.nombre as facilitador_nombre from ops.debriefings d join core.profesionales p on p.id = d.facilitador_id where d.id = $1 for update of d`, [id])).rows[0];
      if (!d) throw notFound();
      if (!puedeGestionar(user, d.facilitador_id)) throw forbidden();
      if (accion === 'iniciar') {
        if (d.estado !== 'programada') throw conflict('Solo se inician sesiones programadas.');
        if (user.profesional_id !== d.facilitador_id) throw forbidden('La sesión la inicia el facilitador.');
        await c.query(`update ops.debriefings set estado='en_curso', iniciado_at=now() where id=$1`, [id]);
        await presence.porActividad(c, d.facilitador_id, { estado: 'en_reunion', zona: 'debriefing', ref_tipo: 'debriefing', ref_id: id }, `${d.facilitador_nombre} inició una sesión de debriefing.`);
      } else if (accion === 'finalizar') {
        if (d.estado !== 'en_curso') throw conflict('La sesión no está en curso.');
        if (b.participantes_asistentes == null) throw badRequest('Registre el número de participantes.');
        await c.query(`update ops.debriefings set estado='realizada', finalizado_at=now(), participantes_asistentes=$2, seguimiento=$3 where id=$1`, [id, b.participantes_asistentes, b.seguimiento ?? null]);
        await presence.porActividad(c, d.facilitador_id, { estado: 'disponible' }, `${d.facilitador_nombre} finalizó una sesión de debriefing.`);
      } else if (accion === 'cancelar') {
        if (d.estado !== 'programada') throw conflict('Solo se cancelan sesiones programadas.');
        await c.query(`update ops.debriefings set estado='cancelada' where id=$1`, [id]);
      } else if (accion === 'seguimiento') {
        await c.query(`update ops.debriefings set seguimiento=$2 where id=$1`, [id, b.seguimiento ?? null]);
      } else throw notFound();
      await audit(c, user, `debriefing.${accion}`, 'debriefing', id, {}, req.ip);
      await ctx.bus.emit(c, { tipo: `debriefing.${accion}`, topic: 'actividades', actor: user.id });
    });
    return { ok: true };
  });

  // ---------------- Capacitación DECE ----------------
  app.get('/api/capacitaciones', { preHandler: requirePerm('actividades.ver') }, async () => {
    const r = await db.query(`select c.*, p.nombre as facilitador_nombre from ops.capacitaciones c join core.profesionales p on p.id = c.facilitador_id order by c.inicio desc limit 300`);
    return r.rows;
  });

  const capSchema = z.object({
    tema: z.enum(TEMAS_CAPACITACION),
    titulo: z.string().trim().min(3).max(200),
    facilitador_id: z.string(),
    publico_objetivo: z.string().trim().min(3).max(300),
    institucion: z.string().max(200).optional(),
    inicio: iso,
    duracion_min: z.number().int().min(15).max(600),
    participantes_previstos: z.number().int().min(0).max(5000),
    observaciones: z.string().max(2000).optional(),
  });

  app.post('/api/capacitaciones', { preHandler: requirePerm('actividades.gestionar') }, async (req) => {
    const user = u(req);
    const b = parse(capSchema, req.body);
    if (!puedeGestionar(user, b.facilitador_id)) throw forbidden();
    const id = await tx(db, async (c) => {
      const r = await c.query(
        `insert into ops.capacitaciones (tema, titulo, facilitador_id, publico_objetivo, institucion, inicio, duracion_min, participantes_previstos, observaciones, creado_por)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [b.tema, b.titulo, b.facilitador_id, b.publico_objetivo, b.institucion ?? null, b.inicio, b.duracion_min, b.participantes_previstos, b.observaciones ?? null, user.id],
      );
      await audit(c, user, 'capacitacion.programada', 'capacitacion', r.rows[0].id, { tema: b.tema }, req.ip);
      await ctx.bus.emit(c, { tipo: 'capacitacion.programada', topic: 'actividades', actor: user.id, texto: `Se programó la capacitación DECE «${b.titulo}».` });
      return r.rows[0].id;
    });
    return { id };
  });

  app.post('/api/capacitaciones/:id/:accion', { preHandler: requirePerm('actividades.gestionar') }, async (req) => {
    const user = u(req);
    const { id, accion } = req.params as { id: string; accion: string };
    const b = parse(z.object({ participantes_asistentes: z.number().int().min(0).max(5000).optional(), observaciones: z.string().max(2000).optional() }), req.body);
    await tx(db, async (c) => {
      const d = (await c.query(`select c.*, p.nombre as facilitador_nombre from ops.capacitaciones c join core.profesionales p on p.id = c.facilitador_id where c.id = $1 for update of c`, [id])).rows[0];
      if (!d) throw notFound();
      if (!puedeGestionar(user, d.facilitador_id)) throw forbidden();
      if (accion === 'iniciar') {
        if (d.estado !== 'programada') throw conflict('Solo se inician capacitaciones programadas.');
        if (user.profesional_id !== d.facilitador_id) throw forbidden('La capacitación la inicia el facilitador.');
        await c.query(`update ops.capacitaciones set estado='en_curso', iniciado_at=now() where id=$1`, [id]);
        await presence.porActividad(c, d.facilitador_id, { estado: 'en_reunion', zona: 'capacitacion', ref_tipo: 'capacitacion', ref_id: id }, `${d.facilitador_nombre} inició una capacitación DECE.`);
      } else if (accion === 'finalizar') {
        if (d.estado !== 'en_curso') throw conflict('La capacitación no está en curso.');
        if (b.participantes_asistentes == null) throw badRequest('Registre el número de participantes.');
        await c.query(`update ops.capacitaciones set estado='realizada', finalizado_at=now(), participantes_asistentes=$2, observaciones=coalesce($3, observaciones) where id=$1`, [id, b.participantes_asistentes, b.observaciones ?? null]);
        await presence.porActividad(c, d.facilitador_id, { estado: 'disponible' }, `${d.facilitador_nombre} finalizó una capacitación DECE.`);
      } else if (accion === 'cancelar') {
        if (d.estado !== 'programada') throw conflict('Solo se cancelan capacitaciones programadas.');
        await c.query(`update ops.capacitaciones set estado='cancelada' where id=$1`, [id]);
      } else throw notFound();
      await audit(c, user, `capacitacion.${accion}`, 'capacitacion', id, {}, req.ip);
      await ctx.bus.emit(c, { tipo: `capacitacion.${accion}`, topic: 'actividades', actor: user.id });
    });
    return { ok: true };
  });

  // ---------------- Articulación territorial ----------------
  app.get('/api/articulaciones', { preHandler: requirePerm('territorio.registrar', 'indicadores.agregados') }, async (req) => {
    const user = u(req);
    const r = await db.query(
      `select a.*, u.nombre as usuario_nombre from ops.articulaciones a join core.usuarios u on u.id = a.usuario_id
        where $1::uuid is null or a.usuario_id = $1 order by a.fecha desc limit 300`,
      [user.rol === 'territorial' ? user.id : null],
    );
    return r.rows;
  });

  app.post('/api/articulaciones', { preHandler: requirePerm('territorio.registrar') }, async (req) => {
    const user = u(req);
    const b = parse(
      z.object({
        fecha: iso,
        lugar: z.string().trim().min(2).max(200),
        tipo: z.enum(['acompanamiento', 'contencion_grupal', 'coordinacion_educativa', 'reunion_equipo', 'otra']),
        descripcion: z.string().trim().min(3).max(2000),
        participantes: z.number().int().min(0).max(5000).optional(),
        requiere_apoyo: z.boolean().default(false),
      }),
      req.body,
    );
    const r = await db.query(
      `insert into ops.articulaciones (usuario_id, fecha, lugar, tipo, descripcion, participantes, requiere_apoyo) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [user.id, b.fecha, b.lugar, b.tipo, b.descripcion, b.participantes ?? null, b.requiere_apoyo],
    );
    await audit(db, user, 'territorio.registro', 'articulacion', r.rows[0].id, { tipo: b.tipo }, req.ip);
    await ctx.bus.emit(db, { tipo: 'territorio.registro', topic: 'actividades', actor: user.id, texto: `${user.nombre} registró una acción de articulación territorial.` });
    return { id: r.rows[0].id };
  });
}
