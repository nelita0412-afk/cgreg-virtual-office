import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Lock, CalendarPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, ErrorMsg, Field, PageHeader, Spinner, useSubmit } from '../components/ui';
import { ProgramarCita } from '../components/ProgramarCita';
import { CitaAcciones } from '../components/CitaAcciones';
import { fFechaHora } from '../lib/format';
import { tonoDerivacion } from './Derivaciones';
import { tonoPrioridad } from './Comando';
import { ESTADO_DERIVACION_LABEL, PRIORIDAD_LABEL, type EstadoDerivacion } from '@shared/domain';

const SIGUIENTES: Partial<Record<EstadoDerivacion, EstadoDerivacion[]>> = {
  solicitada: ['en_revision', 'cerrada'],
  en_revision: ['pendiente_coordinacion', 'aceptada', 'cerrada'],
  pendiente_coordinacion: ['aceptada', 'cerrada'],
  aceptada: ['cerrada'],
  programada: ['cerrada'],
  valorada: ['en_seguimiento', 'cerrada'],
  en_seguimiento: ['cerrada'],
};

export default function DerivacionDetalle() {
  const { id } = useParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['derivacion', id], queryFn: () => api.get(`/api/derivaciones/${id}`) });
  const [nota, setNota] = useState('');
  const [cita, setCita] = useState(false);
  const [val, setVal] = useState({ valoracion: '', recomendaciones: '', seguimiento: '' });
  useEffect(() => {
    if (q.data?.clinico) setVal({ valoracion: q.data.clinico.valoracion ?? '', recomendaciones: q.data.clinico.recomendaciones ?? '', seguimiento: q.data.clinico.seguimiento ?? '' });
  }, [q.data?.clinico]);
  const estado = useSubmit((e: EstadoDerivacion) => api.post(`/api/derivaciones/${id}/estado`, { estado: e, nota_operativa: nota || undefined }), () => { setNota(''); qc.invalidateQueries(); });
  const guardarVal = useSubmit(() => api.put(`/api/derivaciones/${id}/valoracion`, { valoracion: val.valoracion, recomendaciones: val.recomendaciones || undefined, seguimiento: val.seguimiento || undefined }), () => qc.invalidateQueries());
  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-4"><ErrorMsg error={q.error} /></div>;
  const { derivacion: d, historial, clinico, es_especialista } = q.data;
  const puedeProgramar = d.estado === 'aceptada' && (me?.rol === 'coordinacion' || es_especialista);
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title={`Derivación ${d.codigo}`}
        subtitle={<>Servidor: {d.servidor_nombre} · Derivante: {d.derivante_nombre} · Especialista: {d.especialista_nombre}</>}
        actions={<><Badge tono={tonoPrioridad[d.prioridad]}>Prioridad {PRIORIDAD_LABEL[d.prioridad as keyof typeof PRIORIDAD_LABEL].toLowerCase()}</Badge><Badge tono={tonoDerivacion[d.estado as EstadoDerivacion]}>{ESTADO_DERIVACION_LABEL[d.estado as EstadoDerivacion]}</Badge></>}
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          {clinico ? (
            <Card title={<span className="flex items-center gap-2"><Lock size={16} className="text-emerald-300" /> Información clínica (acceso restringido)</span>}>
              <div className="label">Motivo de derivación</div>
              <p className="whitespace-pre-wrap text-sm">{clinico.motivo}</p>
              {!es_especialista && clinico.valoracion && (
                <div className="mt-4 space-y-2 text-sm">
                  <div><div className="label">Resultado de valoración</div><p className="whitespace-pre-wrap">{clinico.valoracion}</p></div>
                  {clinico.recomendaciones && <div><div className="label">Recomendaciones</div><p className="whitespace-pre-wrap">{clinico.recomendaciones}</p></div>}
                  {clinico.seguimiento && <div><div className="label">Seguimiento especializado</div><p className="whitespace-pre-wrap">{clinico.seguimiento}</p></div>}
                </div>
              )}
            </Card>
          ) : (
            <Card title="Información clínica"><p className="text-sm muted">Reservada al profesional derivante y al especialista. Coordinación gestiona la cita sin acceder al motivo.</p></Card>
          )}
          {es_especialista && (SIGUIENTES[d.estado as EstadoDerivacion] ?? []).length > 0 && (
            <Card title="Gestión del especialista">
              <Field label="Nota operativa (opcional, sin contenido clínico)"><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></Field>
              <div className="mt-3 flex flex-wrap gap-2">
                {SIGUIENTES[d.estado as EstadoDerivacion]!.map((e) => (
                  <button key={e} className={e === 'cerrada' ? 'btn-ghost' : 'btn-primary'} disabled={estado.busy} onClick={() => estado.run(e)}>Pasar a «{ESTADO_DERIVACION_LABEL[e]}»</button>
                ))}
              </div>
              <ErrorMsg error={estado.error} />
              {d.estado === 'pendiente_coordinacion' && <p className="mt-2 text-xs muted">Confirme su disponibilidad en «Mi Equipo → Confirmar franja» para que pueda programarse la valoración.</p>}
            </Card>
          )}
          {puedeProgramar && (
            <Card title="Coordinación de cita">
              <p className="mb-2 text-sm muted">Programe la valoración dentro de las franjas confirmadas por el especialista.</p>
              <button className="btn-primary" onClick={() => setCita(true)}><CalendarPlus size={16} /> Programar valoración</button>
            </Card>
          )}
          {d.atencion_id && (
            <Card title="Cita de valoración">
              <div className="mb-2 text-sm">{d.cita_inicio ? fFechaHora(d.cita_inicio) : '—'} · estado de la cita: {d.cita_estado ?? '—'}</div>
              <CitaAcciones a={{ id: d.atencion_id, estado: d.cita_estado, profesional_id: d.especialista_id, servidor_id: d.servidor_id }} />
            </Card>
          )}
          {es_especialista && ['programada', 'valorada', 'en_seguimiento'].includes(d.estado) && (
            <Card title={<span className="flex items-center gap-2"><Lock size={16} className="text-emerald-300" /> Valoración psiquiátrica</span>}>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); guardarVal.run(undefined); }}>
                <Field label="Resultado de valoración"><textarea className="input min-h-[110px]" required value={val.valoracion} onChange={(e) => setVal({ ...val, valoracion: e.target.value })} /></Field>
                <Field label="Recomendaciones"><textarea className="input" value={val.recomendaciones} onChange={(e) => setVal({ ...val, recomendaciones: e.target.value })} /></Field>
                <Field label="Seguimiento especializado"><textarea className="input" value={val.seguimiento} onChange={(e) => setVal({ ...val, seguimiento: e.target.value })} /></Field>
                <ErrorMsg error={guardarVal.error} />
                <button className="btn-primary" disabled={guardarVal.busy}>Guardar valoración</button>
                <p className="text-[11px] faint">La plataforma no genera diagnósticos automáticos; la valoración es responsabilidad del especialista.</p>
              </form>
            </Card>
          )}
        </div>
        <Card title="Trazabilidad">
          <ol className="space-y-2 border-l pl-3 text-sm" style={{ borderColor: 'var(--line)' }}>
            {historial.map((h: any, i: number) => (
              <li key={i}>
                <div>{h.estado_anterior ? `${ESTADO_DERIVACION_LABEL[h.estado_anterior as EstadoDerivacion]} → ` : ''}<strong>{ESTADO_DERIVACION_LABEL[h.estado_nuevo as EstadoDerivacion]}</strong></div>
                <div className="text-xs faint">{fFechaHora(h.ts)} · {h.actor}{h.nota_operativa ? ` · ${h.nota_operativa}` : ''}</div>
              </li>
            ))}
          </ol>
          <Link to={`/servidores/${d.servidor_id}`} className="mt-3 inline-block text-sm text-cyan-300 hover:underline">Ficha del servidor →</Link>
        </Card>
      </div>
      {cita && <ProgramarCita open onClose={() => setCita(false)} servidorId={d.servidor_id} profesionalId={d.especialista_id} derivacionId={d.id} titulo="Programar valoración psiquiátrica" />}
    </div>
  );
}
