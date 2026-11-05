import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, PageHeader, Spinner } from '../components/ui';
import { fFechaHora } from '../lib/format';

export default function Expedientes() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['expediente', 'lista'], queryFn: () => api.get('/api/expedientes') });
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title="Historias clínicas electrónicas"
        subtitle={
          me?.rol === 'coordinacion'
            ? 'Vista administrativa: códigos, fechas y estado de los expedientes. El contenido clínico está reservado al equipo clínico con relación asistencial.'
            : 'Expedientes de los servidores con los que tiene relación asistencial (asignación, derivación o atenciones).'
        }
      />
      <Card>
        {q.isLoading ? <Spinner /> : (q.data ?? []).length === 0 ? <Empty>No hay expedientes accesibles. Se abren automáticamente con la primera atención.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Código</th><th>Servidor</th><th>Responsable</th><th>Apertura</th><th>Última actualización</th><th>Entradas</th><th>Borradores</th></tr></thead>
              <tbody>
                {q.data.map((x: any) => (
                  <tr key={x.id}>
                    <td><Link className="font-mono text-cyan-200 hover:underline" to={`/servidores/${x.servidor_id}/expediente`}>{x.codigo}</Link></td>
                    <td>{x.servidor_nombre}</td>
                    <td className="muted">{x.responsable}</td>
                    <td className="tabular-nums">{fFechaHora(x.fecha_apertura)}</td>
                    <td className="tabular-nums">{fFechaHora(x.updated_at)}</td>
                    <td className="tabular-nums">{x.entradas}</td>
                    <td>{x.borradores ? <Badge tono="warning">{x.borradores} sin validar</Badge> : <span className="faint">—</span>}</td>
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
