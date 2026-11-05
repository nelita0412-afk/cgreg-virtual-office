import { DateTime, Interval } from 'luxon';
import { DURACIONES, TZ_INSTITUCIONAL, type Especialidad } from './domain';

/** Regla de disponibilidad semanal almacenada en la zona horaria de origen del profesional. */
export interface ReglaDisponibilidad {
  dia_semana: number; // ISO: 1 = lunes ... 7 = domingo (en la zona de origen)
  hora_inicio: string; // 'HH:MM'
  hora_fin: string; // 'HH:MM'
  tz: string; // p. ej. 'America/Guayaquil'
}

/** Franja puntual confirmada (p. ej., Psiquiatría, que no tiene horario fijo). */
export interface FranjaConfirmada {
  inicio: string; // ISO UTC
  fin: string;
}

export const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DIAS_CORTOS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function parseHM(hm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) throw new Error(`Hora inválida: ${hm}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) throw new Error(`Hora inválida: ${hm}`);
  return { hour, minute };
}

/**
 * Expande reglas semanales a intervalos absolutos (UTC) que se superponen con [desde, hasta).
 * Se respeta la zona de origen de cada regla; la conversión la hace la base de datos de zonas IANA.
 */
export function expandirReglas(reglas: ReglaDisponibilidad[], desde: Date, hasta: Date): Interval[] {
  const out: Interval[] = [];
  const rango = Interval.fromDateTimes(DateTime.fromJSDate(desde), DateTime.fromJSDate(hasta));
  for (const r of reglas) {
    const ini = parseHM(r.hora_inicio);
    const fin = parseHM(r.hora_fin);
    let dia = DateTime.fromJSDate(desde, { zone: r.tz }).startOf('day').minus({ days: 1 });
    const limite = DateTime.fromJSDate(hasta, { zone: r.tz }).endOf('day').plus({ days: 1 });
    while (dia <= limite) {
      if (dia.weekday === r.dia_semana) {
        const a = dia.set({ hour: ini.hour, minute: ini.minute, second: 0, millisecond: 0 });
        const b = fin.hour === 24 ? dia.plus({ days: 1 }).startOf('day') : dia.set({ hour: fin.hour, minute: fin.minute, second: 0, millisecond: 0 });
        const iv = Interval.fromDateTimes(a, b);
        if (iv.isValid && iv.overlaps(rango)) out.push(iv);
      }
      dia = dia.plus({ days: 1 });
    }
  }
  return out.sort((x, y) => x.start!.toMillis() - y.start!.toMillis());
}

export function franjasAIntervalos(franjas: FranjaConfirmada[]): Interval[] {
  return franjas
    .map((f) => Interval.fromDateTimes(DateTime.fromISO(f.inicio), DateTime.fromISO(f.fin)))
    .filter((i) => i.isValid);
}

/** ¿Está el instante dentro de alguna franja disponible? */
export function enHorario(intervalos: Interval[], instante: Date): boolean {
  const t = DateTime.fromJSDate(instante);
  return intervalos.some((i) => i.contains(t));
}

export interface ResumenDia {
  dia_semana: number; // en hora institucional (Galápagos)
  dia: string;
  rangos: string[]; // 'HH:MM–HH:MM' en hora de Galápagos
}

/**
 * Convierte las reglas semanales a la hora institucional usando una semana de referencia.
 * Ecuador continental y Galápagos no aplican horario de verano; aun así, la conversión
 * se calcula con la base de datos IANA para no asumir diferencias fijas.
 */
export function resumenSemanalInstitucional(reglas: ReglaDisponibilidad[], tzDestino = TZ_INSTITUCIONAL, referencia = new Date()): ResumenDia[] {
  const lunes = DateTime.fromJSDate(referencia, { zone: tzDestino }).startOf('week');
  const ivs = expandirReglas(reglas, lunes.toJSDate(), lunes.plus({ days: 7 }).toJSDate());
  const porDia = new Map<number, string[]>();
  for (const iv of ivs) {
    const a = iv.start!.setZone(tzDestino);
    const b = iv.end!.setZone(tzDestino);
    if (a < lunes || a >= lunes.plus({ days: 7 })) continue;
    const lista = porDia.get(a.weekday) ?? [];
    lista.push(`${a.toFormat('HH:mm')}–${b.toFormat('HH:mm')}`);
    porDia.set(a.weekday, lista);
  }
  return [...porDia.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([d, rangos]) => ({ dia_semana: d, dia: DIAS[d], rangos: rangos.sort() }));
}

export type ErrorAgenda =
  | 'duracion_no_permitida'
  | 'fuera_de_disponibilidad'
  | 'en_el_pasado'
  | 'inicio_invalido';

export const ERROR_AGENDA_LABEL: Record<ErrorAgenda, string> = {
  duracion_no_permitida: 'La duración no está permitida para esta especialidad.',
  fuera_de_disponibilidad: 'El horario está fuera de la disponibilidad del profesional.',
  en_el_pasado: 'No se pueden programar citas en el pasado.',
  inicio_invalido: 'Fecha u hora de inicio inválida.',
};

/**
 * Valida una cita contra las reglas de negocio puras (duración y disponibilidad).
 * Los choques con otras citas se garantizan en la base de datos (restricción de exclusión).
 */
export function validarCita(params: {
  inicio: Date;
  duracionMin: number;
  especialidad: Especialidad;
  disponibilidad: Interval[];
  ahora?: Date;
}): ErrorAgenda | null {
  const { inicio, duracionMin, especialidad, disponibilidad } = params;
  if (Number.isNaN(inicio.getTime())) return 'inicio_invalido';
  if (!DURACIONES[especialidad].includes(duracionMin)) return 'duracion_no_permitida';
  const ahora = params.ahora ?? new Date();
  if (inicio.getTime() < ahora.getTime() - 60_000) return 'en_el_pasado';
  const a = DateTime.fromJSDate(inicio);
  const b = a.plus({ minutes: duracionMin });
  const ok = disponibilidad.some((iv) => iv.start! <= a && iv.end! >= b);
  return ok ? null : 'fuera_de_disponibilidad';
}

/**
 * Genera franjas libres de inicio para una fecha (en hora institucional), excluyendo bloques ocupados.
 */
export function franjasLibres(params: {
  disponibilidad: Interval[];
  ocupados: { inicio: Date; fin: Date }[];
  duracionMin: number;
  pasoMin?: number;
  ahora?: Date;
}): Date[] {
  const paso = params.pasoMin ?? 15;
  const ahora = DateTime.fromJSDate(params.ahora ?? new Date());
  const ocup = params.ocupados.map((o) => Interval.fromDateTimes(DateTime.fromJSDate(o.inicio), DateTime.fromJSDate(o.fin)));
  const out: Date[] = [];
  for (const iv of params.disponibilidad) {
    let t = iv.start!;
    while (t.plus({ minutes: params.duracionMin }) <= iv.end!) {
      const cand = Interval.fromDateTimes(t, t.plus({ minutes: params.duracionMin }));
      if (t >= ahora && !ocup.some((o) => o.overlaps(cand))) out.push(t.toJSDate());
      t = t.plus({ minutes: paso });
    }
  }
  return out;
}

export function fmtInstitucional(iso: string | Date, formato = "dd/MM/yyyy HH:mm"): string {
  const d = typeof iso === 'string' ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso);
  return d.setZone(TZ_INSTITUCIONAL).setLocale('es').toFormat(formato);
}
