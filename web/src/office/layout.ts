import type { PresenciaSnapshot, Zona } from '@shared/domain';

export type V2 = [number, number]; // [x, z]
export interface Slot {
  pos: V2;
  rot: number; // rotación en Y (0 = mirando hacia +z, hacia la cámara)
}

export interface RoomDef {
  id: string;
  nombre: string;
  sub?: string;
  center: V2;
  size: V2;
  color: string;
  ruta?: string;
  vista: { target: V2; zoom: number };
}

/** Distribución de la oficina (unidades de mundo). */
export const ROOMS: RoomDef[] = [
  { id: 'debriefing', nombre: 'Sala de Debriefing', center: [-14, -10.5], size: [14, 9], color: '#38bdf8', ruta: '/debriefing', vista: { target: [-14, -10], zoom: 2.1 } },
  { id: 'capacitacion', nombre: 'Centro de Capacitación DECE', center: [2.5, -10.5], size: [15, 9], color: '#22d3ee', ruta: '/capacitacion', vista: { target: [2.5, -10], zoom: 2.0 } },
  { id: 'psiquiatria', nombre: 'Psiquiatría', sub: 'Derivación', center: [18, -10.5], size: [10, 9], color: '#a855f7', ruta: '/derivaciones', vista: { target: [18, -10], zoom: 2.3 } },
  { id: 'consultorios', nombre: 'Consultorios de Psicología', center: [-16, 1.5], size: [14.5, 10.5], color: '#60a5fa', ruta: '/atenciones', vista: { target: [-16, 1.5], zoom: 2.0 } },
  { id: 'telemedicina', nombre: 'Telemedicina', center: [18, 1.5], size: [10, 9], color: '#10b981', ruta: '/atenciones', vista: { target: [18, 1.5], zoom: 2.3 } },
];

export const ZONES_ABIERTAS = {
  coordinacion: { nombre: 'Coordinación CGREG', center: [0, 1] as V2, ruta: '/comando', vista: { target: [0, 1] as V2, zoom: 2.4 } },
  territorial: { nombre: 'Articulación Territorial', center: [8.5, 1.5] as V2, ruta: '/territorio', vista: { target: [8.5, 1.5] as V2, zoom: 2.6 } },
  psicologia: { nombre: 'Psicología Clínica', center: [0, 11] as V2, ruta: '/equipo', vista: { target: [0, 10] as V2, zoom: 1.6 } },
  descanso: { nombre: 'Zona de pausa', center: [21, 12] as V2 },
};

export const ESTACIONES_PSI: Record<string, V2> = {
  'psi-1': [-15, 11],
  'psi-2': [-9, 11],
  'psi-3': [-3, 11],
  'psi-4': [3, 11],
  'psi-5': [9, 11],
  'psi-6': [15, 11],
};

/** Cabinas de consulta individual (una por psicólogo). */
export const CABINAS: V2[] = [
  [-20.5, -1.2],
  [-16, -1.2],
  [-11.5, -1.2],
  [-20.5, 4.2],
  [-16, 4.2],
  [-11.5, 4.2],
];

export const ENTRADA: V2 = [0, 17.5];
const CORREDORES = [-5, 7.6];
const ESPINA_X = 4.6;

function asientoEn(centro: V2, i: number, rx: number, rz: number, desfase = 0): Slot {
  const a = desfase + (i * Math.PI * 2) / 8;
  const pos: V2 = [centro[0] + Math.cos(a) * rx, centro[1] + Math.sin(a) * rz];
  return { pos, rot: Math.atan2(centro[0] - pos[0], centro[1] - pos[1]) };
}

/** Posición de destino de un avatar según su zona real y estación. */
export function slotPara(p: PresenciaSnapshot, zona: Zona, indiceEnZona: number): Slot | null {
  const est = p.estacion ?? '';
  const idxPsi = est.startsWith('psi-') ? Number(est.slice(4)) - 1 : indiceEnZona % 6;
  switch (zona) {
    case 'fuera':
      return null;
    case 'estacion':
      if (ESTACIONES_PSI[est]) return { pos: [ESTACIONES_PSI[est][0], 10.1], rot: 0 };
      if (est === 'tele') return { pos: [15.6, 3.6], rot: 0 };
      if (est === 'psiq') return { pos: [15, -9.4], rot: 0 };
      if (est === 'terr') return { pos: [8.5, 0.4], rot: 0 };
      return { pos: [0, 0.3], rot: 0 };
    case 'consultorio_psicologia': {
      const c = CABINAS[idxPsi] ?? CABINAS[0];
      return { pos: [c[0], c[1] - 0.5], rot: 0 };
    }
    case 'telemedicina':
      return { pos: [20.2, 0.2], rot: Math.PI / 2 };
    case 'psiquiatria':
      return { pos: [19.5, -11.2], rot: Math.PI / 2 };
    case 'debriefing':
      return asientoEn([-14, -10.5], indiceEnZona, 3.4, 2.1, Math.PI / 2);
    case 'capacitacion':
      return indiceEnZona === 0 ? { pos: [2.5, -13.3], rot: 0 } : { pos: [-1 + (indiceEnZona % 4) * 2.3, -9 + Math.floor(indiceEnZona / 4) * 2], rot: Math.PI };
    case 'coordinacion':
      return { pos: [0, 0.3], rot: 0 };
    case 'territorial':
      return { pos: [8.5, 0.4], rot: 0 };
    case 'descanso':
      return { pos: [20 + (indiceEnZona % 3) * 1.3, 11.6 + Math.floor(indiceEnZona / 3)], rot: -Math.PI / 4 };
  }
  return null;
}

const corredorCercano = (z: number) => CORREDORES.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));

/** Ruta por pasillos (evita atravesar salas en diagonal). */
export function ruta(desde: V2, hasta: V2): V2[] {
  const z0 = corredorCercano(desde[1]);
  const z1 = corredorCercano(hasta[1]);
  const pts: V2[] = [[desde[0], z0]];
  if (z0 !== z1) {
    pts.push([ESPINA_X, z0], [ESPINA_X, z1]);
  }
  pts.push([hasta[0], z1], hasta);
  // eliminar puntos redundantes
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.05);
}
