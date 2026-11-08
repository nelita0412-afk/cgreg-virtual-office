import type { FastifyInstance } from 'fastify';
import webpush from 'web-push';
import { z } from 'zod';
import type { AppCtx } from './context';
import type { EventRow } from './events';
import { makeGuards } from './auth';
import { parse, u } from './routes/util';

/**
 * Notificaciones push (Web Push / VAPID) para la app instalable.
 * Se activan solo si VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY están configuradas (`npm run push:claves`).
 * El aviso sale DESPUÉS del commit (desde el bus de eventos) y lleva solo el título breve y el enlace
 * interno: nunca el cuerpo de la notificación ni datos clínicos, porque puede verse en la pantalla bloqueada.
 */
export function pushRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db, cfg, bus } = ctx;
  const { requireAuth } = makeGuards(ctx);
  const activo = !!(cfg.VAPID_PUBLIC_KEY && cfg.VAPID_PRIVATE_KEY);
  if (activo) webpush.setVapidDetails(cfg.VAPID_SUBJECT, cfg.VAPID_PUBLIC_KEY!, cfg.VAPID_PRIVATE_KEY!);

  app.get('/api/push/clave', { preHandler: requireAuth }, async () => ({ activo, clave: activo ? cfg.VAPID_PUBLIC_KEY : null }));

  app.post('/api/push/suscribir', { preHandler: requireAuth }, async (req) => {
    const b = parse(
      z.object({ endpoint: z.string().url().startsWith('https://').max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) }),
      req.body,
    );
    await db.query(
      `insert into ops.push_suscripciones (usuario_id, endpoint, p256dh, auth, agente) values ($1,$2,$3,$4,$5)
       on conflict (endpoint) do update set usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth, agente = excluded.agente`,
      [u(req).id, b.endpoint, b.keys.p256dh, b.keys.auth, String(req.headers['user-agent'] ?? '').slice(0, 200)],
    );
    return { ok: true };
  });

  app.post('/api/push/anular', { preHandler: requireAuth }, async (req) => {
    const b = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    await db.query(`delete from ops.push_suscripciones where endpoint = $1 and usuario_id = $2`, [b.endpoint, u(req).id]);
    return { ok: true };
  });

  /**
   * Aviso de prueba: lo pide la persona desde Ajustes para comprobar que su teléfono recibe notificaciones.
   * Va solo a sus propias suscripciones y no lleva ningún dato institucional.
   */
  app.post('/api/push/prueba', { preHandler: requireAuth, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, rep) => {
    if (!activo) return rep.code(503).send({ error: 'Las notificaciones push no están configuradas en este servidor.', code: 'push_no_configurado' });
    const subs = await db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
      `select id, endpoint, p256dh, auth from ops.push_suscripciones where usuario_id = $1`,
      [u(req).id],
    );
    if (!subs.rows.length) return rep.code(409).send({ error: 'Este usuario no tiene dispositivos con notificaciones activadas.', code: 'sin_suscripcion' });
    const cuerpo = JSON.stringify({ titulo: 'Prueba: las notificaciones funcionan en este dispositivo', enlace: '/inicio', tag: 'prueba' });
    const r = await Promise.allSettled(subs.rows.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, cuerpo, { TTL: 600, urgency: 'high' })));
    for (const [i, x] of r.entries()) {
      const code = x.status === 'rejected' ? (x.reason as { statusCode?: number })?.statusCode : undefined;
      if (code === 404 || code === 410) await db.query(`delete from ops.push_suscripciones where id = $1`, [subs.rows[i].id]);
    }
    const enviadas = r.filter((x) => x.status === 'fulfilled').length;
    return { enviadas, fallidas: r.length - enviadas };
  });

  if (!activo) return;
  bus.on(async (ev: EventRow) => {
    if (ev.tipo !== 'notificacion' || !ev.destinatarios?.length) return;
    try {
      const subs = await db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
        `select id, endpoint, p256dh, auth from ops.push_suscripciones where usuario_id = any($1)`,
        [ev.destinatarios],
      );
      const titulo = String(ev.payload.titulo ?? 'Nueva notificación').slice(0, 120);
      const enlace = typeof ev.payload.enlace === 'string' && ev.payload.enlace.startsWith('/') ? ev.payload.enlace : '/inicio';
      const cuerpo = JSON.stringify({ titulo, enlace, tag: `n-${ev.id}` });
      for (const s of subs.rows) {
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, cuerpo, { TTL: 6 * 3600, urgency: 'high' })
          .then(() => db.query(`update ops.push_suscripciones set ultimo_envio_at = now() where id = $1`, [s.id]))
          .catch((err: { statusCode?: number }) => {
            // 404/410: el navegador anuló la suscripción (app desinstalada o permiso retirado).
            if (err.statusCode === 404 || err.statusCode === 410) return db.query(`delete from ops.push_suscripciones where id = $1`, [s.id]);
            app.log.warn({ statusCode: err.statusCode }, 'push no entregada');
          });
      }
    } catch (e) {
      app.log.error(e, 'push');
    }
  });
}
