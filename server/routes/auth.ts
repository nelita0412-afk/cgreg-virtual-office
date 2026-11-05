import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import type { AppCtx } from '../context';
import { HttpError, badRequest } from '../context';
import { COOKIE, cookieOptions, hashPassword, login, makeGuards, validarPassword } from '../auth';
import { audit } from '../audit';
import { parse, u } from './util';
import type { PresenceService } from '../presence';

export function authRoutes(app: FastifyInstance, ctx: AppCtx, presence: PresenceService, cerrarSockets: (id: string) => void) {
  const { requireAuth } = makeGuards(ctx);

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, rep) => {
    const b = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
    const token = await login(ctx, b.email, b.password, req.ip, String(req.headers['user-agent'] ?? ''));
    rep.setCookie(COOKIE, token, cookieOptions(ctx));
    return { ok: true };
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, rep) => {
    const user = u(req);
    await ctx.db.query(`update core.sesiones set revocada_at = now() where id = $1`, [user.sid]);
    await audit(ctx.db, user, 'auth.logout', 'usuario', user.id, {}, req.ip);
    const otras = await ctx.db.query(`select 1 from core.sesiones where usuario_id = $1 and revocada_at is null and expira_absoluta > now()`, [user.id]);
    if (!otras.rows[0]) {
      await presence.desconectar(user.id, 'logout').catch(() => {});
      cerrarSockets(user.id);
    }
    rep.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const user = u(req);
    const { sid: _sid, ...rest } = user;
    return { ...rest, emergencia_texto: ctx.cfg.EMERGENCY_ROUTE_TEXT };
  });

  app.post('/api/auth/ping', { preHandler: requireAuth }, async () => ({ ok: true }));

  app.post('/api/auth/password', { preHandler: requireAuth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const user = u(req);
    const b = parse(z.object({ actual: z.string().min(1), nueva: z.string().min(1).max(200) }), req.body);
    const err = validarPassword(b.nueva);
    if (err) throw badRequest(err);
    const r = await ctx.db.query(`select password_hash from core.usuarios where id = $1`, [user.id]);
    if (!(await bcrypt.compare(b.actual, r.rows[0].password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta.');
    if (b.actual === b.nueva) throw badRequest('La nueva contraseña debe ser distinta.');
    await ctx.db.query(`update core.usuarios set password_hash = $2, debe_cambiar_password = false where id = $1`, [user.id, await hashPassword(b.nueva)]);
    await ctx.db.query(`update core.sesiones set revocada_at = now() where usuario_id = $1 and id <> $2 and revocada_at is null`, [user.id, user.sid]);
    await audit(ctx.db, user, 'auth.cambio_password', 'usuario', user.id, {}, req.ip);
    return { ok: true };
  });

  app.get('/api/auth/sesiones', { preHandler: requireAuth }, async (req) => {
    const user = u(req);
    const r = await ctx.db.query(
      `select left(id, 8) as ref, creada_at, ultima_actividad, ip, user_agent, (id = $2) as actual
         from core.sesiones where usuario_id = $1 and revocada_at is null and expira_absoluta > now() order by ultima_actividad desc`,
      [user.id, user.sid],
    );
    return r.rows;
  });

  app.post('/api/auth/sesiones/cerrar-otras', { preHandler: requireAuth }, async (req) => {
    const user = u(req);
    await ctx.db.query(`update core.sesiones set revocada_at = now() where usuario_id = $1 and id <> $2 and revocada_at is null`, [user.id, user.sid]);
    await audit(ctx.db, user, 'auth.cerrar_otras_sesiones', 'usuario', user.id, {}, req.ip);
    return { ok: true };
  });
}
