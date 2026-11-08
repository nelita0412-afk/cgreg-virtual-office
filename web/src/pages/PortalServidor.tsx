import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FileSignature, HeartHandshake, LockKeyhole, Phone, LogIn } from 'lucide-react';
import { Instalar } from '../components/AppMovil';

/**
 * Portal del servidor institucional (sin cuenta). Es la entrada móvil para cualquier servidor del CGREG
 * en Santa Cruz: pedir atención sin valoración previa y firmar el consentimiento desde el enlace recibido.
 * No pide ni guarda datos: el formulario y la firma son las páginas públicas ya existentes.
 */
export default function PortalServidor() {
  const [emergencia, setEmergencia] = useState<string | null>(null);
  const [habilitado, setHabilitado] = useState(true);
  useEffect(() => {
    fetch('/api/publico/config')
      .then((r) => r.json())
      .then((c) => {
        setEmergencia(c.emergencia_texto ?? null);
        setHabilitado(c.formulario_habilitado !== false);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-full" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-5 pb-10 pt-6">
        <header className="flex items-center gap-3">
          <img src="/icons/icono-192.png" alt="" className="h-12 w-12 rounded-2xl" />
          <div className="leading-tight">
            <div className="text-[15px] font-bold text-white">CGREG Virtual Office</div>
            <div className="text-xs muted">Consejo de Gobierno del Régimen Especial de Galápagos</div>
          </div>
        </header>

        <section className="flex flex-col gap-3">
          <h1 className="text-[30px] font-bold leading-[1.1] tracking-tight text-white" style={{ textWrap: 'balance' }}>
            Si las afectaciones de El Niño le están pesando, puede pedir acompañamiento
          </h1>
          <p className="text-[15px] leading-relaxed muted" style={{ textWrap: 'pretty' }}>
            Para servidores del CGREG que trabajan en Santa Cruz. Psicólogas, psicólogos y médicos de la brigada le atienden a distancia, por llamada o videollamada. No necesita una valoración previa.
          </p>
        </section>

        <a
          href="tel:911"
          className="flex min-h-14 items-center gap-3 rounded-2xl border px-4 text-[15px] font-semibold text-red-100 transition-transform duration-150 active:scale-[0.98]"
          style={{ borderColor: 'rgba(248,113,113,.45)', background: 'rgba(127,29,29,.35)' }}
        >
          <Phone size={20} aria-hidden />
          <span className="flex-1">¿Está en peligro ahora? Llame al ECU 911</span>
          <ChevronRight size={18} aria-hidden />
        </a>
        {emergencia && <p className="-mt-3 text-xs leading-relaxed faint">{emergencia}</p>}

        <div className="flex flex-col gap-3">
          {habilitado ? (
            <Link
              to="/solicitar-atencion"
              className="flex min-h-[72px] items-center gap-4 rounded-2xl px-5 text-left transition-transform duration-150 active:scale-[0.98]"
              style={{ background: 'linear-gradient(160deg,#22d3ee,#0369a1)', color: '#04102b' }}
            >
              <HeartHandshake size={26} aria-hidden />
              <span className="flex-1">
                <span className="block text-[17px] font-bold">Solicitar atención</span>
                <span className="block text-[13px] font-medium opacity-80">Formulario de 3 minutos</span>
              </span>
              <ChevronRight size={20} aria-hidden />
            </Link>
          ) : (
            <p className="rounded-2xl border px-4 py-3 text-sm muted" style={{ borderColor: 'var(--line)' }}>
              El formulario en línea no está disponible en este momento. Comuníquese con la Coordinación General del CGREG.
            </p>
          )}

          <div className="flex items-start gap-4 rounded-2xl border px-5 py-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <FileSignature size={24} className="mt-0.5 shrink-0 text-cyan-300" aria-hidden />
            <div className="text-sm">
              <div className="text-[15px] font-semibold text-white">¿Le enviaron un enlace de consentimiento?</div>
              <p className="mt-1 leading-relaxed muted">Ábralo desde el mensaje que recibió: le lleva directamente al documento para leerlo y aceptarlo. El enlace es personal y vence a los pocos días.</p>
            </div>
          </div>
        </div>

        <section className="flex flex-col gap-3" aria-label="Qué pasa después">
          <h2 className="text-[17px] font-semibold text-white">Qué pasa después de pedir atención</h2>
          <ol className="flex flex-col gap-3">
            {[
              ['Revisión', 'La Coordinación General verifica que usted trabaja en el CGREG en Santa Cruz.'],
              ['Asignación', 'Se le asigna una profesional o un profesional según lo que necesita.'],
              ['Contacto', 'Le escriben o llaman al contacto que dejó para acordar la cita.'],
              ['Consentimiento', 'Antes de la primera atención recibe el enlace para leer y aceptar el consentimiento.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-semibold tabular-nums text-cyan-200" style={{ borderColor: 'rgba(79,224,240,.35)' }}>{i + 1}</span>
                <span className="text-sm leading-relaxed">
                  <span className="font-semibold text-white">{t}. </span>
                  <span className="muted">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <p className="flex gap-2 text-xs leading-relaxed faint">
          <LockKeyhole size={14} className="mt-0.5 shrink-0" aria-hidden />
          Su información es confidencial y la tratan solo las personas que participan en su atención, conforme a la Ley Orgánica de Protección de Datos Personales.
        </p>

        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--line)' }}>
          <Instalar />
        </div>

        <Link to="/" className="flex min-h-12 items-center justify-center gap-2 text-sm text-cyan-300">
          <LogIn size={16} aria-hidden /> Soy parte de la brigada o de la institución: ingresar
        </Link>
      </div>
    </div>
  );
}
