import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context';
import { makeGuards } from '../auth';
import { parse } from './util';
import type { PresenceService } from '../presence';

/** Indicadores ejecutivos calculados exclusivamente a partir de registros reales. Solo agregados. */
export async function indicadores(ctx: AppCtx, presence: PresenceService, dias = 14) {
  const db = ctx.db;
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const all = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
  const snap = await presence.snapshot();
  const tele = snap.filter((s) => s.es_teleatencion);

  const personas = await one(`
    select (select count(*) from ops.servidores where activo_en_fuente)::int as registrados,
           (select count(distinct servidor_id) from ops.contactos where resultado = 'contactado')::int as contactados,
           (select count(distinct servidor_id) from ops.atenciones where estado = 'atendida')::int as valorados,
           (select count(distinct servidor_id) from ops.atenciones where estado in ('programada','confirmada') and inicio > now())::int as con_atencion_programada,
           (select count(*) from ops.atenciones where estado = 'atendida')::int as atenciones_realizadas,
           (select count(*) from ops.servidores s where activo_en_fuente
               and not exists (select 1 from ops.atenciones a where a.servidor_id = s.id and a.estado in ('atendida','programada','confirmada','en_atencion')))::int as pendientes,
           (select count(*) from ops.seguimientos where estado = 'pendiente')::int as seguimientos_pendientes,
           (select count(*) from ops.seguimientos where estado = 'realizado')::int as seguimientos_realizados,
           (select count(*) from ops.derivaciones)::int as derivaciones,
           (select count(*) from ops.necesidades)::int as necesidades,
           (select count(*) from ops.necesidades where estado = 'resuelta')::int as necesidades_resueltas,
           (select count(*) from ops.necesidades where estado = 'parcial')::int as necesidades_parciales,
           (select count(*) from ops.necesidades where estado = 'pendiente')::int as necesidades_pendientes`);

  const evolucion = await all(
    `select to_char(d, 'YYYY-MM-DD') as dia,
            (select count(*) from ops.atenciones a where a.estado = 'atendida' and (a.finalizada_at at time zone 'Pacific/Galapagos')::date = d)::int as atendidas,
            (select count(*) from ops.atenciones a where a.estado = 'no_realizada' and (a.inicio at time zone 'Pacific/Galapagos')::date = d)::int as no_realizadas
       from generate_series((now() at time zone 'Pacific/Galapagos')::date - ($1::int - 1), (now() at time zone 'Pacific/Galapagos')::date, interval '1 day') d`,
    [dias],
  );
  const porProfesional = await all(`
    select p.id, p.nombre_corto as nombre, p.especialidad,
           count(a.*) filter (where a.estado = 'atendida')::int as atendidas,
           count(a.*) filter (where a.estado in ('programada','confirmada') and a.inicio > now())::int as programadas,
           count(a.*) filter (where a.estado = 'no_realizada')::int as no_realizadas
      from core.profesionales p left join ops.atenciones a on a.profesional_id = p.id
     where p.es_teleatencion group by p.id order by p.orden`);
  const porEspecialidad = await all(`select tipo, count(*)::int as n from ops.atenciones where estado = 'atendida' group by tipo`);
  const necesidades = await all(`select categoria, estado, count(*)::int as n from ops.necesidades group by categoria, estado`);
  const cumplimiento = await one(`
    select count(*) filter (where estado = 'atendida')::int as atendidas,
           count(*) filter (where estado = 'no_realizada')::int as no_realizadas,
           count(*) filter (where estado = 'reprogramada')::int as reprogramadas
      from ops.atenciones where inicio < now()`);
  const derivaciones = await all(`select estado, count(*)::int as n from ops.derivaciones group by estado`);
  const seguimientos = await all(`select estado, count(*)::int as n from ops.seguimientos group by estado`);
  const actividades = await one(`
    select (select count(*) from ops.debriefings where estado = 'realizada')::int as debriefings_realizados,
           (select coalesce(sum(participantes_asistentes),0) from ops.debriefings where estado = 'realizada')::int as debriefing_participantes,
           (select count(*) from ops.capacitaciones where estado = 'realizada')::int as capacitaciones_realizadas,
           (select coalesce(sum(participantes_asistentes),0) from ops.capacitaciones where estado = 'realizada')::int as capacitacion_participantes,
           (select count(*) from ops.articulaciones)::int as acciones_territoriales`);

  // ---- Ampliación: solo conteos agregados (sin nombres, notas, diagnósticos ni respuestas individuales) ----
  const prioritaria = await one(`
    with p as (select distinct servidor_id from clinical.clasificaciones_riesgo r join ops.servidores s on s.id = r.servidor_id where r.vigente and s.en_santa_cruz is not false)
    select (select count(*) from p)::int as identificados,
           (select count(distinct c.servidor_id) from ops.contactos c join p using (servidor_id) where c.resultado = 'contactado')::int as contactados,
           (select count(distinct a.servidor_id) from ops.asignaciones a join p using (servidor_id) where a.activa)::int as asignados,
           (select count(*) from ops.atenciones a join p using (servidor_id) where a.estado in ('programada','confirmada') and a.inicio > now())::int as atenciones_programadas,
           (select count(*) from ops.atenciones a join p using (servidor_id) where a.estado = 'atendida')::int as atenciones_realizadas,
           (select count(*) from ops.seguimientos g join p using (servidor_id) where g.estado = 'pendiente')::int as seguimientos_pendientes`);
  const abierta = await one(`
    select count(*)::int as solicitudes_recibidas,
           count(*) filter (where verificacion in ('verificado_maestra','verificado_manual'))::int as servidores_verificados,
           count(*) filter (where verificacion = 'pendiente_verificacion' and estado not in ('cerrada','cancelada'))::int as pendientes_verificacion,
           count(*) filter (where estado = 'pendiente_asignacion')::int as pendientes_asignacion,
           (select count(*) from ops.solicitudes_atencion sa join ops.atenciones a on a.id = sa.atencion_id where a.estado in ('programada','confirmada'))::int as atenciones_programadas,
           (select count(*) from ops.solicitudes_atencion sa join ops.atenciones a on a.id = sa.atencion_id where a.estado = 'atendida')::int as atenciones_realizadas
      from ops.solicitudes_atencion`);
  const hce = await one(`
    select (select count(*) from clinical.expedientes where estado = 'abierto')::int as expedientes_abiertos,
           (select count(*) from clinical.expedientes where updated_at > now() - interval '30 days')::int as expedientes_actualizados_30d,
           (select count(*) from clinical.entradas)::int as atenciones_registradas,
           (select count(*) from clinical.entradas where estado = 'validada')::int as entradas_validadas,
           (select count(*) from clinical.entradas where estado = 'borrador')::int as entradas_borrador,
           (select count(*) from clinical.adendas)::int as adendas`);
  const consentimiento = await one(`
    select count(*) filter (where estado = 'pendiente')::int as pendientes,
           count(*) filter (where estado = 'cargado')::int as cargados,
           count(*) filter (where estado = 'pendiente_validacion')::int as pendientes_validacion,
           count(*) filter (where estado = 'validado')::int as validados,
           count(*) filter (where estado = 'requiere_correccion')::int as requieren_correccion,
           count(*) filter (where estado = 'revocado')::int as revocados,
           (select count(*) from ops.atenciones where inicio_urgente)::int as inicios_urgentes,
           (select count(*) from ops.consentimientos where tipo = 'teleatencion' and modalidad = 'constancia_profesional')::int as constancias_previas
      from ops.consentimientos where tipo = 'teleatencion' and modalidad in ('electronica','firmada_manual')`);

  const resueltasAgenda = cumplimiento.atendidas + cumplimiento.no_realizadas;
  return {
    generado: new Date().toISOString(),
    personas: {
      ...personas,
      cobertura: personas.registrados ? Math.round((personas.valorados / personas.registrados) * 1000) / 10 : null,
    },
    equipo: {
      registrados: tele.length,
      con_cuenta: tele.filter((s) => s.tiene_cuenta).length,
      conectados: tele.filter((s) => s.conectado).length,
      disponibles: tele.filter((s) => s.estado === 'disponible').length,
      en_consulta: tele.filter((s) => s.estado === 'en_consulta').length,
      en_reunion: tele.filter((s) => s.estado === 'en_reunion').length,
      en_horario: tele.filter((s) => s.en_horario).length,
    },
    evolucion,
    por_profesional: porProfesional,
    por_especialidad: porEspecialidad,
    necesidades,
    cumplimiento_agenda: { ...cumplimiento, porcentaje: resueltasAgenda ? Math.round((cumplimiento.atendidas / resueltasAgenda) * 1000) / 10 : null },
    derivaciones,
    seguimientos,
    actividades,
    prioritaria,
    abierta,
    hce,
    consentimiento,
  };
}

export function dashboardRoutes(app: FastifyInstance, ctx: AppCtx, presence: PresenceService) {
  const { requirePerm } = makeGuards(ctx);

  app.get('/api/dashboard/indicadores', { preHandler: requirePerm('indicadores.agregados') }, async (req) => {
    const q = parse(z.object({ dias: z.coerce.number().int().min(7).max(90).default(14) }), req.query);
    return indicadores(ctx, presence, q.dias);
  });

  /** Reportes agregados en CSV (sin datos personales). */
  app.get('/api/reportes/:tipo.csv', { preHandler: requirePerm('reportes.ver') }, async (req, rep) => {
    const { tipo } = req.params as { tipo: string };
    const ind = await indicadores(ctx, presence, 30);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = (rows: Record<string, unknown>[]) => (rows.length ? [Object.keys(rows[0]).map(esc).join(','), ...rows.map((r) => Object.values(r).map(esc).join(','))].join('\n') : '');
    let body = '';
    if (tipo === 'resumen') {
      const filas = [
        ...Object.entries(ind.personas).map(([k, v]) => ({ grupo: 'personas', indicador: k, valor: v })),
        ...Object.entries(ind.equipo).map(([k, v]) => ({ grupo: 'equipo', indicador: k, valor: v })),
        ...Object.entries(ind.actividades).map(([k, v]) => ({ grupo: 'actividades', indicador: k, valor: v })),
        ...Object.entries(ind.prioritaria).map(([k, v]) => ({ grupo: 'atencion_prioritaria', indicador: k, valor: v })),
        ...Object.entries(ind.abierta).map(([k, v]) => ({ grupo: 'atencion_abierta', indicador: k, valor: v })),
        ...Object.entries(ind.hce).map(([k, v]) => ({ grupo: 'historias_clinicas', indicador: k, valor: v })),
        ...Object.entries(ind.consentimiento).map(([k, v]) => ({ grupo: 'consentimiento', indicador: k, valor: v })),
        { grupo: 'agenda', indicador: 'cumplimiento_porcentaje', valor: ind.cumplimiento_agenda.porcentaje },
      ];
      body = csv(filas);
    } else if (tipo === 'profesionales') body = csv(ind.por_profesional);
    else if (tipo === 'evolucion') body = csv(ind.evolucion);
    else if (tipo === 'necesidades') body = csv(ind.necesidades);
    else if (tipo === 'derivaciones') body = csv(ind.derivaciones);
    else {
      rep.code(404);
      return { error: 'Reporte no encontrado' };
    }
    rep.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="cgreg-${tipo}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return '﻿' + body;
  });
}
