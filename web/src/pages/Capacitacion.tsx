import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, HeartHandshake, AlertOctagon, ShieldPlus, Route, Network, BookOpen } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, ErrorMsg, Field, Modal, PageHeader, Spinner, useSubmit } from '../components/ui';
import { fFechaHora, localGalToISO } from '../lib/format';
import { AccionesActividad, tonoActividad, useFacilitadores } from './Debriefing';
import { ESTADO_ACTIVIDAD_LABEL, TEMAS_CAPACITACION, TEMA_CAPACITACION_LABEL, type EstadoActividad, type TemaCapacitacion } from '@shared/domain';

const ICONOS: Record<TemaCapacitacion, typeof BookOpen> = {
  primeros_auxilios_psicologicos: HeartHandshake,
  senales_alerta: AlertOctagon,
  herramientas_contencion: ShieldPlus,
  rutas_apoyo: Route,
  coordinacion_territorial: Network,
  otro: BookOpen,
};

export default function Capacitacion() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['capacitaciones'], queryFn: () => api.get('/api/capacitaciones') });
  const pros = useFacilitadores();
  const [nuevo, setNuevo] = useState(false);
  const puedeCrear = me?.rol === 'coordinacion' || me?.rol === 'profesional';
  const [f, setF] = useState({ tema: 'primeros_auxilios_psicologicos', titulo: '', facilitador_id: me?.profesional_id ?? '', publico_objetivo: 'Docentes y equipos DECE', institucion: '', inicio: '', duracion_min: '90', participantes_previstos: '0', observaciones: '' });
  const s = useSubmit(
    () => api.post('/api/capacitaciones', { ...f, institucion: f.institucion || undefined, observaciones: f.observaciones || undefined, inicio: localGalToISO(f.inicio), duracion_min: Number(f.duracion_min), participantes_previstos: Number(f.participantes_previstos) }),
    () => { setNuevo(false); qc.invalidateQueries(); },
  );
  const lista = q.data ?? [];
  return (
    <div className="p-3 sm:p-4">
      <PageHeader title="Centro de Capacitación DECE" subtitle="Formación a equipos DECE y comunidad educativa. Registro de talleres realizados y participantes." actions={puedeCrear && <button className="btn-primary" onClick={() => setNuevo(true)}><Plus size={16} /> Programar capacitación</button>} />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {TEMAS_CAPACITACION.map((t) => {
          const I = ICONOS[t];
          const n = lista.filter((c: any) => c.tema === t && c.estado === 'realizada').length;
          return (
            <div key={t} className="panel p-3">
              <I size={22} className="text-cyan-300" />
              <div className="mt-2 text-sm font-medium leading-tight">{TEMA_CAPACITACION_LABEL[t]}</div>
              <div className="mt-1 text-xs muted">{n} realizada(s)</div>
            </div>
          );
        })}
      </div>
      <Card title="Registro de capacitaciones">
        {q.isLoading ? <Spinner /> : lista.length === 0 ? <Empty>No hay capacitaciones registradas.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Capacitación</th><th>Tema</th><th>Facilitador</th><th>Público / institución</th><th>Inicio (GAL)</th><th>Participantes</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {lista.map((c: any) => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.titulo}</td>
                    <td className="muted">{TEMA_CAPACITACION_LABEL[c.tema as TemaCapacitacion]}</td>
                    <td className="muted">{c.facilitador_nombre}</td>
                    <td>{c.publico_objetivo}{c.institucion && <div className="text-xs faint">{c.institucion}</div>}</td>
                    <td className="tabular-nums">{fFechaHora(c.inicio)} · {c.duracion_min} min</td>
                    <td className="tabular-nums">{c.participantes_asistentes ?? '—'} / {c.participantes_previstos}</td>
                    <td><Badge tono={tonoActividad[c.estado as EstadoActividad]}>{ESTADO_ACTIVIDAD_LABEL[c.estado as EstadoActividad]}</Badge></td>
                    <td><AccionesActividad a={c} base="/api/capacitaciones" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={nuevo} onClose={() => setNuevo(false)} title="Programar capacitación DECE" wide>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); s.run(undefined); }}>
          <Field label="Tema"><select className="input" value={f.tema} onChange={(e) => setF({ ...f, tema: e.target.value })}>{TEMAS_CAPACITACION.map((t) => <option key={t} value={t}>{TEMA_CAPACITACION_LABEL[t]}</option>)}</select></Field>
          <Field label="Título"><input className="input" required value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Field>
          <Field label="Facilitador">
            <select className="input" required value={f.facilitador_id} onChange={(e) => setF({ ...f, facilitador_id: e.target.value })} disabled={me?.rol === 'profesional'}>
              <option value="">Seleccione…</option>
              {(pros.data ?? []).filter((p: any) => p.es_teleatencion).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Field>
          <Field label="Público objetivo"><input className="input" required value={f.publico_objetivo} onChange={(e) => setF({ ...f, publico_objetivo: e.target.value })} /></Field>
          <Field label="Institución / unidad educativa"><input className="input" value={f.institucion} onChange={(e) => setF({ ...f, institucion: e.target.value })} /></Field>
          <Field label="Inicio (hora de Galápagos)"><input type="datetime-local" className="input" required value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></Field>
          <Field label="Duración (min)"><input type="number" min={15} className="input" value={f.duracion_min} onChange={(e) => setF({ ...f, duracion_min: e.target.value })} /></Field>
          <Field label="Participantes previstos"><input type="number" min={0} className="input" value={f.participantes_previstos} onChange={(e) => setF({ ...f, participantes_previstos: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Observaciones"><textarea className="input" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><ErrorMsg error={s.error} /></div>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-ghost" onClick={() => setNuevo(false)}>Cancelar</button><button className="btn-primary" disabled={s.busy}>Programar</button></div>
        </form>
      </Modal>
    </div>
  );
}
