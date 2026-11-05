import type { Queryable } from './db';
import type { SessionUser } from './context';

/** Registra una acción en la bitácora inmutable. Nunca incluir contenido clínico en `detalle`. */
export async function audit(
  c: Queryable,
  user: Pick<SessionUser, 'id' | 'rol'> | null,
  accion: string,
  entidad?: string | null,
  entidadId?: string | null,
  detalle: Record<string, unknown> = {},
  ip?: string | null,
) {
  await c.query(
    `insert into audit.registro (usuario_id, rol, accion, entidad, entidad_id, detalle, ip) values ($1,$2,$3,$4,$5,$6,$7)`,
    [user?.id ?? null, user?.rol ?? null, accion, entidad ?? null, entidadId ?? null, JSON.stringify(detalle), ip ?? null],
  );
}
