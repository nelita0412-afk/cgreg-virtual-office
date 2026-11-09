import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Inbox, HeartHandshake, ClipboardList, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { puede } from '@shared/permissions';
import { Badge, Card, Empty, PageHeader, Spinner } from '../components/ui';
import { fFechaHora, fRelativo } from '../lib/format';
import { CATEGORIA_NECESIDAD_LABEL, ESTADO_NECESIDAD_LABEL, VERIFICACION_LABEL, type Verificacion } from '@shared/domain';

/**
 * Gestión Social (Trabajo Social): recepción y orientación de solicitudes, casos sociales asignados y necesidades
 * sociales. Solo información social y operativa: el contenido clínico no aparece aquí.
 */
export default function GestionSocial() {
  const { me } = useAuth();
  const recibe = puede(me, 'abierta.ver');
  const solicitudes = useQuery<any[]>({ queryKey: ['atencion-abierta', 'pendientes'], queryFn: () => api.get('/api/atencion-abierta?estado=pendiente_asignacion'), enabled: recibe });
  const casos = useQuery<any[]>({ queryKey: ['servidores', 'mios'], queryFn: () => api.get('/api/servidores?mios=1') });
  const necesidades = useQuery<any[]>({ queryKey: ['necesidades'], queryFn: () => api.get('/api/necesidades') });
  const abiertas = (necesidades.data ?? []).filter((n) => n.estado !== 'resuelta');
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-3 sm:p-4">
      <PageHeader title="Gestión Social" subtitle="Recepción y orientación de solicitudes, valoración e intervención social, seguimiento y articulación institucional." />
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        {recibe && (
          <Card title={<span className="flex items-center gap-2"><Inbox size={17} className="text-salvia-700" /> Solicitudes recibidas por orientar</span>} actions={<Link className="btn-ghost btn-sm" to="/atencion-abierta">Ver todas</Link>}>
            {solicitudes.isLoading ? <Spinner /> : !solicitudes.data?.length ? <Empty>No hay solicitudes pendientes de orientación.</Empty> : (
              <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {solicitudes.data.slice(0, 8).map((s) => (
                  <li key={s.id} style={{ borderColor: 'var(--line)' }}>
                    <Link to="/atencion-abierta" className="flex items-center gap-3 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-profundo-900">{s.codigo}</span> <span className="muted">· {fRelativo(s.created_at)}</span>
                        <span className="block truncate text-xs muted">{VERIFICACION_LABEL[s.verificacion as Verificacion] ?? s.verificacion}{s.autoriza_whatsapp ? ' · autorizó WhatsApp' : ''}</span>
                      </span>
                      <ChevronRight size={16} className="faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <Card title={<span className="flex items-center gap-2"><HeartHandshake size={17} className="text-salvia-700" /> Mis casos sociales</span>}>
          {casos.isLoading ? <Spinner /> : !casos.data?.length ? <Empty>No tiene casos sociales asignados.</Empty> : (
            <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
              {casos.data.map((s) => (
                <li key={s.id} style={{ borderColor: 'var(--line)' }}>
                  <Link to={`/servidores/${s.id}/expediente`} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium text-profundo-900">{s.nombre}</span>
                    <span className="text-xs muted">Expediente social</span>
                    <ChevronRight size={16} className="faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><ClipboardList size={17} className="text-salvia-700" /> Necesidades sociales abiertas</span>} className="lg:col-span-2">
          {necesidades.isLoading ? <Spinner /> : !abiertas.length ? <Empty>Sin necesidades abiertas.</Empty> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {abiertas.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <Link to={`/servidores/${n.servidor_id}`} className="flex items-start gap-2 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-profundo-900">{CATEGORIA_NECESIDAD_LABEL[n.categoria as keyof typeof CATEGORIA_NECESIDAD_LABEL] ?? n.categoria}</span>
                      <span className="block truncate muted">{n.servidor_nombre}</span>
                      <span className="block text-xs faint">{fFechaHora(n.created_at)}</span>
                    </span>
                    <Badge tono={n.estado === 'parcial' ? 'warning' : 'info'}>{ESTADO_NECESIDAD_LABEL[n.estado as keyof typeof ESTADO_NECESIDAD_LABEL] ?? n.estado}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
