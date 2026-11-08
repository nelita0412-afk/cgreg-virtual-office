// Catálogos del dominio compartidos por backend y frontend.
// Los valores en snake_case son los que se almacenan en la base de datos.

export const TZ_PROFESIONALES = 'America/Guayaquil';
export const TZ_INSTITUCIONAL = 'Pacific/Galapagos';

export const ROLES = ['admin', 'coordinacion', 'profesional', 'territorial', 'autoridad', 'auditoria', 'trabajo_social'] as const;
export type Rol = (typeof ROLES)[number];
export const ROL_LABEL: Record<Rol, string> = {
  admin: 'Administrador institucional',
  coordinacion: 'Coordinación General',
  profesional: 'Profesional',
  territorial: 'Colaborador territorial',
  autoridad: 'Autoridad',
  auditoria: 'Auditoría',
  trabajo_social: 'Trabajo Social',
};

export const ESPECIALIDADES = ['psicologia', 'telemedicina', 'psiquiatria', 'trabajo_social'] as const;
export type Especialidad = (typeof ESPECIALIDADES)[number];
export const ESPECIALIDAD_LABEL: Record<Especialidad, string> = {
  psicologia: 'Psicología Clínica',
  telemedicina: 'Telemedicina',
  psiquiatria: 'Psiquiatría',
  trabajo_social: 'Trabajo Social',
};
/** Duraciones permitidas por especialidad (minutos). */
export const DURACIONES: Record<Especialidad, number[]> = {
  psicologia: [30, 45, 60],
  telemedicina: [20, 30],
  psiquiatria: [20, 30],
  trabajo_social: [], // no realiza atenciones clínicas
};

// ---- Presencia digital ----
export const ESTADOS_PRESENCIA = [
  'disponible',
  'en_consulta',
  'en_documentacion',
  'en_reunion',
  'en_pausa',
  'desconectado',
  'fuera_de_horario',
] as const;
export type EstadoPresencia = (typeof ESTADOS_PRESENCIA)[number];
/** Estados que un usuario conectado puede elegir manualmente. */
export const ESTADOS_MANUALES: EstadoPresencia[] = ['disponible', 'en_documentacion', 'en_pausa'];
export const ESTADO_PRESENCIA_LABEL: Record<EstadoPresencia, string> = {
  disponible: 'Disponible',
  en_consulta: 'En consulta',
  en_documentacion: 'En documentación',
  en_reunion: 'En reunión',
  en_pausa: 'En pausa',
  desconectado: 'Desconectado',
  fuera_de_horario: 'Fuera de horario',
};
export const ESTADO_PRESENCIA_COLOR: Record<EstadoPresencia, string> = {
  disponible: '#3F9B66',
  en_consulta: '#8A6FA8',
  en_documentacion: '#C98A2E',
  en_reunion: '#B07A55',
  en_pausa: '#8FA39A',
  desconectado: '#7A8C83',
  fuera_de_horario: '#A3B2AA',
};

/** Zonas de la oficina virtual a las que puede desplazarse un avatar. */
export const ZONAS = [
  'fuera',
  'estacion',
  'consultorio_psicologia',
  'telemedicina',
  'psiquiatria',
  'debriefing',
  'capacitacion',
  'coordinacion',
  'territorial',
  'descanso',
] as const;
export type Zona = (typeof ZONAS)[number];

// ---- Atenciones ----
export const ESTADOS_ATENCION = [
  'pendiente',
  'programada',
  'confirmada',
  'en_atencion',
  'atendida',
  'reprogramada',
  'no_realizada',
] as const;
export type EstadoAtencion = (typeof ESTADOS_ATENCION)[number];
export const ESTADO_ATENCION_LABEL: Record<EstadoAtencion, string> = {
  pendiente: 'Pendiente',
  programada: 'Programada',
  confirmada: 'Confirmada',
  en_atencion: 'En atención',
  atendida: 'Atendida',
  reprogramada: 'Reprogramada',
  no_realizada: 'No realizada',
};
/** Estados que reservan un bloque horario en la agenda. */
export const ESTADOS_ATENCION_RESERVAN: EstadoAtencion[] = ['programada', 'confirmada', 'en_atencion'];

// ---- Derivaciones ----
export const ESTADOS_DERIVACION = [
  'solicitada',
  'en_revision',
  'pendiente_coordinacion',
  'aceptada',
  'programada',
  'valorada',
  'en_seguimiento',
  'cerrada',
] as const;
export type EstadoDerivacion = (typeof ESTADOS_DERIVACION)[number];
export const ESTADO_DERIVACION_LABEL: Record<EstadoDerivacion, string> = {
  solicitada: 'Solicitada',
  en_revision: 'En revisión',
  pendiente_coordinacion: 'Pendiente de coordinación',
  aceptada: 'Aceptada',
  programada: 'Programada',
  valorada: 'Valorada',
  en_seguimiento: 'En seguimiento',
  cerrada: 'Cerrada',
};
export const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'] as const;
export type Prioridad = (typeof PRIORIDADES)[number];
export const PRIORIDAD_LABEL: Record<Prioridad, string> = { baja: 'Baja', media: 'Media', alta: 'Alta', urgente: 'Urgente' };

// ---- Solicitudes a Coordinación ----
export const ESTADOS_SOLICITUD = [
  'nueva',
  'recibida',
  'en_gestion',
  'pendiente_respuesta_externa',
  'requiere_informacion',
  'resuelta',
  'cerrada',
] as const;
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number];
export const ESTADO_SOLICITUD_LABEL: Record<EstadoSolicitud, string> = {
  nueva: 'Nueva',
  recibida: 'Recibida',
  en_gestion: 'En gestión',
  pendiente_respuesta_externa: 'Pendiente de respuesta externa',
  requiere_informacion: 'Requiere información adicional',
  resuelta: 'Resuelta',
  cerrada: 'Cerrada',
};
export const TIPOS_SOLICITUD = [
  'apoyo_institucional_servidor',
  'coordinacion_interinstitucional',
  'solicitud_informacion',
  'articulacion_interinstitucional',
  'gestion_recursos',
  'coordinar_derivacion',
  'apoyo_actividad',
  'dificultad_operativa',
  'seguimiento_gestion_externa',
  'otra',
] as const;
export type TipoSolicitud = (typeof TIPOS_SOLICITUD)[number];
export const TIPO_SOLICITUD_LABEL: Record<TipoSolicitud, string> = {
  apoyo_institucional_servidor: 'Gestionar apoyo institucional para un servidor',
  coordinacion_interinstitucional: 'Coordinar con otra institución',
  solicitud_informacion: 'Solicitar información',
  articulacion_interinstitucional: 'Facilitar una articulación interinstitucional',
  gestion_recursos: 'Gestionar recursos',
  coordinar_derivacion: 'Coordinar una derivación',
  apoyo_actividad: 'Solicitar apoyo para una actividad',
  dificultad_operativa: 'Resolver una dificultad operativa',
  seguimiento_gestion_externa: 'Seguimiento de una gestión externa',
  otra: 'Otra',
};
export const ACCIONES_SOLICITUD = [
  'creada',
  'revisada',
  'aceptada',
  'respuesta',
  'solicitar_informacion',
  'informacion_aportada',
  'gestion_registrada',
  'seguimiento_programado',
  'estado_actualizado',
  'respuesta_externa',
  'cerrada',
] as const;
export type AccionSolicitud = (typeof ACCIONES_SOLICITUD)[number];

// ---- Seguimientos, necesidades, contactos ----
export const ESTADOS_SEGUIMIENTO = ['pendiente', 'realizado', 'cancelado'] as const;
export const CATEGORIAS_NECESIDAD = [
  'vivienda',
  'alimentacion',
  'salud',
  'psicosocial',
  'economica',
  'laboral',
  'educativa',
  'documentacion',
  'otra',
] as const;
export type CategoriaNecesidad = (typeof CATEGORIAS_NECESIDAD)[number];
export const CATEGORIA_NECESIDAD_LABEL: Record<CategoriaNecesidad, string> = {
  vivienda: 'Vivienda',
  alimentacion: 'Alimentación',
  salud: 'Salud',
  psicosocial: 'Psicosocial',
  economica: 'Económica',
  laboral: 'Laboral',
  educativa: 'Educativa',
  documentacion: 'Documentación',
  otra: 'Otra',
};
export const ESTADOS_NECESIDAD = ['pendiente', 'parcial', 'resuelta'] as const;
export type EstadoNecesidad = (typeof ESTADOS_NECESIDAD)[number];
export const ESTADO_NECESIDAD_LABEL: Record<EstadoNecesidad, string> = {
  pendiente: 'Pendiente',
  parcial: 'Parcialmente resuelta',
  resuelta: 'Resuelta',
};
export const RESULTADOS_CONTACTO = ['contactado', 'no_responde', 'dato_erroneo', 'rechaza_atencion'] as const;
export type ResultadoContacto = (typeof RESULTADOS_CONTACTO)[number];
export const RESULTADO_CONTACTO_LABEL: Record<ResultadoContacto, string> = {
  contactado: 'Contactado',
  no_responde: 'No responde',
  dato_erroneo: 'Dato de contacto erróneo',
  rechaza_atencion: 'No desea atención',
};

// ---- Debriefing y capacitación ----
export const ESTADOS_ACTIVIDAD = ['programada', 'en_curso', 'realizada', 'cancelada'] as const;
export type EstadoActividad = (typeof ESTADOS_ACTIVIDAD)[number];
export const ESTADO_ACTIVIDAD_LABEL: Record<EstadoActividad, string> = {
  programada: 'Programada',
  en_curso: 'En curso',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
};
export const TEMAS_CAPACITACION = [
  'primeros_auxilios_psicologicos',
  'senales_alerta',
  'herramientas_contencion',
  'rutas_apoyo',
  'coordinacion_territorial',
  'otro',
] as const;
export type TemaCapacitacion = (typeof TEMAS_CAPACITACION)[number];
export const TEMA_CAPACITACION_LABEL: Record<TemaCapacitacion, string> = {
  primeros_auxilios_psicologicos: 'Primeros auxilios psicológicos',
  senales_alerta: 'Identificación de señales de alerta',
  herramientas_contencion: 'Herramientas de contención',
  rutas_apoyo: 'Rutas de apoyo',
  coordinacion_territorial: 'Coordinación con equipos territoriales',
  otro: 'Otro',
};

// ---- Eventos en tiempo real ----
/** Temas de eventos que el frontend usa para invalidar datos. */
export const TOPICS = [
  'presencia',
  'agenda',
  'atenciones',
  'derivaciones',
  'solicitudes',
  'notificaciones',
  'actividades',
  'servidores',
  'sync',
  'necesidades',
  'seguimientos',
  'expedientes',
  'consentimientos',
  'abierta',
  'prioritaria',
] as const;
export type Topic = (typeof TOPICS)[number];

export interface PresenciaSnapshot {
  /** Clave estable para la oficina: id del profesional o, si no es profesional, id de usuario. */
  clave: string;
  usuario_id: string | null;
  tiene_cuenta: boolean;
  estacion: string | null;
  especialidad: Especialidad | null;
  es_teleatencion: boolean;
  color: string | null;
  cabello: string | null;
  profesional_id: string | null;
  nombre: string;
  nombre_corto: string;
  rol: Rol;
  conectado: boolean;
  estado: EstadoPresencia;
  zona: Zona;
  desde: string;
  en_horario: boolean;
}

export interface EventoPublico {
  id: number;
  ts: string;
  tipo: string;
  topic: Topic;
  /** Texto apto para el feed general: sin nombres de servidores ni motivos clínicos. */
  texto: string | null;
  actor_nombre: string | null;
}

// ---- Ampliación: base maestra, rutas de atención, HCE y consentimiento ----
export const VERIFICACIONES = ['verificado_maestra', 'verificado_manual', 'pendiente_verificacion', 'no_verificable'] as const;
export type Verificacion = (typeof VERIFICACIONES)[number];
export const VERIFICACION_LABEL: Record<Verificacion, string> = {
  verificado_maestra: 'Verificado en base maestra',
  verificado_manual: 'Verificado manualmente',
  pendiente_verificacion: 'Pendiente de verificación',
  no_verificable: 'No verificable (atención no bloqueada)',
};

export const ESTADOS_SOLICITUD_ATENCION = ['pendiente_asignacion', 'asignada', 'programada', 'atendida', 'cerrada', 'cancelada'] as const;
export type EstadoSolicitudAtencion = (typeof ESTADOS_SOLICITUD_ATENCION)[number];
export const ESTADO_SOLICITUD_ATENCION_LABEL: Record<EstadoSolicitudAtencion, string> = {
  pendiente_asignacion: 'Pendiente de asignación',
  asignada: 'Asignada',
  programada: 'Programada',
  atendida: 'Atendida',
  cerrada: 'Cerrada',
  cancelada: 'Cancelada',
};
export const PREFERENCIA_SERVICIO_LABEL = { psicologia: 'Psicología', medicina: 'Medicina', no_sabe: 'No sabe / que la brigada oriente' } as const;

export const ESTADOS_CONSENTIMIENTO = ['pendiente', 'cargado', 'pendiente_validacion', 'validado', 'requiere_correccion', 'revocado', 'no_otorgado'] as const;
export type EstadoConsentimiento = (typeof ESTADOS_CONSENTIMIENTO)[number];
export const ESTADO_CONSENTIMIENTO_LABEL: Record<EstadoConsentimiento, string> = {
  pendiente: 'Pendiente',
  cargado: 'Cargado',
  pendiente_validacion: 'Pendiente de validación',
  validado: 'Validado',
  requiere_correccion: 'Requiere corrección',
  revocado: 'Revocado / retirado',
  no_otorgado: 'No otorgado',
};
export const MODALIDADES_CONSENTIMIENTO = ['electronica', 'firmada_manual', 'constancia_profesional'] as const;
export type ModalidadConsentimiento = (typeof MODALIDADES_CONSENTIMIENTO)[number];
export const MODALIDAD_CONSENTIMIENTO_LABEL: Record<ModalidadConsentimiento, string> = {
  electronica: 'Aceptación electrónica',
  firmada_manual: 'Firmado manualmente (documento cargado)',
  constancia_profesional: 'Constancia profesional (registro previo)',
};
export const SERVICIOS_CONSENTIMIENTO = ['psicologia', 'telemedicina', 'psiquiatria'] as const;
export type ServicioConsentimiento = (typeof SERVICIOS_CONSENTIMIENTO)[number];
export const SERVICIO_CONSENTIMIENTO_LABEL: Record<ServicioConsentimiento, string> = {
  psicologia: 'Teleatención psicológica',
  telemedicina: 'Telemedicina',
  psiquiatria: 'Valoración psiquiátrica',
};

export const AREAS_HCE = ['psicologia', 'medicina', 'psiquiatria'] as const;
export type AreaHce = (typeof AREAS_HCE)[number];
export const AREA_HCE_LABEL: Record<AreaHce, string> = { psicologia: 'Psicología Clínica', medicina: 'Medicina', psiquiatria: 'Psiquiatría' };
/** Área de la historia clínica según el tipo de atención. */
export const AREA_DE_ATENCION: Record<'psicologia' | 'telemedicina' | 'psiquiatria', AreaHce> = { psicologia: 'psicologia', telemedicina: 'medicina', psiquiatria: 'psiquiatria' };
export const SECCIONES_HCE = ['motivo_consulta', 'antecedentes', 'valoracion', 'evaluacion_clinica', 'plan_atencion', 'recomendaciones'] as const;
export type SeccionHce = (typeof SECCIONES_HCE)[number];
export const SECCION_HCE_LABEL: Record<SeccionHce, string> = {
  motivo_consulta: 'Motivo de consulta',
  antecedentes: 'Antecedentes relevantes',
  valoracion: 'Valoración profesional',
  evaluacion_clinica: 'Evaluación clínica',
  plan_atencion: 'Plan de atención',
  recomendaciones: 'Recomendaciones',
};
/** Campos de una entrada cronológica (atención). */
export const CAMPOS_ENTRADA = ['resumen', 'motivo_consulta', 'evaluacion', 'intervencion', 'evolucion', 'resultado', 'plan', 'recomendaciones'] as const;
export type CampoEntrada = (typeof CAMPOS_ENTRADA)[number];
export const CAMPO_ENTRADA_LABEL: Record<CampoEntrada, string> = {
  resumen: 'Resumen de la atención',
  motivo_consulta: 'Motivo de consulta',
  evaluacion: 'Evaluación clínica',
  intervencion: 'Intervención realizada',
  evolucion: 'Evolución',
  resultado: 'Resultado',
  plan: 'Plan de atención',
  recomendaciones: 'Recomendaciones',
};
export const TIPOS_INTERVENCION_SOCIAL = ['valoracion_social', 'visita', 'gestion_recursos', 'articulacion', 'seguimiento', 'otra'] as const;
export type TipoIntervencionSocial = (typeof TIPOS_INTERVENCION_SOCIAL)[number];
export const TIPO_INTERVENCION_SOCIAL_LABEL: Record<TipoIntervencionSocial, string> = {
  valoracion_social: 'Valoración social',
  visita: 'Visita / contacto',
  gestion_recursos: 'Gestión de recursos',
  articulacion: 'Articulación interinstitucional',
  seguimiento: 'Seguimiento social',
  otra: 'Otra',
};
