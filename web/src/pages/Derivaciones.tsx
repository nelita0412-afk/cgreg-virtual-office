import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, PageHeader, Spinner, type Tono } from '../components/ui';
import { fFechaHora } from '../lib/format';
import { tonoPrioridad } from './Comando';
import { ESTADOS_DERIVACION, ESTADO_DERIVACION_LABEL, PRIORIDAD_LABEL, type EstadoDerivacion } from '@shared/domain';

export const tonoDerivacion: Record<EstadoDerivacion, Tono> = {
  solicitada: 'warning', en_revision: 'info', pendiente_coordinacion: 'serious', aceptada: 'violet', programada: 'info', valorada: 'good', en_seguimiento: 'good', cerrada: 'neutral',
};

export default function Derivaciones() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['derivaciones'], queryFn: () => api.get('/api/derivaciones') });
  const esDiego = me?.especialidad === 'psiquiatria';
  const conteo = Object.fromEntries(ESTADOS_DERIVACION.map((e) => [e, (q.data ?? []).filter((d: any) => d.estado === e).length]));
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title="Derivaciones a Psiquiatría"
        subtitle={esDiego ? 'Derivaciones recibidas para valoración especializada.' : me?.rol === 'coordinacion' ? 'Vista de coordinación: estados y citas. El motivo clínico solo lo ven el profesional derivante y el especialista.' : 'Sus derivaciones. Para derivar, abra la ficha del servidor asignado.'}
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ESTADOS_DERIVACION.map((e) => <Badge key={e} tono={tonoDerivacion[e]}>{ESTADO_DERIVACION_LABEL[e]}: {conteo[e]}</Badge>)}
      </div>
      <Card>
        {q.isLoading ? <Spinner /> : (q.data ?? []).length === 0 ? <Empty>No hay derivaciones registradas.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Código</th><th>Servidor</th><th>Derivante</th><th>Prioridad</th><th>Solicitud</th><th>Estado</th><th>Cita</th></tr></thead>
              <tbody>
                {q.data.map((d: any) => (
                  <tr key={d.id}>
                    <td><Link to={`/derivaciones/${d.id}`} className="text-cyan-200 hover:underline">{d.codigo}</Link></td>
                    <td>{d.servidor_nombre}</td>
                    <td className="muted">{d.derivante_nombre}</td>
                    <td><Badge tono={tonoPrioridad[d.prioridad]}>{PRIORIDAD_LABEL[d.prioridad as keyof typeof PRIORIDAD_LABEL]}</Badge></td>
                    <td className="tabular-nums">{fFechaHora(d.fecha_solicitud)}</td>
                    <td><Badge tono={tonoDerivacion[d.estado as EstadoDerivacion]}>{ESTADO_DERIVACION_LABEL[d.estado as EstadoDerivacion]}</Badge></td>
                    <td className="tabular-nums">{d.cita_inicio ? fFechaHora(d.cita_inicio) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
