import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { UserPlus, X, PhoneCall, ClipboardList, CalendarPlus, Share2, Plus, FolderHeart, Siren } from 'lucide-react';
import { ConsentimientosPanel } from '../components/Consentimientos';
import { VERIFICACION_LABEL, type Verificacion } from '@shared/domain';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, ErrorMsg, Field, Modal, PageHeader, Spinner, useSubmit } from '../components/ui';
import { ProgramarCita } from '../components/ProgramarCita';
import { fFechaHora, fRelativo } from '../lib/format';
import { tonoAtencion } from './Agenda';
import {
  CATEGORIAS_NECESIDAD, CATEGORIA_NECESIDAD_LABEL, ESTADOS_NECESIDAD, ESTADO_NECESIDAD_LABEL, ESTADO_ATENCION_LABEL, ESPECIALIDAD_LABEL, PRIORIDADES, PRIORIDAD_LABEL, RESULTADOS_CONTACTO, RESULTADO_CONTACTO_LABEL,
  type EstadoAtencion,
} from '@shared/domain';

export default function ServidorDetalle() {
  const { id } = useParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['servidor', id], queryFn: () => api.get(`/api/servidores/${id}`) });
  const pros = useQuery({ queryKey: ['profesionales'], queryFn: () => api.get('/api/profesionales'), enabled: me?.rol === 'coordinacion' });
  const [modal, setModal] = useState<null | 'asignar' | 'contacto' | 'consent' | 'necesidad' | 'cita' | 'derivar' | 'riesgo'>(null);
  const [err, setErr] = useState<unknown>(null);
  const refresh = () => qc.invalidateQueries();
  const esPro = me?.rol === 'profesional';
  const esCoord = me?.rol === 'coordinacion';
  const esTS = me?.rol === 'trabajo_social';
  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-4"><ErrorMsg error={q.error} /></div>;
  const d = q.data;
  const s = d.servidor;
  const consentVigente = d.consentimientos.find((c: any) => c.tipo === 'teleatencion' && c.estado === 'validado' && c.modalidad !== 'constancia_profesional' && !c.revocado_at);
  const accion = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title={s.nombre}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Código institucional: {s.codigo_institucional ?? '—'}</span>
            {s.unidad && <span>· {s.unidad}</span>}
            {s.estado_servidor && <span>· {s.estado_servidor}</span>}
            <span>· Canal de contacto: {s.canal_contacto ?? '—'}</span>
            {s.contacto_declarado && <span>· Contacto declarado: {s.contacto_declarado}</span>}
            <Badge tono={s.verificacion.startsWith('verificado') ? 'good' : 'warning'}>{VERIFICACION_LABEL[s.verificacion as Verificacion]}</Badge>
            {d.prioritaria && <Badge tono="critical"><Siren size={12} /> Seguimiento prioritario</Badge>}
          </span>
        }
        actions={
          <>
            {d.nivel_acceso && <Link className="btn-ghost" to={`/servidores/${id}/expediente`}><FolderHeart size={16} /> Historia clínica{d.expediente ? ` ${d.expediente.codigo}` : ''}</Link>}
            {esCoord && <button className="btn-ghost" onClick={() => setModal('asignar')}><UserPlus size={16} /> Asignar profesional</button>}
            {!esTS && <button className="btn-ghost" onClick={() => setModal('contacto')}><PhoneCall size={16} /> Registrar contacto</button>}
            <button className="btn-ghost" onClick={() => setModal('necesidad')}><ClipboardList size={16} /> Necesidad</button>
            {!esTS && <button className="btn-primary" onClick={() => setModal('cita')}><CalendarPlus size={16} /> Programar cita</button>}
            {esPro && me?.especialidad !== 'psiquiatria' && <button className="btn-ghost" onClick={() => setModal('derivar')}><Share2 size={16} /> Derivar a Psiquiatría</button>}
            {esPro && d.nivel_acceso === 'clinico' && <button className="btn-ghost" onClick={() => setModal('riesgo')}><Siren size={16} /> Clasificación de riesgo</button>}
          </>
        }
      />
      <ErrorMsg error={err} />
      {!consentVigente && esPro && (
        <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          Antes de iniciar la atención ordinaria se requiere un consentimiento informado documentado y validado (electrónico o firmado). El aviso de privacidad de la matriz no lo sustituye.
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Profesionales asignados">
          {d.asignaciones.length === 0 ? <Empty>Sin profesional asignado.</Empty> : (
            <ul className="space-y-1.5 text-sm">
              {d.asignaciones.map((a: any) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>{a.nombre} <span className="muted">· {ESPECIALIDAD_LABEL[a.especialidad as keyof typeof ESPECIALIDAD_LABEL]}</span></span>
                  {esCoord && <button className="btn-ghost btn-sm" onClick={() => accion(() => api.del(`/api/servidores/${id}/asignaciones/${a.profesional_id}`))} aria-label={`Quitar asignación de ${a.nombre}`}><X size={14} /></button>}
                </li>
              ))}
            </ul>
          )}
          {esPro && (
            <button className="btn-ghost btn-sm mt-3" onClick={() => accion(() => api.post('/api/atenciones/pendiente', { servidor_id: id, profesional_id: me!.profesional_id }))}><Plus size={14} /> Registrar atención pendiente</button>
          )}
        </Card>
        <Card title="Atenciones">
          {d.atenciones.length === 0 ? <Empty>Sin atenciones registradas.</Empty> : (
            <ul className="space-y-1.5 text-sm">
              {d.atenciones.map((a: any) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <Link to={`/atenciones/${a.id}`} className="text-cyan-200 hover:underline">{a.codigo}</Link>
                  <Badge tono={tonoAtencion[a.estado as EstadoAtencion]}>{ESTADO_ATENCION_LABEL[a.estado as EstadoAtencion]}</Badge>
                  <span className="muted">{ESPECIALIDAD_LABEL[a.tipo as keyof typeof ESPECIALIDAD_LABEL]} · {a.profesional_nombre} · {a.inicio ? fFechaHora(a.inicio) : 'sin horario'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Necesidades identificadas">
          {d.necesidades.length === 0 ? <Empty>Sin necesidades registradas.</Empty> : (
            <ul className="space-y-2 text-sm">
              {d.necesidades.map((n: any) => (
                <li key={n.id} className="rounded-lg border p-2" style={{ borderColor: 'var(--line)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tono="info">{CATEGORIA_NECESIDAD_LABEL[n.categoria as keyof typeof CATEGORIA_NECESIDAD_LABEL]}</Badge>
                    <select className="input w-auto !py-1 text-xs" value={n.estado} onChange={(e) => accion(() => api.patch(`/api/necesidades/${n.id}`, { estado: e.target.value }))} aria-label="Estado de la necesidad">
                      {ESTADOS_NECESIDAD.map((e) => <option key={e} value={e}>{ESTADO_NECESIDAD_LABEL[e]}</option>)}
                    </select>
                  </div>
                  <div className="mt-1">{n.descripcion}</div>
                  <div className="text-[11px] faint">{n.registrada_por_nombre} · {fRelativo(n.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {d.clasificaciones && (
          <Card title="Clasificación de riesgo (confidencial)">
            {d.clasificaciones.length === 0 ? <Empty>Sin clasificaciones registradas.</Empty> : (
              <ul className="space-y-2 text-sm">
                {d.clasificaciones.map((c: any) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <Badge tono={c.vigente ? 'critical' : 'neutral'}>Riesgo alto{c.vigente ? '' : ' (retirada)'}</Badge>
                    <span className="muted">{c.fuente === 'matriz_valoraciones' ? `Matriz (${c.registro_fuente_id})` : `Registro profesional · ${c.profesional}`} · valoración {c.fecha_valoracion ?? '—'}{c.requiere_seguimiento ? ' · requiere seguimiento' : ''}</span>
                    {c.vigente && c.fuente === 'registro_profesional' && <button className="text-xs text-red-300 hover:underline" onClick={() => { const m = prompt('Motivo del retiro de la clasificación'); if (m) accion(() => api.post(`/api/riesgo/${c.id}/retirar`, { motivo: m })); }}>Retirar</button>}
                    {c.motivo_retiro && <span className="text-xs faint">· {c.motivo_retiro}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {(esPro || esCoord) && <div className="lg:col-span-2"><ConsentimientosPanel servidorId={id!} consentimientos={d.consentimientos} /></div>}
        {(esCoord || esPro) && <WhatsappAutorizado servidorId={id!} estado={s.whatsapp} onCambio={refresh} />}
        <Card title="Contactos y aviso de privacidad">
          <div className="space-y-3 text-sm">
            <div>
              <div className="label">Intentos de contacto</div>
              {d.contactos.length === 0 ? <div className="faint">Sin registros.</div> : d.contactos.map((c: any, i: number) => <div key={i}>{fFechaHora(c.fecha)} · {RESULTADO_CONTACTO_LABEL[c.resultado as keyof typeof RESULTADO_CONTACTO_LABEL]} {c.canal && `(${c.canal})`} <span className="faint">— {c.registrado_por}</span></div>)}
            </div>
            <div>
              <div className="label">Aviso de privacidad (matriz institucional)</div>
              <div>{s.aviso_privacidad_aceptado == null ? 'Sin dato' : s.aviso_privacidad_aceptado ? 'Aceptado' : 'No aceptado'} <span className="text-xs faint">— no equivale a consentimiento informado para la atención clínica.</span></div>
            </div>
            <div className="text-[11px] faint">Registro de origen en matriz: {d.fuentes.map((f: any) => f.registro_id).join(', ') || '—'}</div>
          </div>
        </Card>
      </div>

      <Asignar open={modal === 'asignar'} onClose={() => setModal(null)} id={id!} pros={pros.data ?? []} />
      <Contacto open={modal === 'contacto'} onClose={() => setModal(null)} id={id!} />
      <Consentimiento open={modal === 'consent'} onClose={() => setModal(null)} id={id!} />
      <Necesidad open={modal === 'necesidad'} onClose={() => setModal(null)} id={id!} />
      {modal === 'cita' && <ProgramarCita open onClose={() => setModal(null)} servidorId={id} profesionalId={esPro ? me!.profesional_id! : undefined} />}
      <Derivar open={modal === 'derivar'} onClose={() => setModal(null)} id={id!} />
      <Riesgo open={modal === 'riesgo'} onClose={() => setModal(null)} id={id!} />
    </div>
  );
}

function FormModal({ open, onClose, title, children, onSubmit, busy, error, cta }: any) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        {children}
        <ErrorMsg error={error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy}>{cta ?? 'Guardar'}</button></div>
      </form>
    </Modal>
  );
}

function useForm<T extends object>(init: T, url: string, onClose: () => void, map?: (v: T) => unknown) {
  const qc = useQueryClient();
  const [v, setV] = useState(init);
  const s = useSubmit(() => api.post(url, map ? map(v) : v), () => { qc.invalidateQueries(); setV(init); onClose(); });
  return { v, setV, s };
}

function Asignar({ open, onClose, id, pros }: any) {
  const { v, setV, s } = useForm({ profesional_id: '' }, `/api/servidores/${id}/asignaciones`, onClose);
  return (
    <FormModal open={open} onClose={onClose} title="Asignar profesional" onSubmit={() => s.run(undefined)} busy={s.busy} error={s.error}>
      <Field label="Profesional" hint="Psiquiatría recibe servidores solo mediante derivación.">
        <select className="input" required value={v.profesional_id} onChange={(e) => setV({ profesional_id: e.target.value })}>
          <option value="">Seleccione…</option>
          {pros.filter((p: any) => p.es_teleatencion && p.especialidad !== 'psiquiatria').map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </Field>
    </FormModal>
  );
}

function Contacto({ open, onClose, id }: any) {
  const { v, setV, s } = useForm({ resultado: 'contactado', canal: '' }, `/api/servidores/${id}/contactos`, onClose, (x) => ({ ...x, canal: x.canal || undefined }));
  return (
    <FormModal open={open} onClose={onClose} title="Registrar intento de contacto" onSubmit={() => s.run(undefined)} busy={s.busy} error={s.error}>
      <Field label="Resultado"><select className="input" value={v.resultado} onChange={(e) => setV({ ...v, resultado: e.target.value })}>{RESULTADOS_CONTACTO.map((r) => <option key={r} value={r}>{RESULTADO_CONTACTO_LABEL[r]}</option>)}</select></Field>
      <Field label="Canal"><input className="input" placeholder="Llamada, WhatsApp, videollamada…" value={v.canal} onChange={(e) => setV({ ...v, canal: e.target.value })} /></Field>
    </FormModal>
  );
}

function Consentimiento({ open, onClose, id }: any) {
  const { v, setV, s } = useForm({ tipo: 'teleatencion', base_legitimacion: 'consentimiento', otorgado: 'true', canal: '' }, `/api/servidores/${id}/consentimientos`, onClose, (x) => ({ ...x, otorgado: x.otorgado === 'true', canal: x.canal || undefined }));
  return (
    <FormModal open={open} onClose={onClose} title="Registrar consentimiento / base de legitimación" onSubmit={() => s.run(undefined)} busy={s.busy} error={s.error}>
      <p className="text-xs muted">Conforme a la LOPDP. Registre la manifestación del servidor obtenida por el canal indicado.</p>
      <Field label="Tipo"><select className="input" value={v.tipo} onChange={(e) => setV({ ...v, tipo: e.target.value })}><option value="teleatencion">Consentimiento informado de teleatención</option><option value="tratamiento_datos">Tratamiento de datos personales</option></select></Field>
      <Field label="Base de legitimación"><select className="input" value={v.base_legitimacion} onChange={(e) => setV({ ...v, base_legitimacion: e.target.value })}><option value="consentimiento">Consentimiento</option><option value="interes_vital">Interés vital (emergencia)</option><option value="funcion_publica">Ejercicio de función pública</option></select></Field>
      <Field label="Decisión"><select className="input" value={v.otorgado} onChange={(e) => setV({ ...v, otorgado: e.target.value })}><option value="true">Otorgado</option><option value="false">No otorgado</option></select></Field>
      <Field label="Canal"><input className="input" value={v.canal} onChange={(e) => setV({ ...v, canal: e.target.value })} /></Field>
    </FormModal>
  );
}

function Necesidad({ open, onClose, id }: any) {
  const { v, setV, s } = useForm({ categoria: 'vivienda', descripcion: '' }, `/api/servidores/${id}/necesidades`, onClose);
  return (
    <FormModal open={open} onClose={onClose} title="Registrar necesidad identificada" onSubmit={() => s.run(undefined)} busy={s.busy} error={s.error}>
      <Field label="Categoría"><select className="input" value={v.categoria} onChange={(e) => setV({ ...v, categoria: e.target.value })}>{CATEGORIAS_NECESIDAD.map((c) => <option key={c} value={c}>{CATEGORIA_NECESIDAD_LABEL[c]}</option>)}</select></Field>
      <Field label="Descripción operativa" hint="Sin detalles clínicos."><textarea className="input" required minLength={3} value={v.descripcion} onChange={(e) => setV({ ...v, descripcion: e.target.value })} /></Field>
    </FormModal>
  );
}

function Derivar({ open, onClose, id }: any) {
  const { v, setV, s } = useForm({ prioridad: 'media', motivo: '' }, '/api/derivaciones', onClose, (x) => ({ ...x, servidor_id: id }));
  return (
    <FormModal open={open} onClose={onClose} title="Derivar a Psiquiatría (Dr. Diego Estrella)" onSubmit={() => s.run(undefined)} busy={s.busy} error={s.error} cta="Enviar derivación">
      <p className="text-xs muted">El motivo se cifra y solo lo ven usted y el especialista. Para emergencias, active la ruta de escalamiento profesional.</p>
      <Field label="Prioridad profesional"><select className="input" value={v.prioridad} onChange={(e) => setV({ ...v, prioridad: e.target.value })}>{PRIORIDADES.map((p) => <option key={p} value={p}>{PRIORIDAD_LABEL[p]}</option>)}</select></Field>
      <Field label="Motivo de derivación"><textarea className="input min-h-[120px]" required minLength={10} value={v.motivo} onChange={(e) => setV({ ...v, motivo: e.target.value })} /></Field>
    </FormModal>
  );
}

function Riesgo({ open, onClose, id }: any) {
  const { v, setV, s } = useForm({ fecha_valoracion: '', requiere_seguimiento: 'true', confirmacion: false }, `/api/servidores/${id}/riesgo`, onClose, (x) => ({
    fecha_valoracion: x.fecha_valoracion,
    requiere_seguimiento: x.requiere_seguimiento === 'true',
    confirmacion_profesional: x.confirmacion || undefined,
  }));
  return (
    <FormModal open={open} onClose={onClose} title="Registrar clasificación profesional de riesgo alto" onSubmit={() => s.run(undefined)} busy={s.busy} error={s.error} cta="Registrar">
      <p className="text-xs muted">La plataforma no calcula ni infiere riesgo. Registre únicamente una clasificación que resulte de su valoración profesional. Es información confidencial: solo la ve el equipo clínico asignado.</p>
      <Field label="Fecha de la valoración"><input type="date" className="input" required value={v.fecha_valoracion} onChange={(e) => setV({ ...v, fecha_valoracion: e.target.value })} /></Field>
      <Field label="¿Requiere seguimiento?"><select className="input" value={v.requiere_seguimiento} onChange={(e) => setV({ ...v, requiere_seguimiento: e.target.value })}><option value="true">Sí</option><option value="false">No</option></select></Field>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={v.confirmacion} onChange={(e) => setV({ ...v, confirmacion: e.target.checked })} required /> Confirmo que esta clasificación resulta de mi valoración profesional.</label>
    </FormModal>
  );
}

/**
 * WhatsApp para teleatención: solo con autorización expresa de la persona. Se muestra enmascarado; el número completo
 * solo lo usa el enlace de contacto del profesional responsable. Nada clínico viaja por WhatsApp.
 */
function WhatsappAutorizado({ servidorId, estado, onCambio }: { servidorId: string; estado: { autorizado: boolean; terminacion?: string; fuente?: string; autorizado_at?: string } | undefined; onCambio: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [numero, setNumero] = useState('');
  const [autoriza, setAutoriza] = useState(false);
  const guardar = useSubmit(() => api.put(`/api/servidores/${servidorId}/whatsapp`, { numero, autorizado: autoriza }), () => {
    setAbierto(false);
    setNumero('');
    setAutoriza(false);
    onCambio();
  });
  const retirar = useSubmit(() => api.del(`/api/servidores/${servidorId}/whatsapp`), onCambio);
  return (
    <Card title="WhatsApp para teleatención">
      {estado?.autorizado ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tono="good">Autorizado</Badge>
          <span className="tabular-nums">{estado.terminacion}</span>
          <span className="text-xs muted">
            {estado.fuente === 'solicitud_publica' ? 'Autorizado por la persona en su solicitud' : 'Autorización registrada por el equipo'} · {fFechaHora(estado.autorizado_at)}
          </span>
          <button className="btn-ghost btn-sm ml-auto" onClick={() => retirar.run(undefined)} disabled={retirar.busy}>Retirar autorización</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="muted">Sin número autorizado. Sin autorización no se habilita el contacto por WhatsApp.</span>
          <button className="btn-ghost btn-sm ml-auto" onClick={() => setAbierto(true)}>Registrar WhatsApp autorizado</button>
        </div>
      )}
      <ErrorMsg error={retirar.error} />
      <Modal open={abierto} onClose={() => setAbierto(false)} title="WhatsApp autorizado para teleatención">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); guardar.run(undefined); }}>
          <Field label="Celular (Ecuador)" hint="El número que la persona indicó para ser contactada. No use números personales sin su autorización.">
            <input className="input" inputMode="tel" autoComplete="off" placeholder="09 9999 9999" value={numero} onChange={(e) => setNumero(e.target.value)} required />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={autoriza} onChange={(e) => setAutoriza(e.target.checked)} required />
            <span>La persona autorizó expresamente que la Brigada la contacte por WhatsApp para coordinar y realizar su atención.</span>
          </label>
          <ErrorMsg error={guardar.error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setAbierto(false)}>Cancelar</button>
            <button className="btn-primary" disabled={!autoriza || guardar.busy}>Guardar</button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
