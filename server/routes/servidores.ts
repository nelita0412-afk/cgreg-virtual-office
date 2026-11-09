import { ejerceTerritorial } from '@shared/permissions';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context';
import { forbidden, notFound } from '../context';
import { makeGuards } from '../auth';
import { tx } from '../db';
import { audit } from '../audit';
import { notificar, usuarioDeProfesional } from '../notify';
import { exigirAsignacion, parse, u, uuid } from './util';
import { nivelAcceso, registrarHistorialConsentimiento } from '../hce';
import { CATEGORIAS_NECESIDAD, ESTADOS_NECESIDAD, RESULTADOS_CONTACTO } from '@shared/domain';

export function servidoresRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { requirePerm } = makeGuards(ctx);
  const db = ctx.db;

  app.get('/api/servidores', { preHandler: requirePerm('servidores.ver_todos', 'servidores.ver_asignados') }, async (req) => {
    const user = u(req);
    const q = parse(
      z.object({ q: z.string().max(100).optional(), sin_asignar: z.enum(['1', '0']).optional(), vista: z.enum(['prioritaria', 'pendiente_verificacion', 'base_maestra']).optional(), mios: z.enum(['1']).optional() }),
      req.query,
    );
    // `mios=1`: solo los casos asignados al registro de quien consulta (p. ej., casos sociales de la Coordinadora).
    const pid = user.rol === 'profesional' || user.rol === 'trabajo_social' || q.mios ? user.profesional_id ?? '__sin_registro__' : null;
    const r = await db.query(
      `select s.id, s.codigo_institucional, s.nombre, s.canal_contacto, s.aviso_privacidad_aceptado, s.activo_en_fuente, s.ultima_sincronizacion,
              coalesce((select json_agg(json_build_object('profesional_id', a.profesional_id, 'nombre', p.nombre_corto)) from ops.asignaciones a join core.profesionales p on p.id = a.profesional_id where a.servidor_id = s.id and a.activa), '[]') as asignados,
              exists(select 1 from ops.contactos c where c.servidor_id = s.id and c.resultado = 'contactado') as contactado,
              exists(select 1 from ops.atenciones a where a.servidor_id = s.id and a.estado = 'atendida') as valorado,
              exists(select 1 from ops.atenciones a where a.servidor_id = s.id and a.estado in ('programada','confirmada','contacto_iniciado') and a.inicio > now()) as con_cita,
              exists(select 1 from ops.consentimientos c where c.servidor_id = s.id and c.tipo = 'teleatencion' and c.estado = 'validado' and c.revocado_at is null) as consentimiento,
              (select count(*) from ops.necesidades n where n.servidor_id = s.id and n.estado <> 'resuelta') as necesidades_abiertas,
              s.unidad, s.estado_servidor, s.en_base_maestra, s.en_santa_cruz, s.verificacion, s.origen,
              exists(select 1 from clinical.clasificaciones_riesgo r where r.servidor_id = s.id and r.vigente) as prioritaria,
              (select k.estado from ops.consentimientos k where k.servidor_id = s.id and k.tipo = 'teleatencion' order by k.updated_at desc limit 1) as consentimiento_estado
         from ops.servidores s
        where ($1::text is null or exists (select 1 from ops.asignaciones a where a.servidor_id = s.id and a.profesional_id = $1 and a.activa)
                                or exists (select 1 from ops.derivaciones d where d.servidor_id = s.id and d.especialista_id = $1))
          and ($2::text is null or s.nombre ilike '%' || $2 || '%' or s.codigo_institucional ilike '%' || $2 || '%')
          and ($3::text is null or not exists (select 1 from ops.asignaciones a where a.servidor_id = s.id and a.activa))
          and ($4::text is null
               or ($4 = 'prioritaria' and exists(select 1 from clinical.clasificaciones_riesgo r where r.servidor_id = s.id and r.vigente))
               or ($4 = 'pendiente_verificacion' and s.verificacion in ('pendiente_verificacion','no_verificable'))
               or ($4 = 'base_maestra' and s.en_base_maestra))
        order by s.nombre limit 2000`,
      [pid, q.q ?? null, q.sin_asignar === '1' ? '1' : null, q.vista ?? null],
    );
    // La condición prioritaria solo se muestra a Coordinación (dato operativo) y a profesionales clínicos asignados.
    const veRuta = user.rol === 'coordinacion' || user.rol === 'profesional';
    return r.rows.map((x) => ({ ...x, prioritaria: veRuta ? x.prioritaria : undefined }));
  });

  app.get('/api/servidores/:id', { preHandler: requirePerm('servidores.ver_todos', 'servidores.ver_asignados') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    await exigirAsignacion(db, user, id);
    const s = (await db.query(`select * from ops.servidores where id = $1`, [id])).rows[0];
    if (!s) throw notFound();
    const fuentes = (await db.query(`select registro_id, fecha_registro, activo from ops.registros_fuente where servidor_id = $1`, [id])).rows;
    const asign = (await db.query(`select a.id, a.profesional_id, p.nombre, p.especialidad, a.created_at from ops.asignaciones a join core.profesionales p on p.id = a.profesional_id where a.servidor_id = $1 and a.activa`, [id])).rows;
    const contactos = (await db.query(`select c.resultado, c.canal, c.fecha, u.nombre as registrado_por from ops.contactos c join core.usuarios u on u.id = c.registrado_por where servidor_id = $1 order by fecha desc`, [id])).rows;
    const consent = (await db.query(
      `select c.id, c.tipo, c.base_legitimacion, c.otorgado, c.canal, c.fecha, c.revocado_at, c.modalidad, c.servicio, c.estado, c.fecha_recepcion, c.validado_at, c.observaciones,
              c.documento_id, c.motivo_revocacion, c.updated_at, c.evidencia->>'nombre_firmado' as nombre_firmado,
              p.version as plantilla_version, p.estado as plantilla_estado, u.nombre as registrado_por, uv.nombre as validado_por_nombre, uc.nombre as cargado_por_nombre
         from ops.consentimientos c join core.usuarios u on u.id = c.registrado_por
         left join ops.consentimiento_plantillas p on p.id = c.plantilla_id
         left join core.usuarios uv on uv.id = c.validado_por left join core.usuarios uc on uc.id = c.cargado_por
        where servidor_id = $1 order by c.updated_at desc`,
      [id],
    )).rows;
    const necesidades = (await db.query(`select n.*, u.nombre as registrada_por_nombre from ops.necesidades n join core.usuarios u on u.id = n.registrada_por where servidor_id = $1 order by created_at desc`, [id])).rows;
    const pid = user.rol === 'profesional' || user.rol === 'trabajo_social' ? user.profesional_id : null;
    const atenciones = (
      await db.query(
        `select a.id, a.codigo, a.inicio, a.estado, a.tipo, p.nombre as profesional_nombre, a.profesional_id
           from ops.atenciones a join core.profesionales p on p.id = a.profesional_id
          where a.servidor_id = $1 and ($2::text is null or a.profesional_id = $2) order by coalesce(a.inicio, a.created_at) desc`,
        [id, pid],
      )
    ).rows;
    const nivel = await nivelAcceso(db, user, id!);
    const clas = (await db.query(
      `select r.id, r.fuente, r.registro_fuente_id, r.valor_origen, r.fecha_valoracion, r.requiere_seguimiento, r.vigente, r.created_at, r.retirada_at, r.motivo_retiro, p.nombre as profesional
         from clinical.clasificaciones_riesgo r left join core.profesionales p on p.id = r.profesional_id where r.servidor_id = $1 order by r.created_at desc`,
      [id],
    )).rows;
    const prioritaria = clas.some((c) => c.vigente);
    const expediente = (await db.query(
      `select x.id, x.codigo, x.fecha_apertura, x.estado, p.nombre as responsable from clinical.expedientes x join core.profesionales p on p.id = x.profesional_responsable_id where x.servidor_id = $1`,
      [id],
    )).rows[0] ?? null;
    const abiertas = (await db.query(`select id, codigo, estado, canal, created_at from ops.solicitudes_atencion where servidor_id = $1 order by created_at desc`, [id])).rows;
    const { contacto_cifrado, whatsapp_cifrado, whatsapp_ultimos, whatsapp_autorizado_por, ...sv } = s;
    // WhatsApp autorizado para teleatención: solo enmascarado (el número completo se usa únicamente para el enlace del profesional).
    const whatsapp = whatsapp_cifrado ? { autorizado: true, terminacion: `•••• ${whatsapp_ultimos}`, fuente: sv.whatsapp_fuente, autorizado_at: sv.whatsapp_autorizado_at } : { autorizado: false };
    void whatsapp_autorizado_por;
    const contacto_declarado = contacto_cifrado && (user.rol === 'coordinacion' || nivel) ? ctx.cipher.decrypt(contacto_cifrado) : null;
    await audit(db, user, 'servidor.consulta', 'servidor', id, {}, req.ip);
    return {
      servidor: { ...sv, contacto_declarado, whatsapp },
      fuentes,
      asignaciones: asign,
      contactos,
      consentimientos: consent,
      necesidades,
      atenciones,
      nivel_acceso: nivel,
      // Coordinación ve la condición operativa de seguimiento prioritario; el detalle de la clasificación solo el equipo clínico.
      prioritaria: user.rol === 'coordinacion' || nivel === 'clinico' ? prioritaria : undefined,
      clasificaciones: nivel === 'clinico' ? clas : undefined,
      expediente,
      solicitudes_abiertas: abiertas,
    };
  });

  app.post('/api/servidores/:id/asignaciones', { preHandler: requirePerm('servidores.asignar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ profesional_id: z.string() }), req.body);
    await tx(db, async (c) => {
      const p = (await c.query(`select nombre, especialidad, es_teleatencion from core.profesionales where id = $1`, [b.profesional_id])).rows[0];
      if (!p) throw forbidden('Profesional no encontrado.');
      if (p.especialidad === 'psiquiatria') throw forbidden('Psiquiatría recibe servidores únicamente mediante derivación.');
      // Apoyo Epidemiológico y Territorial no lleva casos individuales (sin acceso clínico por defecto).
      if (p.especialidad === 'epidemiologia') throw forbidden('El Apoyo Epidemiológico y Territorial no recibe casos individuales.');
      if (p.especialidad === 'telemedicina' && !p.es_teleatencion) throw forbidden('El profesional no atiende por teleatención.');
      await c.query(
        `insert into ops.asignaciones (servidor_id, profesional_id, asignada_por) select $1,$2,$3 where not exists (select 1 from ops.asignaciones where servidor_id=$1 and profesional_id=$2 and activa)`,
        [id, b.profesional_id, user.id],
      );
      await audit(c, user, 'servidor.asignado', 'servidor', id, { profesional: b.profesional_id }, req.ip);
      const dest = await usuarioDeProfesional(c, b.profesional_id);
      if (dest) await notificar(c, ctx.bus, [dest], { tipo: 'asignacion', titulo: 'Nuevo servidor asignado', cuerpo: 'Coordinación General le asignó un servidor para acompañamiento.', enlace: `/servidores/${id}` }, user.id);
      await ctx.bus.emit(c, { tipo: 'servidor.asignado', topic: 'servidores', actor: user.id });
    });
    return { ok: true };
  });

  app.delete('/api/servidores/:id/asignaciones/:pid', { preHandler: requirePerm('servidores.asignar') }, async (req) => {
    const user = u(req);
    const { id, pid } = req.params as { id: string; pid: string };
    await db.query(`update ops.asignaciones set activa = false, finalizada_at = now() where servidor_id = $1 and profesional_id = $2 and activa`, [id, pid]);
    await audit(db, user, 'servidor.desasignado', 'servidor', id, { profesional: pid }, req.ip);
    await ctx.bus.emit(db, { tipo: 'servidor.desasignado', topic: 'servidores', actor: user.id });
    return { ok: true };
  });

  app.post('/api/servidores/:id/contactos', { preHandler: requirePerm('atenciones.registrar', 'servidores.asignar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ resultado: z.enum(RESULTADOS_CONTACTO), canal: z.string().max(60).optional() }), req.body);
    await exigirAsignacion(db, user, id);
    await db.query(`insert into ops.contactos (servidor_id, profesional_id, resultado, canal, registrado_por) values ($1,$2,$3,$4,$5)`, [
      id,
      user.profesional_id,
      b.resultado,
      b.canal ?? null,
      user.id,
    ]);
    await audit(db, user, 'servidor.contacto', 'servidor', id, { resultado: b.resultado }, req.ip);
    await ctx.bus.emit(db, { tipo: 'servidor.contacto', topic: 'servidores', actor: user.id });
    return { ok: true };
  });

  app.post('/api/servidores/:id/consentimientos', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(
      z.object({
        tipo: z.enum(['teleatencion', 'tratamiento_datos']),
        base_legitimacion: z.enum(['consentimiento', 'interes_vital', 'funcion_publica']),
        otorgado: z.boolean(),
        canal: z.string().max(60).optional(),
      }),
      req.body,
    );
    await exigirAsignacion(db, user, id);
    const ins = await db.query(
      `insert into ops.consentimientos (servidor_id, tipo, base_legitimacion, otorgado, canal, profesional_id, registrado_por, modalidad, estado)
       values ($1,$2,$3,$4,$5,$6,$7,'constancia_profesional',$8) returning id, estado`,
      [id, b.tipo, b.base_legitimacion, b.otorgado, b.canal ?? null, user.profesional_id, user.id, b.otorgado ? 'validado' : 'no_otorgado'],
    );
    await registrarHistorialConsentimiento(db, ins.rows[0].id, 'constancia_registrada', null, ins.rows[0].estado, user.id, { ip: req.ip });
    await audit(db, user, 'servidor.consentimiento', 'servidor', id, { tipo: b.tipo, otorgado: b.otorgado, base: b.base_legitimacion }, req.ip);
    await ctx.bus.emit(db, { tipo: 'servidor.consentimiento', topic: 'servidores', actor: user.id });
    return { ok: true };
  });

  app.post('/api/servidores/:id/consentimientos/:cid/revocar', { preHandler: requirePerm('atenciones.registrar') }, async (req) => {
    const user = u(req);
    const { id, cid } = req.params as { id: string; cid: string };
    await exigirAsignacion(db, user, id);
    const prev = (await db.query(`select estado from ops.consentimientos where id = $1 and servidor_id = $2 and revocado_at is null`, [cid, id])).rows[0];
    await db.query(`update ops.consentimientos set revocado_at = now(), estado = 'revocado', revocado_por = $3, updated_at = now() where id = $1 and servidor_id = $2 and revocado_at is null`, [cid, id, user.id]);
    if (prev) await registrarHistorialConsentimiento(db, cid, 'revocado', prev.estado, 'revocado', user.id, { ip: req.ip });
    await audit(db, user, 'servidor.consentimiento_revocado', 'servidor', id, {}, req.ip);
    await ctx.bus.emit(db, { tipo: 'servidor.consentimiento', topic: 'servidores', actor: user.id });
    return { ok: true };
  });

  // ---------------- Necesidades ----------------
  app.get('/api/necesidades', { preHandler: requirePerm('servidores.ver_todos', 'servidores.ver_asignados') }, async (req) => {
    const user = u(req);
    const pid = user.rol === 'profesional' || user.rol === 'trabajo_social' ? user.profesional_id : null;
    const r = await db.query(
      `select n.*, s.nombre as servidor_nombre, u.nombre as registrada_por_nombre from ops.necesidades n
         join ops.servidores s on s.id = n.servidor_id join core.usuarios u on u.id = n.registrada_por
        where ($1::text is null or exists (select 1 from ops.asignaciones a where a.servidor_id = n.servidor_id and a.profesional_id = $1 and a.activa))
        order by n.estado, n.created_at desc`,
      [pid],
    );
    return r.rows;
  });

  app.post('/api/servidores/:id/necesidades', { preHandler: requirePerm('necesidades.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ categoria: z.enum(CATEGORIAS_NECESIDAD), descripcion: z.string().trim().min(3).max(500) }), req.body);
    // Función territorial (rol base o complementaria): registra necesidades detectadas en territorio.
    if (!ejerceTerritorial(user)) await exigirAsignacion(db, user, id);
    const r = await db.query(`insert into ops.necesidades (servidor_id, categoria, descripcion, registrada_por) values ($1,$2,$3,$4) returning id`, [id, b.categoria, b.descripcion, user.id]);
    await audit(db, user, 'necesidad.registrada', 'necesidad', r.rows[0].id, { categoria: b.categoria }, req.ip);
    await ctx.bus.emit(db, { tipo: 'necesidad.registrada', topic: 'necesidades', actor: user.id });
    return { id: r.rows[0].id };
  });

  app.patch('/api/necesidades/:id', { preHandler: requirePerm('necesidades.registrar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ estado: z.enum(ESTADOS_NECESIDAD) }), req.body);
    const n = (await db.query(`select servidor_id from ops.necesidades where id = $1`, [id])).rows[0];
    if (!n) throw notFound();
    if (user.rol === 'profesional') await exigirAsignacion(db, user, n.servidor_id);
    await db.query(`update ops.necesidades set estado = $2, updated_at = now(), resuelta_at = case when $2 = 'resuelta' then now() else null end where id = $1`, [id, b.estado]);
    await audit(db, user, 'necesidad.estado', 'necesidad', id, { estado: b.estado }, req.ip);
    await ctx.bus.emit(db, { tipo: 'necesidad.actualizada', topic: 'necesidades', actor: user.id });
    return { ok: true };
  });

  // Selector liviano para formularios (solo id y nombre de servidores autorizados).
  app.get('/api/servidores-selector', { preHandler: requirePerm('servidores.ver_todos', 'servidores.ver_asignados', 'solicitudes.crear') }, async (req) => {
    const user = u(req);
    if (user.rol === 'territorial') return [];
    const pid = user.rol === 'profesional' || user.rol === 'trabajo_social' ? user.profesional_id : null;
    const r = await db.query(
      `select s.id, s.nombre, s.codigo_institucional from ops.servidores s
        where $1::text is null or exists (select 1 from ops.asignaciones a where a.servidor_id = s.id and a.profesional_id = $1 and a.activa)
              or exists (select 1 from ops.derivaciones d where d.servidor_id = s.id and d.especialista_id = $1)
        order by s.nombre`,
      [pid],
    );
    return r.rows;
  });
}
