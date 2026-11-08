import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Inbox, ListTodo, Clock4, Building, CalendarCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, PageHeader, Spinner, Stat, type Tono } from '../components/ui';
import { Apiladas, Barras, Columnas, Progreso, SERIES, STATUS } from '../components/charts';
import { fDiaSolo, fFechaHora, fRelativo } from '../lib/format';
import { CATEGORIA_NECESIDAD_LABEL, ESPECIALIDAD_LABEL, ESTADO_DERIVACION_LABEL, ESTADO_SOLICITUD_LABEL, PRIORIDAD_LABEL, TIPO_SOLICITUD_LABEL, type CategoriaNecesidad, type EstadoDerivacion, type Especialidad } from '@shared/domain';
import { DateTime } from 'luxon';

export { tonoPrioridad } from '../lib/tonos';
import { tonoPrioridad } from '../lib/tonos';

function SolicitudItem({ s }: { s: any }) {
  return (
    <li>
      <Link to={`/solicitudes/${s.id}`} className="flex flex-col gap-1 rounded-xl border p-3 transition hover:bg-white/5" style={{ borderColor: 'var(--line)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tono={tonoPrioridad[s.prioridad]}>{s.prioridad === 'urgente' && <AlertTriangle size={12} />}{PRIORIDAD_LABEL[s.prioridad as keyof typeof PRIORIDAD_LABEL]}</Badge>
          <span className="text-xs faint">{s.codigo}</span>
          <Badge tono="info">{ESTADO_SOLICITUD_LABEL[s.estado as keyof typeof ESTADO_SOLICITUD_LABEL]}</Badge>
          {s.fecha_respuesta_requerida && <span className="text-xs muted">Respuesta requerida: {fDiaSolo(s.fecha_respuesta_requerida)}</span>}
        </div>
        <div className="text-sm font-medium">{s.accion_requerida}</div>
        <div className="text-xs muted">{s.solicitante_nombre} · {TIPO_SOLICITUD_LABEL[s.tipo as keyof typeof TIPO_SOLICITUD_LABEL] ?? s.tipo} · {fRelativo(s.created_at)}</div>
      </Link>
    </li>
  );
}

export default function Comando() {
  const { me } = useAuth();
  const esCoord = me?.rol === 'coordinacion';
  const ind = useQuery({ queryKey: ['indicadores'], queryFn: () => api.get('/api/dashboard/indicadores?dias=14'), refetchInterval: 60_000 });
  const panel = useQuery({ queryKey: ['panel-coord'], queryFn: () => api.get('/api/coordinacion/panel'), enabled: esCoord, refetchInterval: 60_000 });
  const d = ind.data;
  const p = panel.data;

  return (
    <div className="p-3 sm:p-4">
      <PageHeader title="Centro de Comando Ejecutivo" subtitle={`Indicadores calculados con registros reales de la plataforma${d ? ` · actualizado ${fFechaHora(d.generado)}` : ''}`} />

      {esCoord && (
        <div className="mb-4 grid gap-3 xl:grid-cols-2">
          <Card title="¿Qué necesitan de mí los profesionales?" icon={<Inbox size={18} className="text-cyan-300" />} actions={<Link to="/solicitudes" className="text-xs text-cyan-300 hover:underline">Ver bandeja</Link>}>
            {panel.isLoading ? <Spinner /> : (p?.que_necesitan ?? []).length === 0 ? <Empty>No hay solicitudes pendientes de su intervención.</Empty> : (
              <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1 scroll-thin">{p.que_necesitan.map((s: any) => <SolicitudItem key={s.id} s={s} />)}</ul>
            )}
          </Card>
          <Card title="¿Qué debo gestionar hoy?" icon={<ListTodo size={18} className="text-cyan-300" />}>
            {panel.isLoading ? <Spinner /> : (
              <div className="space-y-4 text-sm">
                {(p?.alertas ?? []).length > 0 && (
                  <ul className="space-y-1.5">
                    {p.alertas.map((a: any, i: number) => (
                      <li key={i} className={`flex items-start gap-2 rounded-lg px-3 py-2 ${a.nivel === 'alta' ? 'bg-red-500/10 text-red-100' : 'bg-amber-500/10 text-amber-100'}`}>
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        {a.enlace ? <Link to={a.enlace} className="hover:underline">{a.texto}</Link> : a.texto}
                      </li>
                    ))}
                  </ul>
                )}
                <Bloque titulo="Gestiones con seguimiento para hoy o vencido" icon={<Clock4 size={15} />} items={p?.gestionar_hoy.seguimiento_hoy} render={(s) => <Link to={`/solicitudes/${s.id}`} className="hover:underline">{s.codigo} · {s.accion_requerida} <span className="muted">({fDiaSolo(s.fecha_seguimiento)})</span></Link>} />
                <Bloque titulo="Esperando respuesta de instituciones" icon={<Building size={15} />} items={p?.gestionar_hoy.respuestas_externas} render={(s) => <Link to={`/solicitudes/${s.id}`} className="hover:underline">{s.codigo} · {s.institucion_contactada ?? 'Institución'} — {s.accion_requerida}</Link>} />
                <Bloque titulo="Acciones atrasadas" icon={<AlertTriangle size={15} />} items={p?.gestionar_hoy.atrasadas} render={(s) => <Link to={`/solicitudes/${s.id}`} className="text-red-200 hover:underline">{s.codigo} · venció {fDiaSolo(s.fecha_respuesta_requerida)} — {s.accion_requerida}</Link>} />
                <Bloque titulo="Compromisos próximos (48 h)" icon={<CalendarCheck size={15} />} items={p?.gestionar_hoy.compromisos} render={(c) => <Link to={c.tipo === 'debriefing' ? '/debriefing' : '/capacitacion'} className="hover:underline">{fFechaHora(c.inicio)} · {c.titulo}</Link>} />
              </div>
            )}
          </Card>
        </div>
      )}

      {ind.isLoading || !d ? <Spinner /> : (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide muted">Personas atendidas</h2>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Servidores registrados" value={d.personas.registrados} hint="Matriz institucional" />
            <Stat label="Personas contactadas" value={d.personas.contactados} />
            <Stat label="Personas valoradas" value={d.personas.valorados} />
            <Stat label="Con atención programada" value={d.personas.con_atencion_programada} />
            <Stat label="Atenciones realizadas" value={d.personas.atenciones_realizadas} />
            <Stat label="Personas pendientes" value={d.personas.pendientes} />
          </div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide muted">Equipo y seguimiento</h2>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Profesionales registrados" value={d.equipo.registrados} hint={`${d.equipo.con_cuenta} con cuenta activa`} />
            <Stat label="Conectados" value={d.equipo.conectados} hint={`${d.equipo.en_horario} en horario programado`} />
            <Stat label="Disponibles" value={d.equipo.disponibles} />
            <Stat label="En consulta" value={d.equipo.en_consulta} />
            <Stat label="Seguimientos pendientes" value={d.personas.seguimientos_pendientes} />
            <Stat label="Derivaciones a Psiquiatría" value={d.personas.derivaciones} />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Necesidades identificadas" value={d.personas.necesidades} />
            <Stat label="Necesidades resueltas" value={d.personas.necesidades_resueltas} tone={STATUS.good} />
            <Stat label="Parcialmente resueltas" value={d.personas.necesidades_parciales} tone={STATUS.warning} />
            <Stat label="Necesidades pendientes" value={d.personas.necesidades_pendientes} tone={STATUS.serious} />
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <Card title="Atención prioritaria (riesgo alto registrado)">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Identificados" value={d.prioritaria.identificados} />
                <Stat label="Contactados" value={d.prioritaria.contactados} />
                <Stat label="Asignados" value={d.prioritaria.asignados} />
                <Stat label="Atenciones programadas" value={d.prioritaria.atenciones_programadas} />
                <Stat label="Atenciones realizadas" value={d.prioritaria.atenciones_realizadas} />
                <Stat label="Seguimientos pendientes" value={d.prioritaria.seguimientos_pendientes} />
              </div>
            </Card>
            <Card title="Atención abierta (solicitud voluntaria)">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Solicitudes recibidas" value={d.abierta.solicitudes_recibidas} />
                <Stat label="Servidores verificados" value={d.abierta.servidores_verificados} hint={`${d.abierta.pendientes_verificacion} pendientes de verificación`} />
                <Stat label="Pendientes de asignación" value={d.abierta.pendientes_asignacion} tone={d.abierta.pendientes_asignacion ? STATUS.warning : undefined} />
                <Stat label="Atenciones programadas" value={d.abierta.atenciones_programadas} />
                <Stat label="Atenciones realizadas" value={d.abierta.atenciones_realizadas} />
              </div>
            </Card>
            <Card title="Historias clínicas electrónicas">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Expedientes abiertos" value={d.hce.expedientes_abiertos} />
                <Stat label="Actualizados (30 días)" value={d.hce.expedientes_actualizados_30d} />
                <Stat label="Atenciones registradas" value={d.hce.atenciones_registradas} hint={`${d.hce.entradas_validadas} validadas · ${d.hce.entradas_borrador} en borrador`} />
              </div>
            </Card>
            <Card title="Consentimiento informado (documentado)">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Pendientes" value={d.consentimiento.pendientes} />
                <Stat label="Cargados" value={d.consentimiento.cargados} />
                <Stat label="Pendientes de validación" value={d.consentimiento.pendientes_validacion} tone={d.consentimiento.pendientes_validacion ? STATUS.warning : undefined} />
                <Stat label="Validados" value={d.consentimiento.validados} tone={STATUS.good} />
              </div>
              <div className="mt-2 text-xs faint">{d.consentimiento.requieren_correccion} requieren corrección · {d.consentimiento.revocados} revocados · {d.consentimiento.inicios_urgentes} inicio(s) por urgencia · {d.consentimiento.constancias_previas} constancia(s) previa(s) sin documento</div>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Evolución diaria de atenciones realizadas (14 días)">
              <Columnas etiqueta="Atenciones realizadas por día" datos={d.evolucion.map((e: any) => ({ x: DateTime.fromISO(e.dia).toFormat('dd/MM'), y: e.atendidas, detalle: `No realizadas: ${e.no_realizadas}` }))} />
            </Card>
            <Card title="Cobertura y cumplimiento">
              <div className="space-y-5 pt-2">
                <Progreso valor={d.personas.cobertura} etiqueta={`Cobertura de atención (${d.personas.valorados} de ${d.personas.registrados} servidores valorados)`} />
                <Progreso valor={d.cumplimiento_agenda.porcentaje} etiqueta={`Cumplimiento de agenda (${d.cumplimiento_agenda.atendidas} atendidas · ${d.cumplimiento_agenda.no_realizadas} no realizadas)`} color={SERIES[2]} />
                <div className="text-xs faint">{d.cumplimiento_agenda.reprogramadas} cita(s) reprogramada(s). Los porcentajes se muestran solo cuando existen registros.</div>
              </div>
            </Card>
            <Card title="Atenciones realizadas por profesional">
              <Barras datos={d.por_profesional.map((x: any) => ({ label: x.nombre, valor: x.atendidas, detalle: `Programadas: ${x.programadas} · No realizadas: ${x.no_realizadas}` }))} />
            </Card>
            <Card title="Distribución por especialidad">
              <Barras datos={(['psicologia', 'telemedicina', 'psiquiatria'] as Especialidad[]).map((e) => ({ label: ESPECIALIDAD_LABEL[e], valor: d.por_especialidad.find((x: any) => x.tipo === e)?.n ?? 0 }))} />
            </Card>
            <Card title="Necesidades por categoría y estado">
              <Apiladas
                segmentos={[
                  { key: 'resuelta', label: 'Resuelta', color: STATUS.good },
                  { key: 'parcial', label: 'Parcial', color: STATUS.warning },
                  { key: 'pendiente', label: 'Pendiente', color: STATUS.critical },
                ]}
                filas={Object.entries(
                  d.necesidades.reduce((acc: Record<string, Record<string, number>>, n: any) => {
                    acc[n.categoria] = { ...(acc[n.categoria] ?? {}), [n.estado]: n.n };
                    return acc;
                  }, {}),
                ).map(([k, v]) => ({ label: CATEGORIA_NECESIDAD_LABEL[k as CategoriaNecesidad] ?? k, valores: v as Record<string, number> }))}
              />
            </Card>
            <Card title="Derivaciones y seguimientos">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs muted">Derivaciones por estado</div>
                  <Barras color={SERIES[6]} datos={d.derivaciones.map((x: any) => ({ label: ESTADO_DERIVACION_LABEL[x.estado as EstadoDerivacion], valor: x.n }))} />
                </div>
                <div>
                  <div className="mb-2 text-xs muted">Seguimientos</div>
                  <Barras color={SERIES[2]} datos={['pendiente', 'realizado', 'cancelado'].map((e) => ({ label: e[0].toUpperCase() + e.slice(1), valor: d.seguimientos.find((x: any) => x.estado === e)?.n ?? 0 }))} />
                </div>
              </div>
            </Card>
            <Card title="Debriefing, capacitación y territorio" className="lg:col-span-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat label="Debriefings realizados" value={d.actividades.debriefings_realizados} />
                <Stat label="Participantes en debriefing" value={d.actividades.debriefing_participantes} />
                <Stat label="Capacitaciones DECE" value={d.actividades.capacitaciones_realizadas} />
                <Stat label="Participantes capacitados" value={d.actividades.capacitacion_participantes} />
                <Stat label="Acciones territoriales" value={d.actividades.acciones_territoriales} />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Bloque({ titulo, icon, items, render }: { titulo: string; icon: React.ReactNode; items?: any[]; render: (x: any) => React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide muted">{icon}{titulo} <span className="faint">({items?.length ?? 0})</span></div>
      {!items?.length ? <div className="text-xs faint">Nada pendiente.</div> : <ul className="space-y-1">{items.map((x) => <li key={x.id}>{render(x)}</li>)}</ul>}
    </div>
  );
}
