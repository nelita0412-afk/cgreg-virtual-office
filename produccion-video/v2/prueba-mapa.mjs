import { createRequire } from 'node:module'; import path from 'node:path';
const { chromium } = createRequire(path.resolve(process.env.CGREG_REPO || '../../', 'package.json'))('playwright') // CGREG_REPO: carpeta del repositorio con Playwright;
const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', (e) => console.log('ERROR', e.message));
await p.goto('file://' + path.resolve('prueba-mapa.html')); await p.evaluate(() => document.fonts.ready);
for (const t of process.argv.slice(2)) { const t0 = Date.now(); await p.evaluate((t) => window.ver(+t), t); console.log(t, Date.now() - t0, 'ms'); await p.screenshot({ path: `exploracion/mapa-${t}.jpg`, type: 'jpeg', quality: 85 }); }
await br.close();
