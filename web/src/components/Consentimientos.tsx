import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Upload, Send, CheckCircle2, XCircle, Link2, Ban, FileText, Copy } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth, useCan } from '../lib/auth';
import { Badge, Card, ErrorMsg, Field, Modal, type Tono } from './ui';
import { fFechaHora } from '../lib/format';
import {
  ESTADO_CONSENTIMIENTO_LABEL, MODALIDAD_CONSENTIMIENTO_LABEL, SERVICIOS_CONSENTIMIENTO, SERVICIO_CONSENTIMIENTO_LABEL,
  type EstadoConsentimiento, type ModalidadConsentimiento, type ServicioConsentimiento,
} from '@shared/domain';

export const tonoConsent: Record<EstadoConsentimiento, Tono> = {
  pendiente: 'warning', cargado: 'info', pendiente_validacion: 'violet', validado: 'good', requiere_correccion: 'serious', revocado: 'critical', no_otorgado: 'neutral',
};

/** Gestión del consentimiento informado de un servidor (dos modalidades + constancias previas). */
export function ConsentimientosPanel({ servidorId, consentimientos }: { servidorId: string; consentimientos: any[] }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const puedeValidar = useCan('consentimientos.validar');
  const plantillas = useQuery({ queryKey: ['consentimientos', 'plantillas'], queryFn: () => api.get('/api/consentimientos/plantillas') });
  const [nuevo, setNuevo] = useState(false);
  const [modalidad, setModalidad] = useState<'electronica' | 'firmada_manual'>('electronica');
  const [servicio, setServicio] = useState<ServicioConsentimiento>(me?.especialidad === 'telemedicina' ? 'telemedicina' : me?.especialidad === 'psiquiatria' ? 'psiquiatria' : 'psicologia');
  const [enlace, setEnlace] = useState<{ url: string; expira: string } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [revocar, setRevocar] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [validar, setValidar] = useState<string | null>(null);
  const [obs, setObs] = useState('');
  const [hist, setHist] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [subirA, setSubirA] = useState<string | null>(null);
  const [fechaRec, setFechaRec] = useState('');

  const run = async (fn: () => Promise<any>) => {
    setErr(null);
    try {
      const r = await fn();
      qc.invalidateQueries();
      return r;
    } catch (e) {
      setErr(e);
    }
  };
  const aprobada = (s: string) => (plantillas.data ?? []).find((p: any) => p.servicio === s && p.estado === 'aprobada');
  const formato = (s: string) => aprobada(s) ?? (plantillas.data ?? []).find((p: any) => p.servicio === s);
  const descargar = (s: string, kid?: string) => {
    const p = formato(s);
    if (p) window.location.href = `/api/consentimientos/plantillas/${p.id}/pdf?servidor_id=${servidorId}${kid ? `&consentimiento_id=${kid}` : ''}`;
  };
  const subir = async (file: File) => {
    if (!subirA) return;
    setErr(null);
    const res = await fetch(`/api/consentimientos/${subirA}/documento?nombre=${encodeURIComponent(file.name)}${fechaRec ? `&fecha_recepcion=${fechaRec}` : ''}`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-cgreg': '1' },
      body: file,
    });
    if (!res.ok) setErr(new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? 'No se pudo cargar el archivo'));
    setSubirA(null);
    qc.invalidateQueries();
  };

  return (
    <Card title="Consentimiento informado" actions={<button className="btn-primary btn-sm" onClick={() => setNuevo(true)}>Nuevo consentimiento</button>}>
      <p className="mb-3 text-xs muted">Requisito para iniciar la atención ordinaria. El aviso de privacidad de la matriz <strong>no</strong> equivale a consentimiento informado.</p>
      <ErrorMsg error={err} />
      {consentimientos.length === 0 ? (
        <div className="text-sm faint">Sin consentimientos registrados.</div>
      ) : (
        <ul className="space-y-2">
          {consentimientos.map((k) => (
            <li key={k.id} className="rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tono={tonoConsent[k.estado as EstadoConsentimiento]}>{ESTADO_CONSENTIMIENTO_LABEL[k.estado as EstadoConsentimiento]}</Badge>
                <span>{MODALIDAD_CONSENTIMIENTO_LABEL[k.modalidad as ModalidadConsentimiento]}</span>
                {k.servicio && <span className="muted">· {SERVICIO_CONSENTIMIENTO_LABEL[k.servicio as ServicioConsentimiento]}</span>}
                {k.plantilla_version && <span className="faint">· formato v{k.plantilla_version}</span>}
                <span className="ml-auto text-xs faint">{fFechaHora(k.updated_at)}</span>
              </div>
              {k.modalidad === 'constancia_profesional' && <div className="mt-1 text-xs text-amber-200">Constancia sin documento (registro previo a la ampliación). No habilita la atención ordinaria salvo autorización institucional expresa.</div>}
              {k.nombre_firmado && <div className="mt-1 text-xs muted">Aceptado electrónicamente por: {k.nombre_firmado}</div>}
              {k.observaciones && <div className="mt-1 text-xs text-amber-200">Observaciones: {k.observaciones}</div>}
              {k.motivo_revocacion && <div className="mt-1 text-xs text-red-200">Revocado: {k.motivo_revocacion}</div>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {k.servicio && <button className="btn-ghost btn-sm" onClick={() => descargar(k.servicio, k.id)}><FileDown size={13} /> Formato</button>}
                {k.modalidad === 'electronica' && ['pendiente', 'requiere_correccion'].includes(k.estado) && (
                  <button className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/api/consentimientos/${k.id}/enlace`)).then((r) => r && setEnlace({ url: location.origin + r.enlace, expira: r.expira }))}><Link2 size={13} /> Nuevo enlace</button>
                )}
                {k.modalidad === 'firmada_manual' && ['pendiente', 'requiere_correccion', 'cargado'].includes(k.estado) && (
                  <button className="btn-ghost btn-sm" onClick={() => { setSubirA(k.id); setTimeout(() => fileRef.current?.click(), 0); }}><Upload size={13} /> Cargar firmado</button>
                )}
                {k.estado === 'cargado' && <button className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/api/consentimientos/${k.id}/enviar-validacion`))}><Send size={13} /> Enviar a validación</button>}
                {k.estado === 'pendiente_validacion' && puedeValidar && <button className="btn-primary btn-sm" onClick={() => { setValidar(k.id); setObs(''); }}><CheckCircle2 size={13} /> Validar</button>}
                {k.documento_id && <a className="btn-ghost btn-sm" href={`/api/consentimientos/${k.id}/documento`}><FileText size={13} /> Documento</a>}
                <button className="btn-ghost btn-sm" onClick={() => api.get(`/api/consentimientos/${k.id}`).then(setHist).catch(setErr)}>Historial</button>
                {k.estado !== 'revocado' && k.modalidad !== 'constancia_profesional' && <button className="btn-ghost btn-sm text-red-300" onClick={() => { setRevocar(k.id); setMotivo(''); }}><Ban size={13} /> Revocar</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])} />

      <Modal open={nuevo} onClose={() => setNuevo(false)} title="Nuevo consentimiento informado">
        <div className="space-y-3">
          <Field label="Servicio">
            <select className="input" value={servicio} onChange={(e) => setServicio(e.target.value as ServicioConsentimiento)}>
              {SERVICIOS_CONSENTIMIENTO.map((s) => <option key={s} value={s}>{SERVICIO_CONSENTIMIENTO_LABEL[s]}{aprobada(s) ? ` (formato v${aprobada(s).version} aprobado)` : ' — sin formato aprobado'}</option>)}
            </select>
          </Field>
          <Field label="Modalidad">
            <select className="input" value={modalidad} onChange={(e) => setModalidad(e.target.value as 'electronica' | 'firmada_manual')}>
              <option value="electronica">1. Aceptación electrónica (enlace personal de un solo uso)</option>
              <option value="firmada_manual">2. Firmado manualmente (descargar, firmar, digitalizar y cargar)</option>
            </select>
          </Field>
          {!aprobada(servicio) && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              El formato de este servicio está en <strong>borrador</strong> y debe ser aprobado institucionalmente (Configuración → Formatos de consentimiento) antes de usarse. Puede descargarlo para revisión.
            </div>
          )}
          {modalidad === 'firmada_manual' && <Field label="Fecha de recepción del documento firmado (opcional)"><input type="date" className="input" value={fechaRec} onChange={(e) => setFechaRec(e.target.value)} /></Field>}
          <ErrorMsg error={err} />
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-ghost" onClick={() => descargar(servicio)}><FileDown size={15} /> Descargar formato</button>
            <button
              className="btn-primary"
              disabled={!aprobada(servicio)}
              onClick={() =>
                run(() => api.post(`/api/servidores/${servidorId}/consentimientos/solicitar`, { modalidad, servicio })).then((r) => {
                  if (!r) return;
                  setNuevo(false);
                  if (r.enlace) setEnlace({ url: location.origin + r.enlace, expira: r.expira });
                })
              }
            >
              Crear
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!enlace} onClose={() => setEnlace(null)} title="Enlace personal para la aceptación electrónica">
        <p className="text-sm muted">Compártalo solo con la persona atendida por un canal institucional. Se muestra una única vez y vence el {enlace && fFechaHora(enlace.expira)}.</p>
        <div className="mt-3 flex gap-2">
          <input className="input font-mono text-xs" readOnly value={enlace?.url ?? ''} onFocus={(e) => e.target.select()} />
          <button className="btn-ghost" onClick={() => enlace && navigator.clipboard?.writeText(enlace.url)} aria-label="Copiar enlace"><Copy size={15} /></button>
        </div>
      </Modal>

      <Modal open={!!validar} onClose={() => setValidar(null)} title="Validar consentimiento">
        <p className="mb-3 text-sm muted">Verifique que el documento o la aceptación corresponden a la persona, al servicio y a la versión vigente del formato.</p>
        <Field label="Observaciones (obligatorias si requiere corrección)"><textarea className="input" value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        <ErrorMsg error={err} />
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => run(() => api.post(`/api/consentimientos/${validar}/validar`, { resultado: 'requiere_correccion', observaciones: obs || undefined })).then((r) => r && setValidar(null))}><XCircle size={15} /> Requiere corrección</button>
          <button className="btn-primary" onClick={() => run(() => api.post(`/api/consentimientos/${validar}/validar`, { resultado: 'validado', observaciones: obs || undefined })).then((r) => r && setValidar(null))}><CheckCircle2 size={15} /> Validar</button>
        </div>
      </Modal>

      <Modal open={!!revocar} onClose={() => setRevocar(null)} title="Registrar retiro del consentimiento">
        <p className="mb-3 text-sm muted">Los registros se conservan conforme a la ley. A partir de ahora no podrá iniciarse atención ordinaria sin un nuevo consentimiento.</p>
        <Field label="Motivo / constancia del retiro"><textarea className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setRevocar(null)}>Cancelar</button>
          <button className="btn-danger" disabled={motivo.trim().length < 3} onClick={() => run(() => api.post(`/api/consentimientos/${revocar}/revocar`, { motivo })).then((r) => r && setRevocar(null))}>Registrar retiro</button>
        </div>
      </Modal>

      <Modal open={!!hist} onClose={() => setHist(null)} title={hist ? `Historial ${hist.consentimiento.codigo}` : ''} wide>
        {hist && (
          <ol className="space-y-2 border-l pl-3 text-sm" style={{ borderColor: 'var(--line)' }}>
            {hist.historial.map((h: any, i: number) => (
              <li key={i}>
                <div><strong>{h.accion.replace(/_/g, ' ')}</strong>{h.estado_nuevo && <span className="muted"> → {ESTADO_CONSENTIMIENTO_LABEL[h.estado_nuevo as EstadoConsentimiento] ?? h.estado_nuevo}</span>}</div>
                {h.nota && <div className="text-xs muted">{h.nota}</div>}
                {h.documento_id && <a className="text-xs text-cyan-300 hover:underline" href={`/api/consentimientos/${hist.consentimiento.id}/documento?documento=${h.documento_id}`}>Ver versión del documento</a>}
                <div className="text-[11px] faint">{fFechaHora(h.ts)} · {h.actor ?? 'Persona atendida (enlace)'}</div>
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </Card>
  );
}
