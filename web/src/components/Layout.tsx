import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Gauge, Users, CalendarDays, IdCard, HeartPulse, Share2, Inbox, MessagesSquare, GraduationCap, BarChart3, Settings, ShieldCheck, MapPin, Clock, Bell, LogOut, Menu, X, Wifi, WifiOff, Map, Siren, DoorOpen, FolderHeart,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { ahoraGal, fRelativo } from '../lib/format';
import { useConexion } from '../lib/realtime';
import { can, type Permiso } from '@shared/permissions';
import { ROL_LABEL } from '@shared/domain';

const NAV: { to: string; label: string; icon: typeof Building2; perm: Permiso[] }[] = [
  { to: '/', label: 'Oficina Virtual', icon: Building2, perm: ['oficina.ver'] },
  { to: '/comando', label: 'Centro de Comando', icon: Gauge, perm: ['indicadores.agregados'] },
  { to: '/equipo', label: 'Mi Equipo', icon: Users, perm: ['equipo.ver'] },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, perm: ['agenda.ver_todas', 'agenda.propia'] },
  { to: '/servidores', label: 'Servidores', icon: IdCard, perm: ['servidores.ver_todos', 'servidores.ver_asignados'] },
  { to: '/atencion-prioritaria', label: 'Atención prioritaria', icon: Siren, perm: ['prioritaria.ver'] },
  { to: '/atencion-abierta', label: 'Atención abierta', icon: DoorOpen, perm: ['abierta.ver'] },
  { to: '/historias-clinicas', label: 'Historias clínicas', icon: FolderHeart, perm: ['hce.ver'] },
  { to: '/atenciones', label: 'Atenciones', icon: HeartPulse, perm: ['agenda.ver_todas', 'agenda.propia'] },
  { to: '/derivaciones', label: 'Derivaciones a Psiquiatría', icon: Share2, perm: ['derivaciones.crear', 'derivaciones.coordinar'] },
  { to: '/solicitudes', label: 'Mis Solicitudes y Gestiones', icon: Inbox, perm: ['solicitudes.crear', 'solicitudes.gestionar'] },
  { to: '/debriefing', label: 'Debriefing', icon: MessagesSquare, perm: ['actividades.ver'] },
  { to: '/capacitacion', label: 'Capacitación DECE', icon: GraduationCap, perm: ['actividades.ver'] },
  { to: '/territorio', label: 'Articulación Territorial', icon: Map, perm: ['territorio.registrar'] },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, perm: ['reportes.ver'] },
  { to: '/auditoria', label: 'Auditoría', icon: ShieldCheck, perm: ['auditoria.ver'] },
  { to: '/configuracion', label: 'Configuración', icon: Settings, perm: ['oficina.ver'] },
];

function Reloj() {
  const [t, setT] = useState(ahoraGal());
  useEffect(() => {
    const i = setInterval(() => setT(ahoraGal()), 15_000);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="flex items-center gap-2" title="Hora institucional (Pacific/Galapagos)">
      <Clock size={20} className="text-cyan-300" aria-hidden />
      <div className="leading-tight">
        <div className="text-lg font-semibold tabular-nums">{t.toFormat('HH:mm')}</div>
        <div className="whitespace-nowrap text-[10px] muted">GMT-6 · Galápagos</div>
      </div>
    </div>
  );
}

function Notificaciones() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notificaciones'], queryFn: () => api.get('/api/notificaciones'), refetchInterval: 120_000 });
  const n = q.data?.no_leidas ?? 0;
  const leer = async (ids?: string[]) => {
    await api.post('/api/notificaciones/leer', { ids });
    qc.invalidateQueries({ queryKey: ['notificaciones'] });
  };
  return (
    <div className="relative">
      <button className="relative rounded-xl p-2 hover:bg-white/5" onClick={() => setOpen(!open)} aria-label={`Notificaciones (${n} sin leer)`} aria-expanded={open}>
        <Bell size={22} />
        {n > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold">{n > 99 ? '99+' : n}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] panel p-2" style={{ background: 'var(--panel-solid)' }}>
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-sm font-semibold">Notificaciones</span>
            {n > 0 && <button className="text-xs text-cyan-300 hover:underline" onClick={() => leer()}>Marcar todas como leídas</button>}
          </div>
          <div className="max-h-96 overflow-y-auto scroll-thin">
            {(q.data?.items ?? []).length === 0 && <div className="px-2 py-6 text-center text-sm faint">Sin notificaciones</div>}
            {(q.data?.items ?? []).map((it: any) => (
              <button
                key={it.id}
                className={`block w-full rounded-lg px-2 py-2 text-left hover:bg-white/5 ${it.leida_at ? 'opacity-60' : ''}`}
                onClick={() => {
                  leer([it.id]);
                  setOpen(false);
                  if (it.enlace) nav(it.enlace);
                }}
              >
                <div className="flex items-start gap-2">
                  {!it.leida_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-400" aria-label="Sin leer" />}
                  <div>
                    <div className="text-sm">{it.titulo}</div>
                    {it.cuerpo && <div className="line-clamp-2 text-xs muted">{it.cuerpo}</div>}
                    <div className="text-[11px] faint">{fRelativo(it.created_at)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Conexion() {
  const e = useConexion();
  const ok = e === 'conectado';
  return (
    <span className={`chip whitespace-nowrap ${ok ? 'bg-emerald-500/10 text-emerald-200' : 'bg-amber-500/10 text-amber-200'}`} title="Canal de tiempo real">
      {ok ? <Wifi size={12} /> : <WifiOff size={12} />}
      {ok ? 'En línea' : e === 'reconectando' ? 'Reconectando…' : 'Conectando…'}
    </span>
  );
}

export function Layout() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const items = NAV.filter((i) => i.perm.some((p) => can(me?.rol, p)));
  const salir = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    qc.clear();
    nav('/');
    qc.setQueryData(['me'], null);
  };

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Navegación principal">
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.to === '/'}
          onClick={() => setMenu(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${isActive ? 'bg-gradient-to-r from-sky-600 to-blue-700 text-white shadow-glow' : 'text-slate-200 hover:bg-white/5'}`
          }
        >
          <i.icon size={19} aria-hidden />
          <span className="leading-tight">{i.label}</span>
        </NavLink>
      ))}
      <div className="mt-auto rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-2 font-medium"><MapPin size={16} className="text-cyan-300" /> Santa Cruz, Galápagos</div>
        <div className="mt-2 text-xs muted">{me?.nombre}</div>
        <div className="text-[11px] faint">{me && ROL_LABEL[me.rol]}</div>
        <button className="btn-ghost btn-sm mt-2 w-full" onClick={salir}><LogOut size={14} /> Cerrar sesión</button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="z-30 flex items-center gap-3 border-b px-3 py-2 sm:px-4" style={{ borderColor: 'var(--line)', background: 'linear-gradient(90deg,#071a3f,#0a2559 55%,#071a3f)' }}>
        <button className="rounded-lg p-2 hover:bg-white/5 lg:hidden" onClick={() => setMenu(true)} aria-label="Abrir menú"><Menu size={22} /></button>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-700 text-sm font-black tracking-tighter shadow-glow" aria-hidden>CG</div>
          <div className="hidden leading-tight sm:block">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200">Consejo de Gobierno del Régimen Especial de Galápagos</div>
            <div className="text-[15px] font-bold tracking-tight">CGREG Virtual Office</div>
          </div>
        </div>
        <div className="mx-auto hidden text-center leading-tight 2xl:block">
          <div className="text-[13px] font-semibold uppercase tracking-wide">Centro Integral de Monitoreo y Acompañamiento Telemático</div>
          <div className="text-xs muted">Brigada de Atención Psicosocial y de Salud</div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4">
          <span className="hidden md:inline-flex"><Conexion /></span>
          <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs 2xl:flex" style={{ borderColor: 'var(--line)' }}><MapPin size={13} className="text-cyan-300" /> Santa Cruz, Galápagos</span>
          <Reloj />
          <Notificaciones />
          <NavLink to="/configuracion" className="hidden sm:block" aria-label="Mi perfil">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-sky-700 text-sm font-semibold ring-2 ring-cyan-300/40">{me?.nombre?.[0]}</div>
          </NavLink>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r scroll-thin lg:block" style={{ borderColor: 'var(--line)', background: 'rgba(4,14,36,.6)' }}>{sidebar}</aside>
        {menu && (
          <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMenu(false)}>
            <aside className="h-full w-72 overflow-y-auto" style={{ background: 'var(--panel-solid)' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-end p-2"><button className="rounded-lg p-2 hover:bg-white/5" onClick={() => setMenu(false)} aria-label="Cerrar menú"><X /></button></div>
              {sidebar}
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto scroll-thin" id="contenido">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
