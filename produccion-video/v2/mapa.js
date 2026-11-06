// Mapa animado Ecuador → Galápagos → Santa Cruz (Puerto Ayora). Requiere d3 (v7) y window.MAPA (mapa-datos.js).
// dibujarMapa(canvas, t): t = segundos locales de la secuencia (0 → ~10,6).
(function () {
  const M = window.MAPA;
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const fade = (t, a, b, c, d) => (t < a ? 0 : t < b ? (t - a) / (b - a) : t < c ? 1 : t < d ? 1 - (t - c) / (d - c) : 0);
  // Cuadros clave de cámara: [t, lon, lat, escala]
  const K = [
    [0.0, -78.5, -3.0, 820],
    [2.4, -79.6, -1.8, 1050],
    [5.0, -85.6, -1.2, 1500],
    [7.5, -90.55, -0.62, 21000],
    [10.0, -90.33, -0.67, 96000],
    [99, -90.33, -0.67, 99000],
  ];
  function camara(t) {
    let i = 0;
    while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const [t0, x0, y0, s0] = K[i], [t1, x1, y1, s1] = K[i + 1];
    const k = ease(clamp((t - t0) / (t1 - t0)));
    // En los acercamientos grandes el centro converge antes que la escala (vuelo natural)
    const kc = ease(clamp((t - t0) / ((t1 - t0) * 0.8)));
    return [x0 + (x1 - x0) * kc, y0 + (y1 - y0) * kc, Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * k)];
  }
  const ORIGEN = [-79.9, -2.2]; // costa del Ecuador continental (golfo de Guayaquil), referencia visual de la ruta
  const arco = d3.geoInterpolate(ORIGEN, [-90.35, -0.63]);
  const centroEcu = d3.geoCentroid(M.ecuador_continental);
  const islas = Object.values(M.islas).map((f) => ({ f, c: d3.geoCentroid(f), n: f.properties.nombre }));
  const sc = M.islas['Santa Cruz'];

  window.dibujarMapa = function (cv, t) {
    const W = cv.width, H = cv.height, g = cv.getContext('2d');
    const [lon, lat, s] = camara(t);
    const pr = d3.geoOrthographic().rotate([-lon, -lat]).scale(s).translate([W / 2, H / 2]).clipAngle(90).precision(s > 15000 ? 0.1 : 0.6);
    const path = d3.geoPath(pr, g);
    // Océano
    const gr = g.createRadialGradient(W * 0.45, H * 0.45, 50, W / 2, H / 2, W * 0.75);
    gr.addColorStop(0, '#123A72'); gr.addColorStop(1, '#06173A');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // Retícula
    const paso = s > 30000 ? 0.25 : s > 8000 ? 1 : 5;
    g.beginPath(); path(d3.geoGraticule().step([paso, paso])()); g.strokeStyle = 'rgba(160,200,255,0.10)'; g.lineWidth = 1; g.stroke();
    // Otros países
    g.beginPath(); path(M.paises); g.fillStyle = '#17325F'; g.fill(); g.strokeStyle = 'rgba(120,160,220,0.45)'; g.lineWidth = 1; g.stroke();
    // Ecuador continental
    const brillo = fade(t, 0.6, 1.6, 6.0, 7.2);
    g.save(); g.shadowColor = 'rgba(19,163,181,0.9)'; g.shadowBlur = 24 * brillo;
    g.beginPath(); path(M.ecuador_continental); g.fillStyle = `rgba(19,163,181,${0.25 + 0.35 * brillo})`; g.fill();
    g.strokeStyle = `rgba(120,225,236,${0.6 + 0.4 * brillo})`; g.lineWidth = 1.6; g.stroke(); g.restore();
    // Galápagos (contorno suavizado en acercamientos; los datos tienen resolución de 1 km)
    const oro = clamp((t - 7.3) / 1.3);
    for (const f of M.galapagos.features) {
      g.beginPath();
      if (s > 15000) {
        for (const ring of f.geometry.coordinates) {
          const pts = ring.map((c) => pr(c)).filter(Boolean);
          d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5)).context(g)(pts.slice(0, -1));
        }
      } else path(f);
      const esSC = f.geometry.coordinates[0].length === sc.geometry.coordinates[0].length && f.geometry.coordinates[0][0][0] === sc.geometry.coordinates[0][0][0];
      if (esSC && oro > 0) {
        g.save(); g.shadowColor = 'rgba(201,162,75,0.9)'; g.shadowBlur = 30 * oro;
        g.fillStyle = `rgba(${19 + (201 - 19) * oro},${163 + (162 - 163) * oro},${181 + (75 - 181) * oro},0.85)`; g.fill(); g.restore();
        g.strokeStyle = '#F3DFA6'; g.lineWidth = 2; g.stroke();
      } else {
        g.fillStyle = 'rgba(19,163,181,0.6)'; g.fill(); g.strokeStyle = 'rgba(140,230,240,0.9)'; g.lineWidth = 1.3; g.stroke();
      }
    }
    // Ruta continente → archipiélago
    const kr = clamp((t - 2.6) / 2.0);
    if (kr > 0 && t < 8.2) {
      g.save(); g.globalAlpha = fade(t, 2.6, 2.9, 7.0, 8.2);
      g.beginPath(); const n = 60;
      for (let i = 0; i <= n * kr; i++) { const p = pr(arco(i / n)); if (p) (i ? g.lineTo(...p) : g.moveTo(...p)); }
      g.setLineDash([10, 9]); g.strokeStyle = '#C9A24B'; g.lineWidth = 3; g.stroke(); g.restore();
    }
    // Rótulos
    const texto = (txt, p, size, color, alpha, opt = {}) => {
      if (!p || alpha <= 0) return;
      g.save(); g.globalAlpha = alpha; g.font = `${opt.peso || 700} ${size}px Inter, sans-serif`; g.textAlign = opt.align || 'center';
      if (opt.esp) g.letterSpacing = opt.esp;
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 10; g.fillStyle = color; g.fillText(txt, p[0], p[1]); g.restore();
    };
    texto('ECUADOR', pr([centroEcu[0] + 0.3, centroEcu[1]]), 46, '#FFFFFF', fade(t, 1.0, 1.8, 5.6, 6.6), { esp: '8px', peso: 800 });
    texto('Ecuador continental', pr([centroEcu[0] + 0.3, centroEcu[1] - 0.9]), 24, '#BFE9EF', fade(t, 3.8, 4.4, 5.6, 6.6), { peso: 500 });
    texto('OCÉANO PACÍFICO', pr([-89.5, -8.5]), 30, 'rgba(190,215,250,0.75)', fade(t, 1.2, 2.2, 6.0, 7.0), { esp: '10px', peso: 500 });
    texto('ISLAS GALÁPAGOS', pr([-90.6, 0.9]), 36, '#FFFFFF', fade(t, 4.0, 4.8, 7.0, 7.8), { esp: '6px', peso: 800 });
    for (const { c, n } of islas) {
      if (n === 'Santa Cruz') continue;
      texto(n, pr(c), 24, '#D9F3F7', fade(t, 6.6, 7.4, 8.6, 9.3), { peso: 600 });
    }
    // Santa Cruz y Puerto Ayora
    const csc = d3.geoCentroid(sc);
    const pSC = pr([csc[0], csc[1] + (s > 50000 ? 0.2 : 0.0)]);
    texto(s > 50000 ? 'ISLA SANTA CRUZ' : 'Santa Cruz', pSC, s > 50000 ? 40 : 30, '#F3DFA6', fade(t, 6.9, 7.6, 99, 100), { peso: 800, esp: s > 50000 ? '4px' : '0px' });
    const kpa = fade(t, 8.9, 9.5, 99, 100);
    const pa = pr(M.puerto_ayora);
    if (kpa > 0 && pa) {
      const pulso = (t * 0.9) % 1;
      g.save(); g.globalAlpha = kpa;
      g.beginPath(); g.arc(pa[0], pa[1], 14 + 46 * pulso, 0, Math.PI * 2); g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - pulso)})`; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.arc(pa[0], pa[1], 11, 0, Math.PI * 2); g.fillStyle = '#FFFFFF'; g.fill();
      g.beginPath(); g.arc(pa[0], pa[1], 6, 0, Math.PI * 2); g.fillStyle = '#0B1F45'; g.fill();
      g.restore();
      texto('Puerto Ayora', [pa[0] + 26, pa[1] + 10], 34, '#FFFFFF', kpa, { align: 'left', peso: 700 });
    }
  };
})();
