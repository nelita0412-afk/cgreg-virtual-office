import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../lib/api';
import { Card, PageHeader, Spinner } from '../components/ui';
import { fFechaHora } from '../lib/format';

const REPORTES = [
  { id: 'resumen', titulo: 'Resumen ejecutivo de indicadores', desc: 'Personas, equipo, actividades y cumplimiento de agenda.' },
  { id: 'profesionales', titulo: 'Atenciones por profesional', desc: 'Atendidas, programadas y no realizadas.' },
  { id: 'evolucion', titulo: 'Evolución diaria (30 días)', desc: 'Atenciones realizadas y no realizadas por día.' },
  { id: 'necesidades', titulo: 'Necesidades por categoría y estado', desc: 'Conteos agregados.' },
  { id: 'derivaciones', titulo: 'Derivaciones por estado', desc: 'Conteos agregados.' },
];

export default function Reportes() {
  const ind = useQuery({ queryKey: ['indicadores'], queryFn: () => api.get('/api/dashboard/indicadores?dias=14') });
  return (
    <div className="p-3 sm:p-4">
      <PageHeader title="Reportes" subtitle="Reportes agregados en CSV (UTF-8). No incluyen nombres de servidores ni información clínica." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {REPORTES.map((r) => (
          <Card key={r.id} title={r.titulo}>
            <p className="mb-3 text-sm muted">{r.desc}</p>
            <a className="btn-primary" href={`/api/reportes/${r.id}.csv`} download><Download size={16} /> Descargar CSV</a>
          </Card>
        ))}
      </div>
      <Card title="Vista previa del resumen" className="mt-4">
        {ind.isLoading || !ind.data ? <Spinner /> : (
          <div className="grid gap-4 text-sm md:grid-cols-3">
            {(['personas', 'equipo', 'actividades'] as const).map((g) => (
              <div key={g}>
                <div className="label uppercase">{g}</div>
                <table className="table"><tbody>
                  {Object.entries(ind.data[g]).map(([k, v]) => <tr key={k}><td className="muted">{k.replace(/_/g, ' ')}</td><td className="text-right tabular-nums">{String(v ?? '—')}</td></tr>)}
                </tbody></table>
              </div>
            ))}
            <div className="text-xs faint md:col-span-3">Generado: {fFechaHora(ind.data.generado)}</div>
          </div>
        )}
      </Card>
    </div>
  );
}
