import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { loadConfig } from '../server/config';
import { buildApp, type BuiltApp } from '../server/app';
import { createPool, migrate } from '../server/db';
import { hashPassword } from '../server/auth';
import type { SheetsClient } from '../server/sheets/client';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://cgreg:cgreg_dev@localhost:5432/cgreg_test';
export const PASSWORD = 'ClaveDePrueba2026';

export async function resetDb() {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  // El trigger de auditoría impide borrar filas, pero un DROP SCHEMA en la BD de pruebas es válido.
  await c.query(`drop schema if exists core, ops, clinical, audit, social cascade; drop table if exists public._migraciones;`);
  await c.end();
  const pool = createPool(TEST_DB);
  await migrate(pool, () => {});
  await pool.end();
}

/**
 * Las pruebas originales (previas a la ampliación) registran el consentimiento con la constancia profesional
 * heredada; por eso esta instancia la habilita. Las pruebas de la ampliación usan la configuración por defecto
 * (constancia NO aceptada) pasando `env`.
 */
export async function testApp(sheetsClient?: SheetsClient, env: Record<string, string> = { CONSENTIMIENTO_CONSTANCIA_PROFESIONAL: 'true' }): Promise<BuiltApp> {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SHEETS_SYNC_ENABLED: 'false',
    ...env,
  } as NodeJS.ProcessEnv);
  return buildApp(cfg, { logger: false, sheetsClient });
}

/**
 * Médico de telemedicina FICTICIO solo para pruebas. Desde la reorganización de la Brigada (migración 007) el
 * directorio no tiene telemedicina clínica (Demetrio es Apoyo Epidemiológico sin acceso clínico), pero el flujo de
 * telemedicina y el área «medicina» de la historia siguen existiendo y se prueban con este registro de prueba.
 * Horario: lunes a viernes 19:00–21:00 (hora de Ecuador continental).
 */
export async function crearMedicoPrueba(b: BuiltApp, id = 'medico-prueba') {
  await b.ctx.db.query(
    `insert into core.profesionales (id, nombre, nombre_corto, titulo, especialidad, perfil, modalidad, estacion, color, es_teleatencion, orden, en_directorio)
     values ($1, 'Médico de Prueba (ficticio)', 'Médico', 'Médico (prueba)', 'telemedicina', 'Registro ficticio de pruebas', 'Telemedicina (prueba)', $1, '#78958A', true, 90, false)
     on conflict (id) do nothing`,
    [id],
  );
  await b.ctx.db.query(
    `insert into core.disponibilidad (profesional_id, dia_semana, hora_inicio, hora_fin, tz)
     select $1, d, '19:00', '21:00', 'America/Guayaquil' from generate_series(1, 5) d
      where not exists (select 1 from core.disponibilidad where profesional_id = $1)`,
    [id],
  );
  return id;
}

export async function crearUsuario(b: BuiltApp, email: string, rol: string, profesional_id: string | null = null) {
  const r = await b.ctx.db.query(
    `insert into core.usuarios (email, nombre, rol, profesional_id, password_hash, debe_cambiar_password)
     values ($1, coalesce((select nombre from core.profesionales where id = $3), $1), $2, $3, $4, false) returning id`,
    [email, rol, profesional_id, await hashPassword(PASSWORD)],
  );
  return r.rows[0].id as string;
}

export async function loginCookie(b: BuiltApp, email: string): Promise<string> {
  const res = await b.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`login ${email}: ${res.statusCode} ${res.body}`);
  const ck = res.cookies.find((c) => c.name === 'cgreg_sid')!;
  return `cgreg_sid=${ck.value}`;
}

export function client(b: BuiltApp, cookie: string) {
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const res = await b.app.inject({ method, url, payload: payload as any, headers: { cookie, 'x-cgreg': '1' } });
    return { status: res.statusCode, body: res.body ? (res.headers['content-type']?.toString().includes('json') ? res.json() : res.body) : null };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, p?: unknown) => call('POST', u, p ?? {}),
    put: (u: string, p?: unknown) => call('PUT', u, p ?? {}),
    patch: (u: string, p?: unknown) => call('PATCH', u, p ?? {}),
    del: (u: string) => call('DELETE', u),
  };
}

/** Próximo día hábil (lun–vie) a las HH:mm en hora de Galápagos, siempre en el futuro. */
export function proximoHabilGalapagos(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  let d = DateTime.now().setZone('Pacific/Galapagos').plus({ days: 1 }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d.toUTC().toISO()!;
}

export async function insertarServidor(b: BuiltApp, nombre: string, clave: string) {
  const r = await b.ctx.db.query(`insert into ops.servidores (clave_fuente, nombre) values ($1,$2) returning id`, [clave, nombre]);
  return r.rows[0].id as string;
}
