import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { AppCtx, SessionUser } from '../context';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../context';
import { makeGuards } from '../auth';
import { tx, type Queryable } from '../db';
import { audit } from '../audit';
import { newToken, sha256 } from '../crypto';
import { notificar } from '../notify';
import { parse, u, uuid } from './util';
import { nivelAcceso, registrarHistorialConsentimiento } from '../hce';
import { detectarMime, generarFormatoPdf, renderSecciones, type SeccionFormato } from '../pdf';
import { normalizar } from '../sheets/columns';
import { SERVICIOS_CONSENTIMIENTO, SERVICIO_CONSENTIMIENTO_LABEL, TZ_INSTITUCIONAL, type ServicioConsentimiento } from '@shared/domain';

const codigoDe = (id: string) => `CI-${id.slice(0, 8).toUpperCase()}`;

/**
 * Consentimiento informado documentado:
 *  - Modalidad 1: aceptación electrónica mediante enlace personal de un solo uso.
 *  - Modalidad 2: documento firmado a mano, digitalizado y cargado (repositorio privado cifrado).
 * Estados: pendiente → (cargado →) pendiente_validacion → validado | requiere_corrección; revocado.
 * Solo se aceptan consentimientos basados en formatos APROBADOS por la institución.
 */
export function consentimientosRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { requirePerm } = makeGuards(ctx);
  const db = ctx.db;

  async function exigirGestion(c: Queryable, user: SessionUser, servidorId: string) {
    if (user.rol === 'coordinacion' || user.rol === 'admin') return;
    if ((await nivelAcceso(c, user, servidorId)) !== 'clinico') throw forbidden('No tiene relación asistencial autorizada con este servidor.');
  }

  async function cargar(c: Queryable, id: string) {
    const k = (await c.query(
      `select k.*, p.version as plantilla_version, p.estado as plantilla_estado, p.titulo as plantilla_titulo, p.secciones, p.aprobada_at, p.aprobacion_referencia
         from ops.consentimientos k left join ops.consentimiento_plantillas p on p.id = k.plantilla_id where k.id = $1`,
      [id],
    )).rows[0];
    if (!k) throw notFound('Consentimiento no encontrado');
    return k;
  }

  async function variables(c: Queryable, servidorId: string | null, profesionalId: string | null, servicio: string, version: string) {
    const s = servidorId ? (await c.query(`select nombre, codigo_institucional, unidad from ops.servidores where id = $1`, [servidorId])).rows[0] : null;
    const p = profesionalId ? (await c.query(`select nombre, titulo from core.profesionales where id = $1`, [profesionalId])).rows[0] : null;
    return {
      servidor_nombre: s?.nombre,
      servidor_codigo: s?.codigo_institucional,
      servidor_unidad: s?.unidad,
      profesional_nombre: p?.nombre,
      profesional_titulo: p?.titulo,
      servicio: SERVICIO_CONSENTIMIENTO_LABEL[servicio as ServicioConsentimiento] ?? servicio,
      fecha: s ? DateTime.now().setZone(TZ_INSTITUCIONAL).setLocale('es').toFormat("d 'de' LLLL 'de' yyyy") : null,
      plantilla_version: version,
    };
  }

  async function cambiarEstado(c: Queryable, k: any, nuevo: string, user: SessionUser | null, accion: string, extra: { nota?: string | null; documento_id?: string | null; ip?: string | null } = {}) {
    await c.query(`update ops.consentimientos set estado = $2, updated_at = now() where id = $1`, [k.id, nuevo]);
    await registrarHistorialConsentimiento(c, k.id, accion, k.estado, nuevo, user?.id ?? null, extra);
    await ctx.bus.emit(c, { tipo: `consentimiento.${accion}`, topic: 'consentimientos', actor: user?.id ?? null });
  }

  // ---------------- Formatos (plantillas versionadas) ----------------
  app.get('/api/consentimientos/plantillas', { preHandler: requirePerm('consentimientos.gestionar', 'plantillas.gestionar') }, async () => {
    const r = await db.query(
      `select p.id, p.servicio, p.version, p.titulo, p.estado, p.aprobada_at, p.aprobacion_referencia, p.created_at, u.nombre as aprobada_por_nombre, p.secciones
         from ops.consentimiento_plantillas p left join core.usuarios u on u.id = p.aprobada_por order by p.servicio, p.created_at desc`,
    );
    return r.rows;
  });

  app.post('/api/consentimientos/plantillas', { preHandler: requirePerm('plantillas.gestionar') }, async (req) => {
    const user = u(req);
    const b = parse(
      z.object({
        servicio: z.enum(SERVICIOS_CONSENTIMIENTO),
        version: z.string().trim().regex(/^[0-9A-Za-z.\-]{1,20}$/),
        titulo: z.string().trim().min(5).max(200),
        secciones: z.array(z.object({ titulo: z.string().trim().min(1).max(200), texto: z.string().trim().min(1).max(6000) })).min(3).max(30),
      }),
      req.body,
    );
    try {
      const r = await db.query(
        `insert into ops.consentimiento_plantillas (servicio, version, titulo, secciones, creada_por) values ($1,$2,$3,$4,$5) returning id`,
        [b.servicio, b.version, b.titulo, JSON.stringify(b.secciones), user.id],
      );
      await audit(db, user, 'consentimiento.plantilla_creada', 'plantilla', r.rows[0].id, { servicio: b.servicio, version: b.version }, req.ip);
      return { id: r.rows[0].id };
    } catch (e: any) {
      if (e?.code === '23505') throw conflict('Ya existe esa versión para el servicio.');
      throw e;
    }
  });

  app.post('/api/consentimientos/plantillas/:id/:accion', { preHandler: requirePerm('plantillas.gestionar') }, async (req) => {
    const user = u(req);
    const { id, accion } = req.params as { id: string; accion: string };
    const p = (await db.query(`select * from ops.consentimiento_plantillas where id = $1`, [id])).rows[0];
    if (!p) throw notFound();
    if (accion === 'aprobar') {
      const b = parse(z.object({ referencia: z.string().trim().min(3).max(200) }), req.body);
      if (p.estado !== 'borrador') throw conflict('Solo se aprueban formatos en borrador.');
      await db.query(`update ops.consentimiento_plantillas set estado = 'aprobada', aprobada_por = $2, aprobada_at = now(), aprobacion_referencia = $3 where id = $1`, [id, user.id, b.referencia]);
      await audit(db, user, 'consentimiento.plantilla_aprobada', 'plantilla', id, { referencia: b.referencia }, req.ip);
    } else if (accion === 'retirar') {
      if (p.estado === 'retirada') throw conflict('El formato ya está retirado.');
      await db.query(`update ops.consentimiento_plantillas set estado = 'retirada' where id = $1`, [id]);
      await audit(db, user, 'consentimiento.plantilla_retirada', 'plantilla', id, {}, req.ip);
    } else throw notFound();
    return { ok: true };
  });

  /** Descarga del formato institucional en PDF (con datos del servidor si se indica). Los borradores llevan marca «NO VÁLIDO». */
  app.get('/api/consentimientos/plantillas/:id/pdf', { preHandler: requirePerm('consentimientos.gestionar', 'plantillas.gestionar') }, async (req, rep) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const q = parse(z.object({ servidor_id: uuid.optional(), profesional_id: z.string().optional(), consentimiento_id: uuid.optional() }), req.query);
    const p = (await db.query(`select * from ops.consentimiento_plantillas where id = $1`, [id])).rows[0];
    if (!p) throw notFound();
    if (q.servidor_id) await exigirGestion(db, user, q.servidor_id);
    const vars = await variables(db, q.servidor_id ?? null, q.profesional_id ?? user.profesional_id, p.servicio, p.version);
    const pdf = await generarFormatoPdf({
      titulo: p.titulo,
      servicio: SERVICIO_CONSENTIMIENTO_LABEL[p.servicio as ServicioConsentimiento],
      version: p.version,
      aprobada: p.estado === 'aprobada',
      referencia: p.aprobacion_referencia,
      secciones: renderSecciones(p.secciones as SeccionFormato[], vars),
      codigoConsentimiento: q.consentimiento_id ? codigoDe(q.consentimiento_id) : null,
    });
    await audit(db, user, 'consentimiento.formato_descargado', 'plantilla', id, { servidor: q.servidor_id ?? null, borrador: p.estado !== 'aprobada' }, req.ip);
    rep
      .header('content-type', 'application/pdf')
      .header('cache-control', 'no-store')
      .header('content-disposition', `attachment; filename="consentimiento-${p.servicio}-v${p.version}${p.estado === 'aprobada' ? '' : '-BORRADOR'}.pdf"`);
    return rep.send(Buffer.from(pdf));
  });

  // ---------------- Consentimientos por servidor ----------------
  app.get('/api/consentimientos', { preHandler: requirePerm('consentimientos.gestionar') }, async (req) => {
    const user = u(req);
    const q = parse(z.object({ estado: z.string().optional() }), req.query);
    const pid = user.rol === 'profesional' ? user.profesional_id : null;
    const r = await db.query(
      `select k.id, k.servidor_id, s.nombre as servidor_nombre, k.modalidad, k.servicio, k.estado, k.updated_at, k.fecha_recepcion, p.version as plantilla_version
         from ops.consentimientos k join ops.servidores s on s.id = k.servidor_id left join ops.consentimiento_plantillas p on p.id = k.plantilla_id
        where ($1::text is null or exists (select 1 from ops.asignaciones a where a.servidor_id = k.servidor_id and a.profesional_id = $1 and a.activa)
                                or exists (select 1 from ops.derivaciones d where d.servidor_id = k.servidor_id and d.especialista_id = $1))
          and ($2::text is null or k.estado = $2)
        order by k.updated_at desc limit 500`,
      [pid, q.estado ?? null],
    );
    return r.rows.map((x) => ({ ...x, codigo: codigoDe(x.id) }));
  });

  app.get('/api/consentimientos/:id', { preHandler: requirePerm('consentimientos.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const k = await cargar(db, id);
    await exigirGestion(db, user, k.servidor_id);
    const hist = (await db.query(
      `select h.accion, h.estado_anterior, h.estado_nuevo, h.nota, h.documento_id, h.ts, u.nombre as actor from ops.consentimiento_historial h
         left join core.usuarios u on u.id = h.actor where consentimiento_id = $1 order by h.ts`,
      [id],
    )).rows;
    const doc = k.documento_id ? (await db.query(`select id, nombre_original, mime, tamano, sha256, created_at from clinical.documentos where id = $1`, [k.documento_id])).rows[0] : null;
    const { secciones, ...meta } = k;
    return { consentimiento: { ...meta, codigo: codigoDe(k.id) }, historial: hist, documento: doc };
  });

  /** Inicia un consentimiento (pendiente) con la versión aprobada vigente del formato para el servicio. */
  app.post('/api/servidores/:id/consentimientos/solicitar', { preHandler: requirePerm('consentimientos.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ modalidad: z.enum(['electronica', 'firmada_manual']), servicio: z.enum(SERVICIOS_CONSENTIMIENTO), profesional_id: z.string().optional() }), req.body);
    const r = await tx(db, async (c) => {
      await exigirGestion(c, user, id);
      const p = (await c.query(`select id, version from ops.consentimiento_plantillas where servicio = $1 and estado = 'aprobada' order by aprobada_at desc limit 1`, [b.servicio])).rows[0];
      if (!p) throw conflict('No hay una versión APROBADA del formato de consentimiento para este servicio. Solicite su aprobación institucional.', 'sin_plantilla_aprobada');
      const pid = b.profesional_id ?? user.profesional_id ?? null;
      const k = await c.query(
        `insert into ops.consentimientos (servidor_id, tipo, base_legitimacion, otorgado, profesional_id, registrado_por, modalidad, servicio, plantilla_id, estado)
         values ($1,'teleatencion','consentimiento',false,$2,$3,$4,$5,$6,'pendiente') returning id`,
        [id, pid, user.id, b.modalidad, b.servicio, p.id],
      );
      const kid = k.rows[0].id as string;
      await registrarHistorialConsentimiento(c, kid, 'solicitado', null, 'pendiente', user.id, { nota: `${b.modalidad} · formato v${p.version}`, ip: req.ip });
      let enlace: string | null = null;
      let expira: string | null = null;
      if (b.modalidad === 'electronica') ({ enlace, expira } = await emitirToken(c, kid));
      await audit(c, user, 'consentimiento.solicitado', 'consentimiento', kid, { modalidad: b.modalidad, servicio: b.servicio, plantilla: p.version }, req.ip);
      await ctx.bus.emit(c, { tipo: 'consentimiento.solicitado', topic: 'consentimientos', actor: user.id });
      return { id: kid, codigo: codigoDe(kid), enlace, expira };
    });
    return r;
  });

  async function emitirToken(c: Queryable, consentimientoId: string) {
    const token = newToken(24);
    const expira = DateTime.now().plus({ hours: ctx.cfg.CONSENTIMIENTO_TOKEN_HORAS }).toUTC().toISO()!;
    await c.query(`update ops.consentimiento_tokens set expira_at = least(expira_at, now()) where consentimiento_id = $1 and usado_at is null`, [consentimientoId]);
    await c.query(`insert into ops.consentimiento_tokens (consentimiento_id, token_hash, expira_at) values ($1,$2,$3)`, [consentimientoId, sha256(token), expira]);
    // El enlace se muestra una sola vez a quien lo genera; en la base solo queda su hash.
    return { enlace: `/consentimiento/${token}`, expira };
  }

  app.post('/api/consentimientos/:id/enlace', { preHandler: requirePerm('consentimientos.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    return tx(db, async (c) => {
      const k = await cargar(c, id);
      await exigirGestion(c, user, k.servidor_id);
      if (k.modalidad !== 'electronica' || !['pendiente', 'requiere_correccion'].includes(k.estado)) throw conflict('Solo para consentimientos electrónicos pendientes o en corrección.');
      const t = await emitirToken(c, id);
      await registrarHistorialConsentimiento(c, id, 'enlace_emitido', k.estado, k.estado, user.id, { ip: req.ip });
      await audit(c, user, 'consentimiento.enlace_emitido', 'consentimiento', id, {}, req.ip);
      return t;
    });
  });

  /** Carga del documento firmado (PDF/JPEG/PNG). Se valida la firma binaria, se cifra y se guarda en la base. */
  app.post(
    '/api/consentimientos/:id/documento',
    { preHandler: requirePerm('consentimientos.gestionar'), bodyLimit: ctx.cfg.DOCUMENTO_MAX_MB * 1024 * 1024 },
    async (req) => {
      const user = u(req);
      const { id } = req.params as { id: string };
      const q = parse(z.object({ nombre: z.string().trim().min(1).max(200), fecha_recepcion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Envíe el archivo como contenido binario (PDF, JPEG o PNG).');
      const mime = detectarMime(body);
      if (!mime) throw new HttpError(415, 'Formato no permitido. Solo PDF, JPEG o PNG.', 'formato_no_permitido');
      return tx(db, async (c) => {
        const k = await cargar(c, id);
        await exigirGestion(c, user, k.servidor_id);
        if (k.modalidad !== 'firmada_manual') throw conflict('Este consentimiento no es de modalidad «firmado manualmente».');
        if (!['pendiente', 'requiere_correccion', 'cargado'].includes(k.estado)) throw conflict('El consentimiento no admite carga de documentos en su estado actual.');
        const d = await c.query(
          `insert into clinical.documentos (nombre_original, mime, tamano, sha256, contenido_cifrado, cargado_por) values ($1,$2,$3,$4,$5,$6) returning id`,
          [q.nombre.replace(/[^\p{L}\p{N}._ -]/gu, '_'), mime, body.length, sha256(body), ctx.cipher.encryptBuffer(body), user.id],
        );
        const docId = d.rows[0].id;
        const recepcion = q.fecha_recepcion ? DateTime.fromISO(q.fecha_recepcion, { zone: TZ_INSTITUCIONAL }).toUTC().toISO() : new Date().toISOString();
        await c.query(`update ops.consentimientos set documento_id = $2, fecha_recepcion = $3, cargado_por = $4 where id = $1`, [id, docId, recepcion, user.id]);
        await cambiarEstado(c, k, 'cargado', user, 'documento_cargado', { documento_id: docId, ip: req.ip });
        await audit(c, user, 'consentimiento.documento_cargado', 'consentimiento', id, { documento: docId, mime, tamano: body.length }, req.ip);
        return { documento_id: docId, mime };
      });
    },
  );

  app.post('/api/consentimientos/:id/enviar-validacion', { preHandler: requirePerm('consentimientos.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    await tx(db, async (c) => {
      const k = await cargar(c, id);
      await exigirGestion(c, user, k.servidor_id);
      if (k.estado !== 'cargado') throw conflict('Primero cargue el documento firmado.');
      await cambiarEstado(c, k, 'pendiente_validacion', user, 'enviado_validacion', { ip: req.ip });
      await audit(c, user, 'consentimiento.enviado_validacion', 'consentimiento', id, {}, req.ip);
    });
    return { ok: true };
  });

  app.post('/api/consentimientos/:id/validar', { preHandler: requirePerm('consentimientos.validar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ resultado: z.enum(['validado', 'requiere_correccion']), observaciones: z.string().max(1000).optional() }), req.body);
    await tx(db, async (c) => {
      const k = await cargar(c, id);
      if (user.rol !== 'admin') await exigirGestion(c, user, k.servidor_id);
      if (k.estado !== 'pendiente_validacion') throw conflict('El consentimiento no está pendiente de validación.');
      if (b.resultado === 'requiere_correccion' && !b.observaciones) throw badRequest('Indique qué debe corregirse.');
      if (b.resultado === 'validado') {
        await c.query(`update ops.consentimientos set otorgado = true, validado_por = $2, validado_at = now(), observaciones = $3 where id = $1`, [id, user.id, b.observaciones ?? null]);
      } else {
        await c.query(`update ops.consentimientos set observaciones = $2 where id = $1`, [id, b.observaciones]);
      }
      await cambiarEstado(c, k, b.resultado, user, b.resultado === 'validado' ? 'validado' : 'requiere_correccion', { nota: b.observaciones ?? null, ip: req.ip });
      await audit(c, user, `consentimiento.${b.resultado}`, 'consentimiento', id, {}, req.ip);
      if (k.registrado_por && k.registrado_por !== user.id) {
        await notificar(c, ctx.bus, [k.registrado_por], { tipo: 'consentimiento', titulo: `Consentimiento ${codigoDe(id)}: ${b.resultado === 'validado' ? 'validado' : 'requiere corrección'}`, enlace: `/servidores/${k.servidor_id}` }, user.id);
      }
    });
    return { ok: true };
  });

  /** Retiro/revocación: no borra registros (se conservan por obligación legal); impide nuevas atenciones ordinarias. */
  app.post('/api/consentimientos/:id/revocar', { preHandler: requirePerm('consentimientos.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ motivo: z.string().trim().min(3).max(500) }), req.body);
    await tx(db, async (c) => {
      const k = await cargar(c, id);
      await exigirGestion(c, user, k.servidor_id);
      if (k.estado === 'revocado') throw conflict('El consentimiento ya fue revocado.');
      await c.query(`update ops.consentimientos set revocado_at = now(), revocado_por = $2, motivo_revocacion = $3 where id = $1`, [id, user.id, b.motivo]);
      await c.query(`update ops.consentimiento_tokens set expira_at = least(expira_at, now()) where consentimiento_id = $1 and usado_at is null`, [id]);
      await cambiarEstado(c, k, 'revocado', user, 'revocado', { nota: b.motivo, ip: req.ip });
      await audit(c, user, 'consentimiento.revocado', 'consentimiento', id, {}, req.ip);
    });
    return { ok: true };
  });

  /** Descarga autenticada del documento (descifrado al vuelo; sin enlaces públicos ni caché). */
  app.get('/api/consentimientos/:id/documento', { preHandler: requirePerm('consentimientos.gestionar') }, async (req, rep) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const q = parse(z.object({ documento: uuid.optional() }), req.query);
    const k = await cargar(db, id);
    await exigirGestion(db, user, k.servidor_id);
    const docId = q.documento ?? k.documento_id;
    if (!docId) throw notFound('Sin documento cargado.');
    const vinculado = docId === k.documento_id || (await db.query(`select 1 from ops.consentimiento_historial where consentimiento_id = $1 and documento_id = $2`, [id, docId])).rows[0];
    if (!vinculado) throw forbidden();
    const d = (await db.query(`select * from clinical.documentos where id = $1`, [docId])).rows[0];
    const plano = ctx.cipher.decryptBuffer(d.contenido_cifrado);
    await audit(db, user, 'consentimiento.documento_descargado', 'consentimiento', id, { documento: docId }, req.ip);
    rep
      .header('content-type', d.mime)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `attachment; filename="${codigoDe(id)}-${d.nombre_original.replace(/"/g, '')}"`);
    return rep.send(plano);
  });

  // ---------------- Público: aceptación electrónica con enlace personal ----------------
  async function tokenValido(c: Queryable, token: string) {
    const t = (await c.query(`select * from ops.consentimiento_tokens where token_hash = $1`, [sha256(token)])).rows[0];
    if (!t || t.usado_at || new Date(t.expira_at) < new Date() || t.intentos >= 5) throw new HttpError(410, 'El enlace no es válido o ya expiró. Solicite uno nuevo al profesional.', 'enlace_invalido');
    const k = await cargar(c, t.consentimiento_id);
    if (!['pendiente', 'requiere_correccion'].includes(k.estado)) throw new HttpError(410, 'Este consentimiento ya fue procesado.', 'enlace_invalido');
    return { t, k };
  }

  async function documentoPublico(c: Queryable, k: any) {
    const vars = await variables(c, k.servidor_id, k.profesional_id, k.servicio, k.plantilla_version);
    const secciones = renderSecciones(k.secciones as SeccionFormato[], vars);
    return { secciones, hash: sha256(JSON.stringify(secciones)) };
  }

  app.get('/api/publico/consentimiento/:token', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req) => {
    const { token } = req.params as { token: string };
    const { k } = await tokenValido(db, token);
    const s = (await db.query(`select codigo_institucional from ops.servidores where id = $1`, [k.servidor_id])).rows[0];
    const docu = await documentoPublico(db, k);
    return {
      codigo: codigoDe(k.id),
      titulo: k.plantilla_titulo,
      servicio: SERVICIO_CONSENTIMIENTO_LABEL[k.servicio as ServicioConsentimiento],
      version: k.plantilla_version,
      secciones: docu.secciones,
      requiere_identificador: !!s?.codigo_institucional,
      emergencia_texto: ctx.cfg.EMERGENCIA_PUBLICO_TEXTO,
    };
  });

  app.post('/api/publico/consentimiento/:token', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req: FastifyRequest) => {
    const { token } = req.params as { token: string };
    const b = parse(
      z.object({ nombre_completo: z.string().trim().min(5).max(200), identificador: z.string().trim().max(60).optional(), lectura_confirmada: z.literal(true), acepta: z.literal(true) }),
      req.body,
    );
    return tx(db, async (c) => {
      const { t, k } = await tokenValido(c, token);
      const s = (await c.query(`select nombre, codigo_institucional from ops.servidores where id = $1`, [k.servidor_id])).rows[0];
      const tokensNombre = (x: string) => new Set(normalizar(x).split(' ').filter((w) => w.length > 1));
      const comunes = [...tokensNombre(b.nombre_completo)].filter((w) => tokensNombre(s.nombre).has(w)).length;
      const idOk = !s.codigo_institucional || normalizar(b.identificador ?? '') === normalizar(s.codigo_institucional);
      if (!idOk || comunes < Math.min(2, tokensNombre(s.nombre).size)) {
        await c.query(`update ops.consentimiento_tokens set intentos = intentos + 1 where id = $1`, [t.id]);
        throw badRequest('Los datos de identificación no coinciden con los registrados. Verifique e intente nuevamente.');
      }
      const docu = await documentoPublico(c, k);
      const evidencia = {
        nombre_firmado: b.nombre_completo,
        identificador_declarado: b.identificador ?? null,
        fecha_hora: new Date().toISOString(),
        ip: req.ip,
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        hash_documento: docu.hash,
        plantilla_version: k.plantilla_version,
        metodo: 'Aceptación electrónica mediante enlace personal de un solo uso con verificación de identificación institucional',
      };
      await c.query(`update ops.consentimiento_tokens set usado_at = now() where id = $1`, [t.id]);
      await c.query(`update ops.consentimientos set evidencia = $2, fecha_recepcion = now() where id = $1`, [k.id, JSON.stringify(evidencia)]);
      await cambiarEstado(c, k, 'pendiente_validacion', null, 'aceptacion_electronica', { ip: req.ip, nota: 'Aceptado por la persona atendida' });
      await audit(c, null, 'consentimiento.aceptacion_electronica', 'consentimiento', k.id, { hash_documento: docu.hash }, req.ip);
      if (k.registrado_por) {
        await notificar(c, ctx.bus, [k.registrado_por], { tipo: 'consentimiento', titulo: `Consentimiento ${codigoDe(k.id)} aceptado electrónicamente`, cuerpo: 'Pendiente de su validación.', enlace: `/servidores/${k.servidor_id}` }, null);
      }
      return { ok: true, codigo: codigoDe(k.id), mensaje: 'Su aceptación quedó registrada. El profesional la validará antes de la atención.' };
    });
  });
}
