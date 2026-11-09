import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { AppCtx, SessionUser } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import { makeGuards } from '../auth';
import { tx, type Queryable } from '../db';
import { audit } from '../audit';
import { notificar, usuarioDeProfesional, usuariosPorRol } from '../notify';
import { disponibilidadDe, ocupadosDe } from '../agenda';
import { asegurarEntrada, consentimientoVigente, nivelAcceso } from '../hce';
import { sha256 } from '../crypto';
import { exigirAsignacion, fechaDia, parse, u, uuid } from './util';
import type { PresenceService } from '../presence';
import { ESPECIALIDAD_LABEL, TZ_INSTITUCIONAL, type Especialidad } from '@shared/domain';
import { ERROR_AGENDA_LABEL, franjasLibres, validarCita, fmtInstitucional } from '@shared/schedule';

const MOTIVOS_NO_REALIZADA = ['servidor_no_se_conecto', 'servidor_cancelo', 'problema_tecnico', 'profesional_no_disponible', 'otro'] as const;

interface NotaClinica {
  resumen: string;
  motivo_consulta?: string;
  evaluacion?: string;
  intervencion?: string;
  evolucion?: string;
  resultado?: string;
  plan?: string;
  recomendaciones?: string;
}

export function agendaRoutes(app: FastifyInstance, ctx: AppCtx, presence: PresenceService) {
  const { requirePerm, requireAuth } = makeGuards(ctx);
  const db = ctx.db;

  async function cargarAtencion(c: Queryable, id: string) {
    const r = await c.query(
      `select a.*, p.nombre as profesional_nombre, p.especialidad from ops.atenciones a join core.profesionales p on p.id = a.profesional_id where a.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw notFound('Atención no encontrada');
    return r.rows[0];
  }

  function exigirPropietario(user: SessionUser, at: { profesional_id: string }) {
    if (user.rol !== 'profesional' || user.profesional_id !== at.profesional_id) throw forbidden('Solo el profesional responsable puede realizar esta acción.');
  }

  async function historial(c: Queryable, atencionId: string, anterior: string | null, nuevo: string, actor: string, nota?: string | null) {
    await c.query(`insert into ops.atencion_historial (atencion_id, estado_anterior, estado_nuevo, actor, nota_operativa) values ($1,$2,$3,$4,$5)`, [
      atencionId,
      anterior,
      nuevo,
      actor,
      nota ?? null,
    ]);
  }

  /** Programa una cita respetando disponibilidad, duración y ausencia de choques. */
  async function programar(
    c: Queryable,
    user: SessionUser,
    b: { servidor_id: string; profesional_id: string; inicio: string; duracion_min: number; derivacion_id?: string; atencion_id?: string; reprogramada_desde?: string },
    ip: string,
  ) {
    const pro = (await c.query(`select * from core.profesionales where id = $1 and activo`, [b.profesional_id])).rows[0];
    if (!pro || !pro.es_teleatencion) throw badRequest('Profesional no válido para teleatención.');
    const esp = pro.especialidad as Especialidad;
    if (user.rol === 'profesional' && user.profesional_id !== b.profesional_id) throw forbidden('Solo puede programar citas en su propia agenda.');
    if (esp === 'psiquiatria') {
      if (!b.derivacion_id) throw badRequest('Las citas de Psiquiatría requieren una derivación aceptada.');
      const d = (await c.query(`select * from ops.derivaciones where id = $1 for update`, [b.derivacion_id])).rows[0];
      if (!d || d.servidor_id !== b.servidor_id || d.especialista_id !== b.profesional_id) throw badRequest('La derivación no corresponde al servidor o especialista.');
      if (!b.reprogramada_desde && d.estado !== 'aceptada') throw conflict('La derivación debe estar en estado «Aceptada» para programar la valoración.');
      if (user.rol === 'profesional' && user.profesional_id !== d.especialista_id) throw forbidden();
    } else if (user.rol === 'profesional') {
      await exigirAsignacion(c, user, b.servidor_id);
    } else if (user.rol === 'coordinacion') {
      await c.query(
        `insert into ops.asignaciones (servidor_id, profesional_id, asignada_por) select $1,$2,$3
          where not exists (select 1 from ops.asignaciones where servidor_id=$1 and profesional_id=$2 and activa)`,
        [b.servidor_id, b.profesional_id, user.id],
      );
    } else throw forbidden();

    const inicio = new Date(b.inicio);
    const disp = await disponibilidadDe(c, b.profesional_id, new Date(inicio.getTime() - 86_400_000), new Date(inicio.getTime() + 86_400_000));
    const err = validarCita({ inicio, duracionMin: b.duracion_min, especialidad: esp, disponibilidad: disp });
    if (err) throw badRequest(ERROR_AGENDA_LABEL[err], err);
    const fin = new Date(inicio.getTime() + b.duracion_min * 60_000);
    let id: string;
    try {
      await c.query('savepoint cita');
      if (b.atencion_id) {
        const prev = (await c.query(`select * from ops.atenciones where id = $1 for update`, [b.atencion_id])).rows[0];
        if (!prev || prev.estado !== 'pendiente' || prev.servidor_id !== b.servidor_id) throw badRequest('La atención pendiente no es válida.');
        await c.query(`update ops.atenciones set profesional_id=$2, tipo=$3, inicio=$4, fin=$5, duracion_min=$6, estado='programada', updated_at=now() where id=$1`, [
          b.atencion_id,
          b.profesional_id,
          esp,
          inicio.toISOString(),
          fin.toISOString(),
          b.duracion_min,
        ]);
        id = b.atencion_id;
      } else {
        const r = await c.query(
          `insert into ops.atenciones (servidor_id, profesional_id, tipo, inicio, fin, duracion_min, estado, derivacion_id, reprogramada_desde, creado_por)
           values ($1,$2,$3,$4,$5,$6,'programada',$7,$8,$9) returning id`,
          [b.servidor_id, b.profesional_id, esp, inicio.toISOString(), fin.toISOString(), b.duracion_min, b.derivacion_id ?? null, b.reprogramada_desde ?? null, user.id],
        );
        id = r.rows[0].id;
      }
      await c.query('release savepoint cita');
    } catch (e: any) {
      await c.query('rollback to savepoint cita');
      if (e?.code === '23P01') {
        throw conflict(
          e.constraint === 'atencion_sin_choque_servidor'
            ? 'El servidor ya tiene otra cita en ese horario.'
            : 'Ese horario ya está reservado en la agenda del profesional.',
          'choque_agenda',
        );
      }
      throw e;
    }
    await historial(c, id, b.atencion_id ? 'pendiente' : null, 'programada', user.id);
    if (b.atencion_id) await c.query(`update ops.solicitudes_atencion set estado = 'programada', updated_at = now() where atencion_id = $1 and estado = 'asignada'`, [id]);
    if (b.derivacion_id && !b.reprogramada_desde) {
      await c.query(`update ops.derivaciones set estado='programada', atencion_id=$2, updated_at=now() where id=$1`, [b.derivacion_id, id]);
      await c.query(`insert into ops.derivacion_historial (derivacion_id, estado_anterior, estado_nuevo, actor) values ($1,'aceptada','programada',$2)`, [b.derivacion_id, user.id]);
      await ctx.bus.emit(c, { tipo: 'derivacion.programada', topic: 'derivaciones', actor: user.id });
    }
    await audit(c, user, 'agenda.cita_programada', 'atencion', id, { profesional: b.profesional_id, inicio: inicio.toISOString(), duracion: b.duracion_min }, ip);
    await ctx.bus.emit(c, {
      tipo: 'agenda.cita',
      topic: 'agenda',
      actor: user.id,
      texto: `Nueva cita de ${ESPECIALIDAD_LABEL[esp]} en la agenda de ${pro.nombre} (${fmtInstitucional(inicio, 'dd/MM HH:mm')}).`,
    });
    const destino = await usuarioDeProfesional(c, b.profesional_id);
    if (destino && destino !== user.id) {
      await notificar(c, ctx.bus, [destino], {
        tipo: 'agenda',
        titulo: 'Nueva cita en su agenda',
        cuerpo: `${fmtInstitucional(inicio)} (hora de Galápagos), ${b.duracion_min} min.`,
        enlace: '/agenda',
      }, user.id);
    }
    return id;
  }

  // ---------------- Agenda ----------------
  app.get('/api/agenda', { preHandler: requirePerm('agenda.ver_todas', 'agenda.propia') }, async (req) => {
    const user = u(req);
    const q = parse(z.object({ desde: z.string().datetime({ offset: true }), hasta: z.string().datetime({ offset: true }), profesional_id: z.string().optional() }), req.query);
    const pid = user.rol === 'profesional' ? user.profesional_id : q.profesional_id ?? null;
    const r = await db.query(
      `select a.id, a.codigo, a.inicio, a.fin, a.duracion_min, a.estado, a.tipo, a.profesional_id, p.nombre as profesional_nombre,
              a.servidor_id, s.nombre as servidor_nombre, s.codigo_institucional, a.derivacion_id
         from ops.atenciones a join core.profesionales p on p.id = a.profesional_id join ops.servidores s on s.id = a.servidor_id
        where a.inicio < $2 and a.fin > $1 and ($3::text is null or a.profesional_id = $3)
        order by a.inicio`,
      [q.desde, q.hasta, pid],
    );
    return r.rows;
  });

  app.get('/api/agenda/disponibilidad', { preHandler: requirePerm('agenda.ver_todas', 'agenda.propia') }, async (req) => {
    const q = parse(z.object({ profesional_id: z.string(), desde: z.string().datetime({ offset: true }), hasta: z.string().datetime({ offset: true }) }), req.query);
    const ivs = await disponibilidadDe(db, q.profesional_id, new Date(q.desde), new Date(q.hasta));
    return ivs.map((i) => ({ inicio: i.start!.toUTC().toISO(), fin: i.end!.toUTC().toISO() }));
  });

  app.get('/api/agenda/franjas-libres', { preHandler: requirePerm('agenda.gestionar') }, async (req) => {
    const q = parse(z.object({ profesional_id: z.string(), fecha: fechaDia, duracion: z.coerce.number().int() }), req.query);
    const dia = DateTime.fromISO(q.fecha, { zone: TZ_INSTITUCIONAL });
    const desde = dia.startOf('day').toJSDate();
    const hasta = dia.endOf('day').toJSDate();
    const disp = await disponibilidadDe(db, q.profesional_id, desde, hasta);
    const recortada = disp
      .map((i) => i.intersection(DateTimeInterval(desde, hasta)))
      .filter((i): i is NonNullable<typeof i> => !!i && i.isValid);
    const ocupados = await ocupadosDe(db, q.profesional_id, desde, hasta);
    return franjasLibres({ disponibilidad: recortada, ocupados, duracionMin: q.duracion }).map((d) => d.toISOString());
  });

  const citaSchema = z.object({
    servidor_id: uuid,
    profesional_id: z.string().min(1),
    inicio: z.string().datetime({ offset: true }),
    duracion_min: z.number().int(),
    derivacion_id: uuid.optional(),
    atencion_id: uuid.optional(),
  });

  app.post('/api/agenda/citas', { preHandler: requirePerm('agenda.gestionar') }, async (req) => {
    const b = parse(citaSchema, req.body);
    const id = await tx(db, (c) => programar(c, u(req), b, req.ip));
    return { id };
  });

  app.post('/api/agenda/citas/:id/confirmar', { preHandler: requirePerm('agenda.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    await tx(db, async (c) => {
      const at = await cargarAtencion(c, id);
      if (user.rol === 'profesional') exigirPropietario(user, at);
      if (at.estado !== 'programada') throw conflict('Solo se pueden confirmar citas programadas.');
      await c.query(`update ops.atenciones set estado='confirmada', updated_at=now() where id=$1`, [id]);
      await historial(c, id, 'programada', 'confirmada', user.id);
      await audit(c, user, 'agenda.cita_confirmada', 'atencion', id, {}, req.ip);
      await ctx.bus.emit(c, { tipo: 'agenda.confirmada', topic: 'agenda', actor: user.id });
    });
    return { ok: true };
  });

  app.post('/api/agenda/citas/:id/reprogramar', { preHandler: requirePerm('agenda.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ inicio: z.string().datetime({ offset: true }), duracion_min: z.number().int(), motivo: z.string().max(300).optional() }), req.body);
    const nuevo = await tx(db, async (c) => {
      const at = await cargarAtencion(c, id);
      if (user.rol === 'profesional') exigirPropietario(user, at);
      if (!['programada', 'confirmada', 'contacto_iniciado'].includes(at.estado)) throw conflict('Solo se pueden reprogramar citas programadas o confirmadas.');
      await c.query(`update ops.atenciones set estado='reprogramada', updated_at=now() where id=$1`, [id]);
      await historial(c, id, at.estado, 'reprogramada', user.id, b.motivo);
      const nid = await programar(
        c,
        user,
        { servidor_id: at.servidor_id, profesional_id: at.profesional_id, inicio: b.inicio, duracion_min: b.duracion_min, derivacion_id: at.derivacion_id ?? undefined, reprogramada_desde: id },
        req.ip,
      );
      if (at.derivacion_id) await c.query(`update ops.derivaciones set atencion_id = $2 where id = $1`, [at.derivacion_id, nid]);
      await c.query(`update ops.solicitudes_atencion set atencion_id = $2, updated_at = now() where atencion_id = $1`, [id, nid]);
      return nid;
    });
    return { id: nuevo };
  });

  app.post('/api/agenda/citas/:id/no-realizada', { preHandler: requirePerm('agenda.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ motivo: z.enum(MOTIVOS_NO_REALIZADA) }), req.body);
    await tx(db, async (c) => {
      const at = await cargarAtencion(c, id);
      if (user.rol === 'profesional') exigirPropietario(user, at);
      if (!['programada', 'confirmada', 'contacto_iniciado', 'pendiente'].includes(at.estado)) throw conflict('Estado no válido para marcar como no realizada.');
      await c.query(`update ops.atenciones set estado='no_realizada', motivo_no_realizada=$2, updated_at=now() where id=$1`, [id, b.motivo]);
      await historial(c, id, at.estado, 'no_realizada', user.id, b.motivo);
      await audit(c, user, 'agenda.no_realizada', 'atencion', id, { motivo: b.motivo }, req.ip);
      await ctx.bus.emit(c, { tipo: 'agenda.no_realizada', topic: 'atenciones', actor: user.id });
    });
    return { ok: true };
  });

  // ---------------- Atenciones ----------------
  app.get('/api/atenciones', { preHandler: requirePerm('agenda.ver_todas', 'agenda.propia') }, async (req) => {
    const user = u(req);
    const q = parse(z.object({ estado: z.string().optional(), servidor_id: uuid.optional(), limit: z.coerce.number().max(500).default(200) }), req.query);
    const pid = user.rol === 'profesional' ? user.profesional_id : null;
    const r = await db.query(
      `select a.id, a.codigo, a.inicio, a.fin, a.duracion_min, a.estado, a.tipo, a.profesional_id, p.nombre as profesional_nombre,
              a.servidor_id, s.nombre as servidor_nombre, a.iniciada_at, a.finalizada_at, a.documentada_at, a.derivacion_id, a.motivo_no_realizada,
              a.created_at
         from ops.atenciones a join core.profesionales p on p.id = a.profesional_id join ops.servidores s on s.id = a.servidor_id
        where ($1::text is null or a.profesional_id = $1) and ($2::text is null or a.estado = $2) and ($3::uuid is null or a.servidor_id = $3)
        order by coalesce(a.inicio, a.created_at) desc limit $4`,
      [pid, q.estado ?? null, q.servidor_id ?? null, q.limit],
    );
    return r.rows;
  });

  app.post('/api/atenciones/pendiente', { preHandler: requirePerm('agenda.gestionar') }, async (req) => {
    const user = u(req);
    const b = parse(z.object({ servidor_id: uuid, profesional_id: z.string() }), req.body);
    if (user.rol === 'profesional' && user.profesional_id !== b.profesional_id) throw forbidden();
    const id = await tx(db, async (c) => {
      const pro = (await c.query(`select especialidad, es_teleatencion from core.profesionales where id = $1`, [b.profesional_id])).rows[0];
      if (!pro?.es_teleatencion || pro.especialidad === 'psiquiatria') throw badRequest('Profesional no válido (Psiquiatría se gestiona por derivación).');
      if (user.rol === 'profesional') await exigirAsignacion(c, user, b.servidor_id);
      else
        await c.query(
          `insert into ops.asignaciones (servidor_id, profesional_id, asignada_por) select $1,$2,$3 where not exists (select 1 from ops.asignaciones where servidor_id=$1 and profesional_id=$2 and activa)`,
          [b.servidor_id, b.profesional_id, user.id],
        );
      const r = await c.query(`insert into ops.atenciones (servidor_id, profesional_id, tipo, estado, creado_por) values ($1,$2,$3,'pendiente',$4) returning id`, [
        b.servidor_id,
        b.profesional_id,
        pro.especialidad,
        user.id,
      ]);
      await historial(c, r.rows[0].id, null, 'pendiente', user.id);
      await audit(c, user, 'atencion.pendiente', 'atencion', r.rows[0].id, { profesional: b.profesional_id }, req.ip);
      await ctx.bus.emit(c, { tipo: 'atencion.pendiente', topic: 'atenciones', actor: user.id });
      return r.rows[0].id;
    });
    return { id };
  });

  app.get('/api/atenciones/:id', { preHandler: requireAuth }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const at = await cargarAtencion(db, id);
    const esAutor = user.rol === 'profesional' && user.profesional_id === at.profesional_id;
    // Continuidad asistencial: otros profesionales clínicos con relación asistencial pueden consultar
    // la entrada si no es de confidencialidad restringida. Coordinación: solo datos operativos.
    const nivel = esAutor ? 'clinico' : await nivelAcceso(db, user, at.servidor_id);
    if (!esAutor && user.rol !== 'coordinacion' && nivel !== 'clinico') throw forbidden();
    const hist = (await db.query(`select h.estado_anterior, h.estado_nuevo, h.nota_operativa, h.ts, u.nombre as actor from ops.atencion_historial h join core.usuarios u on u.id = h.actor where atencion_id = $1 order by ts`, [id])).rows;
    let nota: NotaClinica | null = null;
    let entrada: Record<string, unknown> | null = null;
    const e = (await db.query(
      `select e.id, e.estado, e.confidencialidad, e.version_actual, e.validada_at, e.hash_contenido, e.contenido_cifrado, e.autor_profesional_id, x.codigo as expediente_codigo, x.id as expediente_id
         from clinical.entradas e join clinical.expedientes x on x.id = e.expediente_id where e.atencion_id = $1`,
      [id],
    )).rows[0];
    if (e) {
      const puedeLeer = esAutor || (nivel === 'clinico' && e.confidencialidad === 'equipo_clinico');
      entrada = { id: e.id, estado: e.estado, confidencialidad: e.confidencialidad, version: e.version_actual, validada_at: e.validada_at, hash: e.hash_contenido, expediente_codigo: e.expediente_codigo, expediente_id: e.expediente_id };
      if (puedeLeer) {
        const contenido = ctx.cipher.decryptJson<NotaClinica>(e.contenido_cifrado);
        nota = contenido && Object.keys(contenido).length ? contenido : null;
        if (nota) await audit(db, user, esAutor ? 'clinico.lectura_nota' : 'clinico.lectura_nota_continuidad', 'atencion', id, {}, req.ip);
        const ad = (await db.query(`select a.id, a.motivo, a.contenido_cifrado, a.created_at, p.nombre as autor from clinical.adendas a join core.profesionales p on p.id = a.autor_profesional_id where entrada_id = $1 order by created_at`, [e.id])).rows;
        entrada.adendas = ad.map((x) => ({ id: x.id, motivo: x.motivo, contenido: ctx.cipher.decrypt(x.contenido_cifrado), created_at: x.created_at, autor: x.autor }));
      }
    }
    const servidor = (await db.query(`select id, nombre, codigo_institucional from ops.servidores where id = $1`, [at.servidor_id])).rows[0];
    return { atencion: at, servidor, historial: hist, nota, entrada, puede_ver_nota: esAutor || (nivel === 'clinico' && entrada?.confidencialidad === 'equipo_clinico'), puede_editar: esAutor };
  });

  app.post('/api/atenciones/:id/iniciar', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ urgente: z.boolean().optional(), justificacion: z.string().trim().max(1000).optional(), modalidad: z.enum(['videollamada_whatsapp']).optional() }), req.body);
    await tx(db, async (c) => {
      const at = await cargarAtencion(c, id);
      exigirPropietario(user, at);
      if (!['programada', 'confirmada', 'contacto_iniciado', 'pendiente'].includes(at.estado)) throw conflict('La atención no puede iniciarse en su estado actual.');
      const otra = await c.query(`select 1 from ops.atenciones where profesional_id = $1 and estado = 'en_atencion'`, [at.profesional_id]);
      if (otra.rows[0]) throw conflict('Ya tiene otra atención en curso.');
      const valido = await consentimientoVigente(c, ctx.cfg, at.servidor_id, at.tipo);
      if (!valido && !b.urgente) {
        throw conflict('Se requiere un consentimiento informado validado y aplicable a este servicio antes de iniciar la atención ordinaria.', 'sin_consentimiento');
      }
      if (!valido && b.urgente) {
        // Protocolo de urgencia: el trámite no retrasa la atención; queda justificado, auditado y pendiente de regularizar.
        if (!b.justificacion || b.justificacion.length < 10) throw badRequest('Registre la justificación de la urgencia (mínimo 10 caracteres).');
        await c.query(`update ops.atenciones set inicio_urgente = true, justificacion_urgencia_cifrada = $2 where id = $1`, [id, ctx.cipher.encrypt(b.justificacion)]);
        await audit(c, user, 'atencion.inicio_urgente_sin_consentimiento', 'atencion', id, {}, req.ip);
        await notificar(c, ctx.bus, await usuariosPorRol(c, 'coordinacion'), {
          tipo: 'atencion',
          titulo: `Atención ${at.codigo} iniciada por protocolo de urgencia`,
          cuerpo: 'Consentimiento informado pendiente de regularizar.',
          enlace: `/atenciones/${id}`,
        }, user.id);
      }
      if (at.estado === 'pendiente') {
        const dur = at.tipo === 'psicologia' ? 60 : 30;
        await c.query(`update ops.atenciones set inicio = now(), fin = now() + make_interval(mins => $2::int), duracion_min = $2::int where id = $1`, [id, dur]);
      }
      try {
        await c.query('savepoint ini');
        // Modalidad telemática registrada al iniciar (hoy: videollamada manual por WhatsApp).
        await c.query(`update ops.atenciones set estado='en_atencion', iniciada_at=now(), updated_at=now(), modalidad = coalesce($2, modalidad) where id=$1`, [id, b.modalidad ?? null]);
        await c.query('release savepoint ini');
      } catch (e: any) {
        await c.query('rollback to savepoint ini');
        if (e?.code === '23P01') throw conflict('Existe un choque de agenda con otra cita en curso.');
        throw e;
      }
      await historial(c, id, at.estado, 'en_atencion', user.id, b.urgente && !valido ? 'Inicio por protocolo de urgencia' : null);
      // Historia clínica: se abre el expediente (si no existe) y la entrada cronológica de esta atención.
      const at2 = await cargarAtencion(c, id);
      await asegurarEntrada(c, ctx.cipher, at2, user.id);
      await audit(c, user, 'atencion.iniciada', 'atencion', id, {}, req.ip);
      const etiqueta = at.tipo === 'telemedicina' ? 'una telemedicina' : at.tipo === 'psiquiatria' ? 'una valoración psiquiátrica' : 'una consulta';
      await presence.porActividad(c, at.profesional_id, { estado: 'en_consulta', zona: presence.zonaConsulta(at.tipo), ref_tipo: 'atencion', ref_id: id }, `${at.profesional_nombre} inició ${etiqueta}.`);
      await ctx.bus.emit(c, { tipo: 'atencion.iniciada', topic: 'atenciones', actor: user.id });
    });
    return { ok: true };
  });

  app.post('/api/atenciones/:id/finalizar', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    await tx(db, async (c) => {
      const at = await cargarAtencion(c, id);
      exigirPropietario(user, at);
      if (at.estado !== 'en_atencion') throw conflict('La atención no está en curso.');
      await c.query(`update ops.atenciones set estado='atendida', finalizada_at=now(), updated_at=now() where id=$1`, [id]);
      await historial(c, id, 'en_atencion', 'atendida', user.id);
      await c.query(`update ops.solicitudes_atencion set estado = 'atendida', updated_at = now() where atencion_id = $1 and estado in ('asignada','programada')`, [id]);
      await audit(c, user, 'atencion.finalizada', 'atencion', id, {}, req.ip);
      const etiqueta = at.tipo === 'telemedicina' ? 'una telemedicina' : at.tipo === 'psiquiatria' ? 'una valoración psiquiátrica' : 'una consulta';
      await presence.porActividad(c, at.profesional_id, { estado: 'en_documentacion', ref_tipo: 'atencion', ref_id: id }, `${at.profesional_nombre} finalizó ${etiqueta}.`);
      await ctx.bus.emit(c, { tipo: 'atencion.finalizada', topic: 'atenciones', actor: user.id });
    });
    return { ok: true };
  });

  const texto = z.string().max(8000).optional();
  app.put('/api/atenciones/:id/nota', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(
      z.object({
        resumen: z.string().trim().min(1).max(8000),
        motivo_consulta: texto,
        evaluacion: texto,
        intervencion: texto,
        evolucion: texto,
        resultado: texto,
        plan: texto,
        recomendaciones: texto,
        confidencialidad: z.enum(['equipo_clinico', 'restringida']).optional(),
      }),
      req.body,
    );
    const { confidencialidad, ...contenido } = b;
    await tx(db, async (c) => {
      const at = await cargarAtencion(c, id);
      exigirPropietario(user, at);
      if (!['en_atencion', 'atendida'].includes(at.estado)) throw conflict('Solo se documentan atenciones iniciadas o realizadas.');
      const entradaId = await asegurarEntrada(c, ctx.cipher, at, user.id);
      const e = (await c.query(`select estado, version_actual, expediente_id from clinical.entradas where id = $1 for update`, [entradaId])).rows[0];
      if (e.estado === 'validada') throw conflict('La entrada ya fue validada y es inmutable. Registre una adenda.', 'entrada_validada');
      const cifrado = ctx.cipher.encryptJson(contenido);
      const version = e.version_actual + 1;
      // Control de versiones: cada guardado conserva la versión anterior (sin modificaciones silenciosas).
      await c.query(`insert into clinical.entrada_versiones (entrada_id, version, contenido_cifrado, autor_usuario_id) values ($1,$2,$3,$4)`, [entradaId, version, cifrado, user.id]);
      await c.query(
        `update clinical.entradas set contenido_cifrado = $2, version_actual = $3, confidencialidad = coalesce($4, confidencialidad), updated_at = now() where id = $1`,
        [entradaId, cifrado, version, confidencialidad ?? null],
      );
      await c.query(`update clinical.expedientes set updated_at = now() where id = $1`, [e.expediente_id]);
      await c.query(`update ops.atenciones set documentada_at = coalesce(documentada_at, now()), updated_at = now() where id = $1`, [id]);
      await audit(c, user, 'clinico.nota_guardada', 'atencion', id, { version }, req.ip);
      const p = (await c.query(`select estado, ref_id from ops.presencia where usuario_id = $1`, [user.id])).rows[0];
      if (at.estado === 'atendida' && p?.estado === 'en_documentacion' && p.ref_id === id) {
        await presence.porActividad(c, at.profesional_id, { estado: 'disponible' }, `${at.profesional_nombre} completó la documentación de una atención.`);
      }
      await ctx.bus.emit(c, { tipo: 'atencion.documentada', topic: 'atenciones', actor: user.id });
    });
    return { ok: true };
  });

  /** Validación (firma) de la entrada: a partir de aquí es inmutable; solo admite adendas. */
  app.post('/api/atenciones/:id/nota/validar', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const r = await tx(db, async (c) => {
      const at = await cargarAtencion(c, id);
      exigirPropietario(user, at);
      if (at.estado !== 'atendida') throw conflict('Finalice la atención antes de validar su registro.');
      const e = (await c.query(`select * from clinical.entradas where atencion_id = $1 for update`, [id])).rows[0];
      if (!e) throw conflict('No hay registro clínico para validar.');
      if (e.estado === 'validada') throw conflict('La entrada ya está validada.', 'entrada_validada');
      const contenido = ctx.cipher.decryptJson<NotaClinica>(e.contenido_cifrado);
      if (!contenido?.resumen) throw conflict('Complete al menos el resumen de la atención antes de validar.');
      const hash = sha256(JSON.stringify({ contenido, fecha_hora: e.fecha_hora, autor: e.autor_profesional_id, version: e.version_actual, atencion: id }));
      await c.query(`update clinical.entradas set estado = 'validada', validada_at = now(), validada_por = $2, hash_contenido = $3 where id = $1`, [e.id, user.id, hash]);
      await audit(c, user, 'clinico.entrada_validada', 'atencion', id, { version: e.version_actual, hash }, req.ip);
      await ctx.bus.emit(c, { tipo: 'expediente.entrada_validada', topic: 'expedientes', actor: user.id });
      return { hash };
    });
    return r;
  });

  // ---------------- Seguimientos ----------------
  app.get('/api/seguimientos', { preHandler: requirePerm('agenda.ver_todas', 'agenda.propia') }, async (req) => {
    const user = u(req);
    const q = parse(z.object({ estado: z.enum(['pendiente', 'realizado', 'cancelado']).optional() }), req.query);
    const pid = user.rol === 'profesional' ? user.profesional_id : null;
    const r = await db.query(
      `select g.*, s.nombre as servidor_nombre, p.nombre as profesional_nombre from ops.seguimientos g
         join ops.servidores s on s.id = g.servidor_id join core.profesionales p on p.id = g.profesional_id
        where ($1::text is null or g.profesional_id = $1) and ($2::text is null or g.estado = $2) order by g.fecha_programada`,
      [pid, q.estado ?? null],
    );
    return r.rows;
  });

  app.post('/api/seguimientos', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const b = parse(
      z.object({ servidor_id: uuid, fecha_programada: z.string().datetime({ offset: true }), nota_operativa: z.string().max(500).optional(), atencion_origen_id: uuid.optional() }),
      req.body,
    );
    const id = await tx(db, async (c) => {
      await exigirAsignacion(c, user, b.servidor_id);
      const r = await c.query(
        `insert into ops.seguimientos (servidor_id, profesional_id, fecha_programada, nota_operativa, atencion_origen_id, creado_por) values ($1,$2,$3,$4,$5,$6) returning id`,
        [b.servidor_id, user.profesional_id, b.fecha_programada, b.nota_operativa ?? null, b.atencion_origen_id ?? null, user.id],
      );
      await audit(c, user, 'seguimiento.creado', 'seguimiento', r.rows[0].id, {}, req.ip);
      await ctx.bus.emit(c, { tipo: 'seguimiento.creado', topic: 'seguimientos', actor: user.id });
      return r.rows[0].id;
    });
    return { id };
  });

  app.post('/api/seguimientos/:id/estado', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ estado: z.enum(['realizado', 'cancelado']) }), req.body);
    await tx(db, async (c) => {
      const s = (await c.query(`select * from ops.seguimientos where id = $1`, [id])).rows[0];
      if (!s) throw notFound();
      if (s.profesional_id !== user.profesional_id) throw forbidden();
      await c.query(`update ops.seguimientos set estado = $2, realizado_at = case when $2 = 'realizado' then now() else null end where id = $1`, [id, b.estado]);
      await audit(c, user, 'seguimiento.' + b.estado, 'seguimiento', id, {}, req.ip);
      await ctx.bus.emit(c, { tipo: 'seguimiento.actualizado', topic: 'seguimientos', actor: user.id });
    });
    return { ok: true };
  });
}

import { Interval } from 'luxon';
function DateTimeInterval(a: Date, b: Date) {
  return Interval.fromDateTimes(DateTime.fromJSDate(a), DateTime.fromJSDate(b));
}
