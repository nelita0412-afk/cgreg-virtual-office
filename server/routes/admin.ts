import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { AppCtx } from '../context';
import { badRequest, conflict, notFound } from '../context';
import { hashPassword, makeGuards } from '../auth';
import { audit } from '../audit';
import { parse, u } from './util';
import { FUNCIONES, ROLES, type Funcion, type Rol } from '@shared/domain';
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
      `select u.id, u.email, u.nombre, u.rol, u.profesional_id, p.nombre as profesional_nombre, p.especialidad, u.activo, u.debe_cambiar_password, u.ultimo_acceso, u.created_at, u.bloqueado_hasta,
              coalesce((select json_agg(json_build_object('funcion', f.funcion, 'motivo', f.motivo, 'otorgada_at', f.otorgada_at) order by f.funcion)
                          from core.usuario_funciones f where f.usuario_id = u.id and f.revocada_at is null), '[]') as funciones
         from core.usuarios u left join core.profesionales p on p.id = u.profesional_id order by u.rol, u.nombre`,
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
      const p = (await db.query(`select especialidad from core.profesionales where id = $1`, [b.profesional_id])).rows[0];
      if (!p) throw badRequest('Profesional no encontrado.');
      validarVinculo(b.rol, p.especialidad);
    }
    if (b.rol === 'epidemiologia' && !b.profesional_id) throw badRequest('El Apoyo Epidemiológico se vincula a su registro del directorio.');
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

  /**
   * El rol de la cuenta debe corresponder a la profesión del registro del directorio (no al nombre o título):
   * Psicología/Psiquiatría/Telemedicina → profesional; Epidemiología → epidemiologia; Trabajo Social → trabajo_social o
   * coordinacion (Coordinadora que ejerce Trabajo Social).
   */
  function validarVinculo(rol: Rol, especialidad: string) {
    const ok: Partial<Record<Rol, string[]>> = {
      profesional: ['psicologia', 'psiquiatria', 'telemedicina'],
      territorial: ['psicologia', 'trabajo_social', 'epidemiologia'],
      epidemiologia: ['epidemiologia'],
      trabajo_social: ['trabajo_social'],
      coordinacion: ['trabajo_social'],
    };
    if (!ok[rol]?.includes(especialidad)) throw badRequest(`Un registro de ${especialidad} no puede vincularse a una cuenta con rol ${rol}.`);
  }

  /** Registros del directorio para vincular cuentas: identidad y especialidad; sin cargas ni casos. */
  app.get('/api/admin/registros-directorio', { preHandler: requirePerm('usuarios.gestionar') }, async () => {
    const r = await db.query(
      `select p.id, p.nombre, p.especialidad, p.funcion_brigada, p.en_directorio, p.nota_directorio,
              (select u.email from core.usuarios u where u.profesional_id = p.id) as cuenta
         from core.profesionales p where p.activo order by p.orden, p.nombre`,
    );
    return r.rows;
  });

  /** Vincula una cuenta SIN vínculo a un registro del directorio SIN cuenta. Nunca reasigna vínculos existentes. */
  app.post('/api/admin/usuarios/:id/vincular', { preHandler: requirePerm('usuarios.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ profesional_id: z.string().min(1).max(60), motivo: z.string().trim().min(5).max(300) }), req.body);
    const t = (await db.query(`select id, rol, profesional_id from core.usuarios where id = $1`, [id])).rows[0];
    if (!t) throw notFound();
    if (t.profesional_id) throw conflict('La cuenta ya está vinculada a un registro del directorio. Los vínculos no se reasignan.');
    const p = (await db.query(`select especialidad, exists(select 1 from core.usuarios where profesional_id = $1) as ocupado from core.profesionales where id = $1`, [b.profesional_id])).rows[0];
    if (!p) throw badRequest('Profesional no encontrado.');
    if (p.ocupado) throw conflict('Ese registro del directorio ya tiene una cuenta. Los vínculos no se reasignan.');
    validarVinculo(t.rol, p.especialidad);
    await db.query(`update core.usuarios set profesional_id = $2 where id = $1`, [id, b.profesional_id]);
    await audit(db, user, 'usuario.vinculado', 'usuario', id, { profesional: b.profesional_id, motivo: b.motivo }, req.ip);
    return { ok: true };
  });

  /** Otorga una función complementaria (se suma al rol base). Con motivo y auditada. */
  app.post('/api/admin/usuarios/:id/funciones', { preHandler: requirePerm('usuarios.gestionar') }, async (req) => {
    const user = u(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ funcion: z.enum(FUNCIONES), motivo: z.string().trim().min(5).max(300) }), req.body);
    const t = (await db.query(`select id, rol, profesional_id from core.usuarios where id = $1`, [id])).rows[0];
    if (!t) throw notFound();
    const compatibles: Record<Funcion, Rol[]> = {
      trabajo_social: ['coordinacion', 'profesional'],
      territorial: ['profesional', 'epidemiologia', 'trabajo_social', 'coordinacion'],
      gestion_operativa: ['profesional', 'trabajo_social', 'epidemiologia', 'territorial'],
    };
    if (!compatibles[b.funcion].includes(t.rol)) throw badRequest(`La función ${b.funcion} no aplica a una cuenta con rol ${t.rol}.`);
    if (b.funcion === 'trabajo_social' && !t.profesional_id) throw badRequest('Para ejercer Trabajo Social la cuenta debe estar vinculada a su registro del directorio.');
    const r = await db.query(
      `insert into core.usuario_funciones (usuario_id, funcion, motivo, otorgada_por) values ($1,$2,$3,$4) on conflict do nothing returning id`,
      [id, b.funcion, b.motivo, user.id],
    );
    if (!r.rows[0]) throw conflict('La cuenta ya tiene esa función.');
    await audit(db, user, 'usuario.funcion_otorgada', 'usuario', id, { funcion: b.funcion, motivo: b.motivo }, req.ip);
    return { ok: true };
  });

  app.post('/api/admin/usuarios/:id/funciones/:funcion/revocar', { preHandler: requirePerm('usuarios.gestionar') }, async (req) => {
    const user = u(req);
    const { id, funcion } = req.params as { id: string; funcion: string };
    const b = parse(z.object({ motivo: z.string().trim().min(5).max(300) }), req.body);
    const r = await db.query(
      `update core.usuario_funciones set revocada_at = now(), revocada_por = $3 where usuario_id = $1 and funcion = $2 and revocada_at is null returning id`,
      [id, funcion, user.id],
    );
    if (!r.rows[0]) throw notFound();
    await audit(db, user, 'usuario.funcion_revocada', 'usuario', id, { funcion, motivo: b.motivo }, req.ip);
    return { ok: true };
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
