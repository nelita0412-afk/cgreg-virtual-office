import { ejerceTrabajoSocial } from '@shared/permissions';
import type { Queryable } from './db';
import type { Config } from './config';
import type { SessionUser } from './context';
import { forbidden } from './context';
import { AREA_DE_ATENCION, type AreaHce } from '@shared/domain';

/**
 * Nivel de acceso a la historia clínica de un servidor (continuidad asistencial controlada):
 * - 'clinico': profesional clínico con relación asistencial (asignación activa, derivación, atenciones o entradas propias).
 * - 'social': Trabajo Social asignado — solo registros sociales e información administrativa.
 * - 'administrativo': Coordinación General — metadatos operativos, sin contenido clínico.
 * - null: sin acceso.
 */
export type NivelHce = 'clinico' | 'social' | 'administrativo' | null;

export const ESPECIALIDADES_CLINICAS = ['psicologia', 'telemedicina', 'psiquiatria'];

export async function nivelAcceso(c: Queryable, user: SessionUser, servidorId: string): Promise<NivelHce> {
  if (user.rol === 'coordinacion') {
    // Coordinación: información administrativa de todos los casos. Si además ejerce Trabajo Social, en los casos
    // asignados a ella accede también a la información social. Nunca a las notas clínicas por su cargo.
    if (ejerceTrabajoSocial(user) && user.profesional_id) {
      const r = await c.query(`select 1 from ops.asignaciones where servidor_id = $1 and profesional_id = $2 and activa`, [servidorId, user.profesional_id]);
      if (r.rows[0]) return 'social';
    }
    return 'administrativo';
  }
  if (!user.profesional_id) return null;
  if (ejerceTrabajoSocial(user) && user.rol !== 'profesional') {
    const r = await c.query(`select 1 from ops.asignaciones where servidor_id = $1 and profesional_id = $2 and activa`, [servidorId, user.profesional_id]);
    return r.rows[0] ? 'social' : null;
  }
  if (user.rol !== 'profesional' || !ESPECIALIDADES_CLINICAS.includes(user.especialidad ?? '')) return null;
  const r = await c.query(
    `select 1 from ops.asignaciones where servidor_id = $1 and profesional_id = $2 and activa
     union all select 1 from ops.derivaciones where servidor_id = $1 and (especialista_id = $2 or profesional_derivante_id = $2)
     union all select 1 from ops.atenciones where servidor_id = $1 and profesional_id = $2 and estado <> 'pendiente'
     union all select 1 from clinical.entradas e join clinical.expedientes x on x.id = e.expediente_id where x.servidor_id = $1 and core.profesional_canonico(e.autor_profesional_id) = $2
     limit 1`,
    [servidorId, user.profesional_id],
  );
  return r.rows[0] ? 'clinico' : null;
}

export async function exigirNivel(c: Queryable, user: SessionUser, servidorId: string, ...permitidos: Exclude<NivelHce, null>[]) {
  const n = await nivelAcceso(c, user, servidorId);
  if (!n || !permitidos.includes(n)) throw forbidden('No tiene relación asistencial autorizada con este servidor.');
  return n;
}

export const areaDeEspecialidad = (esp: string | null | undefined): AreaHce | null =>
  esp && esp in AREA_DE_ATENCION ? AREA_DE_ATENCION[esp as keyof typeof AREA_DE_ATENCION] : null;

/** Abre (si no existe) el expediente único del servidor. */
export async function asegurarExpediente(c: Queryable, servidorId: string, profesionalId: string, especialidad: string, usuarioId: string | null) {
  const r = await c.query(
    `insert into clinical.expedientes (servidor_id, profesional_responsable_id, especialidad_apertura, abierto_por)
     values ($1,$2,$3,$4) on conflict (servidor_id) do nothing returning id, codigo`,
    [servidorId, profesionalId, especialidad, usuarioId],
  );
  if (r.rows[0]) return { id: r.rows[0].id as string, codigo: r.rows[0].codigo as string, nuevo: true };
  const e = (await c.query(`select id, codigo from clinical.expedientes where servidor_id = $1`, [servidorId])).rows[0];
  return { id: e.id as string, codigo: e.codigo as string, nuevo: false };
}

/** Garantiza la entrada cronológica (borrador) asociada a una atención. */
export async function asegurarEntrada(
  c: Queryable,
  cipher: { encryptJson: (o: unknown) => string },
  at: { id: string; servidor_id: string; profesional_id: string; tipo: string; iniciada_at?: string | null; inicio?: string | null },
  usuarioId: string,
) {
  const ex = await c.query(`select id from clinical.entradas where atencion_id = $1`, [at.id]);
  if (ex.rows[0]) return ex.rows[0].id as string;
  const exp = await asegurarExpediente(c, at.servidor_id, at.profesional_id, at.tipo, usuarioId);
  const area = areaDeEspecialidad(at.tipo) ?? 'psicologia';
  const contenido = cipher.encryptJson({});
  const r = await c.query(
    `insert into clinical.entradas (expediente_id, atencion_id, area, tipo, fecha_hora, autor_profesional_id, contenido_cifrado)
     values ($1,$2,$3,$4, coalesce($5::timestamptz, now()), $6, $7) returning id`,
    [exp.id, at.id, area, at.tipo === 'psiquiatria' ? 'valoracion_psiquiatrica' : 'consulta', at.iniciada_at ?? at.inicio ?? null, at.profesional_id, contenido],
  );
  await c.query(`insert into clinical.entrada_versiones (entrada_id, version, contenido_cifrado, autor_usuario_id) values ($1, 1, $2, $3)`, [r.rows[0].id, contenido, usuarioId]);
  await c.query(`update clinical.expedientes set updated_at = now() where id = $1`, [exp.id]);
  return r.rows[0].id as string;
}

/**
 * ¿Existe un consentimiento informado válido y aplicable al servicio?
 * Válido = estado «validado», no revocado, basado en un formato aprobado (o constancia profesional si la
 * institución la habilita expresamente). El aviso de privacidad de la matriz NUNCA cuenta como consentimiento.
 */
export async function consentimientoVigente(c: Queryable, cfg: Config, servidorId: string, servicio: string): Promise<boolean> {
  const modalidades = ['electronica', 'firmada_manual', ...(cfg.CONSENTIMIENTO_CONSTANCIA_PROFESIONAL === 'true' ? ['constancia_profesional'] : [])];
  const r = await c.query(
    `select 1 from ops.consentimientos k left join ops.consentimiento_plantillas p on p.id = k.plantilla_id
      where k.servidor_id = $1 and k.tipo = 'teleatencion' and k.estado = 'validado' and k.revocado_at is null
        and k.modalidad = any($2) and (k.servicio is null or k.servicio = $3)
        and (k.modalidad = 'constancia_profesional' or p.aprobada_at is not null)
      limit 1`,
    [servidorId, modalidades, servicio],
  );
  return !!r.rows[0];
}

export async function registrarHistorialConsentimiento(
  c: Queryable,
  consentimientoId: string,
  accion: string,
  anterior: string | null,
  nuevo: string | null,
  actor: string | null,
  extra: { nota?: string | null; documento_id?: string | null; ip?: string | null } = {},
) {
  await c.query(
    `insert into ops.consentimiento_historial (consentimiento_id, accion, estado_anterior, estado_nuevo, nota, documento_id, actor, ip) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [consentimientoId, accion, anterior, nuevo, extra.nota ?? null, extra.documento_id ?? null, actor, extra.ip ?? null],
  );
}
