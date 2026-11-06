import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(path.resolve(process.env.CGREG_REPO || '../../', 'package.json'))('playwright') // CGREG_REPO: carpeta del repositorio con Playwright;
const b = await chromium.launch(); const p = await b.newPage();
await p.goto('file://' + path.resolve('storyboard.html')); await p.waitForTimeout(800);
await p.pdf({ path: '../entregables/CGREG-video-storyboard.pdf', format: 'A4', landscape: true, printBackground: true }); await b.close(); console.log('pdf ok');
