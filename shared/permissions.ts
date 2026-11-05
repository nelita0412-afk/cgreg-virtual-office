import type { Rol } from './domain';

/**
 * Matriz de permisos (mínimo privilegio). El backend es la autoridad: el frontend
 * solo la usa para ocultar navegación. Ningún rol obtiene acceso clínico por el
 * simple hecho de ver el dashboard.
 */
export const PERMISOS = {
  'oficina.ver': ['admin', 'coordinacion', 'profesional', 'territorial', 'autoridad', 'auditoria', 'trabajo_social'],
  'presencia.propia': ['coordinacion', 'profesional', 'territorial'],
  'comando.ver': ['coordinacion', 'admin'],
  'indicadores.agregados': ['coordinacion', 'autoridad', 'admin'],
  'equipo.ver': ['admin', 'coordinacion', 'profesional', 'territorial', 'autoridad', 'trabajo_social'],
  'agenda.ver_todas': ['coordinacion'],
  'agenda.propia': ['profesional'],
  'agenda.gestionar': ['coordinacion', 'profesional'],
  'disponibilidad.gestionar': ['coordinacion', 'admin'],
  'servidores.ver_todos': ['coordinacion'],
  'servidores.ver_asignados': ['profesional', 'trabajo_social'],
  'servidores.asignar': ['coordinacion'],
  'atenciones.registrar': ['profesional'],
  'clinico.leer_propio': ['profesional'],
  'derivaciones.crear': ['profesional'],
  'derivaciones.coordinar': ['coordinacion'],
  'derivaciones.valorar': ['profesional'], // además se exige especialidad psiquiatría
  'solicitudes.crear': ['profesional', 'territorial', 'trabajo_social'],
  'solicitudes.gestionar': ['coordinacion'],
  'actividades.ver': ['admin', 'coordinacion', 'profesional', 'territorial', 'autoridad', 'trabajo_social'],
  'actividades.gestionar': ['coordinacion', 'profesional'],
  'territorio.registrar': ['territorial', 'coordinacion'],
  'necesidades.registrar': ['profesional', 'coordinacion', 'territorial', 'trabajo_social'],
  'reportes.ver': ['coordinacion', 'autoridad', 'admin'],
  'usuarios.gestionar': ['admin'],
  'sync.ver': ['admin', 'coordinacion'],
  'sync.ejecutar': ['admin', 'coordinacion'],
  'auditoria.ver': ['auditoria', 'admin'],
  // ---- Ampliación ----
  /** Cola de atención prioritaria: Coordinación ve el dato operativo; los profesionales, solo sus asignados (con detalle). */
  'prioritaria.ver': ['coordinacion', 'profesional'],
  'riesgo.registrar': ['profesional'], // además debe ser clínico y estar asignado
  'abierta.gestionar': ['coordinacion'],
  'abierta.registrar': ['coordinacion', 'profesional'],
  'abierta.ver': ['coordinacion', 'profesional'],
  /** Historia clínica: el backend decide el nivel (clínico, social o administrativo) según rol y relación asistencial. */
  'hce.ver': ['profesional', 'trabajo_social', 'coordinacion'],
  'consentimientos.gestionar': ['profesional', 'coordinacion', 'admin'],
  'consentimientos.validar': ['profesional', 'admin'],
  'plantillas.gestionar': ['admin'],
  'social.registrar': ['trabajo_social'],
} as const satisfies Record<string, readonly Rol[]>;

export type Permiso = keyof typeof PERMISOS;

export function can(rol: Rol | undefined | null, permiso: Permiso): boolean {
  if (!rol) return false;
  return (PERMISOS[permiso] as readonly Rol[]).includes(rol);
}
