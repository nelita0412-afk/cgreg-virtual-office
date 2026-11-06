/**
 * Prueba VISUAL de movimientos de avatares (base de datos de PRUEBAS, nunca producción).
 * No basta con que el evento se guarde: se verifica en el navegador del observador (Coordinación) que el
 * avatar se desplazó por la oficina, llegó al destino correcto y adoptó la postura de la actividad.
 * Capturas en e2e/out/movimiento-*.png.  Uso: npm run build && node e2e/movimiento.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import bcrypt from 'bcryptjs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright');
const WebSocket = req('ws');

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://cgreg:cgreg_dev@localhost:5432/cgreg_test';
const PORT = 4200;
const BASE = `http://localhost:${PORT}`;
const PASS = 'ClaveDePrueba2026';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c = new pg.Client({ connectionString: DB });
await c.connect();
await c.query('drop schema if exists core, ops, clinical, audit, social cascade; drop table if exists public._migraciones;');
const srv = spawn('node', ['dist/server/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', COOKIE_SECURE: 'false', PORT: String(PORT), DATABASE_URL: DB, DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'), SHEETS_SYNC_ENABLED: 'false', SESSION_IDLE_MINUTES: '240' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${BASE}/api/salud`)).ok) break;
  } catch {}
  await sleep(500);
}
const hash = await bcrypt.hash(PASS, 10);
for (const [email, nombre, rol, pid] of [
  ['coord@mov.local', 'Coordinación (prueba)', 'coordinacion', null],
  ['admin@mov.local', 'Admin (prueba)', 'admin', null],
  ['gabriel@mov.local', null, 'profesional', 'gabriel-ordonez'],
  ['demetrio@mov.local', null, 'profesional', 'demetrio-magallanes'],
  ['betsabe@mov.local', null, 'profesional', 'betsabe-cordova'],
]) {
  await c.query(`insert into core.usuarios (email,nombre,rol,profesional_id,password_hash,debe_cambiar_password) values ($1, coalesce($2,(select nombre from core.profesionales where id=$4)), $3,$4,$5,false)`, [email, nombre, rol, pid, hash]);
}
const srvA = (await c.query(`insert into ops.servidores (clave_fuente,nombre,codigo_institucional) values ('MOV:1','Servidor Prueba Uno','MOV-1') returning id`)).rows[0].id;
const srvB = (await c.query(`insert into ops.servidores (clave_fuente,nombre,codigo_institucional) values ('MOV:2','Servidor Prueba Dos','MOV-2') returning id`)).rows[0].id;

const br = await chromium.launch();
async function sesion(email, url = '/?calidad=baja') {
  const ctx = await br.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${email}]`, e.message));
  await page.goto(BASE + url);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASS);
  await page.click('button:has-text("Ingresar")');
  await page.waitForSelector('canvas', { timeout: 30000 });
  const api = async (method, u, body) => {
    const r = await page.evaluate(async ([m, u, b]) => {
      const res = await fetch(u, { method: m, headers: { 'content-type': 'application/json', 'x-cgreg': '1' }, body: m === 'GET' ? undefined : JSON.stringify(b ?? {}) });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, [method, u, body]);
    if (r.status >= 400) throw new Error(`${method} ${u} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return { page, api, ctx };
}
/** Profesional conectado de verdad (sesión + WebSocket con heartbeat), sin abrir un navegador. */
async function sesionApi(email) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS }) });
  if (!r.ok) throw new Error(`login ${email} ${r.status}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`, { headers: { cookie, origin: BASE } });
  const hb = setInterval(() => ws.readyState === 1 && ws.send('{"t":"hb"}'), 10000);
  const api = async (method, u, body) => {
    const res = await fetch(BASE + u, { method, headers: { cookie, 'x-cgreg': '1', 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const d = await res.json().catch(() => null);
    if (res.status >= 400) throw new Error(`${method} ${u} → ${res.status} ${JSON.stringify(d)}`);
    return d;
  };
  return { api, cerrar: () => (clearInterval(hb), ws.close()) };
}
const fallos = [];
const check = (ok, msg) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) fallos.push(msg);
};

try {
  const coord = await sesion('coord@mov.local');
  const admin = await sesionApi('admin@mov.local');
  for (const p of await admin.api('GET', '/api/consentimientos/plantillas')) await admin.api('POST', `/api/consentimientos/plantillas/${p.id}/aprobar`, { referencia: 'Prueba visual' });
  admin.cerrar();
  await coord.api('POST', `/api/servidores/${srvA}/asignaciones`, { profesional_id: 'gabriel-ordonez' });
  await coord.api('POST', `/api/servidores/${srvB}/asignaciones`, { profesional_id: 'demetrio-magallanes' });

  const av = (clave) => coord.page.evaluate((k) => window.__cgregOffice?.avatares?.()[k] ?? null, clave);
  const esperar = async (clave, cond, ms = 150000) => {
    const t0 = Date.now();
    let ult = null;
    while (Date.now() - t0 < ms) {
      ult = await av(clave);
      if (ult && cond(ult)) return ult;
      await sleep(700);
    }
    return ult;
  };
  const cerca = (a, x, z, tol = 0.6) => a && Math.hypot(a.x - x, a.z - z) < tol;
  // Selecciona al profesional como lo haría el usuario (etiqueta o lista accesible): la cámara se centra en él.
  // Desde la vista general (donde todas las etiquetas están en pantalla) se pulsa la etiqueta de la persona.
  const enfocar = async (texto, espera = 6000) => {
    await coord.page.click('button[aria-label="Cerrar panel"]', { timeout: 1500 }).catch(() => {});
    await coord.page.click('button[aria-label="Vista general"]');
    await sleep(2500);
    await coord.page.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? x.textContent ?? '').includes(t));
      b?.click();
    }, texto);
    await sleep(espera);
  };
  const consentir = async (pro, servidor, servicio, nombre, codigo) => {
    const s = await pro.api('POST', `/api/servidores/${servidor}/consentimientos/solicitar`, { modalidad: 'electronica', servicio });
    const r = await fetch(`${BASE}/api/publico/consentimiento/${s.enlace.split('/').pop()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre_completo: nombre, identificador: codigo, lectura_confirmada: true, acepta: true }) });
    if (!r.ok) throw new Error('consentimiento ' + r.status);
    await pro.api('POST', `/api/consentimientos/${s.id}/validar`, { resultado: 'validado' });
  };

  // ---------- 1. Gabriel: entra, va a su estación, consulta y regresa ----------
  const gabriel = await sesionApi('gabriel@mov.local');
  let a = await esperar('gabriel-ordonez', (x) => cerca(x, -26, 12.55) && x.sentado > 0.9);
  check(a && cerca(a, -26, 12.55), 'Gabriel ingresa por la entrada, camina y se sienta en su estación');
  await enfocar('Gabriel');
  await coord.page.screenshot({ path: `${OUT}movimiento-1-gabriel-estacion.png` });

  await consentir(gabriel, srvA, 'psicologia', 'Servidor Prueba Uno', 'MOV-1');
  const at = (await coord.api('POST', '/api/atenciones/pendiente', { servidor_id: srvA, profesional_id: 'gabriel-ordonez' })).id;
  await gabriel.api('POST', `/api/atenciones/${at}/iniciar`);
  const levanta = await esperar('gabriel-ordonez', (x) => x.caminando, 30000);
  check(levanta?.caminando, 'Al iniciar la atención, Gabriel se levanta y camina');
  // En la vista general se ve a Gabriel a mitad del trayecto (pasillos y puertas, no en línea recta).
  await coord.page.click('button[aria-label="Cerrar panel"]', { timeout: 1500 }).catch(() => {});
  await coord.page.click('button[aria-label="Vista general"]');
  await sleep(1200);
  await coord.page.screenshot({ path: `${OUT}movimiento-2-gabriel-caminando.png` });
  a = await esperar('gabriel-ordonez', (x) => cerca(x, -28.4, -2.95) && x.sentado > 0.9);
  check(a && cerca(a, -28.4, -2.95) && a.pose === 'sentado_conversar', `Gabriel llega a su consultorio y adopta la postura de consulta (${a?.pose})`);
  await enfocar('Gabriel');
  await coord.page.screenshot({ path: `${OUT}movimiento-3-gabriel-consultorio.png` });

  await gabriel.api('POST', `/api/atenciones/${at}/finalizar`);
  a = await esperar('gabriel-ordonez', (x) => cerca(x, -26, 12.55) && x.sentado > 0.9);
  check(a && cerca(a, -26, 12.55) && a.pose === 'sentado_teclear', `Al finalizar, Gabriel regresa a su escritorio a documentar (${a?.pose})`);
  await enfocar('Gabriel');
  await coord.page.screenshot({ path: `${OUT}movimiento-4-gabriel-regreso.png` });

  // ---------- 2. Demetrio: Telemedicina ----------
  const demetrio = await sesionApi('demetrio@mov.local');
  a = await esperar('demetrio-magallanes', (x) => cerca(x, 17.5, 1.6) && x.sentado > 0.9);
  check(a && cerca(a, 17.5, 1.6), 'Demetrio llega a su escritorio en Telemedicina');
  await consentir(demetrio, srvB, 'telemedicina', 'Servidor Prueba Dos', 'MOV-2');
  const at2 = (await coord.api('POST', '/api/atenciones/pendiente', { servidor_id: srvB, profesional_id: 'demetrio-magallanes' })).id;
  await demetrio.api('POST', `/api/atenciones/${at2}/iniciar`);
  a = await esperar('demetrio-magallanes', (x) => cerca(x, 27.2, -1.4) && x.sentado > 0.9);
  check(a && cerca(a, 27.2, -1.4) && a.pose === 'sentado_conversar', 'Demetrio se traslada a la estación de teleconsulta al confirmarse el inicio');
  await enfocar('Demetrio');
  await coord.page.screenshot({ path: `${OUT}movimiento-5-demetrio-telemedicina.png` });

  // ---------- 3. Betsabé: Debriefing ----------
  const betsabe = await sesionApi('betsabe@mov.local');
  await esperar('betsabe-cordova', (x) => x.sentado > 0.9);
  const deb = await coord.api('POST', '/api/debriefings', { titulo: 'Prueba visual', facilitador_id: 'betsabe-cordova', grupo_destinatario: 'Equipo de prueba', inicio: new Date(Date.now() + 60000).toISOString(), fin: new Date(Date.now() + 3600000).toISOString(), participantes_previstos: 5 });
  await betsabe.api('POST', `/api/debriefings/${deb.id}/iniciar`);
  a = await esperar('betsabe-cordova', (x) => x.x < -13 && x.x > -25 && x.z < -9 && x.sentado > 0.9);
  check(a && a.x < -13 && a.z < -9 && a.pose === 'sentado_conversar', 'Betsabé se desplaza a la Sala de Debriefing y se sienta a la mesa');
  await enfocar('Betsabé');
  await coord.page.screenshot({ path: `${OUT}movimiento-6-betsabe-debriefing.png` });

  // ---------- 4. Sin eventos, nadie camina ----------
  await sleep(4000);
  const todos = await coord.page.evaluate(() => window.__cgregOffice.avatares());
  check(Object.values(todos).every((x) => !x.caminando), 'Sin eventos nuevos, ningún avatar camina sin sentido');

  // ---------- 5. Etiquetas legibles y sin superposición ----------
  await coord.page.click('button[aria-label="Cerrar panel"]').catch(() => {});
  await coord.page.click('button[aria-label="Vista general"]');
  await sleep(7000); // el renderizado por software (sin GPU) avanza la cámara a pocos FPS
  const rects = await coord.page.evaluate(() =>
    [...document.querySelectorAll('button[aria-label*=": "]')].filter((b) => b.closest('.absolute.inset-0')).map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
  );
  let solap = 0;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const p = rects[i];
      const q = rects[j];
      if (p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y) solap++;
    }
  check(rects.length > 0 && solap === 0, `Etiquetas visibles sin superposición (${rects.length} etiquetas, ${solap} solapes)`);
  await coord.page.screenshot({ path: `${OUT}movimiento-7-vista-general.png` });
} catch (e) {
  console.error(e);
  fallos.push(String(e));
} finally {
  await br.close();
  srv.kill();
  await c.end();
}
console.log(fallos.length ? `\n${fallos.length} verificación(es) visual(es) fallida(s)` : '\nPRUEBA VISUAL DE MOVIMIENTO OK');
process.exit(fallos.length ? 1 : 0);
