import type { Funcion, Rol } from './domain';

/**
 * Matriz de permisos de la Brigada de Apoyo Psicosocial (mínimo privilegio).
 *
 * Permisos efectivos = permisos del ROL BASE ∪ permisos de las FUNCIONES COMPLEMENTARIAS activas de la cuenta.
 * El backend es la autoridad (requirePerm + reglas por caso); el frontend solo usa la matriz para la navegación.
 * Los permisos no dan acceso clínico por sí solos: la información clínica exige además relación asistencial con
 * la persona atendida y especialidad clínica (server/hce.ts), y cada lectura sensible queda auditada.
 *
 * Grupos de información: social (intervención social), clínica (registros de salud mental), administrativa
 * (operación y gestión) y epidemiológica (indicadores agregados, sin identidades).
 */
export const PERMISOS = {
  /** Acceso básico a la aplicación: «Mi día», cuenta propia, resumen agregado del encabezado. */
  'oficina.ver': ['admin', 'coordinacion', 'profesional', 'territorial', 'autoridad', 'auditoria', 'trabajo_social', 'epidemiologia'],
  /** Entrar a la Oficina Virtual 3D y ver la disponibilidad operativa básica de colegas (sin datos clínicos). */
  'oficina.entrar': ['coordinacion', 'profesional', 'territorial', 'trabajo_social', 'epidemiologia'],
  'presencia.propia': ['coordinacion', 'profesional', 'territorial', 'trabajo_social', 'epidemiologia'],
  'comando.ver': ['coordinacion'],
  'indicadores.agregados': ['coordinacion', 'autoridad', 'epidemiologia'],
  /** Mi Equipo: cargas, indicadores individuales y gestión de horarios. Solo Coordinación o función de gestión operativa. */
  'equipo.ver': ['coordinacion'],
  /** Directorio de profesionales de consulta limitada (nombre, profesión, experiencia, función; sin casos ni cargas). */
  'directorio.ver': ['coordinacion', 'profesional', 'territorial', 'trabajo_social', 'epidemiologia'],
  'agenda.ver_todas': ['coordinacion'],
  'agenda.propia': ['profesional'],
  'agenda.gestionar': ['coordinacion', 'profesional'],
  'disponibilidad.gestionar': ['coordinacion'],
  'servidores.ver_todos': ['coordinacion'],
  'servidores.ver_asignados': ['profesional', 'trabajo_social'],
  'servidores.asignar': ['coordinacion'],
  'atenciones.registrar': ['profesional'],
  'clinico.leer_propio': ['profesional'],
  'derivaciones.crear': ['profesional'],
  'derivaciones.coordinar': ['coordinacion'],
  'derivaciones.valorar': ['profesional'], // además se exige especialidad Psiquiatría
  'solicitudes.crear': ['profesional', 'territorial', 'trabajo_social', 'epidemiologia'],
  'solicitudes.gestionar': ['coordinacion'],
  'actividades.ver': ['coordinacion', 'profesional', 'territorial', 'trabajo_social', 'epidemiologia'],
  'actividades.gestionar': ['coordinacion', 'profesional'],
  'territorio.registrar': ['territorial', 'coordinacion', 'epidemiologia'],
  'necesidades.registrar': ['profesional', 'coordinacion', 'territorial', 'trabajo_social'],
  'reportes.ver': ['coordinacion', 'autoridad'],
  'usuarios.gestionar': ['admin'],
  'sync.ver': ['admin', 'coordinacion'],
  'sync.ejecutar': ['admin', 'coordinacion'],
  /** Trazabilidad: registros de acceso y de acciones (metadatos; nunca el contenido clínico). */
  'auditoria.ver': ['auditoria', 'admin'],
  /** Cola de atención prioritaria: Coordinación ve el dato operativo; los profesionales clínicos, solo sus asignados. */
  'prioritaria.ver': ['coordinacion', 'profesional'],
  'riesgo.registrar': ['profesional'], // además debe ser clínico y estar asignado
  'abierta.gestionar': ['coordinacion'],
  'abierta.registrar': ['coordinacion', 'profesional'],
  'abierta.ver': ['coordinacion', 'profesional'],
  /** Historia clínica: el backend decide el nivel (clínico, social o administrativo) según rol, función y relación asistencial. */
  'hce.ver': ['profesional', 'trabajo_social', 'coordinacion'],
  'consentimientos.gestionar': ['profesional', 'coordinacion'],
  'consentimientos.validar': ['profesional'],
  'plantillas.gestionar': ['admin'],
  'social.registrar': ['trabajo_social'],
} as const satisfies Record<string, readonly Rol[]>;

export type Permiso = keyof typeof PERMISOS;

/** Permisos que aporta cada función complementaria (se suman a los del rol base, nunca los restan). */
export const PERMISOS_FUNCION: Record<Funcion, readonly Permiso[]> = {
  trabajo_social: ['social.registrar', 'servidores.ver_asignados', 'hce.ver', 'necesidades.registrar', 'solicitudes.crear', 'directorio.ver'],
  territorial: ['territorio.registrar', 'necesidades.registrar', 'solicitudes.crear'],
  gestion_operativa: ['equipo.ver'],
};

/** Permiso por rol base (sin funciones complementarias). */
export function can(rol: Rol | undefined | null, permiso: Permiso): boolean {
  if (!rol) return false;
  return (PERMISOS[permiso] as readonly Rol[]).includes(rol);
}

export type Sujeto = { rol: Rol; funciones?: readonly Funcion[] | null } | null | undefined;

/** Permiso efectivo de una cuenta: rol base ∪ funciones complementarias activas. */
export function puede(sujeto: Sujeto, permiso: Permiso): boolean {
  if (!sujeto) return false;
  return can(sujeto.rol, permiso) || (sujeto.funciones ?? []).some((f) => PERMISOS_FUNCION[f]?.includes(permiso));
}

export const tieneFuncion = (sujeto: Sujeto, f: Funcion) => !!sujeto && (sujeto.funciones ?? []).includes(f);
/** Trabajo Social como rol base o como función complementaria (p. ej., la Coordinadora). */
export const ejerceTrabajoSocial = (sujeto: Sujeto) => !!sujeto && (sujeto.rol === 'trabajo_social' || tieneFuncion(sujeto, 'trabajo_social'));
/** Función territorial como rol base o complementaria (p. ej., Andrea, psicóloga con función territorial). */
export const ejerceTerritorial = (sujeto: Sujeto) => !!sujeto && (sujeto.rol === 'territorial' || tieneFuncion(sujeto, 'territorial'));

/** Todos los permisos efectivos de una cuenta (para mostrarlos y verificarlos). */
export function permisosEfectivos(sujeto: Sujeto): Permiso[] {
  return (Object.keys(PERMISOS) as Permiso[]).filter((p) => puede(sujeto, p));
}
