import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Hoja inferior para teléfonos: sube desde abajo (curva de cajón iOS, 300 ms), se cierra con la X, con Escape,
 * tocando el fondo o arrastrándola hacia abajo. Al cerrarse devuelve el foco al control que la abrió.
 */
export function HojaInferior({ abierta, onCerrar, titulo, children }: { abierta: boolean; onCerrar: () => void; titulo: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const origen = useRef<Element | null>(null);
  const arrastre = useRef<{ y0: number; t0: number; id: number } | null>(null);
  const [dy, setDy] = useState(0);

  useEffect(() => {
    if (!abierta) return;
    origen.current = document.activeElement;
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('keydown', esc);
      (origen.current as HTMLElement | null)?.focus?.();
    };
  }, [abierta, onCerrar]);

  useEffect(() => setDy(0), [abierta]);

  const empezar = (e: React.PointerEvent) => {
    arrastre.current = { y0: e.clientY, t0: performance.now(), id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const mover = (e: React.PointerEvent) => {
    if (arrastre.current?.id !== e.pointerId) return;
    setDy(Math.max(0, e.clientY - arrastre.current.y0));
  };
  const soltar = (e: React.PointerEvent) => {
    const a = arrastre.current;
    if (a?.id !== e.pointerId) return;
    arrastre.current = null;
    const d = Math.max(0, e.clientY - a.y0);
    const velocidad = d / Math.max(1, performance.now() - a.t0);
    if (d > 110 || (d > 24 && velocidad > 0.5)) onCerrar();
    else setDy(0);
  };
  const arrastrando = !!arrastre.current;

  return createPortal(
    <div className={`fixed inset-0 z-50 transition-[visibility] duration-0 ${abierta ? 'visible' : 'pointer-events-none invisible delay-300'}`} aria-hidden={!abierta}>
      <div
        className={`absolute inset-0 bg-profundo-950/35 transition-opacity duration-200 ${abierta ? 'opacity-100' : 'opacity-0'}`}
        style={abierta && dy ? { opacity: Math.max(0.2, 1 - dy / 400) } : undefined}
        onClick={onCerrar}
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] max-w-xl flex-col rounded-t-3xl border-t shadow-suave outline-none ${arrastrando ? '' : 'transition-transform duration-300 ease-cajon'}`}
        style={{
          // Abierta y quieta queda sin transform: así los diálogos fijos que abra su contenido se ubican respecto a la pantalla.
          transform: abierta ? (dy ? `translateY(${dy}px)` : 'none') : 'translateY(100%)',
          borderColor: 'var(--line)',
          background: 'var(--panel-solid)',
        }}
      >
        <div className="relative shrink-0 cursor-grab touch-none select-none px-5 pb-2 pt-3" onPointerDown={empezar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}>
          <span className="mx-auto block h-1.5 w-10 rounded-full bg-profundo-300" aria-hidden />
          <div className="mt-3 pr-12 text-[17px] font-semibold text-profundo-900">{titulo}</div>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onCerrar}
            className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full transition-transform duration-150 hover:bg-white/5 active:scale-[0.94]"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5" style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
