import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, PageHeader, Spinner, Tabs } from '../components/ui';
import { CitaAcciones } from '../components/CitaAcciones';
import { Tarjetas, Tarjeta } from '../components/Tarjetas';
import { fFechaHora } from '../lib/format';
import { tonoAtencion } from './Agenda';
import { ESTADOS_ATENCION, ESTADO_ATENCION_LABEL, ESPECIALIDAD_LABEL, type EstadoAtencion } from '@shared/domain';

export default function Atenciones() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'atenciones' | 'seguimientos'>('atenciones');
  const [estado, setEstado] = useState('');
  const at = useQuery({ queryKey: ['atenciones', estado], queryFn: () => api.get(`/api/atenciones${qs({ estado })}`) });
  const seg = useQuery({ queryKey: ['seguimientos'], queryFn: () => api.get('/api/seguimientos'), enabled: tab === 'seguimientos' });
  const esPro = me?.rol === 'profesional';
  return (
    <div className="p-3 sm:p-4">
      <PageHeader title="Atenciones" subtitle={esPro ? 'Sus atenciones y seguimientos. La documentación clínica se cifra y solo usted puede leerla.' : 'Vista operativa (sin contenido clínico).'} />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'atenciones', label: 'Atenciones' }, { value: 'seguimientos', label: 'Seguimientos' }]} />
      {tab === 'atenciones' ? (
        <Card actions={
          <select className="input w-auto" value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            {ESTADOS_ATENCION.map((e) => <option key={e} value={e}>{ESTADO_ATENCION_LABEL[e]}</option>)}
          </select>
        } title="Registro de atenciones">
          {at.isLoading ? <Spinner /> : (at.data ?? []).length === 0 ? <Empty>Sin atenciones registradas.</Empty> : (
            <>
            <Tarjetas>
              {at.data.map((a: any) => (
                <Tarjeta
                  key={a.id}
                  to={`/atenciones/${a.id}`}
                  titulo={a.servidor_nombre}
                  detalle={<>{a.codigo} · {a.inicio ? fFechaHora(a.inicio) : 'sin horario'} · {a.profesional_nombre}</>}
                  insignias={<>
                    <Badge tono={tonoAtencion[a.estado as EstadoAtencion]}>{ESTADO_ATENCION_LABEL[a.estado as EstadoAtencion]}</Badge>
                    {a.estado === 'atendida' && (a.documentada_at ? <Badge tono="good">Documentada</Badge> : <Badge tono="warning">Documentación pendiente</Badge>)}
                  </>}
                />
              ))}
            </Tarjetas>
            <div className="hidden overflow-x-auto md:block">
              <table className="table">
                <thead><tr><th>Código</th><th>Servidor</th><th>Tipo</th><th>Profesional</th><th>Horario (GAL)</th><th>Estado</th><th>Documentación</th><th>Acciones</th></tr></thead>
                <tbody>
                  {at.data.map((a: any) => (
                    <tr key={a.id}>
                      <td><Link className="text-cyan-200 hover:underline" to={`/atenciones/${a.id}`}>{a.codigo}</Link></td>
                      <td>{a.servidor_nombre}</td>
                      <td className="muted">{ESPECIALIDAD_LABEL[a.tipo as keyof typeof ESPECIALIDAD_LABEL]}</td>
                      <td className="muted">{a.profesional_nombre}</td>
                      <td className="tabular-nums">{a.inicio ? fFechaHora(a.inicio) : '—'}</td>
                      <td><Badge tono={tonoAtencion[a.estado as EstadoAtencion]}>{ESTADO_ATENCION_LABEL[a.estado as EstadoAtencion]}</Badge></td>
                      <td>{a.estado === 'atendida' ? (a.documentada_at ? <Badge tono="good">Documentada</Badge> : <Badge tono="warning">Pendiente</Badge>) : '—'}</td>
                      <td><CitaAcciones a={a} compacto /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Card>
      ) : (
        <Card title="Seguimientos">
          {seg.isLoading ? <Spinner /> : (seg.data ?? []).length === 0 ? <Empty>Sin seguimientos.</Empty> : (
            <>
            <Tarjetas>
              {seg.data.map((s: any) => (
                <Tarjeta
                  key={s.id}
                  to={`/servidores/${s.servidor_id}`}
                  titulo={s.servidor_nombre}
                  detalle={<>{fFechaHora(s.fecha_programada)}{s.nota_operativa ? ` · ${s.nota_operativa}` : ''}</>}
                  insignias={<Badge tono={s.estado === 'pendiente' ? 'warning' : s.estado === 'realizado' ? 'good' : 'neutral'}>{s.estado}</Badge>}
                  pie={esPro && s.estado === 'pendiente' && s.profesional_id === me?.profesional_id ? (
                    <div className="flex gap-2">
                      <button className="btn-ghost btn-sm min-h-10 flex-1" onClick={async () => { await api.post(`/api/seguimientos/${s.id}/estado`, { estado: 'realizado' }); qc.invalidateQueries(); }}>Realizado</button>
                      <button className="btn-ghost btn-sm min-h-10 flex-1" onClick={async () => { await api.post(`/api/seguimientos/${s.id}/estado`, { estado: 'cancelado' }); qc.invalidateQueries(); }}>Cancelar</button>
                    </div>
                  ) : undefined}
                />
              ))}
            </Tarjetas>
            <div className="hidden overflow-x-auto md:block">
              <table className="table">
                <thead><tr><th>Fecha programada</th><th>Servidor</th><th>Profesional</th><th>Nota operativa</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {seg.data.map((s: any) => (
                    <tr key={s.id}>
                      <td className="tabular-nums">{fFechaHora(s.fecha_programada)}</td>
                      <td><Link to={`/servidores/${s.servidor_id}`} className="hover:underline">{s.servidor_nombre}</Link></td>
                      <td className="muted">{s.profesional_nombre}</td>
                      <td>{s.nota_operativa ?? '—'}</td>
                      <td><Badge tono={s.estado === 'pendiente' ? 'warning' : s.estado === 'realizado' ? 'good' : 'neutral'}>{s.estado}</Badge></td>
                      <td>
                        {esPro && s.estado === 'pendiente' && s.profesional_id === me?.profesional_id && (
                          <div className="flex gap-1">
                            <button className="btn-ghost btn-sm" onClick={async () => { await api.post(`/api/seguimientos/${s.id}/estado`, { estado: 'realizado' }); qc.invalidateQueries(); }}>Realizado</button>
                            <button className="btn-ghost btn-sm" onClick={async () => { await api.post(`/api/seguimientos/${s.id}/estado`, { estado: 'cancelado' }); qc.invalidateQueries(); }}>Cancelar</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
