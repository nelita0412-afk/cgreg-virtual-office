import type { Queryable } from './db';
import type { EventBus } from './events';

export async function notificar(
  c: Queryable,
  bus: EventBus,
  usuarios: string[],
  n: { tipo: string; titulo: string; cuerpo?: string; enlace?: string },
  actor?: string | null,
) {
  const unicos = [...new Set(usuarios.filter(Boolean))];
  if (!unicos.length) return;
  for (const u of unicos) {
    await c.query(`insert into ops.notificaciones (usuario_id, tipo, titulo, cuerpo, enlace) values ($1,$2,$3,$4,$5)`, [
      u,
      n.tipo,
      n.titulo,
      n.cuerpo ?? null,
      n.enlace ?? null,
    ]);
  }
  await bus.emit(c, { tipo: 'notificacion', topic: 'notificaciones', actor, destinatarios: unicos, payload: { titulo: n.titulo } });
}

export async function usuariosPorRol(c: Queryable, rol: string): Promise<string[]> {
  const r = await c.query<{ id: string }>(`select id from core.usuarios where rol = $1 and activo`, [rol]);
  return r.rows.map((x) => x.id);
}

export async function usuarioDeProfesional(c: Queryable, profesionalId: string): Promise<string | null> {
  const r = await c.query<{ id: string }>(`select id from core.usuarios where profesional_id = $1 and activo`, [profesionalId]);
  return r.rows[0]?.id ?? null;
}
