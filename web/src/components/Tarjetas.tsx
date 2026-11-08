import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/** Lista táctil para teléfono: reemplaza a las tablas anchas por debajo de 768 px (las tablas siguen en escritorio). */
export function Tarjetas({ children }: { children: ReactNode }) {
  return <ul className="-mx-1 flex flex-col gap-2 md:hidden">{children}</ul>;
}

export function Tarjeta({ to, titulo, detalle, insignias, pie }: { to?: string; titulo: ReactNode; detalle?: ReactNode; insignias?: ReactNode; pie?: ReactNode }) {
  const cuerpo = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="line-clamp-2 text-[15px] font-medium leading-snug text-slate-100">{titulo}</span>
        {detalle && <span className="text-xs leading-snug muted">{detalle}</span>}
        {insignias && <span className="flex flex-wrap gap-1.5">{insignias}</span>}
      </span>
      {to && <ChevronRight size={18} className="mt-0.5 shrink-0 faint" aria-hidden />}
    </>
  );
  const cls = 'flex min-h-16 items-start gap-3 rounded-2xl border px-4 py-3 transition-colors duration-150';
  const st = { borderColor: 'var(--line)', background: 'var(--panel)' };
  return (
    <li>
      {to ? <Link to={to} className={`${cls} hover:bg-white/[0.04] active:bg-white/[0.07]`} style={st}>{cuerpo}</Link> : <div className={cls} style={st}>{cuerpo}</div>}
      {pie && <div className="px-4 pt-2">{pie}</div>}
    </li>
  );
}
