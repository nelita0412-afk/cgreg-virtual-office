import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { BuiltApp } from '../server/app';
import { createPool, migrate } from '../server/db';
import { PASSWORD, TEST_DB, client, loginCookie, testApp } from './helpers';
import { hashPassword } from '../server/auth';

/**
 * Consolidación de identidad (migración 008): Sally Tinizaray Soriano y «Zally Pamela» son la misma persona.
 * Se reproduce una base en el estado real previo (migraciones hasta la 007, con las dos cuentas y registros en
 * ambos identificadores) y se aplica la 008. Datos ficticios.
 */
let b: BuiltApp;
const id: Record<string, string> = {};

beforeAll(async () => {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query(`drop schema if exists core, ops, clinical, audit, social cascade; drop table if exists public._migraciones;`);
  const pool = createPool(TEST_DB);
  await migrate(pool, () => {}, { hasta: '007_brigada_roles.sql' });
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const hash = await hashPassword(PASSWORD);
  const cuenta = async (email: string, pid: string) =>
    (await q(`insert into core.usuarios (email, nombre, rol, profesional_id, password_hash, debe_cambiar_password) values ($1, $1, 'profesional', $2, $3, false) returning id`, [email, pid, hash])).rows[0].id;
  id.zally = await cuenta('zally@sally.ec', 'zally-pamela');
  id.sally = await cuenta('sally@sally.ec', 'sally-tinizaray');
  id.coord = (await q(`insert into core.usuarios (email, nombre, rol, password_hash, debe_cambiar_password) values ('coord@sally.ec','Coordinación','coordinacion',$1,false) returning id`, [hash])).rows[0].id;
  // Sesión abierta en la cuenta con el nombre erróneo (debe revocarse).
  await q(`insert into core.sesiones (id, usuario_id, expira_absoluta) values ('sesion-zally', $1, now() + interval '1 day')`, [id.zally]);
  const srv = async (n: string) => (await q(`insert into ops.servidores (clave_fuente, nombre) values ($1, $2) returning id`, [`PRUEBA:SZ-${n}`, `Servidor ficticio ${n}`])).rows[0].id;
  id.s1 = await srv('1');
  id.s2 = await srv('2');
  // Trayectoria en el registro histórico (zally-pamela) y registros nuevos en el duplicado (sally-tinizaray).
  await q(`insert into ops.asignaciones (servidor_id, profesional_id, asignada_por) values ($1,'zally-pamela',$3), ($1,'sally-tinizaray',$3), ($2,'sally-tinizaray',$3)`, [id.s1, id.s2, id.coord]);
  id.atHist = (await q(`insert into ops.atenciones (servidor_id, profesional_id, tipo, estado, inicio, fin, duracion_min, creado_por) values ($1,'zally-pamela','psicologia','atendida', now() - interval '3 days', now() - interval '3 days' + interval '45 minutes', 45, $2) returning id`, [id.s1, id.coord])).rows[0].id;
  id.atCerrada = (await q(`insert into ops.atenciones (servidor_id, profesional_id, tipo, estado, inicio, fin, duracion_min, creado_por) values ($1,'sally-tinizaray','psicologia','atendida', now() - interval '1 day', now() - interval '1 day' + interval '45 minutes', 45, $2) returning id`, [id.s2, id.coord])).rows[0].id;
  id.atFutura = (await q(`insert into ops.atenciones (servidor_id, profesional_id, tipo, estado, inicio, fin, duracion_min, creado_por) values ($1,'sally-tinizaray','psicologia','programada', now() + interval '2 days', now() + interval '2 days' + interval '45 minutes', 45, $2) returning id`, [id.s2, id.coord])).rows[0].id;
  // Registro de solo inserción a nombre del duplicado: no puede reescribirse y debe quedar vinculado por el alias.
  id.social = (await q(`insert into social.intervenciones (servidor_id, profesional_id, autor_usuario_id, fecha, tipo, contenido_cifrado) values ($1,'sally-tinizaray',$2, now(), 'seguimiento', 'v1.ficticio') returning id`, [id.s2, id.sally])).rows[0].id;
  await q(`insert into audit.registro (usuario_id, rol, accion, entidad, entidad_id) values ($1,'profesional','prueba.historial_previo','usuario',$2)`, [id.zally, String(id.zally)]);
  // Se aplica la 008 (y las posteriores).
  await migrate(pool, () => {});
  await pool.end();
  await c.end();
  b = await testApp(undefined, {});
});
afterAll(async () => {
  await b.close();
});

const fila = async (sql: string, p: unknown[] = []) => (await b.ctx.db.query(sql, p)).rows;

describe('Consolidación Sally Tinizaray Soriano = «Zally Pamela»', () => {
  it('un solo perfil activo, con el nombre oficial, en el directorio', async () => {
    const pros = await fila(`select id, nombre, activo, en_directorio, consolidado_en from core.profesionales where id in ('zally-pamela','sally-tinizaray') order by id`);
    expect(pros).toEqual([
      { id: 'sally-tinizaray', nombre: 'Sally Tinizaray Soriano', activo: false, en_directorio: false, consolidado_en: 'zally-pamela' },
      { id: 'zally-pamela', nombre: 'Sally Tinizaray Soriano', activo: true, en_directorio: true, consolidado_en: null },
    ]);
    expect((await fila(`select count(*)::int n from core.profesionales where activo and (nombre ilike '%zally%' or nombre ilike '%sally%')`))[0].n).toBe(1);
  });

  it('las referencias se transfieren sin perder historia ni duplicar asignaciones', async () => {
    const at = await fila(`select id, profesional_id, estado from ops.atenciones order by inicio`);
    expect(at.map((a: any) => [a.id, a.profesional_id, a.estado])).toEqual([
      [id.atHist, 'zally-pamela', 'atendida'],
      [id.atCerrada, 'zally-pamela', 'atendida'], // atención cerrada: cambia el profesional, nunca el estado
      [id.atFutura, 'zally-pamela', 'programada'],
    ]);
    const asig = await fila(`select servidor_id, profesional_id, activa from ops.asignaciones order by servidor_id, activa desc`);
    expect(asig.filter((a: any) => a.activa).map((a: any) => [a.servidor_id, a.profesional_id]).sort()).toEqual([[id.s1, 'zally-pamela'], [id.s2, 'zally-pamela']].sort());
    expect(asig).toHaveLength(3); // la asignación duplicada se cerró, no se borró
  });

  it('los registros de solo inserción no se reescriben y quedan vinculados por el alias', async () => {
    const s = await fila(`select profesional_id, core.profesional_canonico(profesional_id) as canonico from social.intervenciones where id = $1`, [id.social]);
    expect(s[0]).toEqual({ profesional_id: 'sally-tinizaray', canonico: 'zally-pamela' });
    await expect(b.ctx.db.query(`update social.intervenciones set profesional_id = 'zally-pamela' where id = $1`, [id.social])).rejects.toThrow(/inmutable/);
  });

  it('una sola cuenta activa; la otra desactivada con sus sesiones revocadas y su historial intacto', async () => {
    const cuentas = await fila(`select id, activo, profesional_id from core.usuarios where id = any($1) order by email`, [[id.sally, id.zally]]);
    expect(cuentas).toEqual([
      { id: id.sally, activo: true, profesional_id: 'zally-pamela' },
      { id: id.zally, activo: false, profesional_id: null },
    ]);
    expect((await fila(`select revocada_at from core.sesiones where id = 'sesion-zally'`))[0].revocada_at).not.toBeNull();
    expect((await fila(`select count(*)::int n from audit.registro where accion = 'prueba.historial_previo' and usuario_id = $1`, [id.zally]))[0].n).toBe(1);
    const acciones = (await fila(`select accion from audit.registro where detalle->>'migracion' = '008'`)).map((r: any) => r.accion).sort();
    expect(acciones).toEqual(['profesional.consolidado', 'profesional.nombre_corregido', 'usuario.consolidado', 'usuario.vinculado'].sort());
  });

  it('Sally ingresa con su cuenta y ve sus casos; la cuenta duplicada ya no ingresa', async () => {
    const sally = client(b, await loginCookie(b, 'sally@sally.ec'));
    expect((await sally.get('/api/auth/me')).body).toMatchObject({ profesional_id: 'zally-pamela', nombre: 'Sally Tinizaray Soriano' });
    expect((await sally.get('/api/servidores')).body.map((x: any) => x.id).sort()).toEqual([id.s1, id.s2].sort());
    const r = await b.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'zally@sally.ec', password: PASSWORD } });
    expect(r.statusCode).toBe(401);
    const dir = await sally.get('/api/directorio');
    expect(dir.body.filter((p: any) => /sally|zally/i.test(p.nombre)).map((p: any) => p.nombre)).toEqual(['Sally Tinizaray Soriano']);
  });
});
