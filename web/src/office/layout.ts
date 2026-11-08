import type { PresenciaSnapshot, Zona } from '@shared/domain';

export type V2 = [number, number]; // [x, z] en metros
/** Postura que adopta el avatar al llegar a su destino (siempre derivada del estado real). */
export type Pose = 'sentado_trabajo' | 'sentado_teclear' | 'sentado_conversar' | 'sentado_relajado' | 'de_pie_presentar' | 'de_pie';
export interface Slot {
  pos: V2;
  rot: number; // rotación en Y (0 = mirando hacia +z, hacia la cámara)
  pose: Pose;
  puerta?: V2; // acceso al espacio (las rutas entran por aquí, no atraviesan paredes)
}

export interface RoomDef {
  id: string;
  nombre: string;
  sub?: string;
  center: V2;
  size: V2;
  color: string;
  suelo: string;
  ruta?: string;
  descripcion: string;
  vista: { target: V2; zoom: number };
}

/** Planta de 64 × 40 m. Fila posterior: salas; central: consultorios, coordinación, telemedicina; frontal: Psicología. */
export const PISO = { w: 64, d: 40 };

export const ROOMS: RoomDef[] = [
  { id: 'debriefing', nombre: 'Sala de Debriefing', center: [-19, -13.5], size: [18, 12], color: '#B08F6C', suelo: '#c9b79c', ruta: '/debriefing', descripcion: 'Acompañamiento emocional a profesionales desplegados en territorio.', vista: { target: [-19, -12.5], zoom: 2.6 } },
  { id: 'capacitacion', nombre: 'Centro de Capacitación DECE', center: [1, -13.5], size: [19, 12], color: '#78958A', suelo: '#c6d0c4', ruta: '/capacitacion', descripcion: 'Talleres de primeros auxilios psicológicos, señales de alerta y rutas de apoyo.', vista: { target: [1, -12.5], zoom: 2.6 } },
  { id: 'psiquiatria', nombre: 'Psiquiatría', sub: 'Derivación', center: [21.5, -13.5], size: [17, 12], color: '#8A6FA8', suelo: '#cbbfd9', ruta: '/derivaciones', descripcion: 'Valoración especializada mediante derivación (Dr. Diego Estrella).', vista: { target: [21.5, -12.5], zoom: 2.6 } },
  { id: 'consultorios', nombre: 'Consultorios de Psicología', center: [-21, -0.5], size: [20, 11], color: '#607D72', suelo: '#dcdfd5', ruta: '/atenciones', descripcion: 'Seis consultorios individuales para la atención psicológica.', vista: { target: [-21, -0.5], zoom: 2.6 } },
  { id: 'telemedicina', nombre: 'Telemedicina', center: [22.5, -0.5], size: [17, 11], color: '#3F8F5F', suelo: '#c8dccf', ruta: '/atenciones', descripcion: 'Consultorio médico de teleconsulta (Dr. Demetrio Magallanes).', vista: { target: [22.5, -0.5], zoom: 2.6 } },
];

export const ZONES_ABIERTAS = {
  coordinacion: { nombre: 'Coordinación CGREG', center: [0, -0.5] as V2, ruta: '/comando', descripcion: 'Supervisión institucional de toda la operación.', vista: { target: [0, -0.5] as V2, zoom: 3.0 } },
  territorial: { nombre: 'Articulación Territorial', center: [10.5, -0.5] as V2, ruta: '/territorio', descripcion: 'Coordinación con colaboradores desplegados en territorio (DECE).', vista: { target: [10.5, -0.5] as V2, zoom: 3.0 } },
  psicologia: { nombre: 'Psicología Clínica', center: [-3.5, 13.5] as V2, ruta: '/equipo', descripcion: 'Estaciones de trabajo de las seis psicólogas y psicólogos clínicos.', vista: { target: [-6, 11.5] as V2, zoom: 1.1 } },
  descanso: { nombre: 'Zona de pausa', center: [27.5, 14] as V2, descripcion: 'Espacio de pausa activa.', vista: { target: [26.5, 13.5] as V2, zoom: 3.4 } },
};

/** Estaciones de Psicología Clínica: 9 m entre centros. */
export const ESTACIONES_PSI: Record<string, V2> = {
  'psi-1': [-26, 13.5],
  'psi-2': [-17, 13.5],
  'psi-3': [-8, 13.5],
  'psi-4': [1, 13.5],
  'psi-5': [10, 13.5],
  'psi-6': [19, 13.5],
};

/** Consultorios individuales (centro de cada cabina, 3 × 2). */
export const CABINAS: V2[] = [
  [-27.5, -3.25],
  [-21, -3.25],
  [-14.5, -3.25],
  [-27.5, 2.25],
  [-21, 2.25],
  [-14.5, 2.25],
];

export const ENTRADA: V2 = [0, 21.5];
const CORREDORES = [-6.6, 7.4];
const ESPINA_X = 5.2;

function silla(centro: V2, i: number, n: number, rx: number, rz: number): Slot {
  const a = Math.PI / 2 + (i * Math.PI * 2) / n;
  const pos: V2 = [centro[0] + Math.cos(a) * rx, centro[1] + Math.sin(a) * rz];
  return { pos, rot: Math.atan2(centro[0] - pos[0], centro[1] - pos[1]), pose: 'sentado_conversar' };
}

/** Destino del avatar según la zona REAL que informa el backend. */
export function slotPara(p: PresenciaSnapshot, zona: Zona, indiceEnZona: number): Slot | null {
  const est = p.estacion ?? '';
  const idxPsi = est.startsWith('psi-') ? Number(est.slice(4)) - 1 : indiceEnZona % 6;
  const trabajo: Slot['pose'] = p.estado === 'en_documentacion' ? 'sentado_teclear' : 'sentado_trabajo';
  switch (zona) {
    case 'fuera':
      return null;
    case 'estacion': {
      const e = ESTACIONES_PSI[est];
      if (e) return { pos: [e[0], e[1] - 0.95], rot: 0, pose: trabajo, puerta: [e[0] - 1.9, 9.4] };
      if (est === 'tele') return { pos: [17.5, 1.6], rot: 0, pose: trabajo, puerta: [22.5, 5] };
      if (est === 'psiq') return { pos: [16, -12.2], rot: 0, pose: trabajo, puerta: [21.5, -7.5] };
      if (est === 'terr') return { pos: [10.5, -1.5], rot: 0, pose: trabajo };
      return { pos: [0, -1.4], rot: 0, pose: 'sentado_teclear' };
    }
    case 'consultorio_psicologia': {
      const c = CABINAS[idxPsi] ?? CABINAS[0];
      const fila = c[1] < 0 ? -1 : 1;
      return { pos: [c[0] - 0.9, c[1] + 0.3], rot: Math.PI / 2, pose: 'sentado_conversar', puerta: [c[0], fila < 0 ? -6.0 : 5.0] };
    }
    case 'telemedicina':
      return { pos: [27.2, -1.4], rot: Math.PI / 2, pose: 'sentado_conversar', puerta: [22.5, 5] };
    case 'psiquiatria':
      return { pos: [26.4, -14.8], rot: Math.PI / 2, pose: 'sentado_conversar', puerta: [21.5, -7.5] };
    case 'debriefing':
      return { ...silla([-19, -13.5], indiceEnZona, 8, 4.4, 2.6), puerta: [-19, -7.5] };
    case 'capacitacion':
      return indiceEnZona === 0
        ? { pos: [1, -17.3], rot: 0, pose: 'de_pie_presentar', puerta: [1, -7.5] }
        : { pos: [-3.5 + ((indiceEnZona - 1) % 4) * 3, -13 + Math.floor((indiceEnZona - 1) / 4) * 2.2], rot: Math.PI, pose: 'sentado_trabajo', puerta: [1, -7.5] };
    case 'coordinacion':
      return { pos: [0, -1.4], rot: 0, pose: 'sentado_teclear' };
    case 'territorial':
      return { pos: [10.5, -1.5], rot: 0, pose: trabajo };
    case 'descanso':
      return { pos: [26.3 + (indiceEnZona % 3) * 1.1, 14.25], rot: 0, pose: 'sentado_relajado' };
  }
  return null;
}

const corredorCercano = (z: number) => CORREDORES.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));

/**
 * Ruta por pasillos: sale por la puerta del espacio de origen, recorre el pasillo (y la espina central si
 * cambia de pasillo) y entra por la puerta del destino. Evita atravesar paredes de cristal.
 */
export function ruta(desde: V2, hasta: V2, puertaDesde?: V2, puertaHasta?: V2): V2[] {
  // Dentro del mismo espacio (misma puerta): desplazamiento directo.
  if (puertaDesde && puertaHasta && puertaDesde[0] === puertaHasta[0] && puertaDesde[1] === puertaHasta[1]) return [hasta];
  const a = puertaDesde ?? desde;
  const b = puertaHasta ?? hasta;
  const z0 = corredorCercano(a[1]);
  const z1 = corredorCercano(b[1]);
  const pts: V2[] = [];
  if (puertaDesde) pts.push(puertaDesde);
  pts.push([a[0], z0]);
  if (z0 !== z1) pts.push([ESPINA_X, z0], [ESPINA_X, z1]);
  pts.push([b[0], z1]);
  if (puertaHasta) pts.push(puertaHasta);
  pts.push(hasta);
  const out: V2[] = [];
  let prev = desde;
  for (const p of pts) {
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.05) out.push(p);
    prev = p;
  }
  return out;
}

/* ------------------------- Movimiento ambiental (paseos breves) ------------------------- */
// Recorridos cortos y con propósito (beber agua, retirar una impresión, leer el tablero, estirarse).
// No cambian el estado real: al terminar, la persona vuelve a su puesto. En consulta o reunión no hay paseos.
export type Accion = 'beber' | 'imprimir' | 'leer' | 'estirarse';
export interface Parada {
  pos: V2;
  rot: number;
  accion: Accion;
}
/** Mobiliario de los puntos de interés (se dibuja en la escena). */
export const PUNTOS_MUEBLES = {
  dispensadores: [[-30.9, 7.4], [30.9, 7.4]] as V2[],
  impresora: [5.5, 9.5] as V2,
  tableros: [[-9.2, -7.42], [11.3, -7.42]] as V2[],
};
const PARADAS: Parada[] = [
  { pos: [-30.0, 7.4], rot: -Math.PI / 2, accion: 'beber' },
  { pos: [30.0, 7.4], rot: Math.PI / 2, accion: 'beber' },
  { pos: [5.5, 8.4], rot: 0, accion: 'imprimir' },
  { pos: [-9.2, -6.4], rot: Math.PI, accion: 'leer' },
  { pos: [11.3, -6.4], rot: Math.PI, accion: 'leer' },
];
/** Estados en los que la persona permanece en su lugar (atendiendo). */
export const SIN_PASEO = new Set(['en_consulta', 'en_reunion', 'desconectado']);

const largo = (desde: V2, camino: V2[]) => camino.reduce((acc, p, i) => acc + Math.hypot(p[0] - (i ? camino[i - 1][0] : desde[0]), p[1] - (i ? camino[i - 1][1] : desde[1])), 0);
/** Distancia máxima de un paseo (ida) en metros: recorridos cortos, nunca deambular por toda la oficina. */
const PASEO_MAX = 26;

/** Elige una parada cercana (por distancia real recorrida en pasillos); r ∈ [0, 1) aporta variedad. */
export function elegirParada(home: Slot, estado: string, r: number): Parada {
  const base = home.puerta ?? home.pos;
  const d = (p: Parada) => largo(home.pos, ruta(home.pos, p.pos, home.puerta, undefined));
  const alcanzables = PARADAS.filter((p) => d(p) <= PASEO_MAX).sort((a, b) => d(a) - d(b));
  if (estado === 'en_pausa') {
    const agua = alcanzables.find((p) => p.accion === 'beber');
    if (agua) return agua;
  }
  const cercanas = alcanzables.slice(0, 3);
  const opciones: Parada[] = [...cercanas, { pos: [base[0] + (r < 0.5 ? 1.4 : -1.4), corredorCercano(base[1])], rot: r < 0.5 ? Math.PI / 2 : -Math.PI / 2, accion: 'estirarse' }];
  return opciones[Math.min(opciones.length - 1, Math.floor(r * opciones.length))];
}
