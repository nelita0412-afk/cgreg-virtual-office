import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from './config';
import { createPool } from './db';
import { FieldCipher } from './crypto';
import { EventBus } from './events';
import { HttpError, type AppCtx } from './context';
import { PresenceService } from './presence';
import { registerRealtime } from './realtime';
import { SheetsSync } from './sheets/sync';
import type { SheetsClient } from './sheets/client';
import { authRoutes } from './routes/auth';
import { officeRoutes } from './routes/office';
import { agendaRoutes } from './routes/agenda';
import { servidoresRoutes } from './routes/servidores';
import { derivacionesRoutes } from './routes/derivaciones';
import { solicitudesRoutes } from './routes/solicitudes';
import { actividadesRoutes } from './routes/actividades';
import { dashboardRoutes } from './routes/dashboard';
import { adminRoutes } from './routes/admin';
import { hceRoutes } from './routes/hce';
import { consentimientosRoutes } from './routes/consentimientos';
import { rutasRoutes } from './routes/rutas';
import { pushRoutes } from './push';

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppCtx;
  presence: PresenceService;
  sync: SheetsSync;
  close: () => Promise<void>;
}

export async function buildApp(cfg: Config, opts: { sheetsClient?: SheetsClient; logger?: boolean } = {}): Promise<BuiltApp> {
  const app = Fastify({ logger: opts.logger ?? cfg.NODE_ENV !== 'test', trustProxy: cfg.TRUST_PROXY === 'true', bodyLimit: 256 * 1024 });
  const db = createPool(cfg.DATABASE_URL);
  const bus = new EventBus(db, cfg.DATABASE_URL);
  const ctx: AppCtx = { cfg, db, cipher: FieldCipher.fromBase64(cfg.DATA_ENCRYPTION_KEY), bus };
  await bus.start();

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', global: true });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 4096 } });
  // Documentos firmados: el archivo llega como contenido binario; su tipo real se comprueba por firma.
  app.addContentTypeParser(['application/pdf', 'image/jpeg', 'image/png', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: cfg.DOCUMENTO_MAX_MB * 1024 * 1024 }, (_req, body, done) => done(null, body));

  // Las respuestas de datos nunca se guardan en cachés (navegador, proxies ni la app instalada).
  app.addHook('onSend', async (req, rep) => {
    if (req.url.startsWith('/api/')) rep.header('cache-control', 'no-store');
    else if (req.url === '/sw.js' || req.url.startsWith('/manifest.webmanifest')) rep.header('cache-control', 'no-cache');
  });

  app.setErrorHandler((err, req, rep) => {
    if (err instanceof HttpError) return rep.code(err.status).send({ error: err.message, code: err.code });
    const e = err as { statusCode?: number; message: string };
    if (e.statusCode && e.statusCode < 500) return rep.code(e.statusCode).send({ error: e.message });
    req.log.error(err);
    return rep.code(500).send({ error: 'Error interno. El incidente quedó registrado.' });
  });

  const presence = new PresenceService(ctx);
  const sync = new SheetsSync(ctx, opts.sheetsClient);
  const rt = registerRealtime(app, ctx, presence);

  app.get('/api/salud', async () => {
    await db.query('select 1');
    return { ok: true, ts: new Date().toISOString(), conexiones_tiempo_real: rt.conexiones() };
  });

  authRoutes(app, ctx, presence, rt.cerrarUsuario);
  officeRoutes(app, ctx, presence);
  agendaRoutes(app, ctx, presence);
  servidoresRoutes(app, ctx);
  derivacionesRoutes(app, ctx);
  solicitudesRoutes(app, ctx);
  actividadesRoutes(app, ctx, presence);
  dashboardRoutes(app, ctx, presence);
  adminRoutes(app, ctx, sync);
  hceRoutes(app, ctx);
  consentimientosRoutes(app, ctx);
  rutasRoutes(app, ctx);
  pushRoutes(app, ctx);

  // Frontend compilado (producción).
  const here = dirname(fileURLToPath(import.meta.url));
  const web = [join(here, '../web'), join(here, '../dist/web'), join(process.cwd(), 'dist/web')].find((p) => existsSync(join(p, 'index.html')));
  if (web) {
    await app.register(fastifyStatic, { root: web, wildcard: false });
    app.setNotFoundHandler((req, rep) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) return rep.code(404).send({ error: 'No encontrado' });
      return rep.sendFile('index.html');
    });
  }

  const sweeper = setInterval(() => presence.barrer().catch((e) => app.log.error(e)), 15_000);
  return {
    app,
    ctx,
    presence,
    sync,
    close: async () => {
      clearInterval(sweeper);
      sync.detener();
      await app.close();
      await bus.stop();
      await db.end();
    },
  };
}
