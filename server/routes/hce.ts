import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import { makeGuards } from '../auth';
import { tx } from '../db';
import { audit } from '../audit';
import { sha256 } from '../crypto';
import { parse, u, uuid } from './util';
import { areaDeEspecialidad, asegurarExpediente, exigirNivel, nivelAcceso } from '../hce';
import { AREAS_HCE, SECCIONES_HCE, TIPOS_INTERVENCION_SOCIAL } from '@shared/domain';

/**
 * Historia clínica electrónica: un expediente por servidor, con secciones versionadas por área
 * (Psicología Clínica, Medicina, Psiquiatría), entradas cronológicas por atención (validables e
 * inmutables tras la validación), adendas, y registros de intervención social separados.
 */
export function hceRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { requirePerm } = makeGuards(ctx);
  const db = ctx.db;
  const dec = (s: string | null) => (s ? ctx.cipher.decrypt(s) : null);

  app.get('/api/servidores/:id/expediente', { preHandler: requirePerm('hce.ver') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const nivel = await exigirNivel(db, user, id, 'clinico', 'social', 'administrativo');
    const servidor = (await db.query(`select id, nombre, codigo_institucional, unidad, verificacion from ops.servidores where id = $1`, [id])).rows[0];
    if (!servidor) throw notFound();
    const x = (await db.query(
      `select x.*, p.nombre as responsable_nombre, p.especialidad as responsable_especialidad from clinical.expedientes x
         join core.profesionales p on p.id = x.profesional_responsable_id where x.servidor_id = $1`,
      [id],
    )).rows[0] ?? null;
    const atenciones = (await db.query(
      `select a.id, a.codigo, a.tipo, a.estado, a.inicio, a.iniciada_at, a.finalizada_at, a.inicio_urgente, p.nombre as profesional_nombre
         from ops.atenciones a join core.profesionales p on p.id = a.profesional_id where a.servidor_id = $1 order by coalesce(a.inicio, a.created_at) desc`,
      [id],
    )).rows;
    const seguimientos = (await db.query(
      `select g.id, g.fecha_programada, g.estado, g.nota_operativa, p.nombre as profesional_nombre from ops.seguimientos g join core.profesionales p on p.id = g.profesional_id where g.servidor_id = $1 order by g.fecha_programada desc`,
      [id],
    )).rows;
    const derivaciones = (await db.query(
      `select d.id, d.codigo, d.estado, d.prioridad, d.fecha_solicitud, pd.nombre as derivante, pe.nombre as especialista from ops.derivaciones d
         join core.profesionales pd on pd.id = d.profesional_derivante_id join core.profesionales pe on pe.id = d.especialista_id where d.servidor_id = $1 order by d.fecha_solicitud desc`,
      [id],
    )).rows;
    const consentimientos = (await db.query(
      `select k.id, k.modalidad, k.servicio, k.estado, k.validado_at, k.updated_at, p.version as plantilla_version from ops.consentimientos k
         left join ops.consentimiento_plantillas p on p.id = k.plantilla_id where k.servidor_id = $1 order by k.updated_at desc`,
      [id],
    )).rows;
    const base = { nivel, servidor, expediente: x, atenciones, consentimientos };

    if (nivel === 'administrativo') {
      // Coordinación: metadatos operativos, sin contenido clínico.
      const resumen = x
        ? (await db.query(`select area, count(*)::int as entradas, count(*) filter (where estado = 'validada')::int as validadas, max(updated_at) as ultima from clinical.entradas where expediente_id = $1 group by area`, [x.id])).rows
        : [];
      await audit(db, user, 'hce.consulta_administrativa', 'servidor', id, {}, req.ip);
      return { ...base, resumen_areas: resumen, seguimientos: seguimientos.map(({ nota_operativa, ...r }) => r), derivaciones };
    }

    const sociales = (await db.query(
      `select i.id, i.fecha, i.tipo, i.contenido_cifrado, i.created_at, p.nombre as profesional_nombre from social.intervenciones i
         join core.profesionales p on p.id = i.profesional_id where i.servidor_id = $1 order by i.fecha desc`,
      [id],
    )).rows.map(({ contenido_cifrado, ...r }) => ({ ...r, contenido: dec(contenido_cifrado) }));

    if (nivel === 'social') {
      // Trabajo Social: sus registros e información operativa; sin notas clínicas.
      await audit(db, user, 'hce.lectura_social', 'servidor', id, { intervenciones: sociales.length }, req.ip);
      return { ...base, intervenciones_sociales: sociales, seguimientos: seguimientos.map(({ nota_operativa, ...r }) => r) };
    }

    // Nivel clínico (continuidad asistencial)
    let secciones: unknown[] = [];
    let entradas: unknown[] = [];
    if (x) {
      secciones = (await db.query(
        `select distinct on (s.area, s.seccion) s.area, s.seccion, s.version, s.contenido_cifrado, s.created_at, s.motivo_cambio, p.nombre as autor
           from clinical.expediente_secciones s join core.profesionales p on p.id = s.autor_profesional_id
          where s.expediente_id = $1 order by s.area, s.seccion, s.version desc`,
        [x.id],
      )).rows.map(({ contenido_cifrado, ...r }) => ({ ...r, contenido: dec(contenido_cifrado) }));
      const rows = (await db.query(
        `select e.*, p.nombre as autor_nombre, a.codigo as atencion_codigo, uv.nombre as validada_por_nombre
           from clinical.entradas e join core.profesionales p on p.id = e.autor_profesional_id
           left join ops.atenciones a on a.id = e.atencion_id left join core.usuarios uv on uv.id = e.validada_por
          where e.expediente_id = $1 order by e.fecha_hora desc`,
        [x.id],
      )).rows;
      const adendas = (await db.query(
        `select a.*, p.nombre as autor_nombre from clinical.adendas a join core.profesionales p on p.id = a.autor_profesional_id
          where a.entrada_id = any($1) order by a.created_at`,
        [rows.map((r) => r.id)],
      )).rows;
      entradas = rows.map((e) => {
        const visible = e.confidencialidad === 'equipo_clinico' || e.autor_profesional_id === user.profesional_id;
        return {
          id: e.id,
          atencion_id: e.atencion_id,
          atencion_codigo: e.atencion_codigo,
          area: e.area,
          tipo: e.tipo,
          fecha_hora: e.fecha_hora,
          autor: e.autor_nombre,
          es_autor: e.autor_profesional_id === user.profesional_id,
          confidencialidad: e.confidencialidad,
          estado: e.estado,
          version: e.version_actual,
          validada_at: e.validada_at,
          validada_por: e.validada_por_nombre,
          hash: e.hash_contenido,
          contenido: visible ? ctx.cipher.decryptJson(e.contenido_cifrado) : null,
          restringida: !visible,
          adendas: visible
            ? adendas.filter((a) => a.entrada_id === e.id).map((a) => ({ id: a.id, motivo: a.motivo, contenido: dec(a.contenido_cifrado), autor: a.autor_nombre, created_at: a.created_at, hash: a.hash_contenido }))
            : [],
        };
      });
    }
    // Valoraciones psiquiátricas de derivaciones (continuidad para el equipo clínico).
    const detalle = (await db.query(
      `select d.id, dd.valoracion_cifrada, dd.recomendaciones_cifradas, dd.seguimiento_cifrado from ops.derivaciones d
         join clinical.derivacion_detalle dd on dd.derivacion_id = d.id where d.servidor_id = $1`,
      [id],
    )).rows;
    const derivacionesClin = derivaciones.map((d) => {
      const dd = detalle.find((z) => z.id === d.id);
      return { ...d, valoracion: dec(dd?.valoracion_cifrada ?? null), recomendaciones: dec(dd?.recomendaciones_cifradas ?? null), seguimiento: dec(dd?.seguimiento_cifrado ?? null) };
    });
    const riesgo = (await db.query(`select fuente, fecha_valoracion, requiere_seguimiento, vigente, created_at from clinical.clasificaciones_riesgo where servidor_id = $1 order by created_at desc`, [id])).rows;
    await audit(db, user, 'hce.lectura_clinica', 'servidor', id, { expediente: x?.codigo ?? null, entradas: entradas.length, secciones: secciones.length }, req.ip);
    return { ...base, secciones, entradas, seguimientos, derivaciones: derivacionesClin, intervenciones_sociales: sociales, clasificaciones_riesgo: riesgo, mi_area: areaDeEspecialidad(user.especialidad) };
  });

  /** Apertura manual del expediente (antes de la primera atención) por un profesional clínico con relación asistencial. */
  app.post('/api/servidores/:id/expediente', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const r = await tx(db, async (c) => {
      await exigirNivel(c, user, id, 'clinico');
      const e = await asegurarExpediente(c, id, user.profesional_id!, user.especialidad!, user.id);
      if (e.nuevo) await audit(c, user, 'hce.expediente_abierto', 'expediente', e.id, { codigo: e.codigo }, req.ip);
      await ctx.bus.emit(c, { tipo: 'expediente.abierto', topic: 'expedientes', actor: user.id });
      return e;
    });
    return r;
  });

  /** Nueva versión de una sección. Cada especialidad escribe solo en su área; las versiones previas se conservan. */
  app.post('/api/expedientes/:id/secciones', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(
      z.object({ area: z.enum(AREAS_HCE), seccion: z.enum(SECCIONES_HCE), contenido: z.string().trim().min(1).max(10000), motivo_cambio: z.string().max(300).optional() }),
      req.body,
    );
    const r = await tx(db, async (c) => {
      const x = (await c.query(`select id, servidor_id, codigo from clinical.expedientes where id = $1 for update`, [id])).rows[0];
      if (!x) throw notFound();
      await exigirNivel(c, user, x.servidor_id, 'clinico');
      if (areaDeEspecialidad(user.especialidad) !== b.area) throw forbidden('Solo puede registrar en el área de su especialidad.');
      const v = (await c.query(`select coalesce(max(version), 0) + 1 as v from clinical.expediente_secciones where expediente_id = $1 and area = $2 and seccion = $3`, [id, b.area, b.seccion])).rows[0].v;
      if (v > 1 && !b.motivo_cambio) throw badRequest('Indique el motivo del cambio (la versión anterior se conserva).');
      await c.query(
        `insert into clinical.expediente_secciones (expediente_id, area, seccion, version, contenido_cifrado, autor_profesional_id, autor_usuario_id, motivo_cambio) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, b.area, b.seccion, v, ctx.cipher.encrypt(b.contenido), user.profesional_id, user.id, b.motivo_cambio ?? null],
      );
      await c.query(`update clinical.expedientes set updated_at = now() where id = $1`, [id]);
      await audit(c, user, 'hce.seccion_version', 'expediente', id, { area: b.area, seccion: b.seccion, version: v }, req.ip);
      await ctx.bus.emit(c, { tipo: 'expediente.seccion', topic: 'expedientes', actor: user.id });
      return { version: v };
    });
    return r;
  });

  app.get('/api/expedientes/:id/secciones/:area/:seccion', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id, area, seccion } = req.params as { id: string; area: string; seccion: string };
    const x = (await db.query(`select servidor_id from clinical.expedientes where id = $1`, [id])).rows[0];
    if (!x) throw notFound();
    await exigirNivel(db, user, x.servidor_id, 'clinico');
    const rows = (await db.query(
      `select s.version, s.contenido_cifrado, s.created_at, s.motivo_cambio, p.nombre as autor from clinical.expediente_secciones s
         join core.profesionales p on p.id = s.autor_profesional_id where s.expediente_id = $1 and s.area = $2 and s.seccion = $3 order by s.version desc`,
      [id, area, seccion],
    )).rows;
    await audit(db, user, 'hce.lectura_versiones', 'expediente', id, { area, seccion }, req.ip);
    return rows.map(({ contenido_cifrado, ...r }) => ({ ...r, contenido: dec(contenido_cifrado) }));
  });

  /** Adenda sobre una entrada validada (única forma de completar o corregir un registro cerrado). */
  app.post('/api/expedientes/entradas/:id/adendas', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ contenido: z.string().trim().min(3).max(8000), motivo: z.string().trim().min(3).max(300) }), req.body);
    const r = await tx(db, async (c) => {
      const e = (await c.query(`select e.*, x.servidor_id from clinical.entradas e join clinical.expedientes x on x.id = e.expediente_id where e.id = $1`, [id])).rows[0];
      if (!e) throw notFound();
      if (e.autor_profesional_id !== user.profesional_id) throw forbidden('Solo el autor de la entrada puede registrar adendas.');
      if (e.estado !== 'validada') throw conflict('La entrada aún es un borrador: puede editarla directamente.');
      const hash = sha256(JSON.stringify({ entrada: id, entrada_hash: e.hash_contenido, contenido: b.contenido, motivo: b.motivo, autor: user.profesional_id }));
      const a = await c.query(
        `insert into clinical.adendas (entrada_id, contenido_cifrado, motivo, autor_profesional_id, autor_usuario_id, hash_contenido) values ($1,$2,$3,$4,$5,$6) returning id`,
        [id, ctx.cipher.encrypt(b.contenido), b.motivo, user.profesional_id, user.id, hash],
      );
      await c.query(`update clinical.expedientes set updated_at = now() where id = $1`, [e.expediente_id]);
      await audit(c, user, 'hce.adenda', 'entrada', id, { adenda: a.rows[0].id }, req.ip);
      await ctx.bus.emit(c, { tipo: 'expediente.adenda', topic: 'expedientes', actor: user.id });
      return { id: a.rows[0].id, hash };
    });
    return r;
  });

  // ---------------- Intervención social (separada de la historia clínica) ----------------
  app.post('/api/servidores/:id/intervenciones-sociales', { preHandler: requirePerm('social.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ fecha: z.string().datetime({ offset: true }), tipo: z.enum(TIPOS_INTERVENCION_SOCIAL), contenido: z.string().trim().min(3).max(8000) }), req.body);
    await exigirNivel(db, user, id, 'social');
    const r = await db.query(
      `insert into social.intervenciones (servidor_id, profesional_id, autor_usuario_id, fecha, tipo, contenido_cifrado) values ($1,$2,$3,$4,$5,$6) returning id`,
      [id, user.profesional_id, user.id, b.fecha, b.tipo, ctx.cipher.encrypt(b.contenido)],
    );
    await audit(db, user, 'social.intervencion', 'servidor', id, { tipo: b.tipo }, req.ip);
    await ctx.bus.emit(db, { tipo: 'social.intervencion', topic: 'expedientes', actor: user.id });
    return { id: r.rows[0].id };
  });

  // Listado de expedientes accesibles (para la bandeja de historias clínicas).
  app.get('/api/expedientes', { preHandler: requirePerm('hce.ver') }, async (req) => {
    const user = u(req);
    const q = parse(z.object({ servidor: uuid.optional() }), req.query);
    const pid = user.rol === 'coordinacion' ? null : user.profesional_id;
    if (user.rol !== 'coordinacion' && !pid) throw forbidden();
    const r = await db.query(
      `select x.id, x.codigo, x.fecha_apertura, x.updated_at, x.estado, s.id as servidor_id, s.nombre as servidor_nombre, p.nombre as responsable,
              (select count(*)::int from clinical.entradas e where e.expediente_id = x.id) as entradas,
              (select count(*)::int from clinical.entradas e where e.expediente_id = x.id and e.estado = 'borrador') as borradores
         from clinical.expedientes x join ops.servidores s on s.id = x.servidor_id join core.profesionales p on p.id = x.profesional_responsable_id
        where ($1::text is null
               or exists (select 1 from ops.asignaciones a where a.servidor_id = x.servidor_id and a.profesional_id = $1 and a.activa)
               or exists (select 1 from ops.derivaciones d where d.servidor_id = x.servidor_id and (d.especialista_id = $1 or d.profesional_derivante_id = $1))
               or exists (select 1 from clinical.entradas e where e.expediente_id = x.id and e.autor_profesional_id = $1))
          and ($2::uuid is null or x.servidor_id = $2)
        order by x.updated_at desc limit 500`,
      [pid, q.servidor ?? null],
    );
    return r.rows;
  });
}
