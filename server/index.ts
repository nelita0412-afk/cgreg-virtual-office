import { loadConfig } from './config';
import { buildApp } from './app';
import { migrate, createPool } from './db';

const cfg = loadConfig();
const pool = createPool(cfg.DATABASE_URL);
await migrate(pool);
await pool.end();

const { app, sync, close } = await buildApp(cfg);
sync.iniciar();
await app.listen({ port: cfg.PORT, host: cfg.HOST });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info(`Recibido ${sig}, cerrando…`);
    await close();
    process.exit(0);
  });
}
