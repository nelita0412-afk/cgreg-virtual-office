import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { Card, Empty, PageHeader, Spinner } from '../components/ui';
import { fFechaHora } from '../lib/format';
import { ROL_LABEL, type Rol } from '@shared/domain';

export default function Auditoria() {
  const [accion, setAccion] = useState('');
  const q = useQuery({ queryKey: ['auditoria', accion], queryFn: () => api.get(`/api/auditoria${qs({ accion, limit: 300 })}`) });
  return (
    <div className="p-3 sm:p-4">
      <PageHeader title="Auditoría" subtitle="Bitácora inmutable de acciones (solo inserción). No contiene contenido clínico. Su consulta también queda registrada." />
      <Card actions={
        <select className="input w-auto" value={accion} onChange={(e) => setAccion(e.target.value)} aria-label="Filtrar por tipo de acción">
          <option value="">Todas las acciones</option>
          {['auth', 'clinico', 'agenda', 'atencion', 'derivacion', 'solicitud', 'servidor', 'usuario', 'sync', 'disponibilidad', 'debriefing', 'capacitacion', 'auditoria'].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      } title="Registros">
        {q.isLoading ? <Spinner /> : (q.data ?? []).length === 0 ? <Empty>Sin registros.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>#</th><th>Fecha (GAL)</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Entidad</th><th>Detalle</th><th>IP</th></tr></thead>
              <tbody>
                {q.data.map((r: any) => (
                  <tr key={r.id}>
                    <td className="faint tabular-nums">{r.id}</td>
                    <td className="tabular-nums">{fFechaHora(r.ts)}</td>
                    <td>{r.usuario_nombre ?? '—'}</td>
                    <td className="muted">{r.rol ? ROL_LABEL[r.rol as Rol] : '—'}</td>
                    <td className="font-mono text-xs">{r.accion}</td>
                    <td className="text-xs muted">{r.entidad ?? ''} {r.entidad_id ? `· ${String(r.entidad_id).slice(0, 8)}` : ''}</td>
                    <td className="max-w-[260px] truncate font-mono text-[11px] faint" title={JSON.stringify(r.detalle)}>{JSON.stringify(r.detalle)}</td>
                    <td className="text-xs faint">{r.ip ?? ''}</td>
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
