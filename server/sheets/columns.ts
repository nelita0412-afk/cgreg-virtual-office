/**
 * Columnas de la pestaña autorizada "Valoraciones" (gid 133021335) que la plataforma necesita.
 * Encabezados verificados en la matriz institucional (fila 1). Solo se leen estas columnas;
 * las demás (situación de vivienda, salud, red de apoyo, etc.) NO se importan.
 */
export const CAMPOS_SERVIDOR = {
  id_registro: { encabezado: 'ID_Valoracion', obligatorio: true, descripcion: 'Identificador del registro de origen' },
  codigo_institucional: { encabezado: 'ID_Distributivo', obligatorio: false, descripcion: 'Código institucional del servidor' },
  nombre: { encabezado: 'Servidor', obligatorio: true, descripcion: 'Nombre del servidor' },
  fecha_registro: { encabezado: 'Fecha_Registro', obligatorio: false, descripcion: 'Fecha del registro de origen' },
  canal_contacto: { encabezado: 'Canal_Contacto', obligatorio: false, descripcion: 'Canal de contacto preferido' },
  aviso_privacidad: { encabezado: 'Aviso_Privacidad_Aceptado', obligatorio: false, descripcion: 'Aceptación del aviso de privacidad' },
} as const;
export type CampoServidor = keyof typeof CAMPOS_SERVIDOR;

export function mapeoColumnas(override?: string): Record<CampoServidor, string> {
  const base = Object.fromEntries(Object.entries(CAMPOS_SERVIDOR).map(([k, v]) => [k, v.encabezado])) as Record<CampoServidor, string>;
  if (!override) return base;
  const extra = JSON.parse(override) as Partial<Record<CampoServidor, string>>;
  for (const k of Object.keys(extra)) if (!(k in CAMPOS_SERVIDOR)) throw new Error(`SHEETS_COLUMNS: campo desconocido ${k}`);
  return { ...base, ...extra };
}

export function colLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function parseAviso(v: string | undefined): boolean | null {
  if (v == null) return null;
  const t = v.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (['si', 'true', 'x', '1', 'acepta', 'aceptado', 'verdadero'].includes(t)) return true;
  if (['no', 'false', '0', 'falso', 'no acepta'].includes(t)) return false;
  return null;
}

/**
 * Pestaña maestra «Personal» (gid 1340025527). Encabezados verificados (fila 1):
 * ID_Distributivo, Nombres_Apellidos, Cargo, Regimen_Laboral, Unidad_Organica, Estado_Distributivo,
 * Contacto_Validado, Encuesta_Recibida, Prioridad_Social, Ultimo_Contacto, Observacion_Administrativa.
 * Solo se leen las columnas siguientes. No existe columna de ubicación laboral, teléfono ni correo.
 */
export const CAMPOS_MAESTRA = {
  codigo_institucional: { encabezado: 'ID_Distributivo', obligatorio: true, descripcion: 'Identificador institucional (vínculo estable)' },
  nombre: { encabezado: 'Nombres_Apellidos', obligatorio: true, descripcion: 'Nombre completo' },
  unidad: { encabezado: 'Unidad_Organica', obligatorio: false, descripcion: 'Unidad o área de trabajo (también usada para el filtro de Santa Cruz)' },
  estado_servidor: { encabezado: 'Estado_Distributivo', obligatorio: false, descripcion: 'Estado del servidor' },
  contacto_validado: { encabezado: 'Contacto_Validado', obligatorio: false, descripcion: 'Indicador de contacto validado (solo valores Sí/No)' },
} as const;
export type CampoMaestra = keyof typeof CAMPOS_MAESTRA | 'ubicacion';

/** Columnas de «Valoraciones» en modo base maestra (sin nombre: el vínculo es el ID_Distributivo). */
export const CAMPOS_VALORACION = {
  id_registro: { encabezado: 'ID_Valoracion', obligatorio: true, descripcion: 'Identificador de la valoración' },
  codigo_institucional: { encabezado: 'ID_Distributivo', obligatorio: true, descripcion: 'Vínculo con la base maestra' },
  fecha_registro: { encabezado: 'Fecha_Registro', obligatorio: false, descripcion: 'Fecha de la valoración' },
  canal_contacto: { encabezado: 'Canal_Contacto', obligatorio: false, descripcion: 'Canal de contacto preferido' },
  aviso_privacidad: { encabezado: 'Aviso_Privacidad_Aceptado', obligatorio: false, descripcion: 'Aviso de privacidad (NO es consentimiento informado)' },
} as const;
export type CampoValoracion = keyof typeof CAMPOS_VALORACION | 'riesgo' | 'seguimiento';

export function mapeoMaestra(override: string | undefined, columnaUbicacion: string): Record<CampoMaestra, string> {
  const base = Object.fromEntries(Object.entries(CAMPOS_MAESTRA).map(([k, v]) => [k, v.encabezado])) as Record<CampoMaestra, string>;
  if (override) {
    const extra = JSON.parse(override) as Record<string, string>;
    for (const k of Object.keys(extra)) if (!(k in CAMPOS_MAESTRA)) throw new Error(`SHEETS_MAESTRA_COLUMNS: campo desconocido ${k}`);
    Object.assign(base, extra);
  }
  if (columnaUbicacion !== base.unidad) base.ubicacion = columnaUbicacion;
  return base;
}

export function mapeoValoracion(riesgo?: string, seguimiento?: string): Record<CampoValoracion, string> {
  const base = Object.fromEntries(Object.entries(CAMPOS_VALORACION).map(([k, v]) => [k, v.encabezado])) as Record<CampoValoracion, string>;
  if (riesgo) base.riesgo = riesgo;
  if (seguimiento) base.seguimiento = seguimiento;
  return base;
}

export const normalizar = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function enUbicacion(valor: string | undefined, filtro: string): boolean {
  if (!valor) return false;
  return normalizar(valor).includes(normalizar(filtro));
}

/** Devuelve true/false solo para valores Sí/No; cualquier otro valor se descarta (no se importa). */
export function parseBooleano(v: string | undefined): boolean | null | 'invalido' {
  if (v == null || v.trim() === '') return null;
  const r = parseAviso(v);
  return r == null ? 'invalido' : r;
}

/** Fechas de la matriz: AAAA-MM-DD, DD/MM/AAAA (con o sin hora). */
export function parseFecha(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
