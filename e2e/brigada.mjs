/**
 * Prueba E2E de interfaz: cada perfil de la Brigada ve y gestiona solo lo que le corresponde.
 * Base de datos DE PRUEBAS (nunca producción), datos ficticios. Comprueba menús, acceso directo por URL (la
 * interfaz y la API deben negarlo), Directorio limitado, Oficina Virtual y administración de funciones.
 * Uso: npm run build && node e2e/brigada.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://cgreg:cgreg_dev@localhost:5432/cgreg_test';
const PORT = 4301;
const BASE = `http://localhost:${PORT}`;
const PASS = 'ClaveDePrueba2026';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c = new pg.Client({ connectionString: DB });
await c.connect();
await c.query('drop schema if exists core, ops, clinical, audit, social cascade; drop table if exists public._migraciones;');
const srv = spawn('node', ['dist/server/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', COOKIE_SECURE: 'false', PORT: String(PORT), DATABASE_URL: DB, DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'), SHEETS_SYNC_ENABLED: 'false', MODO_DEMO: 'true', TELEATENCION_WHATSAPP_HABILITADA: 'true' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${BASE}/api/salud`)).ok) break;
  } catch {}
  await sleep(500);
}
const hash = await bcrypt.hash(PASS, 10);
const uid = {};
for (const [k, nombre, rol, pid] of [
  ['coordinadora', null, 'coordinacion', 'marianella-becerra'],
  ['gabriel', null, 'profesional', 'gabriel-ordonez'],
  ['hugo', null, 'profesional', 'hugo-cuenca'],
  ['sally', null, 'profesional', 'zally-pamela'],
  ['andrea', null, 'profesional', 'andrea-mayorga'],
  ['diego', null, 'profesional', 'diego-estrella'],
  ['demetrio', null, 'epidemiologia', 'demetrio-magallanes'],
  ['autoridad', 'Autoridad (prueba)', 'autoridad', null],
  ['auditoria', 'Auditoría (prueba)', 'auditoria', null],
  ['admin', 'Administración (prueba)', 'admin', null],
]) {
  uid[k] = (await c.query(
    `insert into core.usuarios (email, nombre, rol, profesional_id, password_hash, debe_cambiar_password)
     values ($1, coalesce($2, (select nombre from core.profesionales where id = $4)), $3, $4, $5, false) returning id`,
    [`${k}@brigada.local`, nombre, rol, pid, hash],
  )).rows[0].id;
}
for (const [k, f] of [['coordinadora', 'trabajo_social'], ['andrea', 'territorial']])
  await c.query(`insert into core.usuario_funciones (usuario_id, funcion, motivo) values ($1, $2, 'Prueba E2E (ficticio)')`, [uid[k], f]);
// Teleatención de Hugo: caso asignado, cita de hoy y WhatsApp autorizado (número FICTICIO; el enlace no se abre en la prueba).
const SERVIDOR_TELE = 'Persona Ficticia Teleatención';
const sTele = (await c.query(`insert into ops.servidores (clave_fuente, nombre) values ('PRUEBA:E2E-TELE', $1) returning id`, [SERVIDOR_TELE])).rows[0].id;
await c.query(`insert into ops.asignaciones (servidor_id, profesional_id, asignada_por) values ($1, 'hugo-cuenca', $2)`, [sTele, uid.coordinadora]);
await c.query(
  `insert into ops.atenciones (servidor_id, profesional_id, tipo, estado, inicio, fin, duracion_min, creado_por)
   values ($1, 'hugo-cuenca', 'psicologia', 'programada', now() + interval '20 minutes', now() + interval '65 minutes', 45, $2)`,
  [sTele, uid.coordinadora],
);

const NUMERO_FICTICIO = '0990000001';
const fallos = [];
const check = (ok, msg) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) fallos.push(msg);
};
const br = await chromium.launch();
const errores = [];

async function entrar(k, movil = false) {
  const ctx = await br.newContext(movil ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // Los perfiles de escritorio usan la vista de lista de la oficina: la prueba es de permisos, no de render 3D.
  await ctx.addInitScript(() => {
    localStorage.setItem('cgreg.vista', 'lista');
    // La prueba no abre WhatsApp: registra la dirección que la app intenta abrir.
    window.__abiertos = [];
    window.open = () => {
      const falsa = { opener: null, close() {}, location: {} };
      Object.defineProperty(falsa.location, 'href', { set: (u) => window.__abiertos.push(u) });
      return falsa;
    };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push(`${k}: ${e.message}`));
  await page.goto(BASE + '/');
  await page.fill('input[type=email]', `${k}@brigada.local`);
  await page.fill('input[type=password]', PASS);
  // La API limita a 10 ingresos por minuto y dirección; la prueba respeta el límite en lugar de desactivarlo.
  for (let intento = 0; intento < 3; intento++) {
    const resp = page.waitForResponse((r) => r.url().endsWith('/api/auth/login'));
    await page.click('button:has-text("Ingresar")');
    if ((await resp).status() !== 429) break;
    console.log('  (límite de ingresos por minuto: esperando 61 s)');
    await sleep(61_000);
  }
  await page.waitForSelector(movil ? 'nav[aria-label="Navegación de la app"]' : 'aside nav, aside a', { timeout: 20000 });
  await sleep(1500);
  return { ctx, page };
}
const menu = (page) => page.$$eval('aside a', (as) => as.map((a) => a.textContent.trim()).filter(Boolean));
const api = (page, url) => page.evaluate(async (u) => (await fetch(u)).status, url);
const textoDe = (page) => page.evaluate(() => document.body.innerText);

try {
  // ---------- Profesional de Salud Mental ----------
  const g = await entrar('gabriel');
  const mg = await menu(g.page);
  check(mg.includes('Oficina Virtual') && mg.includes('Mi espacio de trabajo') && mg.includes('Mi agenda') && mg.includes('Mis atenciones') && mg.includes('Mis derivaciones'),
    `Profesional: menú de su espacio de trabajo (${mg.join(' · ')})`);
  check(!mg.includes('Mi Equipo') && mg.includes('Directorio de profesionales'), 'Profesional: sin «Mi Equipo»; con Directorio de profesionales');
  await g.page.goto(BASE + '/');
  await sleep(2000);
  check(g.page.url() === BASE + '/' && (await g.page.locator('[aria-label="Indicadores en tiempo real"]').count()) === 1 && (await api(g.page, '/api/office/presencia')) === 200, 'Profesional: entra a la Oficina Virtual');
  await g.page.screenshot({ path: `${OUT}brigada-1-profesional-oficina.png` });
  await g.page.goto(BASE + '/equipo');
  await sleep(1200);
  check((await textoDe(g.page)).includes('No tiene permisos para acceder a este módulo'), 'Profesional: /equipo por URL directa muestra «sin permisos»');
  check((await api(g.page, '/api/coordinacion/panel')) === 403 && (await api(g.page, '/api/profesionales/sofia-guerra/disponibilidad')) !== 200, 'Profesional: la API niega el panel de gestión de Coordinación');
  await g.page.goto(BASE + '/directorio');
  await g.page.waitForSelector('h2:has-text("Gabriel Alexander Ordóñez Guzmán")', { timeout: 10000 });
  const dir = await textoDe(g.page);
  const dirMin = dir.toLowerCase(); // la función se muestra en versalitas (CSS uppercase)
  check(dir.includes('Sally Tinizaray Soriano') && dir.includes('Hugo Xavier Cuenca Guerrero') && dirMin.includes('apoyo epidemiológico y territorial') && !dir.includes('Zally Pamela'),
    'Directorio: integrantes oficiales con profesión y función');
  check(dir.includes('Disponibilidad para derivaciones') && !/Atenciones hoy|Seguimientos pendientes/.test(dir), 'Directorio: disponibilidad solo para Psiquiatría; sin cargas ni estadísticas');
  await g.page.screenshot({ path: `${OUT}brigada-2-directorio.png`, fullPage: true });
  await g.ctx.close();

  // ---------- Profesional en el teléfono ----------
  const gm = await entrar('gabriel', true);
  const barra = await gm.page.$$eval('nav[aria-label="Navegación de la app"] li', (ls) => ls.map((l) => l.textContent.trim()));
  check(JSON.stringify(barra) === JSON.stringify(['Mi espacio', 'Agenda', 'Atenciones', 'Oficina', 'Más']), `Profesional (teléfono): barra inferior ${barra.join(' · ')}`);
  await gm.page.screenshot({ path: `${OUT}brigada-3-profesional-movil.png` });
  await gm.ctx.close();

  // ---------- Coordinación General + Trabajo Social ----------
  const co = await entrar('coordinadora');
  const mc = await menu(co.page);
  check(['Panel de Coordinación', 'Mi Equipo', 'Agenda general', 'Asignaciones', 'Solicitudes', 'Derivaciones y articulación', 'Seguimiento', 'Oficina Virtual'].every((x) => mc.includes(x)),
    `Coordinación: menú de gestión (${mc.join(' · ')})`);
  check(!mc.includes('Auditoría') && !mc.includes('Administración técnica'), 'Coordinación: no se convierte en administradora técnica ni auditora');
  await co.page.goto(BASE + '/equipo');
  await sleep(2000);
  check(!(await textoDe(co.page)).includes('No tiene permisos'), 'Coordinación: ingresa a Mi Equipo');
  const me = await co.page.evaluate(async () => (await fetch('/api/auth/me')).json());
  check(me.rol === 'coordinacion' && JSON.stringify(me.funciones) === '["trabajo_social"]', 'Coordinación: una sola cuenta con la función Trabajo Social');
  await co.page.screenshot({ path: `${OUT}brigada-4-coordinacion.png` });
  await co.ctx.close();

  // ---------- Andrea: Psicología + territorial ----------
  const an = await entrar('andrea');
  const ma = await menu(an.page);
  check(ma.includes('Mis atenciones') && ma.includes('Mis registros clínicos') && ma.includes('Articulación Territorial') && !ma.includes('Mi Equipo'), `Andrea: Psicología y función territorial (${ma.join(' · ')})`);
  await an.ctx.close();

  // ---------- Diego: Psiquiatría ----------
  const di = await entrar('diego');
  const md = await menu(di.page);
  check(md.includes('Mis derivaciones') && md.includes('Mi agenda') && !md.includes('Mi Equipo') && !md.includes('Solicitudes'), `Diego: flujo de Psiquiatría (${md.join(' · ')})`);
  await di.ctx.close();

  // ---------- Demetrio: Apoyo Epidemiológico y Territorial ----------
  const de = await entrar('demetrio');
  const mde = await menu(de.page);
  check(mde.includes('Oficina Virtual') && mde.includes('Indicadores epidemiológicos') && mde.includes('Gestión de riesgos y territorio'), `Demetrio: oficina, indicadores y territorio (${mde.join(' · ')})`);
  check(!mde.some((x) => /registros clínicos|Historias|atenciones|Asignaciones|Mis casos/i.test(x)), 'Demetrio: sin módulos clínicos en el menú');
  check((await api(de.page, '/api/servidores')) === 403 && (await api(de.page, '/api/expedientes')) === 403, 'Demetrio: la API niega casos e historias');
  await de.ctx.close();

  // ---------- Autoridad ----------
  const au = await entrar('autoridad');
  await au.page.goto(BASE + '/');
  await sleep(2000);
  const mau = await menu(au.page);
  check(au.page.url().endsWith('/comando') && !mau.includes('Oficina Virtual') && !mau.includes('Mi Equipo'), `Autoridad: entra al panel de indicadores (${mau.join(' · ')})`);
  check((await api(au.page, '/api/servidores')) === 403 && (await api(au.page, '/api/office/presencia')) === 403, 'Autoridad: la API niega identidades y presencia individual');
  await au.page.screenshot({ path: `${OUT}brigada-5-autoridad.png` });
  await au.ctx.close();

  // ---------- Auditoría ----------
  const ad = await entrar('auditoria');
  await ad.page.goto(BASE + '/');
  await sleep(2000);
  check(ad.page.url().endsWith('/auditoria') && (await menu(ad.page)).includes('Panel de trazabilidad'), 'Auditoría: entra al panel de trazabilidad');
  check((await api(ad.page, '/api/expedientes')) === 403, 'Auditoría: sin acceso a historias');
  await ad.ctx.close();

  // ---------- Administración ----------
  const adm = await entrar('admin');
  await adm.page.goto(BASE + '/');
  await sleep(2000);
  check(adm.page.url().endsWith('/configuracion') && (await menu(adm.page)).includes('Administración técnica'), 'Administración: entra a la administración técnica');
  check((await api(adm.page, '/api/servidores')) === 403 && (await api(adm.page, '/api/consentimientos')) === 403 && (await api(adm.page, '/api/expedientes')) === 403, 'Administración: sin acceso clínico rutinario');
  const usuariosTab = adm.page.locator('button:has-text("Usuarios"), [role=tab]:has-text("Usuarios")').first();
  if (await usuariosTab.count()) await usuariosTab.click();
  await adm.page.waitForSelector('td:has-text("coordinadora@brigada.local")', { timeout: 10000 });
  const fila = adm.page.locator('tr', { has: adm.page.locator('td:has-text("coordinadora@brigada.local")') });
  check((await fila.innerText()).includes('Trabajo Social'), 'Administración: ve las funciones complementarias de cada cuenta');
  await fila.locator('button:has-text("Funciones")').click();
  await adm.page.waitForSelector('[role=dialog]:has-text("Funciones de")');
  await adm.page.screenshot({ path: `${OUT}brigada-6-admin-funciones.png` });
  await adm.ctx.close();


  // ---------- Entorno de demostración identificado ----------
  {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.waitForSelector('input[type=email]');
    await sleep(800);
    check((await textoDe(p)).includes('Entorno de demostración'), 'Login: aviso visible de entorno de demostración con datos ficticios');
    await ctx.close();
  }

  // ---------- Coordinación: WhatsApp autorizado en la ficha y Gestión Social ----------
  const cw = await entrar('coordinadora');
  const put = await cw.page.evaluate(async ([s, n]) => (await fetch(`/api/servidores/${s}/whatsapp`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-cgreg': '1' }, body: JSON.stringify({ numero: n, autorizado: true }) })).status, [sTele, NUMERO_FICTICIO]);
  check(put === 200, 'Coordinación registra el WhatsApp autorizado de la persona');
  await cw.page.goto(`${BASE}/servidores/${sTele}`);
  await cw.page.waitForSelector('text=WhatsApp para teleatención');
  const ficha = await textoDe(cw.page);
  check(ficha.includes('•••• 0001') && !ficha.includes('0990000001'), 'La ficha muestra el número enmascarado, nunca completo');
  const mcw = await menu(cw.page);
  check(['Gestión Social', 'Indicadores', 'Mi Equipo', 'Consentimientos'].every((x) => mcw.includes(x)), `Coordinación: Gestión Social, Indicadores, Mi Equipo y Consentimientos en el menú`);
  await cw.page.goto(BASE + '/gestion-social');
  await cw.page.waitForSelector('text=Mis casos sociales');
  check((await textoDe(cw.page)).includes('Solicitudes recibidas por orientar'), 'Gestión Social: recepción de solicitudes, casos sociales y necesidades');
  await cw.page.screenshot({ path: `${OUT}brigada-7-gestion-social.png` });
  await cw.ctx.close();

  // ---------- Hugo en el teléfono: agenda propia, Contactar por WhatsApp, Iniciar teleatención ----------
  const hu = await entrar('hugo', true);
  await hu.page.goto(BASE + '/agenda');
  await hu.page.waitForSelector('section[aria-label^="Citas del"] ul button', { timeout: 15000 });
  check((await hu.page.locator('section[aria-label^="Citas del"] ul button', { hasText: SERVIDOR_TELE }).count()) === 1, 'Hugo: su agenda muestra su propia cita');
  await hu.page.locator('section[aria-label^="Citas del"] ul button', { hasText: SERVIDOR_TELE }).click();
  await sleep(600);
  const hoja = hu.page.locator('[role=dialog][aria-label^="Cita "]');
  check((await hoja.locator('button', { hasText: 'Contactar por WhatsApp' }).count()) === 1 && (await hoja.locator('button', { hasText: 'Iniciar teleatención' }).count()) === 1,
    'La cita ofrece «Contactar por WhatsApp» e «Iniciar teleatención»');
  check((await hoja.innerText()).includes('La videollamada se inicia manualmente desde WhatsApp'), 'La interfaz aclara que la videollamada es manual en WhatsApp');
  await hu.page.screenshot({ path: `${OUT}brigada-8-teleatencion-cita.png` });
  await hoja.locator('button', { hasText: 'Contactar por WhatsApp' }).click();
  await sleep(1500);
  const abiertos = await hu.page.evaluate(() => window.__abiertos);
  const url = abiertos[0] ?? '';
  const texto = decodeURIComponent(url.split('?text=')[1] ?? '');
  check(url.startsWith('https://wa.me/593990000001?text='), 'WhatsApp abre el chat del número autorizado (wa.me)');
  check(texto.includes('Brigada de Apoyo Psicosocial') && !texto.includes(SERVIDOR_TELE) && !/diagn|motivo|historia|cl[ií]nic|psicol|psiqui/i.test(texto), `El mensaje es institucional y sin información sensible («${texto.slice(0, 60)}…»)`);
  await sleep(800);
  check((await hoja.innerText()).includes('Contacto iniciado'), 'La cita pasa a «Contacto iniciado»');
  const mh = await hu.page.evaluate(async () => (await fetch('/api/auth/me')).json());
  check(mh.profesional_id === 'hugo-cuenca' && mh.rol === 'profesional', 'Hugo ingresa con su propia cuenta de Salud Mental');
  await hu.ctx.close();

  // ---------- Coordinación ve el estado operativo, no el contenido ----------
  const cv = await entrar('coordinadora');
  const at = await cv.page.evaluate(async (s) => {
    const r = await fetch(`/api/agenda?desde=${encodeURIComponent(new Date(Date.now() - 864e5).toISOString())}&hasta=${encodeURIComponent(new Date(Date.now() + 864e5).toISOString())}`);
    return (await r.json()).find((x) => x.servidor_id === s);
  }, sTele);
  check(at?.estado === 'contacto_iniciado', 'Coordinación ve el estado «Contacto iniciado» de la atención');
  await cv.ctx.close();

  // ---------- Sally: una sola, con su nombre correcto ----------
  const sa = await entrar('sally');
  const ms = await sa.page.evaluate(async () => (await fetch('/api/auth/me')).json());
  check(ms.nombre === 'Sally Tinizaray Soriano' && ms.profesional_id === 'zally-pamela', 'Sally ingresa con su cuenta y su nombre correcto');
  await sa.page.goto(BASE + '/directorio');
  await sa.page.waitForSelector('h2:has-text("Sally Tinizaray Soriano")');
  const tarjetas = await sa.page.$$eval('main h2', (hs) => hs.map((h) => h.textContent.trim()));
  check(tarjetas.filter((t) => /sally|zally/i.test(t)).length === 1 && !tarjetas.some((t) => /zally/i.test(t)) && !(await textoDe(sa.page)).match(/zally/i),
    `Directorio: Sally aparece una sola vez y ninguna «Zally» (${tarjetas.length} integrantes)`);
  check((await menu(sa.page)).includes('Mis consentimientos'), 'Salud Mental: «Mis consentimientos» en el menú');
  await sa.page.goto(BASE + '/consentimientos');
  await sa.page.waitForSelector('h1:has-text("Mis consentimientos")');
  await sa.page.goto(BASE + '/gestion-social');
  await sleep(1000);
  check((await textoDe(sa.page)).includes('No tiene permisos para acceder a este módulo'), 'Salud Mental: sin acceso a Gestión Social');
  await sa.ctx.close();

  check(errores.length === 0, `Sin errores de JavaScript${errores.length ? ': ' + errores.join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  fallos.push(String(e));
} finally {
  await br.close();
  srv.kill();
  await c.end();
}
console.log(fallos.length ? `\n${fallos.length} verificación(es) fallida(s)` : '\nBRIGADA OK');
process.exit(fallos.length ? 1 : 0);
