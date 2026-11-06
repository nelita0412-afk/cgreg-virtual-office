/**
 * Etiquetas inteligentes de la oficina virtual.
 * La escena 3D proyecta los anclajes (cabeza del avatar, letrero de la sala) a coordenadas de pantalla;
 * esta función reparte las etiquetas sin superposición, con línea de referencia al anclaje y modo
 * abreviado cuando falta espacio o el zoom es bajo. Es una función pura (probada en tests/labels.test.ts).
 */

export interface Anclaje {
  id: string;
  tipo: 'persona' | 'sala';
  x: number; // px en el contenedor
  y: number;
  completo: string; // texto principal (nombre)
  detalle?: string; // segunda línea (estado)
  corto: string; // identificador breve (iniciales)
  color?: string; // color del estado o de la sala
  prioridad: number; // mayor = se ubica primero
  atenuado?: boolean; // p. ej. profesional desconectado (anclado en su estación)
  visible: boolean; // anclaje delante de la cámara y dentro del lienzo
}

export interface EtiquetaUbicada extends Anclaje {
  modo: 'completo' | 'corto' | 'oculto';
  lx: number; // centro de la etiqueta
  ly: number;
  w: number;
  h: number;
}

const ANCHO_CAR = 6.6;
export function medir(a: Anclaje, modo: 'completo' | 'corto') {
  if (modo === 'corto') return { w: Math.max(30, a.corto.length * 8 + 22), h: 22 };
  if (a.tipo === 'sala') return { w: Math.min(260, a.completo.length * 7.2 + 26), h: 26 };
  const w = Math.min(190, Math.max(a.completo.length, (a.detalle ?? '').length * 0.86) * ANCHO_CAR + 30);
  return { w, h: a.detalle ? 36 : 24 };
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const choca = (a: Rect, b: Rect, m = 4) => a.x0 < b.x1 + m && a.x1 + m > b.x0 && a.y0 < b.y1 + m && a.y1 + m > b.y0;

/**
 * @param zoomRel zoom relativo al encuadre general (1 = vista general)
 * @param seleccionado id que siempre se muestra completo y primero
 */
export function ubicarEtiquetas(anclajes: Anclaje[], ancho: number, alto: number, zoomRel: number, seleccionado: string | null, lim: { top?: number; right?: number; bottom?: number } = {}): EtiquetaUbicada[] {
  const T = lim.top ?? 0;
  const RR = ancho - (lim.right ?? 0);
  const B = alto - (lim.bottom ?? 0);
  const ocupados: Rect[] = [];
  // Los propios anclajes (cabezas) se reservan para que ninguna etiqueta tape a otro avatar.
  for (const a of anclajes) if (a.visible && a.tipo === 'persona') ocupados.push({ x0: a.x - 9, y0: a.y - 6, x1: a.x + 9, y1: a.y + 30 });
  const orden = [...anclajes].sort((a, b) => {
    const pa = a.id === seleccionado ? 1000 : a.prioridad;
    const pb = b.id === seleccionado ? 1000 : b.prioridad;
    return pb - pa || a.y - b.y;
  });
  const fuera: EtiquetaUbicada[] = [];
  for (const a of orden) {
    if (!a.visible || a.x > RR || a.y < T || a.y > B) {
      fuera.push({ ...a, modo: 'oculto', lx: a.x, ly: a.y, w: 0, h: 0 });
      continue;
    }
    // Con zoom bajo (vista general = 1), solo el seleccionado y las salas se muestran completos;
    // al acercarse (≥ 1.2) cada persona muestra nombre y estado.
    const preferido: ('completo' | 'corto')[] = a.id === seleccionado || a.tipo === 'sala' || zoomRel >= 1.2 ? ['completo', 'corto'] : ['corto'];
    let ubicada: EtiquetaUbicada | null = null;
    for (const modo of preferido) {
      const { w, h } = medir(a, modo);
      const dy = a.tipo === 'sala' ? 0 : -(h / 2 + 18);
      const candidatos: [number, number][] =
        a.tipo === 'sala'
          ? [[0, 0], [0, -30], [0, 30], [-w / 2 - 10, 0], [w / 2 + 10, 0]]
          : [
              [0, dy],
              [0, dy - 26],
              [-(w / 2 + 16), dy + 6],
              [w / 2 + 16, dy + 6],
              [0, dy - 52],
              [-(w / 2 + 16), dy - 22],
              [w / 2 + 16, dy - 22],
              [0, dy - 78],
              [-(w + 20), dy - 40],
              [w + 20, dy - 40],
            ];
      for (const [ox, oy] of candidatos) {
        const lx = a.x + ox;
        const ly = a.y + oy;
        const r = { x0: lx - w / 2, y0: ly - h / 2, x1: lx + w / 2, y1: ly + h / 2 };
        if (r.x0 < 2 || r.y0 < T + 2 || r.x1 > RR - 2 || r.y1 > B - 2) continue;
        if (ocupados.some((o) => choca(o, r))) continue;
        ocupados.push(r);
        ubicada = { ...a, modo, lx, ly, w, h };
        break;
      }
      if (ubicada) break;
    }
    fuera.push(ubicada ?? { ...a, modo: 'oculto', lx: a.x, ly: a.y, w: 0, h: 0 });
  }
  return fuera;
}

/* --------- Almacén mínimo: la escena publica anclajes sin re-renderizar el árbol 3D --------- */
type Estado = { anclajes: Anclaje[]; ancho: number; alto: number; zoomRel: number };
let actual: Estado = { anclajes: [], ancho: 0, alto: 0, zoomRel: 1 };
const subs = new Set<() => void>();
export const etiquetasStore = {
  get: () => actual,
  set: (e: Estado) => {
    actual = e;
    subs.forEach((f) => f());
  },
  subscribe: (f: () => void) => {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};
