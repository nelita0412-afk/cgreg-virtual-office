import { useState } from 'react';

/** Gráficos SVG livianos. Colores validados para el fondo azul marino (paleta categórica oscura). */
export const SERIES = ['#78958A', '#C5A989', '#4D665C', '#B08F6C', '#9A7FA8', '#5E9C76', '#C27D62', '#7A8C83'];
export const STATUS = { good: '#3F8F5F', warning: '#B7791F', serious: '#C0612B', critical: '#B4423A' };

interface Tip {
  x: number;
  y: number;
  text: string;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-pre rounded-lg border border-white/15 bg-slate-950/95 px-2 py-1 text-xs text-white shadow-xl" style={{ left: tip.x, top: tip.y - 8 }}>
      {tip.text}
    </div>
  );
}

/** Columnas verticales (una serie) — evolución diaria. */
export function Columnas({ datos, etiqueta, color = SERIES[0], alto = 180 }: { datos: { x: string; y: number; detalle?: string }[]; etiqueta: string; color?: string; alto?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const max = Math.max(1, ...datos.map((d) => d.y));
  const W = 600;
  const pad = { l: 28, r: 8, t: 10, b: 22 };
  const bw = (W - pad.l - pad.r) / Math.max(1, datos.length);
  const h = alto - pad.t - pad.b;
  const ticks = [...new Set([0, Math.ceil(max / 2), max])];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${alto}`} className="w-full" role="img" aria-label={etiqueta} onMouseLeave={() => setTip(null)}>
        {ticks.map((t) => {
          const y = pad.t + h - (t / max) * h;
          return (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="rgba(52,72,63,.10)" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{t}</text>
            </g>
          );
        })}
        {datos.map((d, i) => {
          const bh = (d.y / max) * h;
          const x = pad.l + i * bw + 2;
          return (
            <g key={d.x}>
              <rect
                x={x - 1}
                y={pad.t}
                width={bw}
                height={h}
                fill="transparent"
                onMouseMove={(e) => {
                  const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setTip({ x: ((x + bw / 2) / W) * r.width, y: ((pad.t + h - bh) / alto) * r.height, text: `${d.x}: ${d.y}${d.detalle ? '\n' + d.detalle : ''}` });
                }}
              />
              {d.y > 0 && <path d={roundTop(x, pad.t + h - bh, Math.max(2, bw - 4), bh)} fill={color} pointerEvents="none" />}
              {(i % Math.ceil(datos.length / 7) === 0 || i === datos.length - 1) && (
                <text x={x + bw / 2 - 2} y={alto - 6} textAnchor="middle" className="fill-slate-400 text-[10px]">{d.x}</text>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function roundTop(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** Barras horizontales (una serie) con etiquetas directas. */
export function Barras({ datos, color = SERIES[0], sufijo = '' }: { datos: { label: string; valor: number; detalle?: string }[]; color?: string; sufijo?: string }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  if (!datos.length) return <div className="py-4 text-sm faint">Sin registros.</div>;
  return (
    <ul className="space-y-2" role="list">
      {datos.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-2 text-sm" title={d.detalle ? `${d.label}: ${d.valor}${sufijo}\n${d.detalle}` : undefined}>
          <span className="truncate muted">{d.label}</span>
          <span className="h-3 overflow-hidden rounded-r bg-white/5">
            <span className="block h-full rounded-r" style={{ width: `${(d.valor / max) * 100}%`, background: color, minWidth: d.valor ? 4 : 0 }} />
          </span>
          <span className="w-10 text-right tabular-nums">{d.valor}{sufijo}</span>
        </li>
      ))}
    </ul>
  );
}

/** Barras apiladas por estado (resuelta/parcial/pendiente) con leyenda. */
export function Apiladas({ filas, segmentos }: { filas: { label: string; valores: Record<string, number> }[]; segmentos: { key: string; label: string; color: string }[] }) {
  const max = Math.max(1, ...filas.map((f) => segmentos.reduce((a, s) => a + (f.valores[s.key] ?? 0), 0)));
  if (!filas.length) return <div className="py-4 text-sm faint">Sin registros.</div>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3 text-xs muted">
        {segmentos.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <ul className="space-y-2">
        {filas.map((f) => {
          const total = segmentos.reduce((a, s) => a + (f.valores[s.key] ?? 0), 0);
          return (
            <li key={f.label} className="grid grid-cols-[minmax(90px,130px)_1fr_auto] items-center gap-2 text-sm">
              <span className="truncate muted">{f.label}</span>
              <span className="flex h-3 gap-[2px]" style={{ width: `${(total / max) * 100}%` }}>
                {segmentos.map((s) =>
                  f.valores[s.key] ? (
                    <span key={s.key} className="h-full first:rounded-l last:rounded-r" style={{ flex: f.valores[s.key], background: s.color }} title={`${s.label}: ${f.valores[s.key]}`} />
                  ) : null,
                )}
              </span>
              <span className="w-8 text-right tabular-nums">{total}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Progreso({ valor, etiqueta, color = SERIES[0] }: { valor: number | null; etiqueta: string; color?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm muted">{etiqueta}</span>
        <span className="text-2xl font-semibold tabular-nums">{valor == null ? '—' : `${valor}%`}</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuenow={valor ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={etiqueta}>
        <div className="h-full rounded-full" style={{ width: `${valor ?? 0}%`, background: color }} />
      </div>
    </div>
  );
}
