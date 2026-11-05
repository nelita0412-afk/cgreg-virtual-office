import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { UserPlus, CalendarPlus, Check, Minus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, ErrorMsg, Field, Modal, PageHeader, Spinner } from '../components/ui';
import { ProgramarCita } from '../components/ProgramarCita';
import { fDiaSolo, fFechaHora } from '../lib/format';

const Si = ({ v }: { v: boolean }) => (v ? <Check size={16} className="text-emerald-400" aria-label="Sí" /> : <Minus size={16} className="faint" aria-label="No" />);

export default function AtencionPrioritaria() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const esCoord = me?.rol === 'coordinacion';
  const q = useQuery({ queryKey: ['prioritaria'], queryFn: () => api.get('/api/atencion-prioritaria') });
  const sync = useQuery({ queryKey: ['sync'], queryFn: () => api.get('/api/sync/estado'), enabled: esCoord });
  const pros = useQuery({ queryKey: ['profesionales'], queryFn: () => api.get('/api/profesionales'), enabled: esCoord });
  const [asignar, setAsignar] = useState<any>(null);
  const [pro, setPro] = useState('');
  const [cita, setCita] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title="Atención prioritaria"
        subtitle={
          esCoord
            ? 'Servidores de Santa Cruz con clasificación profesional de riesgo alto registrada. Coordinación ve el dato operativo para asignar y dar seguimiento; el detalle clínico lo ve solo el equipo asignado.'
            : 'Sus servidores asignados con seguimiento prioritario. Información clínica confidencial.'
        }
      />
      {sync.data && !sync.data.riesgo?.configurado && (
        <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          La pestaña «Valoraciones» no contiene un campo explícito de clasificación profesional de riesgo, por lo que no se importa riesgo desde la matriz (no se infiere).
          Hoy esta cola se alimenta con las clasificaciones que registran los profesionales asignados desde la ficha del servidor. Ver <code>docs/ESTADO.md</code>.
        </div>
      )}
      <ErrorMsg error={err} />
      <Card>
        {q.isLoading ? <Spinner /> : (q.data ?? []).length === 0 ? <Empty>No hay servidores en seguimiento prioritario {esCoord ? '' : 'asignados a usted'}.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Servidor</th><th>Unidad</th><th>Asignado a</th><th>Contactado</th><th>Consentimiento</th><th>Próxima cita</th><th>Atenciones</th><th>Seguim. pend.</th>{!esCoord && <th>Clasificación</th>}<th></th></tr>
              </thead>
              <tbody>
                {q.data.map((s: any) => (
                  <tr key={s.id}>
                    <td><Link className="font-medium text-cyan-200 hover:underline" to={`/servidores/${s.id}`}>{s.nombre}</Link><div className="text-xs faint">{s.codigo_institucional}</div></td>
                    <td className="muted">{s.unidad ?? '—'}</td>
                    <td>{s.asignados.length ? s.asignados.map((a: any) => a.nombre).join(', ') : <Badge tono="critical">Sin asignar</Badge>}</td>
                    <td><Si v={s.contactado} /></td>
                    <td>{s.consentimiento_validado ? <Badge tono="good">Validado</Badge> : <Badge tono="warning">Pendiente</Badge>}</td>
                    <td className="tabular-nums">{s.proxima_cita ? fFechaHora(s.proxima_cita) : '—'}</td>
                    <td className="tabular-nums">{s.atendidas}</td>
                    <td className="tabular-nums">{s.seguimientos_pendientes}</td>
                    {!esCoord && (
                      <td className="text-xs">
                        {(s.clasificacion ?? []).map((c: any, i: number) => (
                          <div key={i}>Riesgo alto · {c.fuente === 'matriz_valoraciones' ? 'matriz' : 'registro profesional'} · {fDiaSolo(c.fecha_valoracion)}{c.requiere_seguimiento ? ' · requiere seguimiento' : ''}</div>
                        ))}
                      </td>
                    )}
                    <td>
                      <div className="flex gap-1">
                        {esCoord && <button className="btn-ghost btn-sm" onClick={() => { setAsignar(s); setPro(''); }}><UserPlus size={13} /> Asignar</button>}
                        <button className="btn-ghost btn-sm" onClick={() => setCita(s)}><CalendarPlus size={13} /> Programar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={!!asignar} onClose={() => setAsignar(null)} title={`Asignar profesional — ${asignar?.nombre ?? ''}`}>
        <Field label="Profesional">
          <select className="input" value={pro} onChange={(e) => setPro(e.target.value)}>
            <option value="">Seleccione…</option>
            {(pros.data ?? []).filter((p: any) => (p.es_teleatencion && p.especialidad !== 'psiquiatria') || p.especialidad === 'trabajo_social').map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setAsignar(null)}>Cancelar</button>
          <button
            className="btn-primary"
            disabled={!pro}
            onClick={async () => {
              setErr(null);
              try {
                await api.post(`/api/servidores/${asignar.id}/asignaciones`, { profesional_id: pro });
                setAsignar(null);
                qc.invalidateQueries();
              } catch (e) {
                setErr(e);
              }
            }}
          >
            Asignar
          </button>
        </div>
      </Modal>
      {cita && <ProgramarCita open onClose={() => setCita(null)} servidorId={cita.id} profesionalId={me?.rol === 'profesional' ? me.profesional_id ?? undefined : undefined} titulo={`Programar atención — ${cita.nombre}`} />}
    </div>
  );
}
