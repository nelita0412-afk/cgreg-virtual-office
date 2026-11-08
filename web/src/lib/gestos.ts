import { useRef, useState } from 'react';

/**
 * Deslizar horizontal con el dedo (o el mouse) sin bloquear el desplazamiento vertical de la página:
 * el gesto solo se «toma» cuando el movimiento es claramente horizontal. Devuelve los manejadores para el
 * elemento y el desplazamiento actual, que se aplica con transform (sin provocar reflujo de diseño).
 */
export function useDeslizarHorizontal({ alSiguiente, alAnterior, umbral = 56 }: { alSiguiente: () => void; alAnterior: () => void; umbral?: number }) {
  const g = useRef<{ x0: number; y0: number; t0: number; id: number; eje: 'x' | 'y' | null } | null>(null);
  const [dx, setDx] = useState(0);
  const deslizo = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    deslizo.current = false;
    g.current = { x0: e.clientX, y0: e.clientY, t0: performance.now(), id: e.pointerId, eje: null };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x0;
    const my = e.clientY - s.y0;
    if (!s.eje && Math.hypot(mx, my) > 10) {
      s.eje = Math.abs(mx) > Math.abs(my) * 1.2 ? 'x' : 'y';
      if (s.eje === 'x') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (s.eje === 'x') setDx(mx);
  };
  const terminar = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    g.current = null;
    if (s.eje !== 'x') return;
    deslizo.current = true;
    const mx = e.clientX - s.x0;
    const velocidad = Math.abs(mx) / Math.max(1, performance.now() - s.t0);
    setDx(0);
    if (Math.abs(mx) > umbral || (Math.abs(mx) > 20 && velocidad > 0.45)) (mx < 0 ? alSiguiente : alAnterior)();
  };
  /** Evita que un toque que terminó en deslizamiento abra la cita que estaba debajo del dedo. */
  const onClickCapture = (e: React.MouseEvent) => {
    if (deslizo.current) {
      e.stopPropagation();
      deslizo.current = false;
    }
  };

  return { dx, arrastrando: dx !== 0, handlers: { onPointerDown, onPointerMove, onPointerUp: terminar, onPointerCancel: terminar, onClickCapture } };
}
