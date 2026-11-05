import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, Square, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, ErrorMsg, Field, Modal, PageHeader, Spinner, useSubmit, type Tono } from '../components/ui';
import { fFechaHora, fHora, localGalToISO } from '../lib/format';
import { ESTADO_ACTIVIDAD_LABEL, type EstadoActividad } from '@shared/domain';

export const tonoActividad: Record<EstadoActividad, Tono> = { programada: 'info', en_curso: 'warning', realizada: 'good', cancelada: 'neutral' };

export function AccionesActividad({ a, base }: { a: any; base: string }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [fin, setFin] = useState(false);
  const [n, setN] = useState('');
  const [obs, setObs] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const esFac = me?.profesional_id === a.facilitador_id;
  const gestiona = esFac || me?.rol === 'coordinacion';
  const run = async (accion: string, body: unknown = {}) => {
    setErr(null);
    try {
      await api.post(`${base}/${a.id}/${accion}`, body);
      qc.invalidateQueries();
      setFin(false);
    } catch (e) {
      setErr(e);
    }
  };
  if (!gestiona) return null;
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {esFac && a.estado === 'programada' && <button className="btn-primary btn-sm" onClick={() => run('iniciar')}><Play size={13} /> Iniciar</button>}
        {a.estado === 'en_curso' && <button className="btn-primary btn-sm" onClick={() => setFin(true)}><Square size={13} /> Finalizar</button>}
        {a.estado === 'programada' && <button className="btn-ghost btn-sm" onClick={() => run('cancelar')}><X size={13} /> Cancelar</button>}
      </div>
      <ErrorMsg error={err} />
      <Modal open={fin} onClose={() => setFin(false)} title="Finalizar actividad">
        <div className="space-y-3">
          <Field label="Número de participantes asistentes"><input type="number" min={0} className="input" value={n} onChange={(e) => setN(e.target.value)} /></Field>
          <Field label={base.includes('debrief') ? 'Seguimiento acordado' : 'Observaciones'}><textarea className="input" value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
          <ErrorMsg error={err} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setFin(false)}>Cancelar</button>
            <button className="btn-primary" disabled={n === ''} onClick={() => run('finalizar', base.includes('debrief') ? { participantes_asistentes: Number(n), seguimiento: obs || undefined } : { participantes_asistentes: Number(n), observaciones: obs || undefined })}>Finalizar</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function useFacilitadores(enabled = true) {
  return useQuery({ queryKey: ['profesionales'], queryFn: () => api.get('/api/profesionales'), enabled });
}

export default function Debriefing() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['debriefings'], queryFn: () => api.get('/api/debriefings') });
  const pros = useFacilitadores();
  const [nuevo, setNuevo] = useState(false);
  const puedeCrear = me?.rol === 'coordinacion' || me?.rol === 'profesional';
  const [f, setF] = useState({ titulo: '', facilitador_id: me?.profesional_id ?? '', grupo_destinatario: '', inicio: '', fin: '', participantes_previstos: '0' });
  const s = useSubmit(
    () => api.post('/api/debriefings', { ...f, inicio: localGalToISO(f.inicio), fin: localGalToISO(f.fin), participantes_previstos: Number(f.participantes_previstos) }),
    () => { setNuevo(false); qc.invalidateQueries(); },
  );
  return (
    <div className="p-3 sm:p-4">
      <PageHeader title="Sala de Debriefing" subtitle="Acompañamiento emocional a profesionales desplegados en territorio. Al iniciar una sesión, el avatar del facilitador se desplaza a la sala." actions={puedeCrear && <button className="btn-primary" onClick={() => setNuevo(true)}><Plus size={16} /> Programar sesión</button>} />
      <Card>
        {q.isLoading ? <Spinner /> : (q.data ?? []).length === 0 ? <Empty>No hay sesiones de debriefing registradas.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Sesión</th><th>Facilitador</th><th>Grupo destinatario</th><th>Horario (GAL)</th><th>Participantes</th><th>Estado</th><th>Seguimiento</th><th></th></tr></thead>
              <tbody>
                {q.data.map((d: any) => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.titulo}</td>
                    <td className="muted">{d.facilitador_nombre}</td>
                    <td>{d.grupo_destinatario}</td>
                    <td className="tabular-nums">{fFechaHora(d.inicio)}–{fHora(d.fin)}</td>
                    <td className="tabular-nums">{d.participantes_asistentes ?? '—'} / {d.participantes_previstos}</td>
                    <td><Badge tono={tonoActividad[d.estado as EstadoActividad]}>{ESTADO_ACTIVIDAD_LABEL[d.estado as EstadoActividad]}</Badge></td>
                    <td className="max-w-[220px] text-xs">{d.seguimiento ?? '—'}</td>
                    <td><AccionesActividad a={d} base="/api/debriefings" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={nuevo} onClose={() => setNuevo(false)} title="Programar sesión de debriefing" wide>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); s.run(undefined); }}>
          <div className="sm:col-span-2"><Field label="Título"><input className="input" required value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Field></div>
          <Field label="Profesional facilitador">
            <select className="input" required value={f.facilitador_id} onChange={(e) => setF({ ...f, facilitador_id: e.target.value })} disabled={me?.rol === 'profesional'}>
              <option value="">Seleccione…</option>
              {(pros.data ?? []).filter((p: any) => p.es_teleatencion).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Field>
          <Field label="Grupo destinatario"><input className="input" required value={f.grupo_destinatario} onChange={(e) => setF({ ...f, grupo_destinatario: e.target.value })} /></Field>
          <Field label="Inicio (hora de Galápagos)"><input type="datetime-local" className="input" required value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></Field>
          <Field label="Fin"><input type="datetime-local" className="input" required value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} /></Field>
          <Field label="Participantes previstos"><input type="number" min={0} className="input" value={f.participantes_previstos} onChange={(e) => setF({ ...f, participantes_previstos: e.target.value })} /></Field>
          <div className="sm:col-span-2"><ErrorMsg error={s.error} /></div>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-ghost" onClick={() => setNuevo(false)}>Cancelar</button><button className="btn-primary" disabled={s.busy}>Programar</button></div>
        </form>
      </Modal>
    </div>
  );
}
