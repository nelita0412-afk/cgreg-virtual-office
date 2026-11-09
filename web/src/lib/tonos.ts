import type { Tono } from '../components/ui';
import type { EstadoAtencion, EstadoDerivacion, EstadoSolicitud } from '@shared/domain';

/** Colores de estado compartidos por escritorio y app móvil. */
export const tonoAtencion: Record<EstadoAtencion, Tono> = {
  pendiente: 'neutral',
  programada: 'info',
  confirmada: 'violet',
  contacto_iniciado: 'serious',
  en_atencion: 'warning',
  atendida: 'good',
  reprogramada: 'neutral',
  no_realizada: 'critical',
};

export const tonoSolicitud: Record<EstadoSolicitud, Tono> = {
  nueva: 'warning', recibida: 'info', en_gestion: 'violet', pendiente_respuesta_externa: 'serious', requiere_informacion: 'serious', resuelta: 'good', cerrada: 'neutral',
};

export const tonoPrioridad: Record<string, Tono> = { urgente: 'critical', alta: 'serious', media: 'warning', baja: 'neutral' };

export const DERIVACION_ACTIVA = (e: EstadoDerivacion) => !['cerrada', 'valorada', 'en_seguimiento'].includes(e);
