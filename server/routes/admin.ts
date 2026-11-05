import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { AppCtx } from '../context';
import { badRequest, conflict, notFound } from '../context';
import { hashPassword, makeGuards } from '../auth';
import { audit } from '../audit';
import { parse, u } from './util';
import { ROLES } from '@shared/domain';
import type { SheetsSync } from '../sheets/sync';
import { CAMPOS_SERVIDOR, mapeoColumnas } from '../sheets/columns';

export function passwordTemporal() {
  // 16 caracteres, letras y números, sin caracteres ambiguos.
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += abc[b[i] % abc.length];
  return /\d/.test(s) ? s : s.slice(0, 15) + '7';
}

export function adminRoutes(app: FastifyInstance, ctx: AppCtx, sync: SheetsSync) {
  const { requirePerm, requireAuth } = makeGuards(ctx);
  const db = ctx.db;

  app.get('/api/admin/usuarios', { preHandler: requirePerm('usuarios.gestionar') }, async () => {
    const r = await db.query(
      `select u.id, u.email, u.nombre, u.rol, u.profesional_id, u.activo, u.debe_cambiar_password, u.ultimo_acceso, u.created_at, u.bloqueado_hasta
         from core.usuarios u order by u.rol, u.nombre`,
    );
    return r.rows;
  });

  app.post('/api/admin/usuarios', { preHandler: requirePerm('usuarios.gestionar') }, async (req) => {
    const user = u(req);
    const b = parse(z.object({ email: z.string().email(), nombre: z.string().trim().min(3).max(200), rol: z.enum(ROLES), profesional_id: z.string().optional() }), req.body);
    if (b.rol === 'profesional' && !b.profesional_id) throw badRequest('Los usuarios profesionales deben vincularse a un registro profesional.');
    if (b.rol === 'trabajo_social') {
      // Trabajo Social: se crea su registro profesional (no forma parte de los ocho profesionales de teleatención).
      const temporal = passwordTemporal();
      const pid = `ts-${randomBytes(4).toString('hex')}`;
      try {
        const r = await db.query(
          `with p as (insert into core.profesionales (id, nombre, nombre_corto, titulo, especialidad, perfil, modalidad, estacion, color, es_teleatencion, orden)
                      values ($1, $2, split_part($2, ' ', 1), 'Trabajador/a social', 'trabajo_social', 'Intervención social y psicosocial', 'Intervención social', $1, '#0891b2', false, 50) returning id)
           insert into core.usuarios (email, nombre, rol, profesional_id, password_hash, debe_cambiar_password) select $3, $2, 'trabajo_social', p.id, $4, true from p returning id`,
          [pid, b.nombre, b.email.toLowerCase(), await hashPassword(temporal)],
        );
        await audit(db, user, 'usuario.creado', 'usuario', r.rows[0].id, { rol: b.rol, profesional: pid }, req.ip);
        return { id: r.rows[0].id, password_temporal: temporal };
      } catch (e: any) {
        if (e?.code === '23505') throw conflict('Ya existe un usuario con ese correo.');
        throw e;
      }
    }
    if (b.profesional_id) {
      const p = (await db.query(`select es_teleatencion from core.profesionales where id = $1`, [b.profesional_id])).rows[0];
      if (!p) throw badRequest('Profesional no encontrado.');
      if (b.rol !== 'profesional' && b.rol !== 'territorial') throw badRequest('Solo profesionales o territoriales se vinculan a un registro profesional.');
    }
    const temporal = passwordTemporal();
    try {
      const r = await db.query(`insert into core.usuarios (email, nombre, rol, profesional_id, password_hash, debe_cambiar_password) values ($1,$2,$3,$4,$5,true) returning id`, [
        b.email.toLowerCase(),
        b.nombre,
        b.rol,
        b.profesional_id ?? null,
        await hashPassword(temporal),
      ]);
      await audit(db, user, 'usuario.creado', 'usuario', r.rows[0].id, { rol: b.rol, profesional: b.profesional_id ?? null }, req.ip);
      return { id: r.rows[0].id, password_temporal: temporal };
    } catch (e: any) {
      if (e?.code === '23505') throw conflict('Ya existe un usuario con ese correo o vinculado a ese profesional.');
      throw e;
    }
  });

  app.post('/api/admin/usuarios/:id/:accion', { preHandler: requirePerm('usuarios.gestionar') }, async (req) => {
    const user = u(req);
    const { id, accion } = req.params as { id: string; accion: string };
    const t = (await db.query(`select id from core.usuarios where id = $1`, [id])).rows[0];
    if (!t) throw notFound();
    if (accion === 'desactivar') {
      if (id === user.id) throw badRequest('No puede desactivar su propia cuenta.');
      await db.query(`update core.usuarios set activo = false where id = $1`, [id]);
      await db.query(`update core.sesiones set revocada_at = now() where usuario_id = $1 and revocada_at is null`, [id]);
    } else if (accion === 'activar') {
      await db.query(`update core.usuarios set activo = true, intentos_fallidos = 0, bloqueado_hasta = null where id = $1`, [id]);
    } else if (accion === 'restablecer') {
      const temporal = passwordTemporal();
      await db.query(`update core.usuarios set password_hash = $2, debe_cambiar_password = true, intentos_fallidos = 0, bloqueado_hasta = null where id = $1`, [id, await hashPassword(temporal)]);
      await db.query(`update core.sesiones set revocada_at = now() where usuario_id = $1 and revocada_at is null`, [id]);
      await audit(db, user, 'usuario.restablecer', 'usuario', id, {}, req.ip);
      return { password_temporal: temporal };
    } else if (accion === 'cerrar-sesiones') {
      await db.query(`update core.sesiones set revocada_at = now() where usuario_id = $1 and revocada_at is null`, [id]);
    } else throw notFound();
    await audit(db, user, `usuario.${accion}`, 'usuario', id, {}, req.ip);
    return { ok: true };
  });

  // ---------------- Integración Google Sheets ----------------
  app.get('/api/sync/estado', { preHandler: requirePerm('sync.ver') }, async () => {
    const mapeo = mapeoColumnas(ctx.cfg.SHEETS_COLUMNS);
    return {
      ...(await sync.estado()),
      columnas: Object.entries(mapeo).map(([campo, encabezado]) => ({ campo, encabezado, descripcion: CAMPOS_SERVIDOR[campo as keyof typeof CAMPOS_SERVIDOR].descripcion })),
    };
  });

  app.post('/api/sync/ejecutar', { preHandler: requirePerm('sync.ejecutar'), config: { rateLimit: { max: 4, timeWindow: '1 minute' } } }, async (req) => {
    const user = u(req);
    const r = await sync.ejecutar();
    await audit(db, user, 'sync.manual', 'sync', null, { estado: r.estado, procesados: r.procesados }, req.ip);
    return r;
  });

  // ---------------- Auditoría ----------------
  app.get('/api/auditoria', { preHandler: requirePerm('auditoria.ver') }, async (req) => {
    const user = u(req);
    const q = parse(z.object({ accion: z.string().max(80).optional(), usuario: z.string().uuid().optional(), antes_de: z.coerce.number().optional(), limit: z.coerce.number().max(500).default(100) }), req.query);
    const r = await db.query(
      `select a.id, a.ts, a.usuario_id, us.nombre as usuario_nombre, a.rol, a.accion, a.entidad, a.entidad_id, a.detalle, a.ip
         from audit.registro a left join core.usuarios us on us.id = a.usuario_id
        where ($1::text is null or a.accion ilike $1 || '%') and ($2::uuid is null or a.usuario_id = $2) and ($3::bigint is null or a.id < $3)
        order by a.id desc limit $4`,
      [q.accion ?? null, q.usuario ?? null, q.antes_de ?? null, q.limit],
    );
    await audit(db, user, 'auditoria.consulta', null, null, { filtro: q.accion ?? null }, req.ip);
    return r.rows;
  });

  // ---------------- Notificaciones ----------------
  app.get('/api/notificaciones', { preHandler: requireAuth }, async (req) => {
    const r = await db.query(`select * from ops.notificaciones where usuario_id = $1 order by created_at desc limit 50`, [u(req).id]);
    const n = await db.query(`select count(*)::int as n from ops.notificaciones where usuario_id = $1 and leida_at is null`, [u(req).id]);
    return { items: r.rows, no_leidas: n.rows[0].n };
  });

  app.post('/api/notificaciones/leer', { preHandler: requireAuth }, async (req) => {
    const b = parse(z.object({ ids: z.array(z.string().uuid()).optional() }), req.body);
    if (b.ids?.length) await db.query(`update ops.notificaciones set leida_at = now() where usuario_id = $1 and id = any($2) and leida_at is null`, [u(req).id, b.ids]);
    else await db.query(`update ops.notificaciones set leida_at = now() where usuario_id = $1 and leida_at is null`, [u(req).id]);
    return { ok: true };
  });
}
