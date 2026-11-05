import { useEffect, useState, type ReactNode } from 'react';
import { X, Loader2, Inbox } from 'lucide-react';
import { ESTADO_PRESENCIA_COLOR, ESTADO_PRESENCIA_LABEL, type EstadoPresencia } from '@shared/domain';
import { ApiError } from '../lib/api';

export function Card({ title, actions, children, className = '', icon }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <section className={`panel p-4 ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="panel-title flex items-center gap-2">
            {icon}
            {title}
          </h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONOS = {
  neutral: 'bg-slate-500/15 text-slate-200 ring-1 ring-slate-400/20',
  info: 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/25',
  good: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/25',
  warning: 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/25',
  serious: 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/25',
  critical: 'bg-red-500/15 text-red-200 ring-1 ring-red-400/30',
  violet: 'bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/25',
} as const;
export type Tono = keyof typeof TONOS;
export function Badge({ tono = 'neutral', children, className = '' }: { tono?: Tono; children: ReactNode; className?: string }) {
  return <span className={`chip ${TONOS[tono]} ${className}`}>{children}</span>;
}

export function EstadoPill({ estado, size = 'md' }: { estado: EstadoPresencia; size?: 'sm' | 'md' }) {
  return (
    <span className={`chip bg-white/5 ring-1 ring-white/10 ${size === 'sm' ? 'text-[11px]' : ''}`}>
      <span className="h-2 w-2 rounded-full" style={{ background: ESTADO_PRESENCIA_COLOR[estado] }} aria-hidden />
      {ESTADO_PRESENCIA_LABEL[estado]}
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 pt-10 backdrop-blur-sm sm:p-6 sm:pt-16" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`panel w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} p-5`} style={{ background: 'var(--panel-solid)' }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] faint">{hint}</span>}
    </label>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm muted" role="status">
      <Loader2 className="animate-spin" size={16} /> {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center text-sm faint" style={{ borderColor: 'var(--line)' }}>
      <Inbox size={20} />
      {children}
    </div>
  );
}

export function ErrorMsg({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : (error as Error)?.message ?? 'Error';
  return <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">{msg}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--line)' }} role="tablist">
      {items.map((i) => (
        <button key={i.value} role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)} className={`rounded-lg px-3 py-1.5 text-sm transition ${value === i.value ? 'bg-sky-600/40 text-white' : 'muted hover:bg-white/5'}`}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-xs muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] faint">{hint}</div>}
    </div>
  );
}

/** Hook mínimo para formularios con envío asíncrono y error. */
export function useSubmit<T>(fn: (v: T) => Promise<unknown>, onOk?: (r: any) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (v: T) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn(v);
      onOk?.(r);
      return r;
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function Avatar({ nombre, color, size = 40 }: { nombre: string; color?: string | null; size?: number }) {
  // Iniciales: palabras con mayúscula (omite «Dr.», «de», «los» y finales como «C.»).
  const ini = nombre
    .replace(/^(Dr\.|Dra\.)\s*/i, '')
    .split(/\s+/)
    .filter((w) => /^\p{Lu}/u.test(w) && !/^\p{Lu}\.$/u.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <div className="grid shrink-0 place-items-center rounded-full bg-navy-700 font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.36, boxShadow: `inset 0 0 0 ${Math.max(2, size / 16)}px ${color ?? '#1a4296'}` }} aria-hidden>
      {ini}
    </div>
  );
}
