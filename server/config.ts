import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),
  /** Clave AES-256 en base64 (32 bytes) para cifrar información clínica. */
  DATA_ENCRYPTION_KEY: z.string().min(1, 'DATA_ENCRYPTION_KEY es obligatorio'),
  SESSION_IDLE_MINUTES: z.coerce.number().default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().default(12),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  // Google Sheets (solo lectura, pestaña autorizada)
  SHEETS_SPREADSHEET_ID: z.string().default('1hsrY0A8tqXUUDLuNK4Y3Sr_BFFhUjt5Hfw9kEo8DguE'),
  SHEETS_GID: z.coerce.number().default(133021335),
  SHEETS_SYNC_INTERVAL_SECONDS: z.coerce.number().min(30).max(3600).default(60),
  SHEETS_SYNC_ENABLED: z.enum(['true', 'false']).default('true'),
  /** JSON de la cuenta de servicio codificado en base64 (alternativa: GOOGLE_APPLICATION_CREDENTIALS). */
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  /** Mapeo campo→encabezado. Solo se leen estas columnas. */
  SHEETS_COLUMNS: z.string().optional(),
  PRESENCE_TIMEOUT_SECONDS: z.coerce.number().default(45),
  /** Texto de emergencia para las páginas públicas (persona atendida). */
  EMERGENCIA_PUBLICO_TEXTO: z
    .string()
    .default('Si usted o alguien cercano está en peligro o en una emergencia, llame de inmediato al ECU 911 o acuda al servicio de salud más cercano. Este formulario no es un servicio de emergencias.'),
  /** gid de la pestaña maestra de personal («Personal» = 1340025527). Sin valor: solo se usa «Valoraciones». */
  SHEETS_MAESTRA_GID: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().optional()),
  SHEETS_MAESTRA_COLUMNS: z.string().optional(),
  /** Filtro de Santa Cruz: la pestaña no tiene columna de ubicación; se usa la unidad orgánica registrada. */
  SHEETS_UBICACION_COLUMNA: z.string().default('Unidad_Organica'),
  SHEETS_UBICACION_VALOR: z.string().default('SANTA CRUZ'),
  /** Columna de «Valoraciones» con la clasificación profesional de riesgo. Vacía = no se importa riesgo (no existe hoy). */
  SHEETS_RIESGO_COLUMNA: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  SHEETS_RIESGO_VALORES: z.string().default('ALTO,ALTA,RIESGO ALTO'),
  SHEETS_SEGUIMIENTO_COLUMNA: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /** Acepta la «constancia profesional» (registro sin documento) como consentimiento válido. Por defecto NO. */
  CONSENTIMIENTO_CONSTANCIA_PROFESIONAL: z.enum(['true', 'false']).default('false'),
  FORMULARIO_PUBLICO_HABILITADO: z.enum(['true', 'false']).default('true'),
  DOCUMENTO_MAX_MB: z.coerce.number().min(1).max(25).default(10),
  CONSENTIMIENTO_TOKEN_HORAS: z.coerce.number().min(1).max(720).default(72),
  /** Notificaciones push de la app instalable (Web Push). Sin claves, solo hay notificaciones dentro de la app. */
  VAPID_PUBLIC_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  VAPID_PRIVATE_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  VAPID_SUBJECT: z.string().default('mailto:soporte@cgreg.gob.ec'),
  EMERGENCY_ROUTE_TEXT: z
    .string()
    .default('Emergencia clínica: active de inmediato la ruta de escalamiento profesional (ECU 911 / protocolo de crisis). No la registre como solicitud administrativa.'),
});

export type Config = z.infer<typeof schema> & { cookieSecure: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${msg}`);
  }
  const c = parsed.data;
  const key = Buffer.from(c.DATA_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY debe ser 32 bytes codificados en base64 (openssl rand -base64 32)');
  return { ...c, cookieSecure: c.COOKIE_SECURE ? c.COOKIE_SECURE === 'true' : c.NODE_ENV === 'production' };
}
