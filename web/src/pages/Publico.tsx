import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { ErrorMsg, Field, Spinner, useSubmit } from '../components/ui';

/** Llamadas públicas (sin sesión ni cabecera de mutación autenticada). */
async function pub<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
  return data;
}

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full p-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-700 font-black shadow-glow" aria-hidden>CG</div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200">Consejo de Gobierno del Régimen Especial de Galápagos</div>
            <h1 className="text-xl font-bold tracking-tight">{titulo}</h1>
            <div className="text-xs muted">Brigada de Atención Psicosocial y de Salud · Santa Cruz</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Emergencia({ texto }: { texto?: string }) {
  return (
    <div className="mb-4 flex gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100" role="note">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <span>{texto ?? 'Si se trata de una emergencia, llame al ECU 911.'}</span>
    </div>
  );
}

/** Atención abierta: cualquier servidor del CGREG en Santa Cruz puede solicitar atención, sin valoración previa. */
export function SolicitarAtencion() {
  const [cfg, setCfg] = useState<{ formulario_habilitado: boolean; emergencia_texto: string } | null>(null);
  const [f, setF] = useState({ nombre: '', identificador: '', unidad: '', contacto: '', preferencia: 'psicologia', horario: '', motivo: '', acepta_aviso: false, sitio_web: '' });
  const [hecho, setHecho] = useState<{ codigo: string; mensaje: string } | null>(null);
  useEffect(() => {
    pub('GET', '/api/publico/config').then(setCfg).catch(() => setCfg({ formulario_habilitado: false, emergencia_texto: '' }));
  }, []);
  const s = useSubmit(
    () =>
      pub('POST', '/api/publico/solicitud-atencion', {
        ...f,
        identificador: f.identificador || undefined,
        unidad: f.unidad || undefined,
        horario: f.horario || undefined,
        motivo: f.motivo || undefined,
        acepta_aviso: f.acepta_aviso || undefined,
      }),
    (r) => setHecho(r),
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  if (!cfg) return <Spinner />;
  return (
    <Marco titulo="Solicitar atención psicológica o médica">
      <Emergencia texto={cfg.emergencia_texto} />
      {hecho ? (
        <div className="panel p-6 text-center">
          <CheckCircle2 size={40} className="mx-auto text-emerald-400" />
          <h2 className="mt-3 text-lg font-semibold">Solicitud registrada</h2>
          <p className="mt-2 text-sm muted">{hecho.mensaje}</p>
          <p className="mt-3 text-sm">Código de su solicitud: <strong className="font-mono">{hecho.codigo}</strong></p>
        </div>
      ) : !cfg.formulario_habilitado ? (
        <div className="panel p-6 text-sm muted">El formulario no está disponible en este momento. Comuníquese con la Coordinación de la brigada.</div>
      ) : (
        <form
          className="panel grid gap-3 p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            s.run(undefined);
          }}
        >
          <p className="text-sm muted sm:col-span-2">
            Este servicio está disponible para servidores del CGREG que laboran en Santa Cruz. <strong>No necesita haber realizado una valoración previa</strong> ni tener un profesional asignado.
          </p>
          <div className="sm:col-span-2"><Field label="Nombres y apellidos *"><input className="input" required minLength={5} autoComplete="name" value={f.nombre} onChange={set('nombre')} /></Field></div>
          <Field label="Identificador institucional (si lo conoce)" hint="Código del distributivo. Ayuda a verificar su vínculo."><input className="input" value={f.identificador} onChange={set('identificador')} /></Field>
          <Field label="Unidad o área (opcional)"><input className="input" value={f.unidad} onChange={set('unidad')} /></Field>
          <Field label="Teléfono o correo para contactarle *"><input className="input" required minLength={6} autoComplete="tel" value={f.contacto} onChange={set('contacto')} /></Field>
          <Field label="Servicio que prefiere">
            <select className="input" value={f.preferencia} onChange={set('preferencia')}>
              <option value="psicologia">Atención psicológica</option>
              <option value="medicina">Atención médica (telemedicina)</option>
              <option value="no_sabe">No sé / que la brigada me oriente</option>
            </select>
          </Field>
          <div className="sm:col-span-2"><Field label="Horario en que prefiere ser contactado (opcional)"><input className="input" value={f.horario} onChange={set('horario')} /></Field></div>
          <div className="sm:col-span-2">
            <Field label="Si desea, cuéntenos brevemente el motivo (opcional)" hint="No es obligatorio. Solo lo leerá el profesional que le atienda.">
              <textarea className="input min-h-[80px]" maxLength={1500} value={f.motivo} onChange={set('motivo')} />
            </Field>
          </div>
          {/* Campo trampa para automatizaciones (oculto a personas y lectores de pantalla) */}
          <input type="text" name="sitio_web" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden value={f.sitio_web} onChange={set('sitio_web')} />
          <label className="flex gap-2 rounded-xl border p-3 text-sm sm:col-span-2" style={{ borderColor: 'var(--line)' }}>
            <input type="checkbox" className="mt-1" checked={f.acepta_aviso} onChange={(e) => setF({ ...f, acepta_aviso: e.target.checked })} required />
            <span>
              Acepto que el CGREG trate los datos de este formulario <strong>únicamente para gestionar mi solicitud</strong> y contactarme, conforme a la Ley Orgánica de Protección de Datos Personales.
              <span className="block text-xs muted">Esto no es el consentimiento informado para la atención: ese documento se le presentará por separado antes de la primera consulta.</span>
            </span>
          </label>
          <div className="sm:col-span-2"><ErrorMsg error={s.error} /></div>
          <div className="sm:col-span-2"><button className="btn-primary w-full" disabled={s.busy}>{s.busy ? 'Enviando…' : 'Enviar solicitud'}</button></div>
        </form>
      )}
    </Marco>
  );
}

/** Aceptación electrónica del consentimiento informado mediante enlace personal de un solo uso. */
export function FirmarConsentimiento() {
  const { token } = useParams();
  const [doc, setDoc] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [f, setF] = useState({ nombre_completo: '', identificador: '', lectura: false, acepta: false });
  const [hecho, setHecho] = useState<string | null>(null);
  useEffect(() => {
    pub('GET', `/api/publico/consentimiento/${token}`).then(setDoc).catch(setErr);
  }, [token]);
  const s = useSubmit(
    () => pub('POST', `/api/publico/consentimiento/${token}`, { nombre_completo: f.nombre_completo, identificador: f.identificador || undefined, lectura_confirmada: f.lectura || undefined, acepta: f.acepta || undefined }),
    (r) => setHecho(r.mensaje),
  );
  if (err) return <Marco titulo="Consentimiento informado"><ErrorMsg error={err} /></Marco>;
  if (!doc) return <Spinner />;
  return (
    <Marco titulo={doc.titulo}>
      <Emergencia texto={doc.emergencia_texto} />
      {hecho ? (
        <div className="panel p-6 text-center">
          <ShieldCheck size={40} className="mx-auto text-emerald-400" />
          <p className="mt-3">{hecho}</p>
          <p className="mt-2 text-sm muted">Código: {doc.codigo}</p>
        </div>
      ) : (
        <>
          <article className="panel mb-4 max-h-[55vh] overflow-y-auto p-5 text-sm leading-relaxed scroll-thin" aria-label="Documento de consentimiento">
            <div className="mb-3 text-xs muted">{doc.servicio} · versión {doc.version} · {doc.codigo}</div>
            {doc.secciones.map((s: any) => (
              <section key={s.titulo} className="mb-4">
                <h2 className="mb-1 font-semibold text-white">{s.titulo}</h2>
                <p className="whitespace-pre-wrap muted">{s.texto}</p>
              </section>
            ))}
          </article>
          <form className="panel grid gap-3 p-5" onSubmit={(e) => { e.preventDefault(); s.run(undefined); }}>
            <Field label="Escriba su nombre completo (equivale a su aceptación electrónica)"><input className="input" required minLength={5} value={f.nombre_completo} onChange={(e) => setF({ ...f, nombre_completo: e.target.value })} /></Field>
            {doc.requiere_identificador && <Field label="Identificador institucional (distributivo)"><input className="input" required value={f.identificador} onChange={(e) => setF({ ...f, identificador: e.target.value })} /></Field>}
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={f.lectura} onChange={(e) => setF({ ...f, lectura: e.target.checked })} required /> He leído y comprendido el documento completo.</label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={f.acepta} onChange={(e) => setF({ ...f, acepta: e.target.checked })} required /> Acepto de forma libre y voluntaria recibir el servicio descrito.</label>
            <p className="text-xs faint">Se registrarán la fecha y hora, su dirección IP y una huella digital (hash) del documento como evidencia. El profesional validará su aceptación antes de la atención. Puede retirar su consentimiento en cualquier momento.</p>
            <ErrorMsg error={s.error} />
            <button className="btn-primary" disabled={s.busy}>Aceptar y firmar electrónicamente</button>
          </form>
        </>
      )}
    </Marco>
  );
}
