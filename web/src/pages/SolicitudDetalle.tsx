import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, ErrorMsg, Field, PageHeader, Spinner, useSubmit } from '../components/ui';
import { fDiaSolo, fFechaHora } from '../lib/format';
import { tonoPrioridad } from './Comando';
import { tonoSolicitud } from './Solicitudes';
import { ESTADO_SOLICITUD_LABEL, PRIORIDAD_LABEL, ROL_LABEL, TIPO_SOLICITUD_LABEL, type EstadoSolicitud, type Rol } from '@shared/domain';

const ACCION_LABEL: Record<string, string> = {
  creada: 'Solicitud creada',
  revisada: 'Revisada por Coordinación',
  aceptada: 'Aceptada para gestión',
  respuesta: 'Respuesta de Coordinación',
  solicitar_informacion: 'Solicitud de información adicional',
  informacion_aportada: 'Información aportada',
  gestion_registrada: 'Gestión realizada',
  seguimiento_programado: 'Seguimiento programado',
  estado_actualizado: 'Estado actualizado',
  respuesta_externa: 'Respuesta de institución externa',
  cerrada: 'Solicitud cerrada',
  comentario: 'Comentario',
};

const ACCIONES_COORD = [
  { id: 'aceptar', label: 'Aceptar', campos: [] },
  { id: 'responder', label: 'Responder', campos: ['comentario'] },
  { id: 'solicitar_informacion', label: 'Solicitar información', campos: ['comentario'] },
  { id: 'gestion_registrada', label: 'Registrar gestión', campos: ['comentario', 'institucion'] },
  { id: 'seguimiento_programado', label: 'Fecha de seguimiento', campos: ['fecha_seguimiento', 'comentario'] },
  { id: 'respuesta_externa', label: 'Registrar respuesta externa', campos: ['comentario', 'institucion', 'estado_ext'] },
  { id: 'estado_actualizado', label: 'Actualizar estado', campos: ['estado', 'comentario', 'institucion'] },
  { id: 'cerrar', label: 'Cerrar', campos: ['comentario'] },
] as const;

export default function SolicitudDetalle() {
  const { id } = useParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['solicitud', id], queryFn: () => api.get(`/api/solicitudes/${id}`) });
  const esCoord = me?.rol === 'coordinacion';
  const [accion, setAccion] = useState<string>(esCoord ? 'aceptar' : 'informacion_aportada');
  const [f, setF] = useState({ comentario: '', institucion: '', fecha_seguimiento: '', estado: 'pendiente_respuesta_externa', estado_ext: 'en_gestion' });
  const s = useSubmit(
    () =>
      api.post(`/api/solicitudes/${id}/acciones`, {
        accion,
        comentario: f.comentario || undefined,
        institucion: f.institucion || undefined,
        fecha_seguimiento: f.fecha_seguimiento || undefined,
        estado: accion === 'estado_actualizado' ? f.estado : accion === 'respuesta_externa' ? f.estado_ext : undefined,
      }),
    () => {
      setF({ ...f, comentario: '', institucion: '', fecha_seguimiento: '' });
      qc.invalidateQueries();
    },
  );
  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-4"><ErrorMsg error={q.error} /></div>;
  const { solicitud: sol, acciones } = q.data;
  const cerrada = sol.estado === 'cerrada';
  const def = ACCIONES_COORD.find((a) => a.id === accion);
  const campos: readonly string[] = esCoord ? def?.campos ?? [] : ['comentario'];
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title={`Solicitud ${sol.codigo}`}
        subtitle={<>{TIPO_SOLICITUD_LABEL[sol.tipo as keyof typeof TIPO_SOLICITUD_LABEL] ?? sol.tipo} · {sol.solicitante_nombre} ({ROL_LABEL[sol.solicitante_rol as Rol]}) · {fFechaHora(sol.created_at)}</>}
        actions={<><Badge tono={tonoPrioridad[sol.prioridad]}>{PRIORIDAD_LABEL[sol.prioridad as keyof typeof PRIORIDAD_LABEL]}</Badge><Badge tono={tonoSolicitud[sol.estado as EstadoSolicitud]}>{ESTADO_SOLICITUD_LABEL[sol.estado as EstadoSolicitud]}</Badge></>}
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <Card title="Detalle">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><dt className="label">Descripción de la necesidad</dt><dd className="whitespace-pre-wrap">{sol.descripcion}</dd></div>
              <div className="sm:col-span-2"><dt className="label">Acción requerida de Coordinación General</dt><dd className="whitespace-pre-wrap font-medium">{sol.accion_requerida}</dd></div>
              <div><dt className="label">Respuesta requerida para</dt><dd>{fDiaSolo(sol.fecha_respuesta_requerida)}</dd></div>
              <div><dt className="label">Fecha de seguimiento</dt><dd>{fDiaSolo(sol.fecha_seguimiento)}</dd></div>
              <div><dt className="label">Institución contactada</dt><dd>{sol.institucion_contactada ?? '—'}</dd></div>
              <div><dt className="label">Servidor relacionado</dt><dd>{sol.servidor_id ? <Link className="text-cyan-300 hover:underline" to={`/servidores/${sol.servidor_id}`}>{sol.servidor_nombre}</Link> : '—'}</dd></div>
              {sol.observaciones && <div className="sm:col-span-2"><dt className="label">Observaciones operativas</dt><dd className="whitespace-pre-wrap">{sol.observaciones}</dd></div>}
              {sol.respuesta && <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 sm:col-span-2"><dt className="label !text-emerald-200">Respuesta de Coordinación General</dt><dd className="whitespace-pre-wrap">{sol.respuesta}</dd></div>}
            </dl>
          </Card>
          {!cerrada && (esCoord || sol.solicitante_id === me?.id) && (
            <Card title={esCoord ? 'Gestionar solicitud' : 'Aportar información'}>
              {esCoord && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {ACCIONES_COORD.map((a) => (
                    <button key={a.id} onClick={() => setAccion(a.id)} className={`btn-sm rounded-lg border px-2.5 py-1 text-xs ${accion === a.id ? 'border-cyan-400 bg-cyan-500/20 text-white' : 'hover:bg-white/5'}`} style={accion === a.id ? undefined : { borderColor: 'var(--line)' }}>{a.label}</button>
                  ))}
                </div>
              )}
              {!esCoord && sol.estado !== 'requiere_informacion' && <p className="mb-2 text-xs muted">Puede agregar información en cualquier momento; Coordinación será notificada.</p>}
              <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); s.run(undefined); }}>
                {campos.includes('comentario') && <Field label={accion === 'responder' ? 'Respuesta' : accion === 'respuesta_externa' ? 'Respuesta recibida' : 'Comentario'}><textarea className="input min-h-[80px]" required={!['cerrar', 'seguimiento_programado', 'estado_actualizado'].includes(accion)} value={f.comentario} onChange={(e) => setF({ ...f, comentario: e.target.value })} /></Field>}
                {campos.includes('institucion') && <Field label="Institución contactada"><input className="input" value={f.institucion} onChange={(e) => setF({ ...f, institucion: e.target.value })} /></Field>}
                {campos.includes('fecha_seguimiento') && <Field label="Fecha de seguimiento"><input type="date" className="input" required value={f.fecha_seguimiento} onChange={(e) => setF({ ...f, fecha_seguimiento: e.target.value })} /></Field>}
                {campos.includes('estado') && (
                  <Field label="Nuevo estado">
                    <select className="input" value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
                      {(['recibida', 'en_gestion', 'pendiente_respuesta_externa', 'requiere_informacion', 'resuelta'] as EstadoSolicitud[]).map((e) => <option key={e} value={e}>{ESTADO_SOLICITUD_LABEL[e]}</option>)}
                    </select>
                  </Field>
                )}
                {campos.includes('estado_ext') && (
                  <Field label="Resultado"><select className="input" value={f.estado_ext} onChange={(e) => setF({ ...f, estado_ext: e.target.value })}><option value="en_gestion">Continúa en gestión</option><option value="resuelta">Gestión resuelta</option></select></Field>
                )}
                {accion === 'cerrar' && sol.estado !== 'resuelta' && <div className="text-xs text-amber-200">Solo se cierran solicitudes resueltas. Use «Actualizar estado → Resuelta» primero.</div>}
                <ErrorMsg error={s.error} />
                <div><button className="btn-primary" disabled={s.busy}>{esCoord ? def?.label : 'Enviar información'}</button></div>
              </form>
            </Card>
          )}
        </div>
        <Card title="Historial de comunicación y gestiones">
          <ol className="space-y-3 border-l pl-3 text-sm" style={{ borderColor: 'var(--line)' }}>
            {acciones.map((a: any) => (
              <li key={a.id}>
                <div className="font-medium">{ACCION_LABEL[a.accion] ?? a.accion}{a.estado_nuevo && a.estado_nuevo !== a.estado_anterior && <span className="font-normal muted"> → {ESTADO_SOLICITUD_LABEL[a.estado_nuevo as EstadoSolicitud]}</span>}</div>
                {a.comentario && <div className="mt-0.5 whitespace-pre-wrap rounded-lg bg-white/5 px-2 py-1">{a.comentario}</div>}
                {a.institucion && <div className="text-xs muted">Institución: {a.institucion}</div>}
                {a.fecha_seguimiento && <div className="text-xs muted">Seguimiento: {fDiaSolo(a.fecha_seguimiento)}</div>}
                <div className="text-[11px] faint">{fFechaHora(a.ts)} · {a.actor_nombre}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
