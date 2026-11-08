/**
 * Prueba E2E de humo sobre una base de datos DE PRUEBAS (nunca producción).
 * - Levanta el servidor compilado (dist) contra TEST_DATABASE_URL.
 * - Crea usuarios de prueba y ejecuta flujos reales vía API y navegador:
 *   conexión → avatar entra; consulta → avatar va al consultorio; debriefing → sala.
 * - Guarda capturas en e2e/out/.
 * Uso: npm run build && npm run e2e
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';
// Playwright puede estar instalado global o localmente (npm i -D playwright && npx playwright install chromium).
const { chromium } = createRequire(import.meta.url)('playwright');

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://cgreg:cgreg_dev@localhost:5432/cgreg_test';
const PORT = 4100;
const BASE = `http://localhost:${PORT}`;
const PASS = 'ClaveDePrueba2026';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c = new pg.Client({ connectionString: DB });
await c.connect();
await c.query('drop schema if exists core, ops, clinical, audit, social cascade; drop table if exists public._migraciones;');

const srv = spawn('node', ['dist/server/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', COOKIE_SECURE: 'false', PORT: String(PORT), DATABASE_URL: DB, DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'), SHEETS_SYNC_ENABLED: 'false' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${BASE}/api/salud`)).ok) break;
  } catch {}
  await sleep(500);
}

const hash = await bcrypt.hash(PASS, 10);
const usuarios = [
  ['coord@prueba.local', 'Coordinación General (prueba)', 'coordinacion', null],
  ['admin@prueba.local', 'Administración (prueba)', 'admin', null],
  ['gabriel@prueba.local', null, 'profesional', 'gabriel-ordonez'],
  ['maria@prueba.local', null, 'profesional', 'maria-alcivar'],
  ['sofia@prueba.local', null, 'profesional', 'sofia-guerra'],
  ['betsabe@prueba.local', null, 'profesional', 'betsabe-cordova'],
  ['demetrio@prueba.local', null, 'profesional', 'demetrio-magallanes'],
  ['diego@prueba.local', null, 'profesional', 'diego-estrella'],
];
for (const [email, nombre, rol, pid] of usuarios) {
  await c.query(
    `insert into core.usuarios (email, nombre, rol, profesional_id, password_hash, debe_cambiar_password)
     values ($1, coalesce($2, (select nombre from core.profesionales where id = $4)), $3, $4, $5, false)`,
    [email, nombre, rol, pid, hash],
  );
}
const s1 = (await c.query(`insert into ops.servidores (clave_fuente, nombre, codigo_institucional) values ('PRUEBA:1','Servidor de prueba uno','P-001') returning id`)).rows[0].id;

const browser = await chromium.launch();
async function sesion(email, viewport = { width: 1600, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  // Solo Coordinación renderiza la oficina 3D: los profesionales usan la vista de lista (misma conexión
  // WebSocket real) para que siete navegadores con renderizado por software no agoten la CPU.
  if (!email.startsWith('coord')) await ctx.addInitScript(() => localStorage.setItem('cgreg.vista', 'lista'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${email}] pageerror:`, e.message));
  await page.goto(BASE);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASS);
  await page.click('button:has-text("Ingresar")');
  await page.waitForSelector('[aria-label="Indicadores en tiempo real"]', { timeout: 20000 });
  const api = async (method, url, body) => {
    const r = await page.evaluate(
      async ([method, url, body]) => {
        const res = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-cgreg': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      [method, url, body],
    );
    if (r.status >= 400) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return { ctx, page, api };
}

const fallos = [];
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fallos.push(msg);
};

try {
  const coord = await sesion('coord@prueba.local');
  const pros = {};
  for (const k of ['gabriel', 'maria', 'sofia', 'betsabe', 'demetrio', 'diego']) pros[k] = await sesion(`${k}@prueba.local`, { width: 1280, height: 800 });
  await sleep(1500);
  let snap = await coord.api('GET', '/api/office/presencia');
  check(snap.filter((p) => p.conectado && p.es_teleatencion).length === 6, '6 profesionales conectados vía WebSocket');

  // Gabriel: consulta real (atención pendiente iniciada ahora, con consentimiento)
  await coord.api('POST', `/api/servidores/${s1}/asignaciones`, { profesional_id: 'gabriel-ordonez' });
  const { id: at } = await coord.api('POST', '/api/atenciones/pendiente', { servidor_id: s1, profesional_id: 'gabriel-ordonez' });
  // Consentimiento informado electrónico (formato aprobado + firma de la persona en la página pública)
  const admin = await sesion('admin@prueba.local');
  const plantillas = await admin.api('GET', '/api/consentimientos/plantillas');
  await admin.api('POST', `/api/consentimientos/plantillas/${plantillas.find((p) => p.servicio === 'psicologia').id}/aprobar`, { referencia: 'Prueba E2E' });
  const sol = await pros.gabriel.api('POST', `/api/servidores/${s1}/consentimientos/solicitar`, { modalidad: 'electronica', servicio: 'psicologia' });
  const persona = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await persona.goto(BASE + sol.enlace);
  await persona.waitForSelector('text=Teleatención psicológica');
  await persona.fill('input >> nth=0', 'Servidor de prueba uno');
  await persona.fill('input >> nth=1', 'P-001');
  await persona.check('input[type=checkbox] >> nth=0');
  await persona.check('input[type=checkbox] >> nth=1');
  await persona.click('button:has-text("Aceptar y firmar")');
  await persona.waitForSelector('text=Su aceptación quedó registrada');
  await persona.screenshot({ path: `${OUT}consentimiento-electronico.png` });
  await pros.gabriel.api('POST', `/api/consentimientos/${sol.id}/validar`, { resultado: 'validado' });
  check(true, 'Consentimiento electrónico firmado en la página pública y validado por el profesional');
  await pros.gabriel.api('POST', `/api/atenciones/${at}/iniciar`);
  // Sofía en pausa, Ma. de los Ángeles en documentación
  await pros.sofia.api('POST', '/api/office/estado', { estado: 'en_pausa' });
  await pros.maria.api('POST', '/api/office/estado', { estado: 'en_documentacion' });
  // Betsabé facilita un debriefing
  const ini = new Date(Date.now() + 60_000).toISOString();
  const fin = new Date(Date.now() + 3_600_000).toISOString();
  const { id: deb } = await coord.api('POST', '/api/debriefings', { titulo: 'Debriefing equipo territorial (prueba)', facilitador_id: 'betsabe-cordova', grupo_destinatario: 'Equipo DECE en territorio', inicio: ini, fin, participantes_previstos: 8 });
  await pros.betsabe.api('POST', `/api/debriefings/${deb}/iniciar`);
  // Gabriel solicita apoyo
  await pros.gabriel.api('POST', '/api/solicitudes', { tipo: 'gestion_recursos', descripcion: 'Se requiere conectividad para sesiones (prueba)', accion_requerida: 'Gestionar plan de datos', prioridad: 'alta' });
  await sleep(9000);

  snap = await coord.api('GET', '/api/office/presencia');
  const z = (id) => snap.find((p) => p.profesional_id === id);
  check(z('gabriel-ordonez').estado === 'en_consulta' && z('gabriel-ordonez').zona === 'consultorio_psicologia', 'Gabriel en consulta → consultorio de psicología');
  check(z('betsabe-cordova').zona === 'debriefing', 'Betsabé en la Sala de Debriefing');
  check(z('sofia-guerra').zona === 'descanso', 'Sofía en pausa');
  check(z('zally-pamela').conectado === false, 'Zally no conectada: no se simula presencia');
  const feed = await coord.page.locator('text=inició una consulta').count();
  check(feed > 0, 'El feed en tiempo real muestra el inicio de consulta');
  await coord.page.screenshot({ path: `${OUT}oficina-coordinacion.png` });

  // Zoom a consultorios
  await coord.page.click('button:has-text("Consultorios de Psicología")');
  await sleep(1800);
  await coord.page.screenshot({ path: `${OUT}oficina-consultorios.png` });

  // Desconexión: Sofía cierra la pestaña → sale de la oficina tras el período de gracia
  await pros.sofia.ctx.close();
  await sleep(14_000);
  snap = await coord.api('GET', '/api/office/presencia');
  check(snap.find((p) => p.profesional_id === 'sofia-guerra').conectado === false, 'Cerrar la sesión del navegador desconecta a Sofía');

  // Vista lista en móvil
  const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mp = await movil.newPage();
  await mp.goto(BASE);
  await mp.fill('input[type=email]', 'coord@prueba.local');
  await mp.fill('input[type=password]', PASS);
  await mp.click('button:has-text("Ingresar")');
  // En el teléfono la portada es «Mi día» con navegación inferior (la oficina 3D queda en /oficina).
  await mp.waitForSelector('nav[aria-label="Navegación de la app"]');
  await sleep(1500);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'Sin desplazamiento horizontal en móvil');
  await mp.screenshot({ path: `${OUT}movil-oficina.png`, fullPage: false });

  // Formulario «Solicitar apoyo a Coordinación» desde el panel del profesional (interfaz)
  const antes = (await coord.api('GET', '/api/notificaciones')).no_leidas;
  // El panel contextual inicia cerrado (más espacio para la oficina): se abre como lo haría la usuaria.
  await pros.maria.page.click('button[aria-label="Mostrar panel"]');
  await pros.maria.page.click('button:has-text("Solicitar apoyo a Coordinación")');
  await pros.maria.page.selectOption('select >> nth=0', 'solicitud_informacion');
  await pros.maria.page.fill('textarea >> nth=0', 'Necesito el directorio de unidades educativas (prueba)');
  await pros.maria.page.fill('textarea >> nth=1', 'Compartir el directorio actualizado');
  await pros.maria.page.click('button:has-text("Enviar solicitud")');
  await sleep(2500);
  const despues = (await coord.api('GET', '/api/notificaciones')).no_leidas;
  check(despues === antes + 1, 'Coordinación recibe la notificación de la solicitud enviada desde el formulario');
  const badge = await coord.page.locator('header button[aria-label^="Notificaciones"]').getAttribute('aria-label');
  check(badge?.includes(String(despues)), 'La campana de notificaciones se actualiza en tiempo real');

  // Atención abierta: formulario público sin cuenta → Coordinación lo recibe
  const pub = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await pub.goto(`${BASE}/solicitar-atencion`);
  await pub.waitForSelector('text=No necesita haber realizado una valoración previa');
  await pub.fill('input >> nth=0', 'Persona Solicitante Prueba');
  await pub.fill('input >> nth=3', '0990000000');
  await pub.check('input[type=checkbox]');
  await pub.screenshot({ path: `${OUT}formulario-atencion-abierta-lleno.png`, fullPage: true });
  await pub.click('button:has-text("Enviar solicitud")');
  await pub.waitForSelector('text=Solicitud registrada');
  await pub.screenshot({ path: `${OUT}formulario-atencion-abierta.png`, fullPage: true });
  const abiertas = await coord.api('GET', '/api/atencion-abierta');
  check(abiertas.some((s) => s.nombre_declarado === 'Persona Solicitante Prueba' && s.verificacion === 'pendiente_verificacion'), 'Solicitud de atención abierta recibida sin cuenta y pendiente de verificación (no rechazada)');

  // Historia clínica: Gabriel finaliza, documenta, valida; Coordinación solo ve lo administrativo
  await pros.gabriel.api('POST', `/api/atenciones/${at}/finalizar`);
  await pros.gabriel.api('PUT', `/api/atenciones/${at}/nota`, { resumen: 'Primera atención (prueba E2E)', plan: 'Seguimiento' });
  await pros.gabriel.api('POST', `/api/atenciones/${at}/nota/validar`);
  await pros.gabriel.page.goto(`${BASE}/servidores/${s1}/expediente`);
  await pros.gabriel.page.click('button:has-text("Evolución")');
  await pros.gabriel.page.waitForSelector('text=Primera atención (prueba E2E)');
  await pros.gabriel.page.screenshot({ path: `${OUT}historia-clinica.png` });
  check((await pros.gabriel.page.locator('text=Validada').count()) > 0, 'Historia clínica con entrada validada visible para el profesional');
  await coord.page.goto(`${BASE}/servidores/${s1}/expediente`);
  await coord.page.waitForSelector('text=Acceso administrativo');
  check((await coord.page.locator('text=Primera atención (prueba E2E)').count()) === 0, 'Coordinación no ve notas clínicas en la historia clínica');
  await coord.page.goto(`${BASE}/servidores/${s1}`);
  await sleep(1500);
  await coord.page.screenshot({ path: `${OUT}ficha-servidor.png`, fullPage: true });

  // Bandeja de coordinación
  await coord.page.goto(`${BASE}/solicitudes`);
  await sleep(1500);
  await coord.page.screenshot({ path: `${OUT}solicitudes-coordinacion.png` });
  await coord.page.goto(`${BASE}/comando`);
  await sleep(2000);
  await coord.page.screenshot({ path: `${OUT}centro-comando.png`, fullPage: true });
  await pros.gabriel.page.goto(`${BASE}/agenda`);
  await sleep(1500);
  await pros.gabriel.page.screenshot({ path: `${OUT}agenda-profesional.png` });
} catch (e) {
  console.error(e);
  fallos.push(String(e));
} finally {
  await browser.close();
  srv.kill();
  await c.end();
}
console.log(fallos.length ? `\n${fallos.length} verificación(es) fallida(s)` : '\nE2E OK');
process.exit(fallos.length ? 1 : 0);
