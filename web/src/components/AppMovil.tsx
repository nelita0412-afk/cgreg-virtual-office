import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BellRing, Download, LogOut, Send, MapPin, MoreHorizontal, RefreshCw, Share, Smartphone, WifiOff, X, type LucideIcon } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useActualizacion, useEnLinea, useInstalacion, usePush } from '../lib/pwa';
import { can, type Permiso } from '@shared/permissions';
import { ROL_LABEL } from '@shared/domain';

export type ItemNav = { to: string; label: string; corto?: string; icon: LucideIcon; perm: Permiso[] };

/** Destinos de la barra inferior por perfil (máximo 4 + «Más»). Lo demás queda en «Más». */
const PRIORIDAD_POR_ROL: Record<string, string[]> = {
  profesional: ['/inicio', '/agenda', '/atenciones', '/solicitudes'],
  coordinacion: ['/inicio', '/solicitudes', '/agenda', '/derivaciones'],
  trabajo_social: ['/inicio', '/servidores', '/solicitudes', '/historias-clinicas'],
  territorial: ['/inicio', '/territorio', '/solicitudes', '/oficina'],
  autoridad: ['/inicio', '/oficina', '/comando', '/reportes'],
  auditoria: ['/inicio', '/auditoria', '/reportes', '/oficina'],
  admin: ['/inicio', '/oficina', '/configuracion', '/equipo'],
};

export function BarraInferior({ items, onSalir }: { items: ItemNav[]; onSalir: () => void }) {
  const { me } = useAuth();
  const [mas, setMas] = useState(false);
  const loc = useLocation();
  useEffect(() => setMas(false), [loc.pathname]);
  const orden = PRIORIDAD_POR_ROL[me?.rol ?? ''] ?? [];
  const principales = orden.map((to) => items.find((i) => i.to === to)).filter((i): i is ItemNav => !!i).slice(0, 4);
  const resto = items.filter((i) => !principales.includes(i));
  const enResto = resto.some((i) => (i.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.to)));

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t lg:hidden"
        style={{ borderColor: 'var(--line)', background: 'rgba(250,249,244,.92)', backdropFilter: 'saturate(1.4) blur(18px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Navegación de la app"
      >
        <ul className="mx-auto flex max-w-xl">
          {principales.map((i) => (
            <li key={i.to} className="flex-1">
              <NavLink
                to={i.to}
                end={i.to === '/'}
                className={({ isActive }) =>
                  `flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150 active:scale-[0.96] ${isActive ? 'text-cyan-300' : 'text-slate-400'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors duration-150 ${isActive ? 'bg-cyan-400/15' : ''}`}>
                      <i.icon size={21} strokeWidth={isActive ? 2.3 : 1.9} aria-hidden />
                    </span>
                    {i.corto ?? i.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li className="flex-1">
            <button
              onClick={() => setMas(true)}
              aria-expanded={mas}
              aria-haspopup="dialog"
              className={`flex min-h-[60px] w-full flex-col items-center justify-center gap-1 text-[11px] font-medium active:scale-[0.96] ${enResto ? 'text-cyan-300' : 'text-slate-400'}`}
            >
              <span className={`grid h-7 w-12 place-items-center rounded-full ${enResto ? 'bg-cyan-400/15' : ''}`}><MoreHorizontal size={22} aria-hidden /></span>
              Más
            </button>
          </li>
        </ul>
      </nav>
      <HojaMas abierta={mas} onCerrar={() => setMas(false)} items={resto} onSalir={onSalir} />
    </>
  );
}

/** Panel inferior con el resto de módulos, la cuenta y los ajustes de la app en este teléfono. */
function HojaMas({ abierta, onCerrar, items, onSalir }: { abierta: boolean; onCerrar: () => void; items: ItemNav[]; onSalir: () => void }) {
  const { me } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierta) return;
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [abierta, onCerrar]);
  return (
    <div className={`fixed inset-0 z-50 lg:hidden ${abierta ? '' : 'pointer-events-none'}`} aria-hidden={!abierta}>
      <div className={`absolute inset-0 bg-profundo-950/35 transition-opacity duration-200 ${abierta ? 'opacity-100' : 'opacity-0'}`} onClick={onCerrar} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Más opciones"
        className={`absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t outline-none transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] ${abierta ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ borderColor: 'var(--line)', background: 'var(--panel-solid)', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
      >
        <div className="sticky top-0 flex items-center justify-between px-5 pb-2 pt-3" style={{ background: 'var(--panel-solid)' }}>
          <span className="mx-auto h-1.5 w-10 rounded-full bg-white/20" aria-hidden />
          <button onClick={onCerrar} className="absolute right-3 top-2 grid h-11 w-11 place-items-center rounded-full hover:bg-white/5" aria-label="Cerrar"><X size={20} /></button>
        </div>
        <div className="flex flex-col gap-5 px-5">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-sky-700 text-lg font-semibold ring-2 ring-cyan-300/40">{me?.nombre?.[0]}</div>
            <div className="min-w-0">
              <div className="truncate font-semibold text-white">{me?.nombre}</div>
              <div className="text-xs muted">{me && ROL_LABEL[me.rol]} · <MapPin size={11} className="inline" aria-hidden /> Santa Cruz</div>
            </div>
          </div>
          <ul className="grid grid-cols-3 gap-2">
            {items.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  end={i.to === '/'}
                  className={({ isActive }) =>
                    `flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl border px-2 text-center text-[12px] leading-tight transition-[background-color,transform] duration-150 active:scale-[0.96] ${isActive ? 'border-cyan-400/50 bg-cyan-400/10 text-white' : 'text-slate-200 hover:bg-white/5'}`
                  }
                  style={({ isActive }) => (isActive ? undefined : { borderColor: 'var(--line)' })}
                >
                  <i.icon size={22} className="text-cyan-300" aria-hidden />
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <AjustesDispositivo />
          <button className="btn-ghost min-h-12 w-full" onClick={onSalir}><LogOut size={16} /> Cerrar sesión</button>
        </div>
      </div>
    </div>
  );
}

export function AjustesDispositivo() {
  const push = usePush();
  const inst = useInstalacion();
  const [prueba, setPrueba] = useState<{ tipo: 'enviando' | 'ok' | 'error'; texto?: string } | null>(null);
  const probar = async () => {
    setPrueba({ tipo: 'enviando' });
    try {
      const r = await push.probar();
      setPrueba(r.enviadas ? { tipo: 'ok', texto: 'Aviso enviado. Debería verlo en unos segundos.' } : { tipo: 'error', texto: 'El servicio de notificaciones del teléfono no aceptó el aviso. Desactive y vuelva a activar.' });
    } catch (e) {
      setPrueba({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo enviar la prueba.' });
    }
  };
  return (
    <div className="flex flex-col divide-y rounded-2xl border" style={{ borderColor: 'var(--line)' }}>
      {!inst.instalada && (inst.puedeInstalar || inst.requiereGuiaIos) && (
        <div className="p-3" style={{ borderColor: 'var(--line)' }}><Instalar compacto /></div>
      )}
      {(push.estado === 'activo' || push.estado === 'inactivo' || push.estado === 'bloqueado') && (
        <div className="flex items-center gap-3 p-3" style={{ borderColor: 'var(--line)' }}>
          <BellRing size={20} className="shrink-0 text-cyan-300" aria-hidden />
          <div className="flex-1 text-sm">
            <div className="text-white">Avisos en este teléfono</div>
            <div className="text-xs muted">{push.estado === 'bloqueado' ? 'Bloqueados en la configuración del teléfono.' : push.estado === 'activo' ? 'Activados.' : 'Desactivados.'}</div>
          </div>
          {push.estado !== 'bloqueado' && (
            <button className="btn-ghost btn-sm min-h-10" onClick={() => (push.estado === 'activo' ? push.desactivar() : push.activar())}>
              {push.estado === 'activo' ? 'Desactivar' : 'Activar'}
            </button>
          )}
        </div>
      )}
      {push.estado === 'activo' && (
        <div className="flex flex-col gap-2 p-3" style={{ borderColor: 'var(--line)' }}>
          <button className="btn-ghost btn-sm min-h-10 self-start" onClick={() => void probar()} disabled={prueba?.tipo === 'enviando'}>
            <Send size={14} aria-hidden /> {prueba?.tipo === 'enviando' ? 'Enviando…' : 'Enviar aviso de prueba'}
          </button>
          {prueba?.texto && (
            <p role="status" className={`text-xs ${prueba.tipo === 'ok' ? 'text-emerald-300' : 'text-amber-200'}`}>
              {prueba.texto}
            </p>
          )}
        </div>
      )}
      {push.estado === 'no_disponible' && (
        <p className="p-3 text-xs muted" style={{ borderColor: 'var(--line)' }}>Este navegador no admite notificaciones push. En iPhone, instale la app en la pantalla de inicio (iOS 16.4 o superior).</p>
      )}
      {push.estado === 'no_configurado' && (
        <p className="p-3 text-xs muted" style={{ borderColor: 'var(--line)' }}>Las notificaciones push aún no están configuradas en el servidor de la institución.</p>
      )}
    </div>
  );
}

/* ------------------------------------------ Avisos ------------------------------------------ */

/** Banda de conexión: se muestra mientras el teléfono no tiene red. */
export function AvisoSinConexion() {
  const enLinea = useEnLinea();
  if (enLinea) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-amber-500/15 px-4 py-2 text-[13px] text-amber-100" style={{ borderBottom: '1px solid rgba(183,121,31,.25)' }}>
      <WifiOff size={16} className="shrink-0" aria-hidden />
      Sin conexión. Lo que ve puede no estar actualizado; para guardar cambios espere a recuperar la señal.
    </div>
  );
}

export function AvisoActualizacion() {
  const { disponible, aplicar } = useActualizacion();
  if (!disponible) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border p-3 shadow-2xl lg:bottom-6" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel-solid)' }}>
      <RefreshCw size={20} className="shrink-0 text-cyan-300" aria-hidden />
      <span className="flex-1 text-sm text-white">Hay una versión nueva de la app.</span>
      <button className="btn-primary btn-sm min-h-10" onClick={aplicar}>Actualizar</button>
    </div>
  );
}

/** Invitación a instalar: diálogo del sistema en Android; instrucciones en iPhone (Safari no tiene botón de instalación). */
export function Instalar({ compacto }: { compacto?: boolean }) {
  const inst = useInstalacion();
  const [guia, setGuia] = useState(false);
  if (inst.instalada || (!inst.puedeInstalar && !inst.requiereGuiaIos)) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Smartphone size={20} className="shrink-0 text-cyan-300" aria-hidden />
        <div className="flex-1 text-sm">
          <div className="text-white">Instale la app en este teléfono</div>
          {!compacto && <div className="text-xs muted">Ícono en la pantalla de inicio y acceso en pantalla completa.</div>}
        </div>
        <button className="btn-primary btn-sm min-h-10" onClick={() => (inst.puedeInstalar ? inst.instalar() : setGuia(!guia))}>
          <Download size={14} /> Instalar
        </button>
      </div>
      {guia && (
        <ol className="ml-8 list-decimal space-y-1 text-xs muted">
          <li>Toque <Share size={12} className="inline" aria-label="Compartir" /> «Compartir» en la barra de Safari.</li>
          <li>Elija «Agregar a pantalla de inicio».</li>
          <li>Confirme con «Agregar».</li>
        </ol>
      )}
    </div>
  );
}

/** Tarjeta en «Mi día»: instalación y avisos en el teléfono, solo cuando aplican. */
export function AvisoNotificacionesPush() {
  const push = usePush();
  const inst = useInstalacion();
  const [cerrada, setCerrada] = useState(() => {
    try {
      return sessionStorage.getItem('cgreg.aviso-app') === '1';
    } catch {
      return false;
    }
  });
  const pedirPush = push.estado === 'inactivo';
  const pedirInstalar = !inst.instalada && (inst.puedeInstalar || inst.requiereGuiaIos);
  if (cerrada || (!pedirPush && !pedirInstalar)) return null;
  const cerrar = () => {
    setCerrada(true);
    try {
      sessionStorage.setItem('cgreg.aviso-app', '1');
    } catch {
      /* almacenamiento no disponible: se cierra solo en esta vista */
    }
  };
  return (
    <section className="relative flex flex-col gap-3 rounded-2xl border p-4 pr-12" style={{ borderColor: 'rgba(120,149,138,.35)', background: 'var(--surface)' }} aria-label="Configurar la app en este teléfono">
      <button onClick={cerrar} className="absolute right-1.5 top-1.5 grid h-10 w-10 place-items-center rounded-full hover:bg-white/5" aria-label="Ocultar"><X size={18} /></button>
      {pedirInstalar && <Instalar />}
      {pedirPush && (
        <div className="flex items-center gap-3">
          <BellRing size={20} className="shrink-0 text-cyan-300" aria-hidden />
          <div className="flex-1 text-sm">
            <div className="text-white">Reciba avisos en el teléfono</div>
            <div className="text-xs muted">Citas nuevas, respuestas de Coordinación y consentimientos. Sin datos clínicos en la pantalla bloqueada.</div>
          </div>
          <button className="btn-primary btn-sm min-h-10" onClick={push.activar}>Activar</button>
        </div>
      )}
    </section>
  );
}
