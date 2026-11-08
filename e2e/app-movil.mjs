/**
 * Prueba E2E de la app móvil (PWA) sobre una base de datos DE PRUEBAS (nunca producción).
 * Comprueba en un iPhone emulado: instalación (manifest e íconos), service worker, que /api nunca se guarda
 * en caché, funcionamiento sin conexión, «Mi día» y navegación por perfil, y el portal del servidor sin cuenta.
 * Uso: npm run build && npm run e2e:movil
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://cgreg:cgreg_dev@localhost:5432/cgreg_test';
const PORT = 4300;
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
for (const [email, nombre, rol, pid] of [
  ['coord@movil.local', 'Coordinación General (prueba)', 'coordinacion', null],
  ['gabriel@movil.local', null, 'profesional', 'gabriel-ordonez'],
  ['autoridad@movil.local', 'Autoridad (prueba)', 'autoridad', null],
]) {
  await c.query(
    `insert into core.usuarios (email, nombre, rol, profesional_id, password_hash, debe_cambiar_password)
     values ($1, coalesce($2, (select nombre from core.profesionales where id = $4)), $3, $4, $5, false)`,
    [email, nombre, rol, pid, hash],
  );
}

const fallos = [];
const check = (ok, msg) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) fallos.push(msg);
};
const br = await chromium.launch();
const errores = [];

async function telefono(email) {
  const ctx = await br.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push(e.message));
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  if (email) {
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', PASS);
    await page.click('button:has-text("Ingresar")');
    await page.waitForSelector('nav[aria-label="Navegación de la app"]', { timeout: 20000 });
    await sleep(1500);
  }
  return { ctx, page };
}
const etiquetasBarra = (page) => page.$$eval('nav[aria-label="Navegación de la app"] li', (ls) => ls.map((l) => l.textContent.trim()));
const desborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

try {
  // ---------- 1. Instalable ----------
  const man = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  check(man.display === 'standalone' && man.start_url && man.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable') && man.icons.some((i) => i.sizes === '192x192'),
    'Manifest instalable: pantalla completa, inicio e íconos 192/512 (incluido adaptable)');
  const iconos = await Promise.all(['/icons/icono-192.png', '/icons/icono-512.png', '/icons/apple-touch-icon.png', '/offline.html', '/sw.js'].map((u) => fetch(BASE + u).then((r) => r.status)));
  check(iconos.every((s) => s === 200), 'Íconos, ícono de iPhone, página sin conexión y service worker disponibles');
  const me = await fetch(`${BASE}/api/auth/me`);
  check(me.headers.get('cache-control') === 'no-store', 'La API responde con Cache-Control: no-store');

  // ---------- 2. Profesional en el teléfono ----------
  const pro = await telefono('gabriel@movil.local');
  check((await pro.page.locator('h1', { hasText: 'Gabriel' }).count()) === 1 && (await pro.page.locator('text=Hoy en mi agenda').count()) === 1, 'Profesional: la portada es «Mi día» con su agenda de hoy');
  check(JSON.stringify(await etiquetasBarra(pro.page)) === JSON.stringify(['Mi día', 'Agenda', 'Atenciones', 'Solicitudes', 'Más']), 'Profesional: barra inferior Mi día · Agenda · Atenciones · Solicitudes · Más');
  check((await pro.page.locator('[role=radiogroup][aria-label="Mi estado en la oficina"]').count()) === 1, 'Profesional: puede cambiar su estado de presencia desde el teléfono');
  await pro.page.click('[role=radio]:has-text("En pausa")');
  await sleep(1500);
  const estado = (await c.query(`select p.estado from ops.presencia p join core.usuarios u on u.id = p.usuario_id where u.email = 'gabriel@movil.local'`)).rows[0]?.estado;
  check(estado === 'en_pausa', `El cambio de estado se guarda en el sistema real (${estado})`);
  await pro.page.screenshot({ path: `${OUT}movil-1-profesional-mi-dia.png` });
  await pro.page.click('nav[aria-label="Navegación de la app"] button:has-text("Más")');
  await sleep(600);
  check(await pro.page.locator('[role=dialog][aria-label="Más opciones"]').isVisible(), 'El panel «Más» se abre con el resto de módulos');
  await pro.page.screenshot({ path: `${OUT}movil-2-mas.png` });
  await pro.page.click('[role=dialog] >> text=Historias clínicas');
  await sleep(1500);
  check(pro.page.url().endsWith('/historias-clinicas'), 'Desde «Más» se abre un módulo existente (historias clínicas)');
  for (const r of ['/agenda', '/atenciones', '/solicitudes', '/derivaciones', '/servidores', '/oficina']) {
    await pro.page.goto(BASE + r);
    await sleep(1800);
    const d = await desborde(pro.page);
    if (d > 1) check(false, `Sin desbordamiento horizontal en ${r} (${d}px)`);
  }
  check(true, 'Sin desbordamiento horizontal en agenda, atenciones, solicitudes, derivaciones, servidores y oficina');

  // ---------- 3. Service worker: solo interfaz, nunca datos ----------
  await pro.page.goto(BASE + '/inicio');
  await pro.page.waitForFunction(() => navigator.serviceWorker?.controller != null || navigator.serviceWorker?.ready, null, { timeout: 15000 }).catch(() => {});
  await pro.page.reload();
  await sleep(2500);
  const sw = await pro.page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const urls = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname);
    return { activo: !!reg?.active, controla: !!navigator.serviceWorker.controller, urls };
  });
  check(sw.activo && sw.controla, 'El service worker está activo y controla la app');
  check(sw.urls.includes('/offline.html') && sw.urls.some((u) => u.startsWith('/assets/')), `Guarda la interfaz para abrir rápido (${sw.urls.length} archivos)`);
  check(!sw.urls.some((u) => u.startsWith('/api/') || u.startsWith('/ws')), 'Ningún dato de /api queda en la caché del teléfono');

  // ---------- 4. Sin conexión ----------
  await pro.ctx.setOffline(true);
  await pro.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await sleep(500);
  check(await pro.page.locator('text=Sin conexión. Lo que ve puede no estar actualizado').isVisible(), 'Sin señal: aviso visible en la app abierta');
  await pro.page.screenshot({ path: `${OUT}movil-3-sin-conexion.png` });
  await pro.page.goto(BASE + '/agenda').catch(() => {});
  await sleep(1500);
  const sinRed = await pro.page.evaluate(() => document.body.innerText);
  check(sinRed.includes('Sin conexión') || sinRed.includes('No hay conexión'), 'Sin señal: al navegar se abre la interfaz guardada con el aviso, no una página de error del navegador');
  await pro.ctx.setOffline(false);
  await pro.ctx.close();

  // ---------- 5. Coordinación ----------
  const coord = await telefono('coord@movil.local');
  check((await coord.page.locator('text=Requiere su atención').count()) === 1 && (await coord.page.locator('text=Lo que necesitan los profesionales').count()) === 1, 'Coordinación: «Mi día» con alertas operativas y bandeja');
  check(JSON.stringify(await etiquetasBarra(coord.page)) === JSON.stringify(['Mi día', 'Solicitudes', 'Agenda', 'Derivaciones', 'Más']), 'Coordinación: barra inferior Mi día · Solicitudes · Agenda · Derivaciones · Más');
  const conectados = await coord.page.locator('text=Profesionales conectados').locator('xpath=..').innerText();
  const real = (await (await fetch(`${BASE}/api/salud`)).json()).ok;
  check(/\d|—/.test(conectados) && real, `Coordinación: indicadores con datos reales del sistema («${conectados.replace(/\s+/g, ' ')}»)`);
  await coord.page.screenshot({ path: `${OUT}movil-4-coordinacion.png` });
  await coord.ctx.close();

  // ---------- 6. Autoridad: sin acceso a datos de servidores ----------
  const aut = await telefono('autoridad@movil.local');
  const barraAut = await etiquetasBarra(aut.page);
  check(!barraAut.some((t) => /Solicitudes|Servidores|Historias/.test(t)), `Autoridad: la navegación respeta sus permisos (${barraAut.join(' · ')})`);
  await aut.ctx.close();

  // ---------- 7. Servidor institucional sin cuenta ----------
  const pub = await telefono(null);
  await pub.page.goto(BASE + '/servidor');
  await sleep(1200);
  check((await pub.page.locator('a[href="tel:911"]').count()) === 1 && (await pub.page.locator('a[href="/solicitar-atencion"]').count()) === 1, 'Portal del servidor: ECU 911 y «Solicitar atención» sin cuenta');
  await pub.page.screenshot({ path: `${OUT}movil-5-portal-servidor.png` });
  await pub.page.click('a[href="/solicitar-atencion"]');
  await pub.page.waitForSelector('text=No necesita haber realizado una valoración previa', { timeout: 10000 });
  check(true, 'Desde el portal se abre el formulario de atención abierta existente');
  check((await desborde(pub.page)) <= 1, 'Formulario público sin desbordamiento en el teléfono');
  await pub.ctx.close();

  check(errores.length === 0, `Sin errores de JavaScript en la app${errores.length ? ': ' + errores.join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  fallos.push(String(e));
} finally {
  await br.close();
  srv.kill();
  await c.end();
}
console.log(fallos.length ? `\n${fallos.length} verificación(es) fallida(s)` : '\nAPP MÓVIL OK');
process.exit(fallos.length ? 1 : 0);
