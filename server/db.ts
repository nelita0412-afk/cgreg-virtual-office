import pg from 'pg';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

// timestamptz → string ISO; date → string; bigint → number (identificadores de eventos)
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

export function createPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 15, idleTimeoutMillis: 30_000 });
}

export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const cand of [join(here, '../db/migrations'), join(here, '../../db/migrations'), join(process.cwd(), 'db/migrations')]) {
    if (existsSync(cand)) return cand;
  }
  throw new Error('No se encontró db/migrations');
}

export async function migrate(db: Db, log: (m: string) => void = console.log): Promise<string[]> {
  await db.query(`create table if not exists public._migraciones (nombre text primary key, aplicada_at timestamptz not null default now())`);
  const dir = migrationsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await db.query<{ nombre: string }>('select nombre from public._migraciones')).rows.map((r) => r.nombre));
  const done: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    await tx(db, async (c) => {
      await c.query(sql);
      await c.query('insert into public._migraciones (nombre) values ($1)', [f]);
    });
    log(`Migración aplicada: ${f}`);
    done.push(f);
  }
  return done;
}
