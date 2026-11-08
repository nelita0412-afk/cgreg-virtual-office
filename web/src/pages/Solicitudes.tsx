import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, PageHeader, Spinner } from '../components/ui';
import { Tarjetas, Tarjeta } from '../components/Tarjetas';
import { SolicitarApoyoModal } from '../components/SolicitarApoyo';
import { fDiaSolo, fRelativo } from '../lib/format';
import { tonoPrioridad } from './Comando';
import { ESTADOS_SOLICITUD, ESTADO_SOLICITUD_LABEL, PRIORIDAD_LABEL, TIPO_SOLICITUD_LABEL, type EstadoSolicitud } from '@shared/domain';

export { tonoSolicitud } from '../lib/tonos';
import { tonoSolicitud } from '../lib/tonos';

type Filtro = { id: string; label: string; estado?: EstadoSolicitud; filtro?: string };

export default function Solicitudes() {
  const { me } = useAuth();
  const nav = useNavigate();
  const esCoord = me?.rol === 'coordinacion';
  const filtros: Filtro[] = [
    { id: 'abiertas', label: 'Abiertas', filtro: 'abiertas' },
    { id: 'urgentes', label: 'Urgentes', filtro: 'urgentes' },
    ...(esCoord ? [{ id: 'hoy', label: 'Seguimiento hoy', filtro: 'seguimiento_hoy' }] : []),
    ...ESTADOS_SOLICITUD.map((e) => ({ id: e, label: ESTADO_SOLICITUD_LABEL[e], estado: e })),
    { id: 'todas', label: 'Todas' },
  ];
  const [f, setF] = useState<Filtro>(filtros[0]);
  const [nueva, setNueva] = useState(false);
  const todas = useQuery({ queryKey: ['solicitudes', 'todas'], queryFn: () => api.get('/api/solicitudes') });
  const q = useQuery({ queryKey: ['solicitudes', f.id], queryFn: () => api.get(`/api/solicitudes${qs({ estado: f.estado, filtro: f.filtro })}`) });
  const cuenta = (fi: Filtro) => {
    const t = todas.data ?? [];
    if (fi.estado) return t.filter((s: any) => s.estado === fi.estado).length;
    if (fi.filtro === 'abiertas') return t.filter((s: any) => !['resuelta', 'cerrada'].includes(s.estado)).length;
    if (fi.filtro === 'urgentes') return t.filter((s: any) => s.prioridad === 'urgente' && !['resuelta', 'cerrada'].includes(s.estado)).length;
    if (!fi.filtro) return t.length;
    return null;
  };
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title={esCoord ? 'Mis Solicitudes y Gestiones Pendientes' : 'Mis solicitudes a Coordinación General'}
        subtitle={esCoord ? 'Bandeja de Coordinación General: solicitudes de intervención enviadas por los profesionales, ordenadas por prioridad y fecha.' : 'Solicite la intervención de Coordinación General cuando requiera una gestión institucional. Las emergencias clínicas siguen su ruta de escalamiento.'}
        actions={!esCoord && <button className="btn-primary" onClick={() => setNueva(true)}><Plus size={16} /> Solicitar apoyo a Coordinación</button>}
      />
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1 scroll-thin" role="tablist">
        {filtros.map((fi) => {
          const n = cuenta(fi);
          return (
            <button key={fi.id} role="tab" aria-selected={f.id === fi.id} onClick={() => setF(fi)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${f.id === fi.id ? 'bg-sky-600/50 text-white' : 'muted hover:bg-white/5'}`}>
              {fi.label}{n != null && <span className="ml-1.5 rounded-full bg-white/10 px-1.5 text-[11px] tabular-nums">{n}</span>}
            </button>
          );
        })}
      </div>
      <Card>
        {q.isLoading ? <Spinner /> : (q.data ?? []).length === 0 ? <Empty>No hay solicitudes en esta vista.</Empty> : (
          <>
          <Tarjetas>
            {q.data.map((s: any) => (
              <Tarjeta
                key={s.id}
                to={`/solicitudes/${s.id}`}
                titulo={s.accion_requerida}
                detalle={<>{s.codigo}{esCoord ? ` · ${s.solicitante_nombre}` : ''} · {fRelativo(s.ultima_accion ?? s.created_at)}{s.fecha_respuesta_requerida ? ` · respuesta ${fDiaSolo(s.fecha_respuesta_requerida)}` : ''}</>}
                insignias={<>
                  <Badge tono={tonoPrioridad[s.prioridad]}>{s.prioridad === 'urgente' && <AlertTriangle size={12} />}{PRIORIDAD_LABEL[s.prioridad as keyof typeof PRIORIDAD_LABEL]}</Badge>
                  <Badge tono={tonoSolicitud[s.estado as EstadoSolicitud]}>{ESTADO_SOLICITUD_LABEL[s.estado as EstadoSolicitud]}</Badge>
                </>}
              />
            ))}
          </Tarjetas>
          <div className="hidden overflow-x-auto md:block">
            <table className="table">
              <thead><tr><th>Código</th><th>Prioridad</th>{esCoord && <th>Solicitante</th>}<th>Acción requerida</th><th>Tipo</th><th>Estado</th><th>Respuesta requerida</th><th>Seguimiento</th><th>Última actividad</th></tr></thead>
              <tbody>
                {q.data.map((s: any) => (
                  <tr key={s.id} className="cursor-pointer" onClick={() => nav(`/solicitudes/${s.id}`)}>
                    <td className="text-cyan-200">{s.codigo}</td>
                    <td><Badge tono={tonoPrioridad[s.prioridad]}>{s.prioridad === 'urgente' && <AlertTriangle size={12} />}{PRIORIDAD_LABEL[s.prioridad as keyof typeof PRIORIDAD_LABEL]}</Badge></td>
                    {esCoord && <td>{s.solicitante_nombre}</td>}
                    <td className="max-w-[320px]"><a href={`/solicitudes/${s.id}`} onClick={(e) => { e.preventDefault(); nav(`/solicitudes/${s.id}`); }} className="line-clamp-2 hover:underline">{s.accion_requerida}</a></td>
                    <td className="muted">{TIPO_SOLICITUD_LABEL[s.tipo as keyof typeof TIPO_SOLICITUD_LABEL] ?? s.tipo}</td>
                    <td><Badge tono={tonoSolicitud[s.estado as EstadoSolicitud]}>{ESTADO_SOLICITUD_LABEL[s.estado as EstadoSolicitud]}</Badge></td>
                    <td className="tabular-nums">{fDiaSolo(s.fecha_respuesta_requerida)}</td>
                    <td className="tabular-nums">{fDiaSolo(s.fecha_seguimiento)}</td>
                    <td className="muted">{fRelativo(s.ultima_accion ?? s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
      <SolicitarApoyoModal open={nueva} onClose={() => setNueva(false)} onCreada={(id) => nav(`/solicitudes/${id}`)} />
    </div>
  );
}
