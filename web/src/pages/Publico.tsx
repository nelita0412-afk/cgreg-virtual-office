import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Search, ShieldCheck } from 'lucide-react';
import { ErrorMsg, Field, Spinner, useSubmit } from '../components/ui';

/** Llamadas públicas (sin sesión ni cabecera de mutación autenticada). */
async function pub<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Sin conexión a internet. Sus respuestas siguen en el formulario: vuelva a enviarlo cuando tenga señal.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw Object.assign(new Error('Demasiados intentos seguidos. Por seguridad, espere unos minutos y vuelva a intentarlo.'), { status: 429 });
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `Error ${res.status}`), { status: res.status });
  return data;
}

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full p-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center gap-3">
          <img src="/icons/icono-192.png" alt="" className="h-12 w-12 shrink-0 rounded-2xl shadow-glow" />
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
  const [f, setF] = useState({ nombre: '', identificador: '', unidad: '', contacto: '', whatsapp: '', autoriza_whatsapp: false, preferencia: 'psicologia', horario: '', motivo: '', acepta_aviso: false, sitio_web: '' });
  const [hecho, setHecho] = useState<{ codigo: string; clave?: string; mensaje: string } | null>(null);
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
        whatsapp: f.whatsapp.trim() || undefined,
        autoriza_whatsapp: f.whatsapp.trim() ? f.autoriza_whatsapp : undefined,
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
          {hecho.clave && <ClaveUnaVez codigo={hecho.codigo} clave={hecho.clave} />}
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
          <div className="sm:col-span-2 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
            <Field label="WhatsApp para su teleatención (opcional)" hint="Si lo indica, su profesional podrá escribirle y hacer la videollamada por WhatsApp. Por ese medio no se envía información de su salud.">
              <input className="input" inputMode="tel" autoComplete="tel" placeholder="09 9999 9999" value={f.whatsapp} onChange={set('whatsapp')} />
            </Field>
            {f.whatsapp.trim() && (
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={f.autoriza_whatsapp} onChange={(e) => setF({ ...f, autoriza_whatsapp: e.target.checked })} required />
                <span>Autorizo que la Brigada de Apoyo Psicosocial me contacte por WhatsApp a este número para coordinar y realizar mi atención.</span>
              </label>
            )}
          </div>
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

/** La clave se muestra una sola vez: el servidor solo guarda su huella y no puede volver a mostrarla. */
function ClaveUnaVez({ codigo, clave }: { codigo: string; clave: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(`${codigo} · ${clave}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin portapapeles: la clave queda visible para anotarla */
    }
  };
  return (
    <div className="mt-5 rounded-2xl border p-4 text-left" style={{ borderColor: 'rgba(197,169,137,.6)', background: 'rgba(197,169,137,.12)' }}>
      <div className="flex items-center gap-2 text-sm font-semibold text-profundo-900">
        <KeyRound size={16} aria-hidden /> Clave para consultar el estado
      </div>
      <div className="mt-2 select-all text-center font-mono text-[26px] font-semibold tracking-[0.12em] text-profundo-900" aria-label={`Clave: ${clave.split('').join(' ')}`}>
        {clave}
      </div>
      <p className="mt-2 text-xs leading-relaxed muted">
        Anótela o tómele una captura. Por seguridad <strong>no se puede volver a mostrar</strong>. Con el código {codigo} y esta clave puede ver en qué etapa está su solicitud, sin cuenta.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-ghost btn-sm min-h-11" onClick={() => void copiar()}>
          <Copy size={14} aria-hidden /> {copiado ? 'Copiado' : 'Copiar código y clave'}
        </button>
        <Link to={`/servidor/estado?codigo=${encodeURIComponent(codigo)}`} className="btn-ghost btn-sm min-h-11">
          <Search size={14} aria-hidden /> Consultar estado
        </Link>
      </div>
    </div>
  );
}

const ETAPAS = [
  { id: 'recibida', titulo: 'Recibida', texto: 'La Coordinación General está revisando su solicitud.' },
  { id: 'asignada', titulo: 'Profesional asignado', texto: 'Ya tiene profesional. Le contactarán por el medio que indicó.' },
  { id: 'programada', titulo: 'Cita acordada', texto: 'Su cita está programada. Si no recibió el detalle, revise sus mensajes o llamadas.' },
  { id: 'atendida', titulo: 'Atendida', texto: 'La atención se realizó.' },
] as const;

/** Consulta del estado sin cuenta: solo muestra la etapa del trámite, nunca datos personales ni clínicos. */
export function ConsultarEstado() {
  const [params] = useSearchParams();
  const [codigo, setCodigo] = useState(params.get('codigo') ?? '');
  const [clave, setClave] = useState('');
  const [r, setR] = useState<{ codigo: string; etapa: string; actualizada: string } | null>(null);
  const s = useSubmit(() => pub('POST', '/api/publico/solicitud-estado', { codigo, clave }), (x) => setR(x));
  const indice = r ? ETAPAS.findIndex((e) => e.id === r.etapa) : -1;
  const fecha = r ? new Date(`${r.actualizada}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return (
    <Marco titulo="Estado de mi solicitud">
      {r ? (
        <div className="panel entrada-pantalla p-5" aria-live="polite">
          <div className="text-xs muted">Solicitud {r.codigo} · actualizada el {fecha}</div>
          {r.etapa === 'cerrada' ? (
            <p className="mt-3 text-[15px] text-profundo-900">La solicitud está cerrada. Si todavía necesita apoyo, puede enviar una nueva solicitud.</p>
          ) : (
            <ol className="mt-4 flex flex-col gap-0">
              {ETAPAS.map((e, i) => {
                const hecha = i < indice;
                const actual = i === indice;
                return (
                  <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {i < ETAPAS.length - 1 && <span className={`absolute left-[11px] top-6 h-[calc(100%-20px)] w-0.5 ${i < indice ? 'bg-salvia-500' : 'bg-profundo-200'}`} aria-hidden />}
                    <span className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${hecha ? 'border-salvia-500 bg-salvia-500 text-marfil' : actual ? 'border-profundo-900 bg-nieve' : 'border-profundo-200 bg-nieve'}`}>
                      {hecha ? <CheckCircle2 size={14} aria-hidden /> : actual ? <span className="h-2 w-2 rounded-full bg-profundo-900" /> : null}
                    </span>
                    <span>
                      <span className={`block text-[15px] ${actual ? 'font-semibold text-profundo-900' : hecha ? 'text-profundo-700' : 'faint'}`}>
                        {e.titulo}
                        {actual && <span className="sr-only"> (etapa actual)</span>}
                      </span>
                      {actual && <span className="mt-0.5 block text-sm muted">{e.texto}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-5 flex gap-2 text-[11px] leading-relaxed faint">
            <ShieldCheck size={13} className="mt-px shrink-0" aria-hidden />
            Esta consulta solo muestra la etapa del trámite. Sus datos personales y la información de su atención no se muestran aquí.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-ghost btn-sm min-h-11" onClick={() => { setR(null); setClave(''); }}>Consultar otra solicitud</button>
            <Link to="/servidor" className="btn-ghost btn-sm min-h-11">Volver al inicio</Link>
          </div>
        </div>
      ) : (
        <form
          className="panel flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            s.run(undefined);
          }}
        >
          <p className="text-sm muted">Escriba el código de su solicitud y la clave que recibió al enviarla.</p>
          <Field label="Código de la solicitud">
            <input className="input min-h-12 font-mono text-[16px] uppercase" placeholder="SA-0000" required maxLength={20} autoComplete="off" autoCapitalize="characters" spellCheck={false} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </Field>
          <Field label="Clave de consulta" hint="10 letras y números, por ejemplo ABCDE-23456. Puede escribirla con o sin guion.">
            <input className="input min-h-12 font-mono text-[16px] uppercase tracking-wider" required maxLength={20} autoComplete="off" autoCapitalize="characters" spellCheck={false} value={clave} onChange={(e) => setClave(e.target.value)} />
          </Field>
          <ErrorMsg error={s.error} />
          <button className="btn-primary min-h-12" disabled={s.busy}>{s.busy ? 'Consultando…' : 'Consultar estado'}</button>
          <p className="text-[11px] leading-relaxed faint">¿Perdió la clave? Por seguridad no se puede recuperar. La brigada le contactará igualmente por el medio que indicó; si lo necesita, comuníquese con la Coordinación General del CGREG.</p>
        </form>
      )}
      <div className="mt-4"><Emergencia /></div>
    </Marco>
  );
}
