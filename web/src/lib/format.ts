import { DateTime } from 'luxon';
import { TZ_INSTITUCIONAL } from '@shared/domain';

export const gal = (iso: string | null | undefined) => (iso ? DateTime.fromISO(iso).setZone(TZ_INSTITUCIONAL).setLocale('es') : null);
export const fFecha = (iso?: string | null) => gal(iso)?.toFormat('dd/MM/yyyy') ?? '—';
export const fFechaHora = (iso?: string | null) => gal(iso)?.toFormat('dd/MM/yyyy HH:mm') ?? '—';
export const fHora = (iso?: string | null) => gal(iso)?.toFormat('HH:mm') ?? '—';
export const fDiaLargo = (iso?: string | null) => gal(iso)?.toFormat("cccc d 'de' LLLL") ?? '—';
export const fRelativo = (iso?: string | null) => gal(iso)?.toRelative({ locale: 'es' }) ?? '—';
export const fDiaSolo = (d?: string | null) => (d ? DateTime.fromISO(d).setLocale('es').toFormat('dd/MM/yyyy') : '—');
export function minutosDesde(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}
export const ahoraGal = () => DateTime.now().setZone(TZ_INSTITUCIONAL);
/** Convierte 'YYYY-MM-DDTHH:mm' interpretado en hora de Galápagos a ISO UTC. */
export const localGalToISO = (v: string) => DateTime.fromISO(v, { zone: TZ_INSTITUCIONAL }).toUTC().toISO()!;
export const iniciales = (n: string) =>
  n
    .replace(/^(Dr\.|Dra\.|Ma\.)\s*/i, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
