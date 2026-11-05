import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Users, Wifi, CheckCircle2, Stethoscope, UsersRound, CalendarDays, CalendarClock, Share2, Activity, BarChart3, CalendarRange, LayoutGrid, Box, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ProfesionalPanel } from '../components/ProfesionalPanel';
import { EstadoPill, Spinner, Empty, Avatar } from '../components/ui';
import { fHora, fFechaHora } from '../lib/format';
import { ROOMS, ZONES_ABIERTAS, type V2 } from '../office/layout';
import type { Foco } from '../office/Scene';
import { ESTADO_PRESENCIA_COLOR, ESTADO_PRESENCIA_LABEL, type EventoPublico, type PresenciaSnapshot, type Zona } from '@shared/domain';

const OfficeScene = lazy(() => import('../office/Scene'));

function soportaWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function usePrefiereMenosMovimiento() {
  const [v, setV] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!m) return;
    const f = () => setV(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return v;
}

const VISTAS: { id: string; label: string; target: V2; zoom: number; ruta?: string }[] = [
  { id: 'general', label: 'Vista general', target: [0, 0], zoom: 1 },
  { id: 'coordinacion', label: 'Coordinación', ...ZONES_ABIERTAS.coordinacion.vista, ruta: ZONES_ABIERTAS.coordinacion.ruta },
  { id: 'psicologia', label: 'Psicología Clínica', ...ZONES_ABIERTAS.psicologia.vista, ruta: '/equipo' },
  ...ROOMS.map((r) => ({ id: r.id, label: r.nombre, ...r.vista, ruta: r.ruta })),
  { id: 'territorial', label: 'Territorial', ...ZONES_ABIERTAS.territorial.vista, ruta: ZONES_ABIERTAS.territorial.ruta },
];

const ZONA_TXT: Record<Zona, string> = {
  fuera: 'Fuera de la oficina',
  estacion: 'En su estación',
  consultorio_psicologia: 'Consultorio de Psicología',
  telemedicina: 'Consultorio de Telemedicina',
  psiquiatria: 'Consultorio de Psiquiatría',
  debriefing: 'Sala de Debriefing',
  capacitacion: 'Centro de Capacitación DECE',
  coordinacion: 'Coordinación CGREG',
  territorial: 'Articulación Territorial',
  descanso: 'Zona de pausa',
};

function Kpi({ icon: Icon, valor, label, color }: { icon: typeof Users; valor: number | string | null | undefined; label: string; color: string }) {
  return (
    <div className="panel flex min-w-[128px] items-center gap-3 px-3 py-2.5">
      <Icon size={26} style={{ color }} aria-hidden />
      <div className="leading-tight">
        <div className="text-2xl font-semibold tabular-nums">{valor ?? '—'}</div>
        <div className="text-[12px] muted">{label}</div>
      </div>
    </div>
  );
}

function Anillo({ valor, max, etiqueta, color, sufijo = '' }: { valor: number | null; max: number; etiqueta: string; color: string; sufijo?: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const frac = valor == null || !max ? 0 : Math.min(1, valor / max);
  return (
    <figure className="flex flex-col items-center gap-1" aria-label={`${etiqueta}: ${valor ?? 'sin datos'}${sufijo}`}>
      <svg width="88" height="88" viewBox="0 0 88 88" role="img">
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(148,163,184,.18)" strokeWidth="7" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 44 44)" />
        <text x="44" y="49" textAnchor="middle" className="fill-white text-[19px] font-semibold tabular-nums">{valor == null ? '—' : `${valor}${sufijo}`}</text>
      </svg>
      <figcaption className="max-w-[110px] text-center text-[11px] leading-tight muted">{etiqueta}</figcaption>
    </figure>
  );
}

export default function Oficina() {
  const { me } = useAuth();
  const nav = useNavigate();
  const reducir = usePrefiereMenosMovimiento();
  const webgl = useMemo(soportaWebGL, []);
  const [modo, setModo] = useState<'3d' | 'lista'>(() => {
    try {
      const v = localStorage.getItem('cgreg.vista');
      if (v === 'lista' || v === '3d') return v;
    } catch {
      /* almacenamiento no disponible */
    }
    return webgl && window.innerWidth >= 768 ? '3d' : 'lista';
  });
  useEffect(() => {
    try {
      localStorage.setItem('cgreg.vista', modo);
    } catch {
      /* ignorar */
    }
  }, [modo]);

  const presencia = useQuery<PresenciaSnapshot[]>({ queryKey: ['presencia'], queryFn: () => api.get('/api/office/presencia'), refetchInterval: 60_000 });
  const resumen = useQuery({ queryKey: ['resumen'], queryFn: () => api.get('/api/office/resumen'), refetchInterval: 60_000 });
  const eventos = useQuery<EventoPublico[]>({ queryKey: ['eventos'], queryFn: () => api.get('/api/office/eventos?limit=30') });

  const lista = presencia.data ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const yo = lista.find((p) => p.usuario_id === me?.id);
  const clave = sel ?? yo?.clave ?? lista[0]?.clave ?? null;
  const seleccion = lista.find((p) => p.clave === clave) ?? null;
  const [foco, setFoco] = useState<Foco>({ target: [0, 0], zoom: 1, key: 0 });
  const [vista, setVista] = useState('general');

  const enfocar = (id: string) => {
    const v = VISTAS.find((x) => x.id === id);
    if (!v) return;
    setVista(id);
    setFoco((f) => ({ target: v.target, zoom: v.zoom, key: f.key + 1 }));
  };
  const zoomRel = (k: number) => setFoco((f) => ({ ...f, zoom: Math.max(0.7, Math.min(5, f.zoom * k)), key: f.key + 1 }));
  const r = resumen.data;

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4">
      {/* indicadores superiores */}
      <div className="flex gap-2 overflow-x-auto pb-1 scroll-thin" aria-label="Indicadores en tiempo real">
        <Kpi icon={Users} valor={r?.profesionales} label="Profesionales" color="#60a5fa" />
        <Kpi icon={Wifi} valor={r?.conectados} label="Conectados" color="#22c55e" />
        <Kpi icon={CheckCircle2} valor={r?.disponibles} label="Disponibles" color="#22c55e" />
        <Kpi icon={Stethoscope} valor={r?.en_consulta} label="En consulta" color="#3b82f6" />
        <Kpi icon={UsersRound} valor={r?.en_reunion} label="En reunión" color="#a855f7" />
        <Kpi icon={CalendarDays} valor={r?.atenciones_hoy} label="Atenciones hoy" color="#e2e8f0" />
        <Kpi icon={CalendarClock} valor={r?.proximas_citas} label="Próximas citas" color="#e2e8f0" />
        <Kpi icon={Share2} valor={r?.derivaciones_pendientes} label="Derivaciones pendientes" color="#c084fc" />
      </div>

      <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="panel relative flex min-h-[420px] flex-col overflow-hidden p-0 xl:h-[min(64vh,680px)]">
          <div className="flex flex-wrap items-center gap-1.5 border-b p-2" style={{ borderColor: 'var(--line)' }}>
            <div className="flex flex-1 gap-1 overflow-x-auto scroll-thin" role="toolbar" aria-label="Navegación por departamentos">
              {VISTAS.map((v) => (
                <button key={v.id} onClick={() => (modo === '3d' ? enfocar(v.id) : v.ruta && nav(v.ruta))} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs transition ${vista === v.id && modo === '3d' ? 'bg-sky-600/50 text-white' : 'muted hover:bg-white/5'}`}>
                  {v.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {modo === '3d' && (
                <>
                  <button className="btn-ghost btn-sm" onClick={() => zoomRel(1.25)} aria-label="Acercar"><ZoomIn size={14} /></button>
                  <button className="btn-ghost btn-sm" onClick={() => zoomRel(0.8)} aria-label="Alejar"><ZoomOut size={14} /></button>
                  <button className="btn-ghost btn-sm" onClick={() => enfocar('general')} aria-label="Vista general"><Maximize2 size={14} /></button>
                </>
              )}
              <button className="btn-ghost btn-sm" onClick={() => setModo(modo === '3d' ? 'lista' : '3d')} disabled={!webgl && modo === 'lista'} title={webgl ? '' : 'Este dispositivo no soporta WebGL'}>
                {modo === '3d' ? <><LayoutGrid size={14} /> Vista lista</> : <><Box size={14} /> Vista 3D</>}
              </button>
            </div>
          </div>
          {presencia.isLoading ? (
            <Spinner label="Cargando oficina…" />
          ) : modo === '3d' && webgl ? (
            <div className="relative min-h-[380px] flex-1">
              <Suspense fallback={<Spinner label="Preparando entorno 3D…" />}>
                <OfficeScene presencia={lista} seleccionado={clave} onSelect={setSel} onZona={(id) => enfocar(id)} foco={foco} reducirMovimiento={reducir} />
              </Suspense>
              {/* lista accesible por teclado de las personas en la oficina */}
              <ul className="sr-only">
                {lista.map((p) => (
                  <li key={p.clave}><button onClick={() => setSel(p.clave)}>{p.nombre}: {p.estado}</button></li>
                ))}
              </ul>
            </div>
          ) : (
            <OfficeList lista={lista} onSelect={setSel} seleccionado={clave} />
          )}
          {modo === '3d' && webgl && (
            <div className="flex flex-wrap gap-1.5 border-t px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--line)' }} aria-label="Leyenda de estados">
              {(['disponible', 'en_consulta', 'en_documentacion', 'en_reunion', 'en_pausa', 'desconectado', 'fuera_de_horario'] as const).map((e) => (
                <span key={e} className="chip bg-white/5"><span className="h-2 w-2 rounded-full" style={{ background: ESTADO_PRESENCIA_COLOR[e] }} />{ESTADO_PRESENCIA_LABEL[e]}</span>
              ))}
            </div>
          )}
        </div>
        <aside className="panel overflow-y-auto scroll-thin xl:h-[min(64vh,680px)]" aria-label="Profesional seleccionado">
          <div className="border-b px-4 py-3 text-[15px] font-semibold" style={{ borderColor: 'var(--line)' }}>Profesional seleccionado</div>
          <ProfesionalPanel seleccion={seleccion} />
        </aside>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <section className="panel p-4" aria-live="polite">
          <h2 className="panel-title mb-2 flex items-center gap-2"><Activity size={18} className="text-cyan-300" /> Actividad de la Brigada <span className="text-xs font-normal muted">(tiempo real)</span></h2>
          <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1 text-sm scroll-thin">
            {(eventos.data ?? []).length === 0 && <li className="faint">Aún no hay actividad registrada.</li>}
            {(eventos.data ?? []).map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-11 shrink-0 tabular-nums muted">{fHora(e.ts)}</span>
                <span>{e.texto}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel p-4">
          <h2 className="panel-title mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><BarChart3 size={18} className="text-cyan-300" /> Resumen del día</span>
            <span className="text-[11px] font-normal muted">Actualizado: {r ? fHora(r.actualizado) : '—'}</span>
          </h2>
          <div className="flex flex-wrap justify-around gap-2">
            <Anillo valor={r?.atendidas_hoy ?? null} max={Math.max(1, r?.atenciones_hoy ?? 0)} etiqueta="Atenciones realizadas hoy" color="#22c55e" />
            <Anillo valor={r?.cumplimiento_agenda_hoy ?? null} max={100} sufijo="%" etiqueta="Cumplimiento de agenda hoy" color="#3b82f6" />
            <Anillo valor={r?.derivaciones_activas ?? null} max={Math.max(1, r?.derivaciones_activas ?? 0)} etiqueta="Derivaciones activas a Psiquiatría" color="#a855f7" />
          </div>
        </section>
        <section className="panel p-4">
          <h2 className="panel-title mb-2 flex items-center gap-2"><CalendarRange size={18} className="text-cyan-300" /> Próximas actividades</h2>
          {(r?.proximas_actividades ?? []).length === 0 ? (
            <Empty>Sin debriefings ni capacitaciones programadas.</Empty>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {r.proximas_actividades.map((a: any) => (
                <li key={a.id}>
                  <button className="flex w-full gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/5" onClick={() => nav(a.tipo === 'debriefing' ? '/debriefing' : '/capacitacion')}>
                    <span className="shrink-0 rounded-md bg-white/5 px-1.5 tabular-nums">{fFechaHora(a.inicio).slice(0, 5)} {fHora(a.inicio)}</span>
                    <span className="truncate">{a.titulo}{a.estado === 'en_curso' && <span className="ml-1 text-emerald-300">· en curso</span>}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function OfficeList({ lista, onSelect, seleccionado }: { lista: PresenciaSnapshot[]; onSelect: (c: string) => void; seleccionado: string | null }) {
  const grupos: { titulo: string; filtro: (p: PresenciaSnapshot) => boolean }[] = [
    { titulo: 'Coordinación CGREG', filtro: (p) => p.rol === 'coordinacion' },
    { titulo: 'Psicología Clínica', filtro: (p) => p.especialidad === 'psicologia' && p.es_teleatencion },
    { titulo: 'Telemedicina', filtro: (p) => p.especialidad === 'telemedicina' },
    { titulo: 'Psiquiatría (derivación)', filtro: (p) => p.especialidad === 'psiquiatria' },
    { titulo: 'Articulación Territorial', filtro: (p) => !p.es_teleatencion && p.rol !== 'coordinacion' },
  ];
  return (
    <div className="grid flex-1 content-start gap-4 overflow-y-auto p-3 scroll-thin">
      {grupos.map((g) => {
        const ps = lista.filter(g.filtro);
        if (!ps.length) return null;
        return (
          <div key={g.titulo}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{g.titulo}</h3>
            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {ps.map((p) => (
                <button key={p.clave} onClick={() => onSelect(p.clave)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition hover:bg-white/5 ${seleccionado === p.clave ? 'ring-2 ring-cyan-400' : ''}`} style={{ borderColor: 'var(--line)' }}>
                  <Avatar nombre={p.nombre} color={p.color} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.nombre}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <EstadoPill estado={p.estado} size="sm" />
                      {p.conectado && <span className="text-[11px] faint">{ZONA_TXT[p.zona]}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
