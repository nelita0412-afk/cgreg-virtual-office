// Video institucional CGREG — versión 2. Genera video_v2.html (1920×1080) con 7 escenas sobre una línea de tiempo global.
// Escena 1: mapa animado (canvas, mapa.js) + fotografías de Puerto Ayora. Escenas 5–6: grabación en vivo de la plataforma
// (secuencia de fotogramas reales, EDL de linea_tiempo_v2.json). Escena 7: cierre limpio, SIN logotipos institucionales.
const fs = require('fs');
const path = require('path');
const React = require('react');
const RDS = require('react-dom/server');
const lu = require('react-icons/lu');

const lt = JSON.parse(fs.readFileSync(path.join(__dirname, 'linea_tiempo_v2.json'), 'utf8'));
const E = Object.fromEntries(lt.escenas.map((e) => [e.n, e]));
const V = Object.fromEntries(lt.voz.map((v) => [v.id, v]));
const icon = (n, color = '#13A3B5', size = 44, sw = 1.8) => RDS.renderToStaticMarkup(React.createElement(lu[n], { color, size, strokeWidth: sw }));
const a = (nombre, dur, t, ease = 'cubic-bezier(.22,.61,.36,1)') => `${nombre} ${dur}s ${ease} ${t.toFixed(3)}s ${nombre === 'desaparecer' ? 'forwards' : 'both'}`;
const anim = (...xs) => `animation:${xs.join(',')};`;
const NAVY = '#0B1F45', TURQ = '#13A3B5', ORO = '#C9A24B', AZUL = '#1D4E9E';
const LOGO = 'recursos/logos-gobierno-cgreg.png';
const F = 'recursos/fotos/';
function escena(n, contenido, { fondo = NAVY } = {}) {
  const e = E[n];
  const ini = Math.max(0, e.inicio - 0.35), fin = e.fin - 0.35;
  return `<section class="esc" style="background:${fondo};${anim(a('aparecer', 0.7, ini, 'ease'), a('desaparecer', 0.7, fin, 'ease'))}">${contenido}</section>`;
}
const chipLogo = (x, y, w) => `<div class="chiplogo" style="left:${x}px;top:${y}px;width:${w}px"><img src="${LOGO}" style="width:${w - 36}px"></div>`;
const credito = (txt, t, hasta) => `<div class="credito" style="${anim(a('aparecer', 0.8, t, 'ease'), ...(hasta ? [a('desaparecer', 0.8, hasta, 'ease')] : []))}">${txt}</div>`;

/* ---------------- Escena 1: mapa Ecuador → Galápagos → Santa Cruz, y fotografías de Puerto Ayora ---------------- */
const t1 = E[1].inicio, M = lt.mapa_seg, VM = 10.8 / lt.mapa_seg; // velocidad de la animación cartográfica
const s1 = escena(1, `
  <canvas id="mapa" width="1920" height="1080" style="position:absolute;inset:0;${anim(a('desaparecer', 1.2, t1 + M - 0.6, 'ease'))}"></canvas>
  <div class="kicker sombra" style="left:96px;top:86px;${anim(a('subir', 0.9, t1 + 0.4), a('desaparecer', 0.8, t1 + 8.6 / VM, 'ease'))}">CONTEXTO TERRITORIAL</div>
  <div class="rotulo-geo" style="top:80px;bottom:auto;${anim(a('desdeIzq', 0.9, t1 + 9.0 / VM), a('desaparecer', 0.8, t1 + M - 0.5, 'ease'))}">${icon('LuMapPin', ORO, 34)}<span>PUERTO AYORA · ISLA SANTA CRUZ · GALÁPAGOS · ECUADOR</span></div>
  <div class="credito" style="${anim(a('aparecer', 0.8, t1 + 0.4, 'ease'), a('desaparecer', 0.8, t1 + M - 0.6, 'ease'))}">Cartografía: © colaboradores de OpenStreetMap (ODbL) · Natural Earth</div>
  <div class="foto" style="background-image:url('${F}puerto-ayora-muelle.jpg');${anim(a('aparecer', 1.2, t1 + M - 0.6, 'ease'), a('kb1', 7.5, t1 + M - 0.6, 'linear'))}"></div>
  <div class="velo-izq" style="${anim(a('aparecer', 1.2, t1 + M - 0.4, 'ease'))}"></div>
  <div style="${anim(a('aparecer', 0.8, t1 + M, 'ease'))}">${chipLogo(90, 70, 560)}</div>
  <div class="kicker" style="left:96px;top:330px;${anim(a('subir', 0.9, t1 + M + 0.2))}">ISLA SANTA CRUZ · GALÁPAGOS</div>
  <h1 class="titulo" style="left:90px;top:380px;width:1300px;${anim(a('subir', 1.0, t1 + M + 0.5))}">Plan de acompañamiento<br>psicosocial y de salud</h1>
  <div class="bajada" style="left:96px;top:600px;width:900px;${anim(a('subir', 1.0, t1 + M + 1.2))}">Respuesta institucional ante las afectaciones asociadas al fenómeno <b>El Niño-Oscilación del Sur (ENOS)</b>, en su fase cálida (El Niño)</div>
  ${credito('Foto: Puerto Ayora · David Broad, CC BY 3.0 · Wikimedia Commons', t1 + M + 0.4)}
`);
/* ---------------- Escena 2: dos rutas de atención ---------------- */
const t2 = E[2].inicio, K2 = V['2'].dur / 12.4; // sincronía con la voz
const s2 = escena(2, `
  <div class="malla"></div>
  ${chipLogo(80, 60, 420)}
  <div class="kicker" style="left:96px;top:190px;${anim(a('subir', 0.8, t2 + 0.3 * K2))}">DOS VÍAS DE ACCESO</div>
  <h2 class="titulo2" style="left:90px;top:232px;${anim(a('subir', 0.9, t2 + 0.5 * K2))}">Rutas de atención</h2>
  <svg class="rutas" viewBox="0 0 1920 1080">
    <path d="M 700 455 C 980 455, 1080 600, 1330 610" stroke="${ORO}" style="${anim(a('trazo', 2.2, t2 + 1.4 * K2, 'ease-in-out'))}"/>
    <path d="M 700 755 C 980 755, 1080 640, 1330 630" stroke="${TURQ}" style="${anim(a('trazo', 2.2, t2 + 5.6 * K2, 'ease-in-out'))}"/>
  </svg>
  <div class="ruta r1" style="left:96px;top:385px;${anim(a('desdeIzq', 0.9, t2 + 0.9 * K2))}">
    <div class="ri">${icon('LuShieldAlert', ORO, 46)}</div>
    <div><div class="rt" style="color:${ORO}">RUTA 1 · ATENCIÓN PRIORITARIA</div><div class="rd">Servidores con riesgo alto <b>validado profesionalmente</b></div></div>
  </div>
  <div class="ruta r2" style="left:96px;top:685px;${anim(a('desdeIzq', 0.9, t2 + 5.1 * K2))}">
    <div class="ri">${icon('LuDoorOpen', TURQ, 46)}</div>
    <div><div class="rt" style="color:${TURQ}">RUTA 2 · ATENCIÓN ABIERTA</div><div class="rd">Cualquier servidor del CGREG en Santa Cruz que <b>solicite acompañamiento</b></div></div>
  </div>
  <div class="nodo" style="left:1330px;top:470px;${anim(a('escalar', 0.9, t2 + 3.4 * K2))}">
    <div class="nodo-n">8</div><div class="nodo-t">profesionales<br>de la brigada</div>
  </div>
  <div class="nota" style="left:1300px;top:820px;width:520px;${anim(a('subir', 0.8, t2 + 8.2 * K2))}">La ausencia de una valoración previa no impide el acceso a la atención.</div>
`);

/* ---------------- Escena 3: equipo interdisciplinario ---------------- */
const t3 = E[3].inicio, K3 = V['3'].dur / 13.8; // sincronía con la voz
const psis = ['Gabriel Ordóñez', 'Ma. de los Ángeles Alcívar', 'Hugo Xavier Cuenca', 'Sofía Guerra', 'Betsabé Córdova', 'Zally Pamela'];
const s3 = escena(3, `
  <div class="foto tenue" style="background-image:url('${F}telesalud-pasillo.jpg');${anim(a('kb3', 16, t3, 'linear'))}"></div>
  <div class="velo-total"></div>
  ${chipLogo(80, 60, 420)}
  <div class="kicker" style="left:96px;top:180px;${anim(a('subir', 0.8, t3 + 0.2 * K3))}">EL EQUIPO</div>
  <h2 class="titulo2" style="left:90px;top:222px;${anim(a('subir', 0.9, t3 + 0.4 * K3))}">Brigada interdisciplinaria</h2>
  <div class="grupo" style="left:96px;top:370px;${anim(a('subir', 0.8, t3 + 0.9 * K3))}">${icon('LuBrain', TURQ, 40)}<span><b>6</b> Psicología clínica</span></div>
  ${psis.map((n, i) => `<div class="persona" style="left:${96 + (i % 3) * 385}px;top:${450 + Math.floor(i / 3) * 96}px;${anim(a('subir', 0.7, t3 + 1.3 * K3 + i * 0.25))}">${icon('LuUserRound', '#9FD8E2', 30)}<span>${n}</span></div>`).join('')}
  <div class="tarjeta" style="left:1290px;top:370px;${anim(a('desdeDer', 0.9, t3 + 3.6 * K3))}">
    ${icon('LuStethoscope', ORO, 40)}<div><div class="tt">Medicina / Telemedicina</div><div class="tn">Dr. Demetrio Magallanes</div><div class="td">Médico epidemiólogo · ayuda humanitaria y gestión de riesgos</div></div>
  </div>
  <div class="tarjeta" style="left:1290px;top:560px;${anim(a('desdeDer', 0.9, t3 + 7.2 * K3))}">
    ${icon('LuClipboardList', ORO, 40)}<div><div class="tt">Psiquiatría por derivación</div><div class="tn">Dr. Diego Estrella</div><div class="td">Valoraciones especializadas de casos remitidos</div></div>
  </div>
  <div class="tarjeta discontinua" style="left:96px;top:690px;width:1140px;${anim(a('subir', 0.9, t3 + 10.6 * K3))}">
    ${icon('LuMapPin', TURQ, 36)}<div><div class="tt" style="color:${TURQ}">Articulación territorial adicional</div><div class="td">Andrea Mayorga · psicóloga DECE en territorio, con niñas, niños, adolescentes, familias y profesionales educativos</div></div>
  </div>
  ${credito('Imagen referencial · USDA, dominio público', t3 + 0.5 * K3)}
`);

/* ---------------- Escena 4: alcance de los servicios ---------------- */
const t4 = E[4].inicio, K4 = V['4'].dur / 10.4; // sincronía con la voz
const serv = [
  ['LuVideo', 'Atención psicológica individual', 'clin'], ['LuStethoscope', 'Telemedicina', 'clin'], ['LuClipboardList', 'Valoración psiquiátrica especializada', 'clin'],
  ['LuRefreshCw', 'Seguimiento psicosocial', 'acomp'], ['LuUsersRound', 'Debriefing y acompañamiento grupal', 'acomp'], ['LuGraduationCap', 'Capacitación DECE', 'acomp'],
];
const s4 = escena(4, `
  <div class="foto mitad" style="background-image:url('${F}teleconsulta.jpg');${anim(a('kb4', 12, t4, 'linear'))}"></div>
  <div class="velo-izq ancho"></div>
  ${chipLogo(80, 60, 420)}
  <div class="kicker" style="left:96px;top:180px;${anim(a('subir', 0.8, t4 + 0.2 * K4))}">ALCANCE</div>
  <h2 class="titulo2" style="left:90px;top:222px;${anim(a('subir', 0.9, t4 + 0.4 * K4))}">Servicios telemáticos</h2>
  <div class="grupo-et" style="left:96px;top:365px;${anim(a('aparecer', 0.6, t4 + 0.8 * K4, 'ease'))}">PRESTACIONES CLÍNICAS</div>
  <div class="grupo-et" style="left:96px;top:640px;color:${TURQ};${anim(a('aparecer', 0.6, t4 + 5.2 * K4, 'ease'))}">ACOMPAÑAMIENTO Y FORTALECIMIENTO</div>
  ${serv.map(([ic, t, g], i) => `<div class="serv" style="left:96px;top:${(g === 'clin' ? 410 : 685) + (i % 3) * 72}px;${anim(a('desdeIzq', 0.7, t4 + [1.0, 2.6, 3.6, 5.6, 7.0, 8.6][i] * K4))}"><span class="sic">${icon(ic, g === 'clin' ? '#fff' : NAVY, 30)}</span><span>${t}</span></div>`).join('')}
  <div class="nota fondo" style="left:1120px;top:178px;width:720px;${anim(a('subir', 0.8, t4 + 2.0 * K4))}">La teleatención es una modalidad de atención y acompañamiento; no sustituye la atención presencial ni de emergencia.</div>
  ${credito('Imagen referencial · USDA, dominio público', t4 + 0.5 * K4)}
`);


/* ---------------- Escenas 5 y 6: navegación en vivo por CGREG Virtual Office ---------------- */
const PASOS = { '01-ingreso': '1 · Ingreso', '02-oficina': '2 · Oficina virtual', '03-consultorios': '3 · Consultorios de Psicología', '04-telemedicina': '4 · Telemedicina',
  '05-agenda': '5 · Agendas', '06-atenciones': '6 · Registro de atenciones', '07-historias': '7 · Historia clínica y consentimiento', '08-comando': '8 · Centro de Comando',
  '09-solicitudes': '9 · Solicitudes a Coordinación' };
const pasoEnTiempo = [];
// la etiqueta del paso cambia cuando se abre el módulo (≈0,9 s después del inicio del tramo, tiempo del clic)
for (const s of lt.edl) if (!pasoEnTiempo.length || pasoEnTiempo[pasoEnTiempo.length - 1].clip !== s.clip) pasoEnTiempo.push({ clip: s.clip, ini: pasoEnTiempo.length ? s.ini + 0.35 : s.ini });
const pasos6 = [{ clip: '10', ini: E[6].inicio, txt: '10 · Seguimiento institucional' }];
const t5 = E[5].inicio, t6 = E[6].inicio;
const bandaDemo = (n) => `<div class="banda-demo"><span class="demo2">SIMULACIÓN DE DEMOSTRACIÓN · DATOS FICTICIOS</span>${(n === 5 ? pasoEnTiempo.map((p, i, arr) => ({ t: p.ini, h: arr[i + 1] ? arr[i + 1].ini : E[6].fin, txt: PASOS[p.clip] })) : pasos6.map((p) => ({ t: p.ini, h: E[6].fin, txt: p.txt })))
  .map((p) => `<span class="paso-demo" style="${anim(a('aparecer', 0.35, p.t, 'ease'), a('desaparecer', 0.25, p.h - 0.2, 'ease'))}">${p.txt}</span>`).join('')}</div>`;
const s5 = escena(5, `
  <img class="demo" data-escena="5" src="">
  ${bandaDemo(5)}
  <div class="tercio" style="${anim(a('desdeIzq', 0.8, t5 + 0.2), a('desaparecer', 0.6, t5 + 3.0, 'ease'))}"><div class="m5t">CGREG VIRTUAL OFFICE</div><div class="m5s">Centro Digital de Operaciones de Atención Interdisciplinaria</div></div>
`, { fondo: '#04102B' });
const flujo = [['LuUserRound', 'Profesional', 'solicita apoyo desde la plataforma'], ['LuLandmark', 'Coordinación General', 'recibe, evalúa y articula'], ['LuNetwork', 'Instituciones', 'gestión interinstitucional'], ['LuCircleCheck', 'Respuesta y seguimiento', 'hasta obtener respuesta']];
const tf = V['6b'].ini - 0.2;
const s6 = escena(6, `
  <img class="demo" data-escena="6" src="">
  ${bandaDemo(6)}
  <div class="velo-flujo" style="${anim(a('aparecer', 0.8, tf - 0.3, 'ease'))}"></div>
  <div class="flujo2">
    ${flujo.map(([ic, t, d], i) => `<div class="paso" style="${anim(a('subir', 0.7, tf + i * 0.9))}"><div class="pic">${icon(ic, i === 1 ? NAVY : '#fff', 40)}</div><div class="pt">${t}</div><div class="pd">${d}</div></div>${i < 3 ? `<div class="flecha" style="${anim(a('aparecer', 0.5, tf + 0.5 + i * 0.9, 'ease'))}">${icon('LuArrowRight', TURQ, 40)}</div>` : ''}`).join('')}
  </div>
  <div class="pendientes" style="${anim(a('aparecer', 0.8, tf + 3.6, 'ease'))}">${icon('LuHourglass', ORO, 26)}<div><b>Pendiente de validación institucional:</b> autorización de Google Sheets · confirmación de la clasificación de riesgo · aprobación de los formatos de consentimiento · despliegue institucional de la plataforma</div></div>
`, { fondo: '#04102B' });

/* ---------------- Escena 7: cierre — SIN logotipos ni marcas institucionales ---------------- */
const t7 = E[7].inicio, f7 = E[7].fin;
const s7 = `<section class="esc" style="background:#000;${anim(a('aparecer', 0.9, t7 - 0.35, 'ease'))}">
  <div class="foto" style="background-image:url('${F}bahia-tortuga.jpg');${anim(a('kb7', f7 - t7 + 0.4, t7 - 0.35, 'linear'))}"></div>
  <div class="velo-cierre2" style="${anim(a('aparecer', 2.0, t7 + 0.4, 'ease'))}"></div>
  <div class="lema2" style="${anim(a('subir', 1.2, V['7'].ini + 2.2), a('desaparecer', 1.0, f7 - 3.1, 'ease'))}">Más cerca de nuestros servidores,<br>incluso a la distancia.</div>
  ${credito('Foto: Bahía Tortuga, isla Santa Cruz · Diego Delso, CC BY-SA 4.0 · Wikimedia Commons', t7 + 0.4, t7 + 4.0)}
  <div class="negro" style="${anim(a('aparecer', 1.2, f7 - 1.2, 'ease'))}"></div>
</section>`;
const css = `
@font-face{font-family:Inter}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:${NAVY};font-family:'Inter',sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
.esc{position:absolute;inset:0;overflow:hidden}
.foto{position:absolute;inset:0;background-size:cover;background-position:center;will-change:transform}
.foto.tenue{opacity:.22}
.foto.mitad{left:auto;width:1100px;right:0}
.foto.captura{background-size:cover;background-position:center}
.velo-izq{position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,31,69,.95) 0%,rgba(11,31,69,.86) 48%,rgba(11,31,69,.25) 76%,rgba(11,31,69,0) 100%)}
.velo-izq.ancho{background:linear-gradient(90deg,rgba(11,31,69,1) 0%,rgba(11,31,69,1) 45%,rgba(11,31,69,.35) 62%,rgba(11,31,69,0) 80%)}
.velo-total{position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,31,69,.86),rgba(11,31,69,.95))}
.velo-sup{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,16,43,.97) 0%,rgba(4,16,43,.93) 14%,rgba(4,16,43,0) 26%,rgba(4,16,43,0) 70%,rgba(4,16,43,.55) 100%)}
.velo-inf{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,16,43,.97) 0%,rgba(4,16,43,.92) 20%,rgba(4,16,43,.25) 34%,rgba(4,16,43,.55) 55%,rgba(4,16,43,.96) 78%)}
.velo-cierre{position:absolute;inset:0;background:rgba(11,31,69,.25)}
.malla{position:absolute;inset:0;background-image:radial-gradient(rgba(19,163,181,.18) 1.5px,transparent 1.5px);background-size:44px 44px;opacity:.6}
.chiplogo{position:absolute;background:#fff;border-radius:14px;padding:14px 18px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.chiplogo img{display:block}
.kicker{position:absolute;font-size:26px;font-weight:700;letter-spacing:.22em;color:${TURQ}}
.titulo{position:absolute;font-family:'Inter Display','Inter';font-size:86px;line-height:1.02;font-weight:800;letter-spacing:-.01em}
.titulo2{position:absolute;font-family:'Inter Display','Inter';font-size:64px;font-weight:800;letter-spacing:-.01em}
.sombra{text-shadow:0 4px 24px rgba(0,0,0,.5)}
.bajada{position:absolute;font-size:34px;line-height:1.35;color:#E3ECF8;font-weight:400}
.bajada b{color:#fff;font-weight:700}
.enos{position:absolute;display:flex;align-items:center;gap:14px;font-size:26px;color:#fff;background:rgba(19,163,181,.25);border:1.5px solid rgba(19,163,181,.8);padding:12px 22px;border-radius:40px}
.credito{position:absolute;right:40px;top:1040px;font-size:17px;color:rgba(255,255,255,.75);font-style:italic}
.rutas{position:absolute;inset:0;width:1920px;height:1080px}
.rutas path{fill:none;stroke-width:7;stroke-linecap:round;stroke-dasharray:1000;stroke-dashoffset:1000}
.ruta{position:absolute;width:600px;display:flex;gap:20px;align-items:flex-start;background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.18);border-radius:20px;padding:26px 26px}
.ruta.r1{border-color:rgba(201,162,75,.7)}
.ruta.r2{border-color:rgba(19,163,181,.8)}
.rt{font-size:24px;font-weight:800;letter-spacing:.06em;margin-bottom:10px}
.rd{font-size:27px;line-height:1.3;color:#E3ECF8}
.rd b{color:#fff}
.nodo{position:absolute;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#2A63BE,${AZUL} 60%,#123A7A);display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 0 0 14px rgba(19,163,181,.18),0 0 60px rgba(19,163,181,.35)}
.nodo-n{font-family:'Inter Display';font-size:120px;font-weight:800;line-height:1}
.nodo-t{font-size:26px;text-align:center;line-height:1.2;color:#E3ECF8}
.nota{position:absolute;font-size:24px;line-height:1.35;color:#C9D6EA;font-style:italic}
.nota.fondo{background:rgba(4,16,43,.85);border-radius:12px;padding:14px 20px;color:#E3ECF8}
.grupo{position:absolute;display:flex;align-items:center;gap:16px;font-size:34px;font-weight:600}
.grupo b{font-family:'Inter Display';font-size:46px;color:${TURQ};margin-right:6px}
.persona{position:absolute;width:370px;display:flex;align-items:center;gap:14px;font-size:27px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:18px 18px}
.tarjeta{position:absolute;width:560px;display:flex;gap:22px;align-items:flex-start;background:rgba(255,255,255,.08);border:1.5px solid rgba(201,162,75,.55);border-radius:18px;padding:26px}
.tarjeta.discontinua{border:2px dashed rgba(19,163,181,.8);background:rgba(19,163,181,.08)}
.tt{font-size:24px;font-weight:800;letter-spacing:.04em;color:${ORO};margin-bottom:6px}
.tn{font-size:32px;font-weight:700;margin-bottom:6px}
.td{font-size:24px;line-height:1.3;color:#C9D6EA}
.grupo-et{position:absolute;font-size:22px;font-weight:800;letter-spacing:.18em;color:#8FB4F0}
.serv{position:absolute;display:flex;align-items:center;gap:22px;font-size:33px;font-weight:600}
.sic{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${AZUL}}
.serv:nth-of-type(n) .sic{}
.marca5{position:absolute;left:70px;top:56px}
.m5t{font-family:'Inter Display';font-size:58px;font-weight:800;letter-spacing:.02em;text-shadow:0 4px 20px rgba(0,0,0,.5)}
.m5s{font-size:26px;color:${TURQ};font-weight:600;text-shadow:0 2px 12px rgba(0,0,0,.6)}
.demo{position:absolute;right:56px;top:66px;font-size:22px;font-weight:700;color:${ORO};background:rgba(4,16,43,.85);border:1.5px solid rgba(201,162,75,.7);padding:10px 20px;border-radius:30px}
.etiquetas{position:absolute;right:56px;top:150px;display:flex;flex-direction:column;gap:14px;align-items:flex-end}
.etq{display:flex;align-items:center;gap:14px;font-size:26px;font-weight:600;background:rgba(4,16,43,.88);border:1.5px solid rgba(19,163,181,.6);padding:12px 22px;border-radius:14px}
.flujo{position:absolute;left:96px;right:96px;top:640px;display:flex;align-items:center;justify-content:space-between}
.paso{width:360px;text-align:center}
.pic{width:92px;height:92px;margin:0 auto 16px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${AZUL};border:3px solid ${TURQ}}
.paso:nth-child(3) .pic{background:${ORO};border-color:#fff}
.pt{font-size:32px;font-weight:800;margin-bottom:6px}
.pd{font-size:24px;color:#C9D6EA;line-height:1.3}
.flecha{width:60px;display:flex;justify-content:center}
.cierre-pilares{position:absolute;left:0;right:0;top:400px;text-align:center;font-family:'Inter Display';font-size:58px;font-weight:700;text-shadow:0 4px 30px rgba(0,0,0,.55)}
.cierre-pilares i{color:${TURQ};font-style:normal;margin:0 18px}
.cierre{position:absolute;left:0;right:0;top:250px;display:flex;flex-direction:column;align-items:center}
.chiplogo.grande{position:relative;padding:22px 30px;border-radius:18px}
.cgreg{font-family:'Inter Display';font-size:120px;font-weight:800;letter-spacing:.08em;margin-top:44px;text-shadow:0 4px 30px rgba(0,0,0,.4)}
.lema{font-size:44px;font-weight:500;color:#fff;margin-top:6px;text-shadow:0 3px 18px rgba(0,0,0,.5)}
#sub{position:absolute;left:50%;transform:translateX(-50%);bottom:54px;max-width:1560px;text-align:center;font-size:38px;line-height:1.3;font-weight:500;color:#fff;background:rgba(4,12,32,.78);padding:12px 28px;border-radius:12px;display:none}

.rotulo-geo{position:absolute;left:96px;bottom:150px;display:flex;align-items:center;gap:16px;font-size:30px;font-weight:800;letter-spacing:.12em;background:rgba(4,16,43,.82);border:1.5px solid rgba(201,162,75,.75);padding:16px 28px;border-radius:14px}
img.demo{position:absolute;inset:0;width:1920px;height:1080px;object-fit:cover}
.banda-demo{position:absolute;left:606px;top:17px;height:40px;display:flex;align-items:center}
.banda-demo > .demo2{position:relative}
.demo2{font-size:16px;font-weight:800;letter-spacing:.07em;color:${ORO};background:rgba(4,16,43,.95);border:1.5px solid rgba(201,162,75,.85);padding:7px 16px;border-radius:30px;white-space:nowrap}
.paso-demo{position:absolute;left:calc(100% + 10px);top:3px;font-size:16px;font-weight:700;color:#fff;background:rgba(19,163,181,.95);padding:7px 16px;border-radius:30px;white-space:nowrap}
.tercio .m5t{font-size:46px}
.tercio .m5s{font-size:22px;line-height:1.3}
.tercio{position:absolute;right:56px;top:300px;max-width:560px;text-align:left;background:rgba(4,16,43,.88);border:1.5px solid rgba(19,163,181,.6);border-radius:18px;padding:24px 32px}
.velo-flujo{position:absolute;left:0;right:0;bottom:0;height:620px;background:linear-gradient(180deg,rgba(4,16,43,0),rgba(4,16,43,.9) 30%,rgba(4,16,43,.97))}
.flujo2{position:absolute;left:96px;right:96px;top:548px;display:flex;align-items:center;justify-content:space-between}
.pendientes{position:absolute;left:50%;transform:translateX(-50%);top:800px;width:1560px;display:flex;align-items:center;gap:14px;font-size:19px;line-height:1.3;color:#F3DFA6;background:rgba(4,16,43,.95);border:1.5px solid rgba(201,162,75,.8);border-radius:12px;padding:10px 20px}
.pendientes b{color:${ORO}}
.velo-cierre2{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,16,43,.05) 0%,rgba(4,16,43,.25) 45%,rgba(4,16,43,.55) 100%)}
.lema2{position:absolute;left:0;right:0;top:400px;text-align:center;font-family:'Inter Display','Inter';font-size:66px;font-weight:700;line-height:1.2;text-shadow:0 4px 30px rgba(0,0,0,.6)}
.negro{position:absolute;inset:0;background:#000}
@keyframes kb7{from{transform:scale(1.03)}to{transform:scale(1.14) translateX(-2%)}}

@keyframes aparecer{from{opacity:0}to{opacity:1}}
@keyframes desaparecer{from{opacity:1}to{opacity:0}}
@keyframes subir{from{opacity:0;transform:translateY(34px)}to{opacity:1;transform:none}}
@keyframes desdeIzq{from{opacity:0;transform:translateX(-50px)}to{opacity:1;transform:none}}
@keyframes desdeDer{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:none}}
@keyframes escalar{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:none}}
@keyframes trazo{to{stroke-dashoffset:0}}
@keyframes oscurecer{from{background:rgba(11,31,69,.25)}to{background:rgba(11,31,69,.82)}}
@keyframes kb1{from{transform:scale(1.04) translate(0,0)}to{transform:scale(1.16) translate(-2%,-1%)}}
@keyframes paneo{from{background-position:0% 50%;transform:scale(1.05)}to{background-position:100% 50%;transform:scale(1.1)}}
@keyframes kb3{from{transform:scale(1.05)}to{transform:scale(1.15) translateX(-2%)}}
@keyframes kb4{from{transform:scale(1.02)}to{transform:scale(1.12) translate(-1%,1%)}}
@keyframes kb5a{from{transform:scale(1.0)}to{transform:scale(1.14) translate(1%,1%)}}
@keyframes kb5b{from{transform:scale(1.12) translate(2%,0)}to{transform:scale(1.22) translate(4%,-2%)}}
@keyframes kb5c{from{transform:scale(1.1) translate(3%,0)}to{transform:scale(1.2) translate(5%,0)}}
@keyframes kb5d{from{transform:scale(1.02) translate(0,0)}to{transform:scale(1.16) translate(-3%,3%)}}
@keyframes kb5e{from{transform:scale(1.04) translate(0,2%)}to{transform:scale(1.18) translate(-2%,4%)}}
@keyframes kb6a{from{transform:scale(1.04)}to{transform:scale(1.14)}}
@keyframes kb6b{from{transform:scale(1.25) translate(-6%,8%)}to{transform:scale(1.32) translate(-7%,9%)}}

`;


const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>CGREG video v2</title><style>${css}</style>
<script src="node_modules/d3/dist/d3.min.js"></script><script src="mapa-datos.js"></script><script src="mapa.js"></script></head>
<body>${s1}${s2}${s3}${s4}${s5}${s6}${s7}<div id="sub"></div>
<script>
const CUES = ${JSON.stringify(lt.cues)}, EDL = ${JSON.stringify(lt.edl)}, CLIPS = ${JSON.stringify(lt.clips)}, FPS = ${lt.fps};
const T1 = ${E[1].inicio}, MAPA = ${lt.mapa_seg}, T5 = ${E[5].inicio}, T6 = ${E[6].inicio}, F6 = ${E[6].fin};
window.DURACION = ${lt.duracion};
const sub = document.getElementById('sub'), cv = document.getElementById('mapa'), demos = [...document.querySelectorAll('img.demo')];
document.getAnimations().forEach((x) => x.pause());
function fotogramaDemo(t) {
  let s = null; for (const x of EDL) if (t >= x.ini) s = x;
  if (!s) s = EDL[0];
  const n = Math.min(s.f1 - 1, s.f0 + Math.floor((t - s.ini) * FPS * (s.vel || 1) + 1e-6));
  return 'grabacion/' + s.clip + '/f' + String(Math.max(s.f0, n)).padStart(5, '0') + '.jpg';
}
window.irA = async (t) => {
  for (const x of document.getAnimations()) { x.pause(); x.currentTime = t * 1000; }
  const c = CUES.find((c) => t >= c.ini && t <= c.fin);
  if (c) { sub.textContent = c.texto; sub.style.display = 'block'; } else sub.style.display = 'none';
  if (t >= T1 && t <= T1 + MAPA + 0.8) dibujarMapa(cv, (t - T1) * 10.8 / MAPA);
  if (t >= T5 - 0.5 && t <= F6 + 0.5) {
    const src = fotogramaDemo(Math.max(T5, t));
    await Promise.all(demos.map((im) => { if (im.getAttribute('src') !== src) { im.src = src; return im.decode().catch(() => {}); } }));
  }
};
</script></body></html>`;
fs.writeFileSync(path.join(__dirname, 'video_v2.html'), html);
console.log('video_v2.html', (html.length / 1024).toFixed(0), 'KB');
