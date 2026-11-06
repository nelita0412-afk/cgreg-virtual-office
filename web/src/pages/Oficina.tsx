import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Activity, BarChart3, Box, CalendarClock, CalendarDays, CalendarRange, CheckCircle2, Footprints, Home, LayoutGrid, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Share2, Stethoscope, Users, UsersRound, Wifi, X, ZoomIn, ZoomOut } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ProfesionalPanel } from '../components/ProfesionalPanel';
import { EstadoPill, Spinner, Empty, Avatar } from '../components/ui';
import { fHora, fFechaHora } from '../lib/format';
import { ROOMS, ZONES_ABIERTAS, type V2 } from '../office/layout';
import { useCalidad, type Foco } from '../office/Scene';
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
  { id: 'general', label: 'Vista general', target: [0, -1], zoom: 1 },
  { id: 'coordinacion', label: 'Coordinación', ...ZONES_ABIERTAS.coordinacion.vista, ruta: ZONES_ABIERTAS.coordinacion.ruta },
  { id: 'psicologia', label: 'Psicología Clínica', ...ZONES_ABIERTAS.psicologia.vista, ruta: '/equipo' },
  ...ROOMS.map((r) => ({ id: r.id, label: r.nombre, ...r.vista, ruta: r.ruta })),
  { id: 'territorial', label: 'Territorial', ...ZONES_ABIERTAS.territorial.vista, ruta: ZONES_ABIERTAS.territorial.ruta },
  { id: 'descanso', label: 'Pausa', ...ZONES_ABIERTAS.descanso.vista },
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
    <div className="flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <Icon size={17} style={{ color }} aria-hidden />
      <span className="text-lg font-semibold tabular-nums leading-none">{valor ?? '—'}</span>
      <span className="text-[11.5px] leading-tight muted">{label}</span>
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

/** Sala o zona → zona de presencia y profesionales de referencia (para el panel contextual). */
const SALA_ZONA: Record<string, { zona: Zona; profesionales?: (p: PresenciaSnapshot) => boolean }> = {
  debriefing: { zona: 'debriefing' },
  capacitacion: { zona: 'capacitacion' },
  psiquiatria: { zona: 'psiquiatria', profesionales: (p) => p.especialidad === 'psiquiatria' },
  telemedicina: { zona: 'telemedicina', profesionales: (p) => p.especialidad === 'telemedicina' },
  consultorios: { zona: 'consultorio_psicologia', profesionales: (p) => p.especialidad === 'psicologia' && p.es_teleatencion },
  psicologia: { zona: 'estacion', profesionales: (p) => p.especialidad === 'psicologia' && p.es_teleatencion },
  coordinacion: { zona: 'coordinacion', profesionales: (p) => p.rol === 'coordinacion' },
  territorial: { zona: 'territorial', profesionales: (p) => !p.es_teleatencion && p.rol !== 'coordinacion' },
  descanso: { zona: 'descanso' },
};

function SalaPanel({ id, lista, actividades, onSelect }: { id: string; lista: PresenciaSnapshot[]; actividades: any[]; onSelect: (c: string) => void }) {
  const nav = useNavigate();
  const room = ROOMS.find((r) => r.id === id);
  const abierta = (ZONES_ABIERTAS as Record<string, { nombre: string; ruta?: string; descripcion: string }>)[id];
  const info = room ? { nombre: room.nombre + (room.sub ? ` (${room.sub})` : ''), ruta: room.ruta, descripcion: room.descripcion, color: room.color } : { ...abierta, color: '#1d4ed8' };
  const map = SALA_ZONA[id];
  const presentes = lista.filter((p) => p.conectado && map && p.zona === map.zona);
  const asignados = map?.profesionales ? lista.filter(map.profesionales) : [];
  const acts = actividades.filter((a) => (id === 'debriefing' && a.tipo === 'debriefing') || (id === 'capacitacion' && a.tipo === 'capacitacion'));
  const fila = (p: PresenciaSnapshot) => (
    <li key={p.clave}>
      <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5" onClick={() => onSelect(p.clave)}>
        <Avatar nombre={p.nombre} color={p.color} size={30} />
        <span className="min-w-0 flex-1 truncate text-sm">{p.nombre}</span>
        <EstadoPill estado={p.estado} size="sm" />
      </button>
    </li>
  );
  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <div className="mb-1 h-1.5 w-12 rounded-full" style={{ background: info.color }} />
        <h3 className="text-[17px] font-semibold text-white">{info.nombre}</h3>
        <p className="mt-1 text-sm muted">{info.descripcion}</p>
      </div>
      <div>
        <div className="label">Actividad ahora</div>
        {presentes.length ? <ul>{presentes.map(fila)}</ul> : <p className="text-sm faint">Sin actividad en este momento.</p>}
      </div>
      {asignados.length > 0 && (
        <div>
          <div className="label">Profesionales del área</div>
          <ul>{asignados.map(fila)}</ul>
        </div>
      )}
      {acts.length > 0 && (
        <div>
          <div className="label">Próximas actividades</div>
          <ul className="space-y-1 text-sm">{acts.map((a) => <li key={a.id}>{fFechaHora(a.inicio)} · {a.titulo}</li>)}</ul>
        </div>
      )}
      {info.ruta && <button className="btn-primary" onClick={() => nav(info.ruta!)}>Abrir módulo</button>}
    </div>
  );
}

function IndicadorCalidad() {
  const v = useCalidad();
  const [fps, dpr, nivel] = v.split('|');
  if (fps === '0') return null;
  return (
    <span className="chip bg-slate-950/70 text-[10.5px] tabular-nums text-slate-300" title="FPS medidos en este navegador y resolución de renderizado aplicada (calidad adaptativa)">
      {fps} FPS · {nivel === 'alta' ? 'Calidad alta' : nivel === 'media' ? 'Calidad media' : 'Calidad reducida'} · DPR {dpr}
    </span>
  );
}

export default function Oficina() {
  const { me } = useAuth();
  const nav = useNavigate();
  const reducir = usePrefiereMenosMovimiento();
  const webgl = useMemo(soportaWebGL, []);
  // Movimiento ambiental (paseos breves de quien no está atendiendo). ?ambiente=0 lo desactiva (pruebas).
  const [ambiente, setAmbiente] = useState<boolean>(() => {
    const q = new URLSearchParams(window.location.search).get('ambiente');
    if (q === '0' || q === '1') return q === '1';
    try {
      return localStorage.getItem('cgreg.ambiente') !== '0';
    } catch {
      return true;
    }
  });
  const cambiarAmbiente = () =>
    setAmbiente((a) => {
      try {
        localStorage.setItem('cgreg.ambiente', a ? '0' : '1');
      } catch {
        /* sin almacenamiento: solo esta sesión */
      }
      return !a;
    });
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
  const [sala, setSala] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const yo = lista.find((p) => p.usuario_id === me?.id);
  const clave = sel ?? yo?.clave ?? lista[0]?.clave ?? null;
  const seleccion = lista.find((p) => p.clave === clave) ?? null;
  const [foco, setFoco] = useState<Foco>({ target: [0, -1], zoom: 1, key: 0 });
  const [vista, setVista] = useState('general');
  const contenedor = useRef<HTMLDivElement>(null);
  const [completa, setCompleta] = useState(false);
  useEffect(() => {
    const f = () => setCompleta(document.fullscreenElement === contenedor.current);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const pantallaCompleta = () => (document.fullscreenElement ? document.exitFullscreen() : contenedor.current?.requestFullscreen?.());

  const enfocar = (id: string) => {
    const v = VISTAS.find((x) => x.id === id);
    if (!v) return;
    setVista(id);
    setFoco((f) => ({ target: v.target, zoom: v.zoom, key: f.key + 1 }));
  };
  const seleccionar = (c: string, pos?: V2) => {
    setSel(c);
    setSala(null);
    setPanel(true);
    const p = pos ?? (() => {
      const r = (window as any).__cgregOffice?.avatares?.()[c];
      return r?.visible ? ([r.x, r.z] as V2) : undefined;
    })();
    if (p) setFoco((f) => ({ target: p, zoom: Math.max(f.zoom, 3.5), key: f.key + 1 }));
  };
  const abrirSala = (id: string) => {
    setSala(id);
    setPanel(true);
    enfocar(id);
  };
  const zoomRel = (k: number) => setFoco((f) => ({ ...f, zoom: Math.max(0.85, Math.min(9, f.zoom * k)), key: f.key + 1 }));
  const r = resumen.data;

  return (
    <div className="flex flex-col gap-2 p-2 sm:p-3">
      {/* indicadores compactos */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scroll-thin" aria-label="Indicadores en tiempo real">
        <Kpi icon={Users} valor={r?.profesionales} label="Profesionales" color="#60a5fa" />
        <Kpi icon={Wifi} valor={r?.conectados} label="Conectados" color="#22c55e" />
        <Kpi icon={CheckCircle2} valor={r?.disponibles} label="Disponibles" color="#22c55e" />
        <Kpi icon={Stethoscope} valor={r?.en_consulta} label="En consulta" color="#3b82f6" />
        <Kpi icon={UsersRound} valor={r?.en_reunion} label="En reunión" color="#a855f7" />
        <Kpi icon={CalendarDays} valor={r?.atenciones_hoy} label="Atenciones hoy" color="#e2e8f0" />
        <Kpi icon={CalendarClock} valor={r?.proximas_citas} label="Próximas citas" color="#e2e8f0" />
        <Kpi icon={Share2} valor={r?.derivaciones_pendientes} label="Derivaciones pendientes" color="#c084fc" />
      </div>

      <div
        ref={contenedor}
        className="relative overflow-hidden rounded-2xl border"
        style={{ borderColor: 'var(--line)', background: '#04102b', height: completa ? '100vh' : 'max(520px, calc(100vh - 128px))' }}
      >
        {presencia.isLoading ? (
          <Spinner label="Cargando oficina…" />
        ) : modo === '3d' && webgl ? (
          <Suspense fallback={<Spinner label="Preparando entorno 3D…" />}>
            <OfficeScene presencia={lista} seleccionado={sala ? null : clave} onSelect={seleccionar} onZona={abrirSala} foco={foco} reducirMovimiento={reducir} reservaDerecha={panel ? 356 : 0} ambiente={ambiente} />
          </Suspense>
        ) : (
          <div className="h-full overflow-y-auto pt-12"><OfficeList lista={lista} onSelect={(c) => seleccionar(c)} seleccionado={clave} /></div>
        )}

        {/* barra superior flotante: departamentos y controles */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start gap-2">
          <div className="pointer-events-auto flex max-w-full flex-1 gap-1 overflow-x-auto rounded-xl border bg-slate-950/75 p-1 backdrop-blur scroll-thin" style={{ borderColor: 'var(--line)' }} role="toolbar" aria-label="Navegación por departamentos">
            {VISTAS.map((v) => (
              <button key={v.id} onClick={() => (modo === '3d' ? (v.id === 'general' ? enfocar('general') : abrirSala(v.id)) : v.ruta && nav(v.ruta))} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs transition ${vista === v.id && modo === '3d' ? 'bg-sky-600/60 text-white' : 'text-slate-300 hover:bg-white/10'}`}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="pointer-events-auto flex gap-1 rounded-xl border bg-slate-950/75 p-1 backdrop-blur" style={{ borderColor: 'var(--line)' }}>
            {modo === '3d' && (
              <>
                <button className="btn-ghost btn-sm" onClick={() => zoomRel(1.25)} aria-label="Acercar"><ZoomIn size={14} /></button>
                <button className="btn-ghost btn-sm" onClick={() => zoomRel(0.8)} aria-label="Alejar"><ZoomOut size={14} /></button>
                <button className="btn-ghost btn-sm" onClick={() => enfocar('general')} aria-label="Vista general"><Home size={14} /></button>
              </>
            )}
            <button
              className={`btn-ghost btn-sm ${ambiente ? 'text-cyan-300' : ''}`}
              onClick={cambiarAmbiente}
              aria-pressed={ambiente}
              aria-label={ambiente ? 'Pausar movimiento ambiental' : 'Activar movimiento ambiental'}
              title="Movimiento ambiental: quien no está en consulta ni en reunión da paseos breves (agua, impresora, tablero) y vuelve a su puesto. No cambia su estado real."
            >
              <Footprints size={14} />
            </button>
            <button className="btn-ghost btn-sm" onClick={pantallaCompleta} aria-label={completa ? 'Salir de pantalla completa' : 'Pantalla completa'}>{completa ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
            <button className="btn-ghost btn-sm" onClick={() => setModo(modo === '3d' ? 'lista' : '3d')} disabled={!webgl && modo === 'lista'}>
              {modo === '3d' ? <><LayoutGrid size={14} /> Lista</> : <><Box size={14} /> 3D</>}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setPanel(!panel)} aria-label={panel ? 'Ocultar panel' : 'Mostrar panel'}>{panel ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}</button>
          </div>
        </div>

        {/* leyenda y calidad */}
        {modo === '3d' && webgl && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[70%] flex-wrap gap-1 text-[10.5px]" aria-label="Leyenda de estados">
            {(['disponible', 'en_consulta', 'en_documentacion', 'en_reunion', 'en_pausa', 'desconectado', 'fuera_de_horario'] as const).map((e) => (
              <span key={e} className="chip bg-slate-950/70 text-slate-200"><span className="h-2 w-2 rounded-full" style={{ background: ESTADO_PRESENCIA_COLOR[e] }} />{ESTADO_PRESENCIA_LABEL[e]}</span>
            ))}
            <IndicadorCalidad />
          </div>
        )}

        {/* panel contextual (profesional o sala) */}
        {panel && (
          <aside className="absolute bottom-2 right-2 top-14 flex w-[min(340px,calc(100%-16px))] flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur" style={{ borderColor: 'var(--line)', background: 'rgba(6,22,51,0.92)' }} aria-label="Panel contextual">
            <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: 'var(--line)' }}>
              <span className="text-[14px] font-semibold">{sala ? 'Departamento' : 'Profesional seleccionado'}</span>
              <button className="rounded-md p-1 hover:bg-white/10" onClick={() => setPanel(false)} aria-label="Cerrar panel"><X size={15} /></button>
            </div>
            <div className="flex-1 overflow-y-auto scroll-thin">
              {sala ? <SalaPanel id={sala} lista={lista} actividades={r?.proximas_actividades ?? []} onSelect={(c) => seleccionar(c)} /> : <ProfesionalPanel seleccion={seleccion} />}
            </div>
          </aside>
        )}
        <ul className="sr-only">
          {lista.map((p) => (
            <li key={p.clave}><button onClick={() => seleccionar(p.clave)}>{p.nombre}: {ESTADO_PRESENCIA_LABEL[p.estado]}</button></li>
          ))}
        </ul>
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        <section className="panel p-3" aria-live="polite">
          <h2 className="panel-title mb-2 flex items-center gap-2"><Activity size={17} className="text-cyan-300" /> Actividad de la Brigada <span className="text-xs font-normal muted">(tiempo real)</span></h2>
          <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1 text-sm scroll-thin">
            {(eventos.data ?? []).length === 0 && <li className="faint">Aún no hay actividad registrada.</li>}
            {(eventos.data ?? []).map((e) => (
              <li key={e.id} className="flex gap-3"><span className="w-11 shrink-0 tabular-nums muted">{fHora(e.ts)}</span><span>{e.texto}</span></li>
            ))}
          </ul>
        </section>
        <section className="panel p-3">
          <h2 className="panel-title mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><BarChart3 size={17} className="text-cyan-300" /> Resumen del día</span>
            <span className="text-[11px] font-normal muted">Actualizado: {r ? fHora(r.actualizado) : '—'}</span>
          </h2>
          <div className="flex flex-wrap justify-around gap-2">
            <Anillo valor={r?.atendidas_hoy ?? null} max={Math.max(1, r?.atenciones_hoy ?? 0)} etiqueta="Atenciones realizadas hoy" color="#22c55e" />
            <Anillo valor={r?.cumplimiento_agenda_hoy ?? null} max={100} sufijo="%" etiqueta="Cumplimiento de agenda hoy" color="#3b82f6" />
            <Anillo valor={r?.derivaciones_activas ?? null} max={Math.max(1, r?.derivaciones_activas ?? 0)} etiqueta="Derivaciones activas" color="#a855f7" />
          </div>
        </section>
        <section className="panel p-3">
          <h2 className="panel-title mb-2 flex items-center gap-2"><CalendarRange size={17} className="text-cyan-300" /> Próximas actividades</h2>
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
