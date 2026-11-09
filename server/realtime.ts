import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppCtx } from './context';
import { puede } from '@shared/permissions';
import { COOKIE, sessionFromToken } from './auth';
import type { PresenceService } from './presence';
import type { EventRow } from './events';

/**
 * Canal de tiempo real (WebSocket). Cada conexión está autenticada con la cookie de sesión.
 * - El cliente envía {"t":"hb"} cada 10 s (heartbeat). Si deja de hacerlo, el barrido
 *   del servidor marca al usuario como desconectado.
 * - El servidor difunde eventos confirmados en la base de datos (LISTEN/NOTIFY).
 * - Tras reconectar, el cliente vuelve a pedir el estado completo (recuperación).
 */
export function registerRealtime(app: FastifyInstance, ctx: AppCtx, presence: PresenceService) {
  const sockets = new Map<string, Set<WebSocket>>();
  /** Usuarios conectados que pueden ver la disponibilidad del equipo (Oficina Virtual). */
  const venOficina = new Set<string>();

  const send = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  ctx.bus.on(async (ev: EventRow) => {
    const publico = { id: ev.id, ts: ev.ts, tipo: ev.tipo, topic: ev.topic, texto: ev.texto_publico, actor_nombre: ev.actor_nombre };
    const targets = ev.destinatarios ? ev.destinatarios.flatMap((u) => [...(sockets.get(u) ?? [])]) : [...sockets.values()].flatMap((s) => [...s]);
    for (const ws of targets) send(ws, { type: 'evento', evento: publico });
    if (ev.topic === 'presencia') {
      const snap = await presence.snapshot();
      // La disponibilidad del equipo solo se envía a quien puede entrar a la Oficina Virtual (no a Autoridad, Auditoría ni Administración).
      for (const [uid, set] of sockets) if (venOficina.has(uid)) for (const ws of set) send(ws, { type: 'presencia', data: snap });
    }
  });

  app.get('/ws', { websocket: true }, async (socket, req) => {
    // Protección contra secuestro de WebSocket entre sitios: el Origin debe coincidir con el Host.
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (origin && host && new URL(origin).host !== host) {
      socket.close(4403, 'origin');
      return;
    }
    const user = await sessionFromToken(ctx, req.cookies[COOKIE], false);
    if (!user || user.debe_cambiar_password) {
      socket.close(4401, 'unauthenticated');
      return;
    }
    const set = sockets.get(user.id) ?? new Set();
    set.add(socket);
    sockets.set(user.id, set);
    if (puede(user, 'oficina.entrar')) venOficina.add(user.id);
    const registraPresencia = puede(user, 'presencia.propia');
    if (registraPresencia) await presence.conectar(user.id).catch((e) => req.log.error(e));
    send(socket, { type: 'hola', usuario: user.id, servidor_ts: new Date().toISOString() });

    socket.on('message', async (raw) => {
      let msg: { t?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === 'hb') {
        const valida = await sessionFromToken(ctx, req.cookies[COOKIE], false);
        if (!valida) {
          socket.close(4401, 'session');
          return;
        }
        if (registraPresencia) await presence.heartbeat(user.id);
        send(socket, { type: 'hb', ts: new Date().toISOString() });
      }
    });

    socket.on('close', () => {
      set.delete(socket);
      if (set.size === 0) {
        sockets.delete(user.id);
        venOficina.delete(user.id);
      }
      if (!registraPresencia) return;
      // Período de gracia para recargas de página o micro-cortes.
      setTimeout(async () => {
        if (sockets.get(user.id)?.size) return;
        const r = await ctx.db.query(
          `select 1 from ops.presencia where usuario_id = $1 and conectado and ultimo_heartbeat > now() - interval '12 seconds'`,
          [user.id],
        );
        if (!r.rows[0]) await presence.desconectar(user.id, 'cierre').catch(() => {});
      }, 12_000);
    });
  });

  return {
    conexiones: () => [...sockets.values()].reduce((a, s) => a + s.size, 0),
    cerrarUsuario: (userId: string) => sockets.get(userId)?.forEach((ws) => ws.close(4401, 'logout')),
  };
}
