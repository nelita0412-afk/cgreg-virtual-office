import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx, SessionUser } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import { makeGuards } from '../auth';
import { tx, type Queryable } from '../db';
import { audit } from '../audit';
import { notificar, usuarioDeProfesional, usuariosPorRol } from '../notify';
import { exigirAsignacion, parse, u, uuid } from './util';
import { ESTADO_DERIVACION_LABEL, PRIORIDADES, type EstadoDerivacion } from '@shared/domain';

/** Transiciones manuales permitidas al especialista. «programada» y «valorada» las fija el sistema. */
const TRANSICIONES: Partial<Record<EstadoDerivacion, EstadoDerivacion[]>> = {
  solicitada: ['en_revision', 'cerrada'],
  en_revision: ['pendiente_coordinacion', 'aceptada', 'cerrada'],
  pendiente_coordinacion: ['aceptada', 'cerrada'],
  aceptada: ['cerrada'],
  programada: ['cerrada'],
  valorada: ['en_seguimiento', 'cerrada'],
  en_seguimiento: ['cerrada'],
};

export function derivacionesRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { requirePerm } = makeGuards(ctx);
  const db = ctx.db;

  const esEspecialista = (user: SessionUser, d: { especialista_id: string }) => user.rol === 'profesional' && user.profesional_id === d.especialista_id;
  const esDerivante = (user: SessionUser, d: { profesional_derivante_id: string }) => user.rol === 'profesional' && user.profesional_id === d.profesional_derivante_id;

  async function cargar(c: Queryable, id: string) {
    const d = (
      await c.query(
        `select d.*, s.nombre as servidor_nombre, s.codigo_institucional, pd.nombre as derivante_nombre, pe.nombre as especialista_nombre,
                a.inicio as cita_inicio, a.estado as cita_estado
           from ops.derivaciones d join ops.servidores s on s.id = d.servidor_id
           join core.profesionales pd on pd.id = d.profesional_derivante_id join core.profesionales pe on pe.id = d.especialista_id
           left join ops.atenciones a on a.id = d.atencion_id
          where d.id = $1`,
        [id],
      )
    ).rows[0];
    if (!d) throw notFound('Derivación no encontrada');
    return d;
  }

  async function historial(c: Queryable, id: string, ant: string | null, nuevo: string, actor: string, nota?: string | null) {
    await c.query(`insert into ops.derivacion_historial (derivacion_id, estado_anterior, estado_nuevo, actor, nota_operativa) values ($1,$2,$3,$4,$5)`, [id, ant, nuevo, actor, nota ?? null]);
  }

  app.get('/api/derivaciones', { preHandler: requirePerm('derivaciones.crear', 'derivaciones.coordinar') }, async (req) => {
    const user = u(req);
    const pid = user.rol === 'profesional' ? user.profesional_id : null;
    // Coordinación ve datos operativos (código, estado, prioridad, fechas) para coordinar citas, nunca el motivo clínico.
    const r = await db.query(
      `select d.id, d.codigo, d.estado, d.prioridad, d.fecha_solicitud, d.updated_at, d.servidor_id, s.nombre as servidor_nombre,
              d.profesional_derivante_id, pd.nombre as derivante_nombre, d.especialista_id, pe.nombre as especialista_nombre,
              d.atencion_id, a.inicio as cita_inicio
         from ops.derivaciones d join ops.servidores s on s.id = d.servidor_id
         join core.profesionales pd on pd.id = d.profesional_derivante_id join core.profesionales pe on pe.id = d.especialista_id
         left join ops.atenciones a on a.id = d.atencion_id
        where $1::text is null or d.profesional_derivante_id = $1 or d.especialista_id = $1
        order by case d.prioridad when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end, d.fecha_solicitud desc`,
      [pid],
    );
    return r.rows;
  });

  app.get('/api/derivaciones/:id', { preHandler: requirePerm('derivaciones.crear', 'derivaciones.coordinar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const d = await cargar(db, id);
    const autorizadoClinico = esEspecialista(user, d) || esDerivante(user, d);
    if (user.rol === 'profesional' && !autorizadoClinico) throw forbidden();
    const hist = (await db.query(`select h.estado_anterior, h.estado_nuevo, h.nota_operativa, h.ts, u.nombre as actor from ops.derivacion_historial h join core.usuarios u on u.id = h.actor where derivacion_id = $1 order by ts`, [id])).rows;
    let clinico = null;
    if (autorizadoClinico) {
      const det = (await db.query(`select * from clinical.derivacion_detalle where derivacion_id = $1`, [id])).rows[0];
      if (det) {
        clinico = {
          motivo: ctx.cipher.decrypt(det.motivo_cifrado),
          valoracion: det.valoracion_cifrada ? ctx.cipher.decrypt(det.valoracion_cifrada) : null,
          recomendaciones: det.recomendaciones_cifradas ? ctx.cipher.decrypt(det.recomendaciones_cifradas) : null,
          seguimiento: det.seguimiento_cifrado ? ctx.cipher.decrypt(det.seguimiento_cifrado) : null,
        };
        await audit(db, user, 'clinico.lectura_derivacion', 'derivacion', id, {}, req.ip);
      }
    }
    return { derivacion: d, historial: hist, clinico, es_especialista: esEspecialista(user, d) };
  });

  app.post('/api/derivaciones', { preHandler: requirePerm('derivaciones.crear') }, async (req) => {
    const user = u(req);
    const b = parse(z.object({ servidor_id: uuid, prioridad: z.enum(PRIORIDADES), motivo: z.string().trim().min(10).max(4000) }), req.body);
    if (user.especialidad === 'psiquiatria') throw forbidden('El especialista recibe derivaciones; no las emite.');
    const res = await tx(db, async (c) => {
      await exigirAsignacion(c, user, b.servidor_id);
      const esp = (await c.query(`select id from core.profesionales where especialidad = 'psiquiatria' and activo order by orden limit 1`)).rows[0];
      if (!esp) throw badRequest('No hay especialista en Psiquiatría registrado.');
      const abierta = await c.query(`select codigo from ops.derivaciones where servidor_id = $1 and estado <> 'cerrada'`, [b.servidor_id]);
      if (abierta.rows[0]) throw conflict(`Ya existe una derivación abierta para este servidor (${abierta.rows[0].codigo}).`);
      const r = await c.query(
        `insert into ops.derivaciones (servidor_id, profesional_derivante_id, especialista_id, prioridad, estado, creado_por) values ($1,$2,$3,$4,'solicitada',$5) returning id, codigo`,
        [b.servidor_id, user.profesional_id, esp.id, b.prioridad, user.id],
      );
      const { id, codigo } = r.rows[0];
      await c.query(`insert into clinical.derivacion_detalle (derivacion_id, motivo_cifrado) values ($1,$2)`, [id, ctx.cipher.encrypt(b.motivo)]);
      await historial(c, id, null, 'solicitada', user.id);
      await audit(c, user, 'derivacion.creada', 'derivacion', id, { prioridad: b.prioridad }, req.ip);
      const destinos = [...(await usuariosPorRol(c, 'coordinacion'))];
      const espUser = await usuarioDeProfesional(c, esp.id);
      if (espUser) destinos.push(espUser);
      await notificar(c, ctx.bus, destinos, { tipo: 'derivacion', titulo: `Nueva derivación a Psiquiatría ${codigo}`, cuerpo: `Prioridad: ${b.prioridad}.`, enlace: `/derivaciones/${id}` }, user.id);
      await ctx.bus.emit(c, { tipo: 'derivacion.creada', topic: 'derivaciones', actor: user.id, texto: `Se registró una derivación a Psiquiatría.` });
      return { id, codigo };
    });
    return res;
  });

  app.post('/api/derivaciones/:id/estado', { preHandler: requirePerm('derivaciones.valorar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ estado: z.enum(Object.keys(ESTADO_DERIVACION_LABEL) as [EstadoDerivacion, ...EstadoDerivacion[]]), nota_operativa: z.string().max(500).optional() }), req.body);
    await tx(db, async (c) => {
      const d = await cargar(c, id);
      if (!esEspecialista(user, d)) throw forbidden('Solo el especialista asignado puede cambiar el estado.');
      if (!(TRANSICIONES[d.estado as EstadoDerivacion] ?? []).includes(b.estado)) throw conflict(`Transición no permitida: ${d.estado} → ${b.estado}.`);
      await c.query(`update ops.derivaciones set estado = $2, updated_at = now(), cerrada_at = case when $2 = 'cerrada' then now() else null end where id = $1`, [id, b.estado]);
      await historial(c, id, d.estado, b.estado, user.id, b.nota_operativa);
      await audit(c, user, 'derivacion.estado', 'derivacion', id, { de: d.estado, a: b.estado }, req.ip);
      const destinos = [...(await usuariosPorRol(c, 'coordinacion'))];
      const der = await usuarioDeProfesional(c, d.profesional_derivante_id);
      if (der) destinos.push(der);
      await notificar(c, ctx.bus, destinos, { tipo: 'derivacion', titulo: `Derivación ${d.codigo}: ${ESTADO_DERIVACION_LABEL[b.estado]}`, enlace: `/derivaciones/${id}` }, user.id);
      const texto = b.estado === 'aceptada' ? `${d.especialista_nombre} aceptó una derivación.` : null;
      await ctx.bus.emit(c, { tipo: 'derivacion.estado', topic: 'derivaciones', actor: user.id, texto });
    });
    return { ok: true };
  });

  app.put('/api/derivaciones/:id/valoracion', { preHandler: requirePerm('derivaciones.valorar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ valoracion: z.string().trim().min(1).max(8000), recomendaciones: z.string().max(4000).optional(), seguimiento: z.string().max(4000).optional() }), req.body);
    await tx(db, async (c) => {
      const d = await cargar(c, id);
      if (!esEspecialista(user, d)) throw forbidden();
      if (!['programada', 'valorada', 'en_seguimiento'].includes(d.estado)) throw conflict('La valoración se registra tras la cita programada.');
      if (d.estado === 'programada' && d.cita_estado !== 'atendida' && d.cita_estado !== 'en_atencion') throw conflict('Inicie la cita de valoración antes de registrar el resultado.');
      await c.query(
        `update clinical.derivacion_detalle set valoracion_cifrada = $2, recomendaciones_cifradas = $3, seguimiento_cifrado = $4, updated_at = now() where derivacion_id = $1`,
        [id, ctx.cipher.encrypt(b.valoracion), b.recomendaciones ? ctx.cipher.encrypt(b.recomendaciones) : null, b.seguimiento ? ctx.cipher.encrypt(b.seguimiento) : null],
      );
      if (d.estado === 'programada') {
        await c.query(`update ops.derivaciones set estado = 'valorada', updated_at = now() where id = $1`, [id]);
        await historial(c, id, 'programada', 'valorada', user.id);
        const der = await usuarioDeProfesional(c, d.profesional_derivante_id);
        if (der) await notificar(c, ctx.bus, [der], { tipo: 'derivacion', titulo: `Derivación ${d.codigo} valorada`, cuerpo: 'Puede consultar las recomendaciones del especialista.', enlace: `/derivaciones/${id}` }, user.id);
      }
      await audit(c, user, 'clinico.valoracion_guardada', 'derivacion', id, {}, req.ip);
      await ctx.bus.emit(c, { tipo: 'derivacion.valorada', topic: 'derivaciones', actor: user.id });
    });
    return { ok: true };
  });
}
