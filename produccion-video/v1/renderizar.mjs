// Renderiza video.html fotograma a fotograma. Uso: node renderizar.mjs prueba t1 t2 ...  |  node renderizar.mjs video salida.mp4 [fps]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
const { chromium } = createRequire(path.resolve(process.env.CGREG_REPO || '../../', 'package.json'))('playwright') // CGREG_REPO: carpeta del repositorio con Playwright;
const [modo, ...args] = process.argv.slice(2);
const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
await p.goto('file://' + path.resolve('video.html'));
await p.evaluate(async () => {
  await document.fonts.ready;
  const urls = new Set();
  for (const el of document.querySelectorAll('*')) { const m = getComputedStyle(el).backgroundImage.match(/url\("(.+?)"\)/); if (m) urls.add(m[1]); }
  await Promise.all([...urls].map((u) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = u; })));
  await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r))));
});
if (modo === 'prueba') {
  for (const t of args) { await p.evaluate((t) => window.irA(t), +t); await p.waitForTimeout(80); await p.screenshot({ path: `${process.env.DIR_PRUEBA || 'prueba'}/t${(+t).toFixed(1)}.jpg`, type: 'jpeg', quality: 85 }); }
} else {
  const [salida, fpsS] = args; const fps = +(fpsS || 25);
  const dur = await p.evaluate(() => window.DURACION); const N = Math.ceil(dur * fps);
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), salida], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < N; f++) {
    await p.evaluate((t) => window.irA(t), f / fps);
    const buf = await p.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 250 === 0) console.log(`fotograma ${f}/${N} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  console.log('listo', salida, N, 'fotogramas');
}
await br.close();
