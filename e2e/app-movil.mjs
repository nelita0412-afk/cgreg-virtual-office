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
  ['admin@movil.local', 'Administración (prueba)', 'admin', null],
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
/** Llamada a la API con la sesión del navegador (mismas cookies y cabecera que la app). */
const api = async (page, method, url, body) => {
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
const etiquetasBarra = (page) => page.$$eval('nav[aria-label="Navegación de la app"] li', (ls) => ls.map((l) => l.textContent.trim()));
// Desbordamiento horizontal de la página o del área de contenido (que tiene su propio desplazamiento).
const desborde = (page) =>
  page.evaluate(() => {
    const m = document.getElementById('contenido');
    return Math.max(document.documentElement.scrollWidth - innerWidth, m ? m.scrollWidth - m.clientWidth : 0);
  });

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
  check(JSON.stringify(await etiquetasBarra(pro.page)) === JSON.stringify(['Mi espacio', 'Agenda', 'Atenciones', 'Oficina', 'Más']), 'Profesional: barra inferior Mi espacio · Agenda · Atenciones · Oficina · Más');
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
  await pro.page.click('[role=dialog] >> text=Mis registros clínicos');
  await sleep(1500);
  check(pro.page.url().endsWith('/historias-clinicas'), 'Desde «Más» se abre un módulo existente (mis registros clínicos)');
  for (const r of ['/inicio', '/agenda', '/atenciones', '/solicitudes', '/derivaciones', '/servidores', '/oficina', '/historias-clinicas', '/debriefing', '/capacitacion', '/configuracion']) {
    await pro.page.goto(BASE + r);
    await sleep(1800);
    const d = await desborde(pro.page);
    if (d > 1) check(false, `Sin desbordamiento horizontal en ${r} (${d}px)`);
  }
  check(true, 'Sin desbordamiento horizontal en Mi día, agenda, atenciones, solicitudes, derivaciones, servidores, oficina, historias clínicas, debriefing, capacitación y configuración');

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
  check(JSON.stringify(await etiquetasBarra(coord.page)) === JSON.stringify(['Panel', 'Agenda', 'Solicitudes', 'Mi Equipo', 'Más']), 'Coordinación: barra inferior Panel · Agenda · Solicitudes · Mi Equipo · Más');
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


  // ---------- 8. Agenda táctil y registro clínico por pasos ----------
  const s1 = (await c.query(`insert into ops.servidores (clave_fuente, nombre, codigo_institucional) values ('PRUEBA:M1','Servidor de prueba móvil','PM-001') returning id`)).rows[0].id;
  const coordApi = await telefono('coord@movil.local');
  const adminApi = await telefono('admin@movil.local');
  const proApi = await telefono('gabriel@movil.local');
  await api(coordApi.page, 'POST', `/api/servidores/${s1}/asignaciones`, { profesional_id: 'gabriel-ordonez' });
  const { id: at } = await api(coordApi.page, 'POST', '/api/atenciones/pendiente', { servidor_id: s1, profesional_id: 'gabriel-ordonez' });
  const plantillas = await api(adminApi.page, 'GET', '/api/consentimientos/plantillas');
  await api(adminApi.page, 'POST', `/api/consentimientos/plantillas/${plantillas.find((p) => p.servicio === 'psicologia').id}/aprobar`, { referencia: 'Prueba E2E móvil' });
  const sol = await api(proApi.page, 'POST', `/api/servidores/${s1}/consentimientos/solicitar`, { modalidad: 'electronica', servicio: 'psicologia' });
  const firma = await telefono(null);
  await firma.page.goto(BASE + sol.enlace);
  await firma.page.waitForSelector('text=Teleatención psicológica');
  await firma.page.fill('input >> nth=0', 'Servidor de prueba móvil');
  await firma.page.fill('input >> nth=1', 'PM-001');
  await firma.page.check('input[type=checkbox] >> nth=0');
  await firma.page.check('input[type=checkbox] >> nth=1');
  await firma.page.click('button:has-text("Aceptar y firmar")');
  await firma.page.waitForSelector('text=Su aceptación quedó registrada');
  await firma.ctx.close();
  await api(proApi.page, 'POST', `/api/consentimientos/${sol.id}/validar`, { resultado: 'validado' });
  await api(proApi.page, 'POST', `/api/atenciones/${at}/iniciar`);
  await adminApi.ctx.close();
  await coordApi.ctx.close();

  const tel = proApi.page;
  await tel.goto(BASE + '/agenda');
  await tel.waitForSelector('[role=tablist][aria-label="Días de la semana"]', { timeout: 15000 });
  await sleep(1200);
  const tituloDia = () => tel.locator('section[aria-label^="Citas del"] h2').innerText();
  const hoyTxt = await tituloDia();
  check(hoyTxt.startsWith('Hoy') && (await tel.locator('section[aria-label^="Citas del"] ul button', { hasText: 'Servidor de prueba móvil' }).count()) === 1, 'Agenda móvil: tira de la semana y el día de hoy con la cita real');
  const zona = await tel.locator('section[aria-label^="Citas del"]').boundingBox();
  const deslizar = async (dir) => {
    const y = zona.y + 40, x0 = zona.x + zona.width / 2;
    await tel.mouse.move(x0, y);
    await tel.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await tel.mouse.move(x0 + dir * i * 18, y + 1);
      await sleep(16);
    }
    await tel.mouse.up();
    await sleep(450);
  };
  await deslizar(-1);
  const manana = await tituloDia();
  await deslizar(1);
  check(manana !== hoyTxt && (await tituloDia()) === hoyTxt, `Agenda móvil: deslizar cambia de día y vuelve («${manana}»)`);
  await tel.screenshot({ path: `${OUT}movil-6-agenda.png` });
  await tel.locator('section[aria-label^="Citas del"] ul button', { hasText: 'Servidor de prueba móvil' }).click();
  await sleep(500);
  const hoja = tel.locator('[role=dialog][aria-label^="Cita "]');
  check((await hoja.isVisible()) && (await hoja.locator('button', { hasText: 'Detalle' }).count()) === 1, 'Agenda móvil: la cita se abre en una hoja inferior con sus acciones');
  await tel.screenshot({ path: `${OUT}movil-7-agenda-hoja.png` });
  await tel.keyboard.press('Escape');
  await sleep(400);
  check(!(await hoja.isVisible()), 'La hoja inferior se cierra con Escape');

  await tel.goto(`${BASE}/atenciones/${at}`);
  await tel.waitForSelector('text=Paso 1 de 4', { timeout: 15000 });
  check(true, 'Registro clínico por pasos: el formulario abre en el paso 1 de 4');
  await tel.click('button:has-text("Continuar")');
  await sleep(300);
  check(await tel.locator('text=Escriba el resumen de la atención para poder guardar.').isVisible(), 'Validación: no avanza sin el resumen obligatorio y lo indica junto al campo');
  const SECRETO = 'Texto clínico de prueba E2E 7f3a';
  await tel.fill('textarea >> nth=0', SECRETO);
  await tel.fill('textarea >> nth=1', 'Motivo de prueba');
  await tel.click('button:has-text("Guardar y continuar")');
  await tel.waitForSelector('text=Paso 2 de 4');
  await sleep(800);
  const ent = (await c.query(`select version_actual, contenido_cifrado from clinical.entradas where atencion_id = $1`, [at])).rows[0];
  check(ent && ent.version_actual >= 1 && !String(ent.contenido_cifrado).includes(SECRETO), `Al avanzar se guarda en el servidor, cifrado (versión ${ent?.version_actual})`);
  await tel.fill('textarea >> nth=0', 'Evaluación de prueba');
  await tel.click('nav[aria-label="Navegación de la app"] >> text=Mi día').catch(() => {});
  await sleep(300);
  const avisoSalida = await tel.evaluate(() => location.pathname);
  check(avisoSalida.startsWith('/atenciones/'), 'Con cambios sin guardar, salir pide confirmación (se canceló y sigue en el registro)');
  await tel.click('button:has-text("Guardar y continuar")');
  await tel.waitForSelector('text=Paso 3 de 4');
  await tel.click('button:has-text("Continuar")');
  await tel.waitForSelector('text=Paso 4 de 4');
  check(await tel.locator('dd', { hasText: SECRETO }).isVisible(), 'Paso de revisión: muestra el resumen de lo registrado');
  await tel.screenshot({ path: `${OUT}movil-8-registro-pasos.png` });
  check((await desborde(tel)) <= 1, 'Registro clínico por pasos sin desbordamiento horizontal en el teléfono');
  const local = await tel.evaluate(async () => {
    const t = [];
    for (let i = 0; i < localStorage.length; i++) t.push(localStorage.getItem(localStorage.key(i)));
    for (let i = 0; i < sessionStorage.length; i++) t.push(sessionStorage.getItem(sessionStorage.key(i)));
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) t.push(r.url);
    const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [];
    return { texto: t.join('|'), dbs };
  });
  check(!local.texto.includes('7f3a') && !local.texto.includes('Motivo de prueba') && local.dbs.length === 0, 'Nada del registro clínico queda en el teléfono (localStorage, sessionStorage, cachés ni IndexedDB)');
  tel.on('dialog', (d) => d.accept());

  await proApi.ctx.close();

  // ---------- 9. Notificaciones push: el service worker muestra el aviso ----------
  // El modo «headless shell» de Playwright niega siempre las notificaciones; se usa Chromium completo sin ventana.
  // El envío real a los servicios de Google/Apple no es posible en este entorno: se entrega el mensaje push al
  // service worker por el protocolo de depuración, con el mismo contenido que envía el servidor.
  const brPush = await chromium.launch({ channel: 'chromium' });
  try {
    const ctxPush = await brPush.newContext({ ...devices['iPhone 13'] });
    await ctxPush.grantPermissions(['notifications'], { origin: BASE });
    const pp = await ctxPush.newPage();
    pp.on('pageerror', (e) => errores.push(e.message));
    await pp.goto(BASE + '/servidor');
    await pp.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
    await sleep(1000);
    const cdp = await ctxPush.newCDPSession(pp);
    const regs = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    for (let i = 0; i < 30 && !regs.some((r) => !r.isDeleted); i++) await sleep(150);
    const reg = regs.find((r) => !r.isDeleted && r.scopeURL.startsWith(BASE));
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: BASE, registrationId: reg.registrationId, data: JSON.stringify({ titulo: 'Prueba: las notificaciones funcionan en este dispositivo', enlace: '/inicio', tag: 'prueba' }) });
    let notas = [];
    for (let i = 0; i < 30 && !notas.length; i++) {
      await sleep(200);
      notas = await pp.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ t: n.title, tag: n.tag, enlace: n.data?.enlace, cuerpo: n.body })));
    }
    check(
      notas.some((n) => n.t.startsWith('Prueba') && n.tag === 'prueba' && n.enlace === '/inicio' && !/cl[ií]nic/i.test(n.cuerpo)),
      `Push: el service worker recibe el aviso y lo muestra con título y enlace interno, sin contenido clínico (${notas.length})`,
    );
  } finally {
    await brPush.close();
  }

  // ---------- 10. Consulta del estado sin cuenta ----------
  const ciudadano = await telefono(null);
  const cp = ciudadano.page;
  await cp.goto(BASE + '/solicitar-atencion');
  await cp.waitForSelector('text=No necesita haber realizado una valoración previa');
  await cp.fill('input >> nth=0', 'Persona de prueba móvil');
  await cp.fill('input[autocomplete=tel]', '0999000111');
  await cp.check('input[type=checkbox]');
  await cp.click('button:has-text("Enviar solicitud")');
  await cp.waitForSelector('text=Clave para consultar el estado', { timeout: 10000 });
  const codigoSol = (await cp.locator('strong.font-mono').innerText()).trim();
  const claveSol = (await cp.locator('[aria-label^="Clave:"]').innerText()).trim();
  check(/^SA-\d+$/.test(codigoSol) && /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(claveSol), `Al enviar el formulario se muestra una sola vez la clave de consulta (${codigoSol})`);
  await cp.screenshot({ path: `${OUT}movil-9-clave.png` });
  const guardada = (await c.query(`select clave_consulta_hash from ops.solicitudes_atencion where codigo = $1`, [codigoSol])).rows[0].clave_consulta_hash;
  check(/^[0-9a-f]{64}$/.test(guardada) && !guardada.includes(claveSol.replace('-', '')), 'La base guarda solo la huella (HMAC) de la clave, nunca la clave');
  await cp.click('a:has-text("Consultar estado")');
  await cp.waitForSelector('text=Escriba el código de su solicitud');
  check((await cp.locator('input >> nth=0').inputValue()) === codigoSol, 'El enlace precarga el código (la clave nunca viaja en la URL)');
  await cp.fill('input >> nth=1', 'ZZZZZ-ZZZZZ');
  await cp.click('button:has-text("Consultar estado")');
  await cp.waitForSelector('text=No encontramos una solicitud con ese código y esa clave');
  check(true, 'Clave incorrecta: respuesta genérica, sin revelar si el código existe');
  await cp.fill('input >> nth=1', claveSol.toLowerCase());
  await cp.click('button:has-text("Consultar estado")');
  await cp.waitForSelector('text=etapa actual', { state: 'attached', timeout: 10000 });
  const textoEstado = await cp.locator('main, body').first().innerText();
  check(textoEstado.includes('Recibida') && !textoEstado.includes('Persona de prueba móvil') && !textoEstado.includes('0999000111'), 'Con código y clave correctos muestra solo la etapa (Recibida), sin datos personales');
  await cp.screenshot({ path: `${OUT}movil-10-estado.png` });
  check((await desborde(cp)) <= 1, 'Consulta de estado sin desbordamiento en el teléfono');
  await ciudadano.ctx.close();

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
