import { loadConfig } from '../config';
import { createPool, migrate } from '../db';

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
const done = await migrate(db);
console.log(done.length ? `Listo: ${done.length} migración(es) aplicada(s).` : 'La base de datos ya estaba actualizada.');
await db.end();
