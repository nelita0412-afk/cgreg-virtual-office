import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, ExternalLink, Search, UserPlus, Copy } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, ErrorMsg, Field, Modal, PageHeader, Spinner, Tabs, useSubmit, type Tono } from '../components/ui';
import { fFechaHora, fRelativo } from '../lib/format';
import { ESTADO_SOLICITUD_ATENCION_LABEL, PREFERENCIA_SERVICIO_LABEL, VERIFICACION_LABEL, type EstadoSolicitudAtencion, type Verificacion } from '@shared/domain';

const tonoVer: Record<Verificacion, Tono> = { verificado_maestra: 'good', verificado_manual: 'good', pendiente_verificacion: 'warning', no_verificable: 'neutral' };
const tonoEst: Record<EstadoSolicitudAtencion, Tono> = { pendiente_asignacion: 'warning', asignada: 'info', programada: 'violet', atendida: 'good', cerrada: 'neutral', cancelada: 'neutral' };

export default function AtencionAbierta() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const esCoord = me?.rol === 'coordinacion';
  const [tab, setTab] = useState('activas');
  const q = useQuery({ queryKey: ['abierta', tab], queryFn: () => api.get(`/api/atencion-abierta${qs({ estado: tab === 'activas' ? undefined : tab })}`) });
  const lista = (q.data ?? []).filter((s: any) => (tab === 'activas' ? !['cerrada', 'cancelada', 'atendida'].includes(s.estado) : true));
  const [sel, setSel] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const urlPublica = `${location.origin}/solicitar-atencion`;
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title="Atención abierta"
        subtitle="Solicitudes voluntarias de cualquier servidor del CGREG en Santa Cruz, sin necesidad de valoración previa. La falta de verificación no bloquea la atención."
        actions={
          <>
            <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(urlPublica)} title={urlPublica}><Copy size={15} /> Copiar enlace del formulario</button>
            <a className="btn-ghost" href="/solicitar-atencion" target="_blank" rel="noreferrer"><ExternalLink size={15} /> Ver formulario</a>
            <button className="btn-primary" onClick={() => setNuevo(true)}><Plus size={15} /> Registrar solicitud</button>
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'activas', label: 'Activas' }, { value: 'pendiente_asignacion', label: 'Pendientes de asignación' }, { value: 'atendida', label: 'Atendidas' }, { value: 'cerrada', label: 'Cerradas' }, { value: 'cancelada', label: 'Canceladas' }]} />
      <Card>
        {q.isLoading ? <Spinner /> : lista.length === 0 ? <Empty>No hay solicitudes en esta vista.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Código</th><th>Persona</th><th>Vínculo institucional</th><th>Servicio preferido</th><th>Contacto</th><th>Estado</th><th>Profesional</th><th>Recibida</th></tr></thead>
              <tbody>
                {lista.map((s: any) => (
                  <tr key={s.id} className="cursor-pointer" onClick={() => setSel(s.id)}>
                    <td className="font-mono text-cyan-200">{s.codigo}</td>
                    <td>{s.servidor_nombre ?? s.nombre_declarado}<div className="text-xs faint">{s.canal === 'formulario_publico' ? 'Formulario público' : 'Registro interno'}</div></td>
                    <td><Badge tono={tonoVer[s.verificacion as Verificacion]}>{VERIFICACION_LABEL[s.verificacion as Verificacion]}</Badge></td>
                    <td className="muted">{PREFERENCIA_SERVICIO_LABEL[s.preferencia_servicio as keyof typeof PREFERENCIA_SERVICIO_LABEL]}</td>
                    <td className="text-xs">{s.contacto}</td>
                    <td><Badge tono={tonoEst[s.estado as EstadoSolicitudAtencion]}>{ESTADO_SOLICITUD_ATENCION_LABEL[s.estado as EstadoSolicitudAtencion]}</Badge></td>
                    <td className="muted">{s.profesional_nombre ?? '—'}</td>
                    <td className="text-xs muted">{fRelativo(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {sel && <Detalle id={sel} esCoord={esCoord} onClose={() => setSel(null)} />}
      <NuevaInterna open={nuevo} onClose={() => { setNuevo(false); qc.invalidateQueries({ queryKey: ['abierta'] }); }} />
    </div>
  );
}

function Detalle({ id, esCoord, onClose }: { id: string; esCoord: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['abierta', 'detalle', id], queryFn: () => api.get(`/api/atencion-abierta/${id}`) });
  const pros = useQuery({ queryKey: ['profesionales'], queryFn: () => api.get('/api/profesionales'), enabled: esCoord });
  const [buscar, setBuscar] = useState('');
  const res = useQuery({ queryKey: ['base-maestra', buscar], queryFn: () => api.get(`/api/base-maestra/buscar${qs({ q: buscar })}`), enabled: esCoord && buscar.length >= 2 });
  const [pro, setPro] = useState('');
  const [nota, setNota] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      qc.invalidateQueries();
    } catch (e) {
      setErr(e);
    }
  };
  const s = q.data?.solicitud;
  return (
    <Modal open onClose={onClose} title={s ? `Solicitud ${s.codigo}` : 'Solicitud'} wide>
      {!s ? <Spinner /> : (
        <div className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><div className="label">Nombre declarado</div>{s.nombre_declarado}</div>
            <div><div className="label">Identificador declarado</div>{s.codigo_declarado ?? '—'}</div>
            <div><div className="label">Unidad declarada</div>{s.unidad_declarada ?? '—'}</div>
            <div><div className="label">Contacto</div>{s.contacto}</div>
            <div><div className="label">Servicio preferido</div>{PREFERENCIA_SERVICIO_LABEL[s.preferencia_servicio as keyof typeof PREFERENCIA_SERVICIO_LABEL]}</div>
            <div><div className="label">Horario preferido</div>{s.horario_preferido ?? '—'}</div>
            <div className="sm:col-span-2"><div className="label">Motivo</div>{s.motivo ?? (s.tiene_motivo ? <span className="faint">Reservado al profesional asignado.</span> : '—')}</div>
            <div><div className="label">Vínculo institucional</div><Badge tono={tonoVer[s.verificacion as Verificacion]}>{VERIFICACION_LABEL[s.verificacion as Verificacion]}</Badge>{s.verificacion_nota && <div className="text-xs faint">{s.verificacion_nota}</div>}</div>
            <div><div className="label">Registro vinculado</div>{s.servidor_id ? <Link className="text-cyan-300 hover:underline" to={`/servidores/${s.servidor_id}`}>{s.servidor_nombre}</Link> : '—'}</div>
          </div>
          {esCoord && !['cerrada', 'cancelada'].includes(s.estado) && (
            <>
              {s.verificacion !== 'verificado_maestra' && (
                <div className="rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
                  <div className="mb-2 font-medium">Verificar vínculo institucional</div>
                  {s.servidor_sugerido_id && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      Posible coincidencia en base maestra: <strong>{s.sugerido_nombre}</strong> ({s.sugerido_codigo})
                      <button className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/api/atencion-abierta/${id}/verificar`, { servidor_id: s.servidor_sugerido_id }))}>Vincular</button>
                    </div>
                  )}
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-2.5 faint" />
                    <input className="input pl-8" placeholder="Buscar en la base maestra por nombre o código…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
                  </div>
                  {(res.data ?? []).map((m: any) => (
                    <div key={m.id} className="mt-1 flex items-center justify-between gap-2 text-xs">
                      <span>{m.nombre} · {m.codigo_institucional} · {m.unidad}</span>
                      <button className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/api/atencion-abierta/${id}/verificar`, { servidor_id: m.id }))}>Vincular</button>
                    </div>
                  ))}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input className="input flex-1" placeholder="Nota de verificación (p. ej., confirmado por Talento Humano)" value={nota} onChange={(e) => setNota(e.target.value)} />
                    <button className="btn-ghost btn-sm" disabled={nota.length < 5} onClick={() => run(() => api.post(`/api/atencion-abierta/${id}/verificar`, { resultado: 'verificado_manual', nota }))}>Verificado manualmente</button>
                    <button className="btn-ghost btn-sm" disabled={nota.length < 5} onClick={() => run(() => api.post(`/api/atencion-abierta/${id}/verificar`, { resultado: 'no_verificable', nota }))}>No verificable</button>
                  </div>
                  <p className="mt-1 text-[11px] faint">«No verificable» no rechaza la solicitud: deja constancia y permite la atención.</p>
                </div>
              )}
              {['pendiente_asignacion', 'asignada'].includes(s.estado) && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={s.estado === 'asignada' ? 'Reasignar profesional' : 'Asignar profesional'}>
                    <select className="input" value={pro} onChange={(e) => setPro(e.target.value)}>
                      <option value="">Seleccione…</option>
                      {(pros.data ?? []).filter((p: any) => p.es_teleatencion && p.especialidad !== 'psiquiatria').map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </Field>
                  <button className="btn-primary" disabled={!pro} onClick={() => run(() => api.post(`/api/atencion-abierta/${id}/asignar`, { profesional_id: pro }))}><UserPlus size={15} /> Asignar</button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost btn-sm" disabled={nota.length < 3} onClick={() => run(() => api.post(`/api/atencion-abierta/${id}/cerrar`, { nota }))}>Cerrar</button>
                <button className="btn-ghost btn-sm text-red-300" disabled={nota.length < 3} onClick={() => run(() => api.post(`/api/atencion-abierta/${id}/cancelar`, { nota }))}>Cancelar (la persona desiste)</button>
              </div>
            </>
          )}
          {s.atencion_id && <Link className="text-cyan-300 hover:underline" to={`/atenciones/${s.atencion_id}`}>Ver atención vinculada →</Link>}
          <ErrorMsg error={err} />
          <div>
            <div className="label">Historial</div>
            <ol className="space-y-1 border-l pl-3 text-xs" style={{ borderColor: 'var(--line)' }}>
              {q.data.historial.map((h: any) => <li key={h.id}><strong>{h.accion.replace(/_/g, ' ')}</strong>{h.nota_operativa && ` · ${h.nota_operativa}`} <span className="faint">— {fFechaHora(h.ts)} · {h.actor_nombre ?? 'Formulario público'}</span></li>)}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}

function NuevaInterna({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ nombre: '', identificador: '', unidad: '', contacto: '', preferencia: 'psicologia', horario: '', motivo: '', acepta_aviso: false });
  const s = useSubmit(
    () => api.post('/api/atencion-abierta', { ...f, identificador: f.identificador || undefined, unidad: f.unidad || undefined, horario: f.horario || undefined, motivo: f.motivo || undefined, acepta_aviso: f.acepta_aviso || undefined }),
    () => {
      setF({ nombre: '', identificador: '', unidad: '', contacto: '', preferencia: 'psicologia', horario: '', motivo: '', acepta_aviso: false });
      onClose();
    },
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="Registrar solicitud de atención (llamada o contacto directo)" wide>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); s.run(undefined); }}>
        <Field label="Nombres y apellidos"><input className="input" required value={f.nombre} onChange={set('nombre')} /></Field>
        <Field label="Identificador institucional"><input className="input" value={f.identificador} onChange={set('identificador')} /></Field>
        <Field label="Unidad"><input className="input" value={f.unidad} onChange={set('unidad')} /></Field>
        <Field label="Contacto"><input className="input" required value={f.contacto} onChange={set('contacto')} /></Field>
        <Field label="Servicio"><select className="input" value={f.preferencia} onChange={set('preferencia')}><option value="psicologia">Psicología</option><option value="medicina">Medicina</option><option value="no_sabe">No sabe</option></select></Field>
        <Field label="Horario preferido"><input className="input" value={f.horario} onChange={set('horario')} /></Field>
        <div className="sm:col-span-2"><Field label="Motivo (opcional, solo lo verá el profesional asignado)"><textarea className="input" value={f.motivo} onChange={set('motivo')} /></Field></div>
        <label className="flex gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.acepta_aviso} onChange={(e) => setF({ ...f, acepta_aviso: e.target.checked })} required /> La persona fue informada y aceptó el aviso de privacidad para tramitar su solicitud.</label>
        <div className="sm:col-span-2"><ErrorMsg error={s.error} /></div>
        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={s.busy}>Registrar</button></div>
      </form>
    </Modal>
  );
}
