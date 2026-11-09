import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { puede, type Permiso } from '@shared/permissions';
import type { AppCtx, SessionUser } from './context';
import { HttpError, forbidden } from './context';
import { newToken, sha256 } from './crypto';
import { audit } from './audit';

export const COOKIE = 'cgreg_sid';
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
const DUMMY_HASH = bcrypt.hashSync('cgreg-dummy-password', 12);

export const hashPassword = (p: string) => bcrypt.hash(p, 12);

export function validarPassword(p: string): string | null {
  if (p.length < 12) return 'La contraseña debe tener al menos 12 caracteres.';
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return 'La contraseña debe combinar letras y números.';
  return null;
}

export async function login(ctx: AppCtx, email: string, password: string, ip: string, ua: string) {
  const { db, cfg } = ctx;
  const r = await db.query(`select * from core.usuarios where lower(email) = lower($1)`, [email.trim()]);
  const u = r.rows[0];
  const fail = async (motivo: string) => {
    await audit(db, u ? { id: u.id, rol: u.rol } : null, 'auth.login_fallido', 'usuario', u?.id ?? null, { motivo }, ip);
    throw new HttpError(401, 'Credenciales inválidas o cuenta bloqueada temporalmente.', 'auth_failed');
  };
  if (!u || !u.activo) {
    await bcrypt.compare(password, DUMMY_HASH); // tiempo constante
    return fail(u ? 'inactivo' : 'desconocido');
  }
  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) return fail('bloqueado');
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    const intentos = u.intentos_fallidos + 1;
    await db.query(
      `update core.usuarios set intentos_fallidos = case when $2::int >= $3::int then 0 else $2::int end,
              bloqueado_hasta = case when $2::int >= $3::int then now() + ($4 || ' minutes')::interval else bloqueado_hasta end where id = $1`,
      [u.id, intentos, MAX_INTENTOS, String(BLOQUEO_MIN)],
    );
    if (intentos >= MAX_INTENTOS) await audit(db, { id: u.id, rol: u.rol }, 'auth.cuenta_bloqueada', 'usuario', u.id, {}, ip);
    return fail('password');
  }
  const token = newToken();
  await db.query(
    `insert into core.sesiones (id, usuario_id, expira_absoluta, ip, user_agent) values ($1,$2, now() + ($3 || ' hours')::interval, $4, $5)`,
    [sha256(token), u.id, String(cfg.SESSION_ABSOLUTE_HOURS), ip, ua.slice(0, 300)],
  );
  await db.query(`update core.usuarios set intentos_fallidos = 0, bloqueado_hasta = null, ultimo_acceso = now() where id = $1`, [u.id]);
  await audit(db, { id: u.id, rol: u.rol }, 'auth.login', 'usuario', u.id, {}, ip);
  return token;
}

export async function sessionFromToken(ctx: AppCtx, token: string | undefined, touch = true): Promise<SessionUser | null> {
  if (!token) return null;
  const sid = sha256(token);
  const r = await ctx.db.query(
    `select s.id as sid, s.ultima_actividad, s.expira_absoluta, s.revocada_at,
            u.id, u.nombre, u.email, u.rol, u.profesional_id, u.activo, u.debe_cambiar_password,
            p.especialidad, coalesce(p.es_teleatencion, false) as es_teleatencion,
            coalesce((select array_agg(f.funcion order by f.funcion) from core.usuario_funciones f where f.usuario_id = u.id and f.revocada_at is null), '{}') as funciones
       from core.sesiones s join core.usuarios u on u.id = s.usuario_id
       left join core.profesionales p on p.id = u.profesional_id
      where s.id = $1`,
    [sid],
  );
  const s = r.rows[0];
  if (!s || s.revocada_at || !s.activo) return null;
  const now = Date.now();
  if (new Date(s.expira_absoluta).getTime() < now) return null;
  if (now - new Date(s.ultima_actividad).getTime() > ctx.cfg.SESSION_IDLE_MINUTES * 60_000) return null;
  if (touch && now - new Date(s.ultima_actividad).getTime() > 30_000) {
    await ctx.db.query(`update core.sesiones set ultima_actividad = now() where id = $1`, [sid]);
  }
  return {
    id: s.id,
    sid,
    nombre: s.nombre,
    email: s.email,
    rol: s.rol,
    funciones: s.funciones ?? [],
    profesional_id: s.profesional_id,
    especialidad: s.especialidad ?? null,
    es_teleatencion: s.es_teleatencion,
    debe_cambiar_password: s.debe_cambiar_password,
  };
}

export function makeGuards(ctx: AppCtx) {
  const requireAuth = async (req: FastifyRequest, _rep: FastifyReply) => {
    const user = await sessionFromToken(ctx, req.cookies[COOKIE]);
    if (!user) throw new HttpError(401, 'Sesión no válida o expirada', 'unauthenticated');
    // Protección CSRF adicional a SameSite=Strict: las mutaciones exigen una cabecera propia.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-cgreg'] !== '1') {
      throw new HttpError(403, 'Solicitud rechazada (CSRF)', 'csrf');
    }
    if (user.debe_cambiar_password && !req.url.startsWith('/api/auth/')) {
      throw new HttpError(403, 'Debe cambiar su contraseña antes de continuar', 'password_change_required');
    }
    req.user = user;
  };
  const requirePerm =
    (...permisos: Permiso[]) =>
    async (req: FastifyRequest, rep: FastifyReply) => {
      await requireAuth(req, rep);
      if (!permisos.some((p) => puede(req.user, p))) {
        // Evento de seguridad para Auditoría: intento de acceso sin el permiso requerido.
        await audit(ctx.db, req.user!, 'acceso.denegado', 'ruta', null, { metodo: req.method, ruta: req.routeOptions?.url ?? req.url.split('?')[0], requiere: permisos }, req.ip).catch(() => {});
        throw forbidden();
      }
    };
  return { requireAuth, requirePerm };
}

export function cookieOptions(ctx: AppCtx) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: ctx.cfg.cookieSecure,
    maxAge: ctx.cfg.SESSION_ABSOLUTE_HOURS * 3600,
  };
}
