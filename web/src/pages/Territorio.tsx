import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, LifeBuoy } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, ErrorMsg, Field, Modal, PageHeader, Spinner, useSubmit } from '../components/ui';
import { SolicitarApoyoModal } from '../components/SolicitarApoyo';
import { fFechaHora, localGalToISO } from '../lib/format';

const TIPOS: Record<string, string> = {
  acompanamiento: 'Acompañamiento',
  contencion_grupal: 'Contención grupal',
  coordinacion_educativa: 'Coordinación educativa',
  reunion_equipo: 'Reunión de equipo',
  otra: 'Otra',
};

export default function Territorio() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['articulaciones'], queryFn: () => api.get('/api/articulaciones') });
  const [nuevo, setNuevo] = useState(false);
  const [apoyo, setApoyo] = useState(false);
  const [f, setF] = useState({ fecha: '', lugar: '', tipo: 'acompanamiento', descripcion: '', participantes: '', requiere_apoyo: false });
  const s = useSubmit(
    () => api.post('/api/articulaciones', { ...f, fecha: localGalToISO(f.fecha), participantes: f.participantes ? Number(f.participantes) : undefined }),
    () => { setNuevo(false); qc.invalidateQueries(); },
  );
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title="Espacio de Articulación Territorial"
        subtitle="Coordinación con colaboradores que trabajan directamente en territorio (DECE). Registre acciones sin datos clínicos de niños, niñas o adolescentes."
        actions={
          <>
            {me?.rol === 'territorial' && <button className="btn-ghost" onClick={() => setApoyo(true)}><LifeBuoy size={16} /> Solicitar apoyo</button>}
            <button className="btn-primary" onClick={() => setNuevo(true)}><Plus size={16} /> Registrar acción</button>
          </>
        }
      />
      <Card>
        {q.isLoading ? <Spinner /> : (q.data ?? []).length === 0 ? <Empty>Sin acciones territoriales registradas.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Fecha (GAL)</th><th>Lugar</th><th>Tipo</th><th>Descripción</th><th>Participantes</th><th>Registrado por</th><th></th></tr></thead>
              <tbody>
                {q.data.map((a: any) => (
                  <tr key={a.id}>
                    <td className="tabular-nums">{fFechaHora(a.fecha)}</td>
                    <td>{a.lugar}</td>
                    <td>{TIPOS[a.tipo]}</td>
                    <td className="max-w-[340px]">{a.descripcion}</td>
                    <td className="tabular-nums">{a.participantes ?? '—'}</td>
                    <td className="muted">{a.usuario_nombre}</td>
                    <td>{a.requiere_apoyo && <Badge tono="warning">Requiere apoyo</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={nuevo} onClose={() => setNuevo(false)} title="Registrar acción territorial" wide>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); s.run(undefined); }}>
          <Field label="Fecha y hora (GAL)"><input type="datetime-local" className="input" required value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Field>
          <Field label="Lugar / unidad educativa / sector"><input className="input" required value={f.lugar} onChange={(e) => setF({ ...f, lugar: e.target.value })} /></Field>
          <Field label="Tipo"><select className="input" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Participantes"><input type="number" min={0} className="input" value={f.participantes} onChange={(e) => setF({ ...f, participantes: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Descripción operativa"><textarea className="input" required value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Field></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.requiere_apoyo} onChange={(e) => setF({ ...f, requiere_apoyo: e.target.checked })} /> Requiere apoyo del equipo de teleatención</label>
          <div className="sm:col-span-2"><ErrorMsg error={s.error} /></div>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-ghost" onClick={() => setNuevo(false)}>Cancelar</button><button className="btn-primary" disabled={s.busy}>Registrar</button></div>
        </form>
      </Modal>
      <SolicitarApoyoModal open={apoyo} onClose={() => setApoyo(false)} />
    </div>
  );
}
