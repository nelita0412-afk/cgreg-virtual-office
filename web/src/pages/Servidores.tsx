import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, Check, Minus } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, PageHeader, Spinner, Tabs } from '../components/ui';
import { VERIFICACION_LABEL, type Verificacion } from '@shared/domain';
import { fFechaHora } from '../lib/format';

const Si = ({ v, label }: { v: boolean; label: string }) => (v ? <Check size={16} className="text-emerald-400" aria-label={`${label}: sí`} /> : <Minus size={16} className="faint" aria-label={`${label}: no`} />);

export default function Servidores() {
  const { me } = useAuth();
  const [q, setQ] = useState('');
  const [sinAsignar, setSinAsignar] = useState(false);
  const [vista, setVista] = useState('todos');
  const r = useQuery({ queryKey: ['servidores', q, sinAsignar, vista], queryFn: () => api.get(`/api/servidores${qs({ q, sin_asignar: sinAsignar ? '1' : undefined, vista: vista === 'todos' ? undefined : vista })}`) });
  const sync = useQuery({ queryKey: ['sync'], queryFn: () => api.get('/api/sync/estado'), enabled: me?.rol === 'coordinacion' });
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title="Servidores"
        subtitle={me?.rol === 'profesional' ? 'Servidores asignados a usted.' : 'Identificación básica obtenida en modo solo lectura de la matriz institucional (pestaña autorizada).'}
      />
      {sync.data && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs muted">
          <Badge tono={sync.data.estado_conexion === 'conectado' ? 'good' : sync.data.estado_conexion === 'no_configurado' ? 'warning' : 'critical'}>
            Matriz: {sync.data.estado_conexion.replace('_', ' ')}
          </Badge>
          Última sincronización exitosa: {sync.data.ultima_sincronizacion_exitosa ? fFechaHora(sync.data.ultima_sincronizacion_exitosa) : 'nunca'} · consulta periódica cada {sync.data.intervalo_segundos} s
          <Link to="/configuracion" className="text-cyan-300 hover:underline">Detalles</Link>
        </div>
      )}
      {me?.rol === 'coordinacion' && (
        <Tabs value={vista} onChange={setVista} items={[{ value: 'todos', label: 'Todos' }, { value: 'base_maestra', label: 'Base maestra (Santa Cruz)' }, { value: 'prioritaria', label: 'Seguimiento prioritario' }, { value: 'pendiente_verificacion', label: 'Pendientes de verificación' }]} />
      )}
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="absolute left-3 top-2.5 faint" />
            <input className="input pl-9" placeholder="Buscar por nombre o código…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar servidor" />
          </div>
          {me?.rol === 'coordinacion' && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sinAsignar} onChange={(e) => setSinAsignar(e.target.checked)} /> Solo sin profesional asignado</label>
          )}
        </div>
        {r.isLoading ? <Spinner /> : (r.data ?? []).length === 0 ? (
          <Empty>{me?.rol === 'profesional' ? 'Aún no tiene servidores asignados.' : 'No hay servidores registrados. Se importarán desde la matriz cuando la integración tenga credenciales.'}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Servidor</th><th>Código / unidad</th><th>Vínculo</th><th>Asignado a</th><th>Contactado</th><th>Consentimiento</th><th>Valorado</th><th>Cita próxima</th><th>Necesidades abiertas</th></tr></thead>
              <tbody>
                {r.data.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/servidores/${s.id}`} className="font-medium text-cyan-200 hover:underline">{s.nombre}</Link>
                      {s.prioritaria && <Badge tono="critical" className="ml-2">Prioritario</Badge>}
                      {!s.activo_en_fuente && s.origen !== 'solicitud_abierta' && <Badge className="ml-2">No vigente en matriz</Badge>}
                      {s.origen === 'solicitud_abierta' && <Badge tono="info" className="ml-2">Atención abierta</Badge>}
                    </td>
                    <td className="muted">{s.codigo_institucional ?? '—'}{s.unidad && <div className="text-[11px] faint">{s.unidad}</div>}</td>
                    <td><Badge tono={s.verificacion?.startsWith('verificado') ? 'good' : 'warning'}>{VERIFICACION_LABEL[s.verificacion as Verificacion]}</Badge></td>
                    <td>{s.asignados.length ? s.asignados.map((a: any) => a.nombre).join(', ') : <span className="text-amber-300">Sin asignar</span>}</td>
                    <td><Si v={s.contactado} label="Contactado" /></td>
                    <td>{s.consentimiento_estado ? <span className="text-xs">{s.consentimiento_estado.replace(/_/g, ' ')}</span> : <Si v={false} label="Consentimiento" />}</td>
                    <td><Si v={s.valorado} label="Valorado" /></td>
                    <td><Si v={s.con_cita} label="Cita" /></td>
                    <td className="tabular-nums">{s.necesidades_abiertas}</td>
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
