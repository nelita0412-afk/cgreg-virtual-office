import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { badRequest, forbidden, type SessionUser } from '../context';
import type { Queryable } from '../db';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw badRequest(r.error.issues.map((i) => `${i.path.join('.') || 'datos'}: ${i.message}`).join('; '), 'validation');
  return r.data;
}

export const uuid = z.string().uuid();
export const textoCorto = (max = 500) => z.string().trim().min(1).max(max);
export const fechaISO = z.string().datetime({ offset: true });
export const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function u(req: FastifyRequest): SessionUser {
  return req.user!;
}

export function ip(req: FastifyRequest) {
  return req.ip;
}

/** Comprueba que el profesional esté asignado al servidor (mínimo privilegio). */
export async function exigirAsignacion(c: Queryable, user: SessionUser, servidorId: string) {
  if (user.rol === 'coordinacion') return;
  if (!['profesional', 'trabajo_social'].includes(user.rol) || !user.profesional_id) throw forbidden();
  const r = await c.query(
    `select 1 from ops.asignaciones where servidor_id = $1 and profesional_id = $2 and activa
     union all
     select 1 from ops.derivaciones where servidor_id = $1 and especialista_id = $2`,
    [servidorId, user.profesional_id],
  );
  if (!r.rows[0]) throw forbidden('El servidor no está asignado a usted.');
}
