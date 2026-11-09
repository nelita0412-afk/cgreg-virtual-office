import type { Config } from './config';
import type { Db } from './db';
import type { FieldCipher } from './crypto';
import type { EventBus } from './events';
import type { Rol, Especialidad, Funcion } from '@shared/domain';

export interface AppCtx {
  cfg: Config;
  db: Db;
  cipher: FieldCipher;
  bus: EventBus;
}

export interface SessionUser {
  id: string;
  sid: string;
  nombre: string;
  email: string;
  rol: Rol;
  /** Funciones complementarias activas (se suman al rol base). */
  funciones: Funcion[];
  profesional_id: string | null;
  especialidad: Especialidad | null;
  es_teleatencion: boolean;
  debe_cambiar_password: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}
export const badRequest = (m: string, code?: string) => new HttpError(400, m, code);
export const forbidden = (m = 'No autorizado para esta acción') => new HttpError(403, m, 'forbidden');
export const notFound = (m = 'Registro no encontrado') => new HttpError(404, m, 'not_found');
export const conflict = (m: string, code?: string) => new HttpError(409, m, code);
