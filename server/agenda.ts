import type { Interval } from 'luxon';
import type { Queryable } from './db';
import { expandirReglas, franjasAIntervalos, type ReglaDisponibilidad } from '@shared/schedule';

/** Disponibilidad efectiva (UTC) = reglas semanales en zona de origen + franjas confirmadas. */
export async function disponibilidadDe(c: Queryable, profesionalId: string, desde: Date, hasta: Date): Promise<Interval[]> {
  const reglas = (
    await c.query(
      `select dia_semana, to_char(hora_inicio,'HH24:MI') as hora_inicio, to_char(hora_fin,'HH24:MI') as hora_fin, tz
         from core.disponibilidad where vigente and profesional_id = $1`,
      [profesionalId],
    )
  ).rows as ReglaDisponibilidad[];
  const franjas = (
    await c.query(`select inicio, fin from core.franjas_confirmadas where activa and profesional_id = $1 and fin > $2 and inicio < $3`, [
      profesionalId,
      desde.toISOString(),
      hasta.toISOString(),
    ])
  ).rows;
  return [...expandirReglas(reglas, desde, hasta), ...franjasAIntervalos(franjas)];
}

export async function ocupadosDe(c: Queryable, profesionalId: string, desde: Date, hasta: Date, excluir?: string) {
  const r = await c.query(
    `select inicio, fin from ops.atenciones where profesional_id = $1 and estado in ('programada','confirmada','en_atencion')
       and fin > $2 and inicio < $3 and ($4::uuid is null or id <> $4)`,
    [profesionalId, desde.toISOString(), hasta.toISOString(), excluir ?? null],
  );
  return r.rows.map((x) => ({ inicio: new Date(x.inicio), fin: new Date(x.fin) }));
}
