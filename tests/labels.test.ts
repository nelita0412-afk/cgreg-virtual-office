import { describe, it, expect } from 'vitest';
import { ubicarEtiquetas, type Anclaje } from '../web/src/office/labels';

const persona = (id: string, x: number, y: number, extra: Partial<Anclaje> = {}): Anclaje => ({
  id, tipo: 'persona', x, y, completo: `Profesional ${id}`, detalle: 'Disponible', corto: id.toUpperCase(), prioridad: 10, visible: true, ...extra,
});
const solapan = (a: any, b: any) => a.lx - a.w / 2 < b.lx + b.w / 2 && a.lx + a.w / 2 > b.lx - b.w / 2 && a.ly - a.h / 2 < b.ly + b.h / 2 && a.ly + a.h / 2 > b.ly - b.h / 2;

describe('Etiquetas inteligentes de la oficina', () => {
  it('nunca superpone etiquetas aunque los avatares estén muy juntos', () => {
    const anclas = Array.from({ length: 8 }, (_, i) => persona('p' + i, 400 + i * 30, 300));
    const r = ubicarEtiquetas(anclas, 1200, 700, 1.5, null).filter((e) => e.modo !== 'oculto');
    expect(r.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) expect(solapan(r[i], r[j]), `${r[i].id}/${r[j].id}`).toBe(false);
  });
  it('el seleccionado se muestra siempre completo y queda dentro del lienzo', () => {
    const anclas = [persona('a', 5, 5), ...Array.from({ length: 6 }, (_, i) => persona('b' + i, 20 + i * 10, 60))];
    const r = ubicarEtiquetas(anclas, 800, 500, 0.6, 'b3');
    const sel = r.find((e) => e.id === 'b3')!;
    expect(sel.modo).toBe('completo');
    expect(sel.lx - sel.w / 2).toBeGreaterThanOrEqual(0);
    expect(sel.ly - sel.h / 2).toBeGreaterThanOrEqual(0);
  });
  it('con zoom bajo usa identificadores breves', () => {
    const r = ubicarEtiquetas([persona('go', 300, 300)], 800, 600, 0.7, null);
    expect(r[0].modo).toBe('corto');
  });
  it('no dibuja anclajes fuera de cámara', () => {
    expect(ubicarEtiquetas([persona('x', 300, 300, { visible: false })], 800, 600, 1.5, null)[0].modo).toBe('oculto');
  });
});
