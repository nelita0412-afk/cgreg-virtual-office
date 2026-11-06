// Grabación de navegación EN VIVO por CGREG Virtual Office (plataforma real, base DEMO con datos ficticios).
// Técnica: «tiempo virtual». Se toma el control de requestAnimationFrame y performance.now de la página;
// cada fotograma avanza exactamente 40 ms de la aplicación (25 fps) y se captura. Así la oficina 3D y la
// interfaz se graban con fluidez aunque este equipo no tenga GPU. Clics, escritura y desplazamientos son
// eventos reales del navegador sobre la aplicación real; el cursor visible es una capa dibujada encima.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(path.resolve(process.env.CGREG_REPO || '../../', 'package.json'))('playwright') // CGREG_REPO: carpeta del repositorio con Playwright;

const BASE = 'http://localhost:4000';
// Contraseña de los usuarios DEMO (base de demostración). No se guarda en el código: variable de entorno.
const PASS = process.env.CGREG_DEMO_PASS;
if (!PASS) throw new Error('Defina CGREG_DEMO_PASS con la contraseña de los usuarios DEMO.');
const OUT = path.resolve('grabacion');
const DT = 40; // ms por fotograma (25 fps)
const solo = process.argv[2]; // 'profesional' | 'coordinacion' | undefined (ambas)

const SHIM = () => {
  // Reloj virtual de animación: rAF y performance.now avanzan solo cuando el grabador lo indica.
  let vt = 0, id = 0;
  const cola = new Map();
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { id += 1; cola.set(id, cb); return id; };
  window.cancelAnimationFrame = (i) => cola.delete(i);
  window.__tick = (ms) => {
    vt += ms;
    const lote = [...cola.values()]; cola.clear();
    for (const cb of lote) { try { cb(vt); } catch (e) { console.error(e); } }
  };
  // Capa de cursor (no interactiva) y onda de clic
  const montar = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    c.style.cssText = 'position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))';
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2.5 L4 19.2 L8.4 15.3 L11.3 21.6 L14.2 20.3 L11.4 14.2 L17.4 14.2 Z" fill="#fff" stroke="#0B1F45" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const r = document.createElement('div');
    r.id = '__onda';
    r.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #13A3B5;background:rgba(19,163,181,.18);z-index:2147483646;pointer-events:none;opacity:0';
    document.documentElement.append(r, c);
  };
  window.__cursor = (x, y, onda) => {
    montar();
    document.getElementById('__cur').style.transform = `translate(${x - 4}px,${y - 3}px)`;
    const r = document.getElementById('__onda');
    if (onda == null) { r.style.opacity = 0; return; }
    r.style.left = x + 'px'; r.style.top = y + 'px';
    r.style.opacity = String(Math.max(0, 1 - onda));
    r.style.transform = `scale(${0.4 + onda * 1.1})`;
  };
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function sesion(nombre) {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });
  await ctx.addInitScript(SHIM);
  const p = await ctx.newPage();
  let clip = null, f = 0, x = 720, y = 470, onda = null, marcas = {};
  const dir = () => path.join(OUT, clip);
  const foto = async () => {
    await p.evaluate(([x, y, o]) => window.__cursor(x, y, o), [x, y, onda]);
    await p.evaluate((ms) => window.__tick(ms), DT);
    await p.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await p.screenshot({ path: path.join(dir(), `f${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    f += 1;
    if (onda != null) { onda += 0.12; if (onda > 1) onda = null; }
  };
  const api = {
    p,
    async clip(n) { clip = n; f = 0; fs.mkdirSync(dir(), { recursive: true }); console.log('— clip', n); },
    async esperar(seg) { for (let i = 0; i < Math.round(seg * 25); i++) await foto(); },
    async mover(tx, ty, seg = 0.8) {
      const x0 = x, y0 = y, n = Math.max(1, Math.round(seg * 25));
      for (let i = 1; i <= n; i++) {
        const k = ease(i / n);
        x = x0 + (tx - x0) * k; y = y0 + (ty - y0) * k - Math.sin(k * Math.PI) * 18; // arco natural
        await p.mouse.move(x, y);
        await foto();
      }
    },
    async a(sel, seg = 0.8, dx = 0.5, dy = 0.5) {
      const loc = typeof sel === 'string' ? p.locator(sel).first() : sel;
      await loc.waitFor({ state: 'visible', timeout: 20000 });
      const b = await loc.boundingBox();
      await api.mover(b.x + b.width * dx, b.y + b.height * dy, seg);
      return loc;
    },
    async clic(sel, seg = 0.8) {
      if (sel) await api.a(sel, seg);
      await foto(); await foto();
      onda = 0;
      await p.mouse.down(); await foto(); await p.mouse.up();
      await foto();
    },
    async escribir(texto, fpc = 2) { for (const ch of texto) { await p.keyboard.type(ch); for (let i = 0; i < fpc; i++) await foto(); } },
    async rueda(dy, seg = 1.2) { const n = Math.round(seg * 25); for (let i = 0; i < n; i++) { await p.mouse.wheel(0, (dy / n) * (1 - Math.cos(((i + 0.5) / n) * Math.PI * 2)) ); await foto(); } },
    async hastaQue(fn, max = 8) { for (let i = 0; i < max * 25; i++) { if (await p.evaluate(fn).catch(() => false)) return; await foto(); } },
    marca(n) { marcas[`${clip}:${n}`] = f; },
    async cerrar() { fs.writeFileSync(path.join(OUT, `marcas-${nombre}.json`), JSON.stringify(marcas, null, 1)); await br.close(); },
  };
  return api;
}

fs.mkdirSync(OUT, { recursive: true });

if (!solo || solo === 'profesional') {
  // ---------- Sesión 1: un psicólogo (Gabriel Ordóñez, usuario DEMO) ----------
  const s = await sesion('profesional');
  const { p } = s;
  await p.goto(`${BASE}/?calidad=alta&ambiente=1`);
  await p.waitForSelector('input[type=email]');
  await s.clip('01-ingreso');
  await s.esperar(0.6);
  await s.clic('input[type=email]', 0.9);
  await s.escribir('gabriel@demo.cgreg', 1);
  await s.clic('input[type=password]', 0.5);
  await s.escribir(PASS, 1); // el campo de contraseña muestra puntos
  await s.clic('button:has-text("Ingresar")', 0.6);
  s.marca('ingresar');
  await s.hastaQue(() => !!document.querySelector('canvas'), 30);
  await s.esperar(1.0);

  await s.clip('02-oficina');
  await s.esperar(1.2);
  await s.mover(980, 420, 1.2);
  await s.esperar(1.0);
  await s.mover(640, 520, 1.4);
  await s.esperar(1.2);

  // Navegación por salas: clic sobre el rótulo de la sala dentro de la oficina 3D (la cámara vuela y abre el panel del departamento)
  const sala = (t) => p.locator('div.pointer-events-none.absolute.inset-0 > button', { hasText: t }).first();
  await s.clip('03-consultorios');
  await s.clic(sala('Consultorios de Psicología'), 1.0);
  await s.esperar(2.2);
  const hx = p.locator('div.pointer-events-none.absolute.inset-0 > button', { hasText: 'Hugo' }).first();
  if (await hx.count()) await s.a(hx, 1.0); else await s.mover(760, 470, 1.0);
  await s.esperar(1.2);
  await s.clic('button[aria-label="Vista general"]', 0.9);
  await s.esperar(1.6);

  await s.clip('04-telemedicina');
  await s.clic(sala('Telemedicina'), 1.0);
  await s.esperar(2.6);

  await s.clip('05-agenda');
  await s.clic('nav >> text=Agenda', 0.9);
  await s.esperar(0.8);
  await s.a('text=Ana Lucía Ficticia Uno', 1.0);
  await s.esperar(1.4);

  await s.clip('06-atenciones');
  await s.clic('nav >> text=Atenciones', 0.9);
  await s.esperar(0.8);
  await s.clic(p.locator('tr', { hasText: 'AT-00001' }).locator('button, a', { hasText: 'Detalle' }), 1.0);
  await s.esperar(1.0);
  await s.a('text=Registro clínico', 0.9);
  await s.esperar(1.6);

  await s.clip('07-historias');
  await s.clic('nav >> text=Historias clínicas', 1.0);
  await s.esperar(0.7);
  await s.clic('text=HC-00001', 0.8);
  await s.esperar(1.0);
  await s.clic('button:has-text("Evolución")', 0.8);
  await s.esperar(1.2);
  await s.clic('button:has-text("Consentimiento")', 0.8);
  await s.esperar(1.8);
  await s.cerrar();
}

if (!solo || solo === 'coordinacion') {
  // ---------- Sesión 2: Coordinación General (usuario DEMO) ----------
  const s = await sesion('coordinacion');
  const { p } = s;
  await p.addInitScript(() => localStorage.setItem('cgreg.vista', 'lista'));
  await p.goto(`${BASE}/`);
  await p.fill('input[type=email]', 'coordinacion@demo.cgreg');
  await p.fill('input[type=password]', PASS);
  await p.click('button:has-text("Ingresar")');
  await p.waitForTimeout(4000);
  await p.goto(`${BASE}/comando`);
  await p.waitForTimeout(3000);

  await s.clip('08-comando');
  await s.esperar(0.6);
  await s.a('text=¿Qué necesitan de mí los profesionales?', 1.0);
  await s.esperar(0.8);
  await s.a('text=¿Qué debo gestionar hoy?', 1.0);
  await s.esperar(0.6);
  await s.mover(700, 600, 0.8);
  await s.rueda(380, 1.6);
  await s.esperar(1.0);

  await s.clip('09-solicitudes');
  await s.clic('nav >> text=Mis Solicitudes', 1.0);
  await s.esperar(1.0);
  await s.clic(p.locator('tr', { hasText: 'SOL-0001' }).first(), 1.0);
  s.marca('detalle');
  await s.esperar(1.0);
  await s.a('text=Historial de comunicación', 1.0);
  await s.esperar(0.8);
  await s.a('text=Gestión realizada', 0.9);
  await s.esperar(0.8);
  await s.a('button:has-text("Registrar gestión")', 1.0);
  await s.esperar(1.6);
  await s.cerrar();
}
console.log('grabación lista');
