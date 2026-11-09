import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowUpRight, Bell, CalendarDays, CalendarClock, ChevronRight, ClipboardList, FolderHeart, HeartPulse, Inbox, LifeBuoy, Share2, Siren, DoorOpen, Building2, Gauge, Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ahoraGal, fHora, fRelativo, fFecha, gal } from '../lib/format';
import { tonoAtencion, tonoPrioridad, tonoSolicitud, DERIVACION_ACTIVA } from '../lib/tonos';
import { Badge, ErrorMsg } from '../components/ui';
import { SolicitarApoyoModal } from '../components/SolicitarApoyo';
import { AvisoNotificacionesPush } from '../components/AppMovil';
import { puede } from '@shared/permissions';
import {
  ESTADO_ATENCION_LABEL, ESTADO_DERIVACION_LABEL, ESTADO_PRESENCIA_COLOR, ESTADO_PRESENCIA_LABEL, ESTADO_SOLICITUD_LABEL, ESTADOS_MANUALES, PRIORIDAD_LABEL, ROL_LABEL,
  type EstadoAtencion, type EstadoDerivacion, type EstadoPresencia, type EstadoSolicitud, type PresenciaSnapshot,
} from '@shared/domain';

/**
 * «Mi día»: pantalla de inicio de la app (móvil primero), distinta según el perfil.
 * Todo lo que muestra sale de la API en el momento: no hay cifras de ejemplo ni datos guardados en el dispositivo.
 */
export default function Inicio() {
  const { me } = useAuth();
  if (!me) return null;
  const esProfesional = me.rol === 'profesional' && !!me.profesional_id;
  const esCoordinacion = me.rol === 'coordinacion';
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pb-8 pt-4 sm:px-6 lg:pt-8">
      <Saludo />
      <AvisoNotificacionesPush />
      {esProfesional && <DiaProfesional />}
      {esCoordinacion && <DiaCoordinacion />}
      {!esProfesional && !esCoordinacion && <DiaInstitucional />}
    </div>
  );
}

/* --------------------------------------- Encabezado --------------------------------------- */
function Saludo() {
  const { me } = useAuth();
  const ahora = ahoraGal();
  const h = ahora.hour;
  const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const fecha = ahora.setLocale('es').toFormat("cccc d 'de' LLLL");
  const nombre = (me?.nombre ?? '').replace(/^(Dr\.|Dra\.|Ma\.)\s*/i, '').split(' ')[0];
  return (
    <header className="flex flex-col gap-1">
      <p className="text-sm muted">{fecha.charAt(0).toUpperCase() + fecha.slice(1)} · {ahora.toFormat('HH:mm')} en Galápagos</p>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white sm:text-3xl" style={{ textWrap: 'balance' }}>
        {saludo}, {nombre}
      </h1>
      <p className="text-sm faint">{me && ROL_LABEL[me.rol]}</p>
      <MiEstado />
    </header>
  );
}

const ETIQUETA_CORTA: Partial<Record<EstadoPresencia, string>> = { en_documentacion: 'Documentando' };

/** Estado de presencia propio: lo que ven Coordinación y el equipo en la oficina virtual. */
function MiEstado() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const registra = puede(me, 'presencia.propia');
  const pres = useQuery<PresenciaSnapshot[]>({ queryKey: ['presencia'], queryFn: () => api.get('/api/office/presencia'), enabled: registra, refetchInterval: 60_000 });
  if (!registra) return null;
  const yo = pres.data?.find((p) => p.usuario_id === me?.id);
  const actual = yo?.estado;
  const automatico = actual && !ESTADOS_MANUALES.includes(actual);
  const cambiar = async (estado: EstadoPresencia) => {
    setError(null);
    try {
      await api.post('/api/office/estado', { estado });
      await qc.invalidateQueries({ queryKey: ['presencia'] });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex gap-1.5 rounded-2xl border p-1" role="radiogroup" aria-label="Mi estado en la oficina" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.6)' }}>
        {ESTADOS_MANUALES.map((e) => {
          const activo = actual === e;
          return (
            <button
              key={e}
              role="radio"
              aria-checked={activo}
              onClick={() => cambiar(e)}
              disabled={!!automatico}
              className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-2 text-[13px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] disabled:opacity-60 ${activo ? 'bg-nieve text-white shadow-glow' : 'text-slate-300'}`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ESTADO_PRESENCIA_COLOR[e] }} aria-hidden />
              {ETIQUETA_CORTA[e] ?? ESTADO_PRESENCIA_LABEL[e]}
            </button>
          );
        })}
      </div>
      {automatico && (
        <p className="text-xs muted">
          Ahora figura «{ESTADO_PRESENCIA_LABEL[actual]}» por una actividad en curso; el estado cambia solo al terminarla.
        </p>
      )}
      <ErrorMsg error={error} />
    </div>
  );
}

/* ------------------------------------- Piezas comunes ------------------------------------- */
function Seccion({ titulo, icono, accion, children }: { titulo: string; icono: ReactNode; accion?: { to: string; label: string }; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={titulo}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white">
          <span className="text-cyan-300" aria-hidden>{icono}</span>
          {titulo}
        </h2>
        {accion && (
          <Link to={accion.to} className="-mr-2 flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-cyan-300 hover:bg-white/5">
            {accion.label} <ChevronRight size={16} aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Lista({ children }: { children: ReactNode }) {
  return <ul className="divide-y overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>{children}</ul>;
}

function Fila({ to, children, onClick }: { to?: string; children: ReactNode; onClick?: () => void }) {
  const cls = 'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-white/[0.04] active:bg-white/[0.07]';
  return (
    <li style={{ borderColor: 'var(--line)' }}>
      {to ? (
        <Link to={to} className={cls}>
          {children}
          <ChevronRight size={18} className="ml-auto shrink-0 faint" aria-hidden />
        </Link>
      ) : (
        <button className={cls} onClick={onClick}>{children}</button>
      )}
    </li>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed px-4 py-5 text-sm muted" style={{ borderColor: 'var(--line)' }}>{children}</p>;
}

function Cargando() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1].map((i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/[0.04]" />)}
    </div>
  );
}

/** Indicador con valor real del sistema; si la consulta falla muestra «—», nunca un número inventado. */
function Indicador({ etiqueta, valor, to, tono }: { etiqueta: string; valor: number | null | undefined; to?: string; tono?: 'alerta' }) {
  const contenido = (
    <>
      <span className={`text-2xl font-bold tabular-nums ${tono === 'alerta' && valor ? 'text-amber-300' : 'text-white'}`}>{valor ?? '—'}</span>
      <span className="text-xs leading-snug muted">{etiqueta}</span>
    </>
  );
  const cls = 'flex min-h-[84px] flex-col justify-between gap-1 rounded-2xl border p-3 transition-colors duration-150';
  return to ? (
    <Link to={to} className={`${cls} hover:bg-white/[0.04]`} style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>{contenido}</Link>
  ) : (
    <div className={cls} style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>{contenido}</div>
  );
}

function Accesos({ items }: { items: { to?: string; onClick?: () => void; label: string; icono: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((i) => {
        const cls = 'flex min-h-14 items-center gap-2.5 rounded-2xl border px-3 text-sm font-medium text-slate-100 transition-[background-color,transform] duration-150 hover:bg-white/[0.05] active:scale-[0.97]';
        const st = { borderColor: 'var(--line)', background: 'var(--panel)' };
        const inner = <><span className="text-cyan-300" aria-hidden>{i.icono}</span><span className="leading-tight">{i.label}</span></>;
        return i.to ? <Link key={i.label} to={i.to} className={cls} style={st}>{inner}</Link> : <button key={i.label} onClick={i.onClick} className={cls} style={st}>{inner}</button>;
      })}
    </div>
  );
}

const rangoHoy = () => {
  const a = ahoraGal().startOf('day');
  return { desde: a.toUTC().toISO()!, hasta: a.plus({ days: 1 }).toUTC().toISO()! };
};

/* --------------------------------------- Profesional --------------------------------------- */
function DiaProfesional() {
  const { me } = useAuth();
  const nav = useNavigate();
  const [apoyo, setApoyo] = useState(false);
  const { desde, hasta } = useMemo(rangoHoy, []);
  const agenda = useQuery<any[]>({ queryKey: ['agenda', 'hoy', desde], queryFn: () => api.get(`/api/agenda?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`), refetchInterval: 60_000 });
  const seguimientos = useQuery<any[]>({ queryKey: ['seguimientos', 'pendiente'], queryFn: () => api.get('/api/seguimientos?estado=pendiente') });
  const solicitudes = useQuery<any[]>({ queryKey: ['solicitudes', 'abiertas'], queryFn: () => api.get('/api/solicitudes?filtro=abiertas') });
  const derivaciones = useQuery<any[]>({ queryKey: ['derivaciones'], queryFn: () => api.get('/api/derivaciones'), enabled: puede(me, 'derivaciones.crear') });

  const citas = (agenda.data ?? []).filter((c) => c.estado !== 'reprogramada');
  const siguiente = citas.find((c) => ['programada', 'confirmada', 'contacto_iniciado', 'en_atencion'].includes(c.estado) && new Date(c.fin) > new Date());
  const ahoraIso = new Date().toISOString();
  const segs = seguimientos.data ?? [];
  const vencidos = segs.filter((s) => s.fecha_programada < ahoraIso);
  const derActivas = (derivaciones.data ?? []).filter((d) => DERIVACION_ACTIVA(d.estado as EstadoDerivacion));

  return (
    <>
      {siguiente && <ProximaCita c={siguiente} />}

      <Seccion titulo="Hoy en mi agenda" icono={<CalendarDays size={18} />} accion={{ to: '/agenda', label: 'Agenda' }}>
        {agenda.isLoading ? <Cargando /> : agenda.error ? <ErrorMsg error={agenda.error} /> : citas.length === 0 ? (
          <Vacio>No tiene citas programadas para hoy.</Vacio>
        ) : (
          <Lista>
            {citas.map((c) => (
              <Fila key={c.id} to={`/atenciones/${c.id}`}>
                <span className="w-12 shrink-0 text-[15px] font-semibold tabular-nums text-white">{fHora(c.inicio)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-slate-100">{c.servidor_nombre}</span>
                  <span className="block text-xs faint">{c.codigo} · {c.duracion_min} min</span>
                </span>
                <Badge tono={tonoAtencion[c.estado as EstadoAtencion]}>{ESTADO_ATENCION_LABEL[c.estado as EstadoAtencion]}</Badge>
              </Fila>
            ))}
          </Lista>
        )}
      </Seccion>

      <div className="grid grid-cols-3 gap-2">
        <Indicador etiqueta="Seguimientos vencidos" valor={seguimientos.data ? vencidos.length : null} tono="alerta" to="/atenciones" />
        <Indicador etiqueta="Solicitudes abiertas" valor={solicitudes.data?.length} to="/solicitudes" />
        <Indicador etiqueta="Derivaciones activas" valor={derivaciones.data ? derActivas.length : null} to="/derivaciones" />
      </div>

      <Seccion titulo="Seguimientos pendientes" icono={<CalendarClock size={18} />} accion={segs.length > 4 ? { to: '/atenciones', label: 'Ver todos' } : undefined}>
        {seguimientos.isLoading ? <Cargando /> : segs.length === 0 ? (
          <Vacio>No tiene seguimientos pendientes.</Vacio>
        ) : (
          <Lista>
            {segs.slice(0, 4).map((s) => (
              <Fila key={s.id} to={`/servidores/${s.servidor_id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-slate-100">{s.servidor_nombre}</span>
                  <span className={`block text-xs ${s.fecha_programada < ahoraIso ? 'text-amber-300' : 'faint'}`}>
                    {s.fecha_programada < ahoraIso ? 'Vencido · ' : ''}{fFecha(s.fecha_programada)} {fHora(s.fecha_programada)}
                  </span>
                </span>
              </Fila>
            ))}
          </Lista>
        )}
      </Seccion>

      <Seccion titulo="Mis solicitudes a Coordinación" icono={<Inbox size={18} />} accion={{ to: '/solicitudes', label: 'Todas' }}>
        {solicitudes.isLoading ? <Cargando /> : (solicitudes.data ?? []).length === 0 ? (
          <Vacio>No tiene solicitudes abiertas. Si necesita una gestión institucional, use «Solicitar apoyo».</Vacio>
        ) : (
          <Lista>
            {(solicitudes.data ?? []).slice(0, 3).map((s) => (
              <Fila key={s.id} to={`/solicitudes/${s.id}`}>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="line-clamp-2 text-[15px] leading-snug text-slate-100">{s.accion_requerida}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs faint">
                    <Badge tono={tonoSolicitud[s.estado as EstadoSolicitud]}>{ESTADO_SOLICITUD_LABEL[s.estado as EstadoSolicitud]}</Badge>
                    {s.codigo} · {fRelativo(s.ultima_accion ?? s.updated_at)}
                  </span>
                </span>
              </Fila>
            ))}
          </Lista>
        )}
      </Seccion>

      {derActivas.length > 0 && (
        <Seccion titulo="Derivaciones a Psiquiatría" icono={<Share2 size={18} />} accion={{ to: '/derivaciones', label: 'Ver' }}>
          <Lista>
            {derActivas.slice(0, 3).map((d) => (
              <Fila key={d.id} to={`/derivaciones/${d.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-slate-100">{d.servidor_nombre}</span>
                  <span className="block text-xs faint">{d.codigo}{d.cita_inicio ? ` · cita ${fFecha(d.cita_inicio)} ${fHora(d.cita_inicio)}` : ''}</span>
                </span>
                <Badge tono={tonoPrioridad[d.prioridad]}>{ESTADO_DERIVACION_LABEL[d.estado as EstadoDerivacion]}</Badge>
              </Fila>
            ))}
          </Lista>
        </Seccion>
      )}

      <Seccion titulo="Accesos rápidos" icono={<ArrowUpRight size={18} />}>
        <Accesos
          items={[
            { label: 'Solicitar apoyo', icono: <LifeBuoy size={20} />, onClick: () => setApoyo(true) },
            { label: 'Historias clínicas', icono: <FolderHeart size={20} />, to: '/historias-clinicas' },
            { label: 'Mis servidores', icono: <ClipboardList size={20} />, to: '/servidores' },
            { label: 'Atención abierta', icono: <DoorOpen size={20} />, to: '/atencion-abierta' },
          ]}
        />
      </Seccion>
      <SolicitarApoyoModal open={apoyo} onClose={() => setApoyo(false)} onCreada={(id) => nav(`/solicitudes/${id}`)} />
    </>
  );
}

function ProximaCita({ c }: { c: any }) {
  const inicio = gal(c.inicio)!;
  const enCurso = c.estado === 'en_atencion';
  const minutos = Math.round(inicio.diffNow('minutes').minutes);
  const cuando = enCurso ? 'En curso' : minutos <= 0 ? 'Ahora' : minutos < 60 ? `En ${minutos} min` : `A las ${inicio.toFormat('HH:mm')}`;
  return (
    <Link
      to={`/atenciones/${c.id}`}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-3xl border p-5 transition-transform duration-150 active:scale-[0.99]"
      style={{ borderColor: 'transparent', background: 'linear-gradient(150deg, #78958A 0%, #4D665C 100%)', color: '#F5F3EC' }}
      aria-label={`Próxima atención: ${c.servidor_nombre}, ${cuando}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-eucalipto">{enCurso ? 'Atención en curso' : 'Próxima atención'}</span>
        <span className="rounded-full bg-marfil/15 px-3 py-1 text-sm font-semibold tabular-nums text-marfil">{cuando}</span>
      </div>
      <div>
        <div className="text-[22px] font-bold leading-tight text-marfil">{c.servidor_nombre}</div>
        <div className="mt-1 text-sm text-eucalipto/90">
          {fHora(c.inicio)}–{fHora(c.fin)} · {c.codigo}
        </div>
      </div>
      <span className="flex items-center gap-1 text-sm font-medium text-arena-200">
        Abrir la atención <ChevronRight size={16} className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

/* -------------------------------------- Coordinación -------------------------------------- */
function DiaCoordinacion() {
  const panel = useQuery<any>({ queryKey: ['panel-coord'], queryFn: () => api.get('/api/coordinacion/panel'), refetchInterval: 60_000 });
  const resumen = useQuery<any>({ queryKey: ['resumen'], queryFn: () => api.get('/api/office/resumen'), refetchInterval: 60_000 });
  const r = resumen.data;
  const p = panel.data;
  const necesitan: any[] = p?.que_necesitan ?? [];
  return (
    <>
      <Seccion titulo="Requiere su atención" icono={<AlertTriangle size={18} />}>
        {panel.isLoading ? <Cargando /> : panel.error ? <ErrorMsg error={panel.error} /> : (p?.alertas ?? []).length === 0 ? (
          <Vacio>No hay alertas operativas en este momento.</Vacio>
        ) : (
          <Lista>
            {p.alertas.map((a: any, i: number) => (
              <Fila key={i} to={a.enlace}>
                <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${a.nivel === 'alta' ? 'bg-red-400' : 'bg-amber-400'}`} aria-label={a.nivel === 'alta' ? 'Prioridad alta' : 'Prioridad media'} />
                <span className="flex-1 text-[15px] leading-snug text-slate-100">{a.texto}</span>
              </Fila>
            ))}
          </Lista>
        )}
      </Seccion>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Indicador etiqueta="Profesionales conectados" valor={r?.conectados} to="/" />
        <Indicador etiqueta="En consulta ahora" valor={r?.en_consulta} to="/" />
        <Indicador etiqueta="Atenciones agendadas hoy" valor={r?.atenciones_hoy} to="/agenda" />
        <Indicador etiqueta="Solicitudes urgentes abiertas" valor={p?.urgentes} tono="alerta" to="/solicitudes" />
      </div>

      <Seccion titulo="Lo que necesitan los profesionales" icono={<Inbox size={18} />} accion={{ to: '/solicitudes', label: 'Bandeja' }}>
        {panel.isLoading ? <Cargando /> : necesitan.length === 0 ? (
          <Vacio>No hay solicitudes pendientes de gestión.</Vacio>
        ) : (
          <Lista>
            {necesitan.slice(0, 5).map((s) => (
              <Fila key={s.id} to={`/solicitudes/${s.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-slate-100">{s.accion_requerida}</span>
                  <span className="block truncate text-xs faint">{s.codigo} · {s.solicitante_nombre} · {fRelativo(s.ultima_accion ?? s.created_at)}</span>
                </span>
                <Badge tono={tonoPrioridad[s.prioridad]}>{PRIORIDAD_LABEL[s.prioridad as keyof typeof PRIORIDAD_LABEL]}</Badge>
              </Fila>
            ))}
          </Lista>
        )}
      </Seccion>

      {p && (
        <div className="grid grid-cols-3 gap-2">
          <Indicador etiqueta="Seguimiento para hoy" valor={p.gestionar_hoy.seguimiento_hoy.length} to="/solicitudes" />
          <Indicador etiqueta="Esperando a instituciones" valor={p.gestionar_hoy.respuestas_externas.length} to="/solicitudes" />
          <Indicador etiqueta="Respuestas atrasadas" valor={p.gestionar_hoy.atrasadas.length} tono="alerta" to="/solicitudes" />
        </div>
      )}

      <Seccion titulo="Accesos rápidos" icono={<ArrowUpRight size={18} />}>
        <Accesos
          items={[
            { label: 'Centro de Comando', icono: <Gauge size={20} />, to: '/comando' },
            { label: 'Atención prioritaria', icono: <Siren size={20} />, to: '/atencion-prioritaria' },
            { label: 'Atención abierta', icono: <DoorOpen size={20} />, to: '/atencion-abierta' },
            { label: 'Derivaciones', icono: <Share2 size={20} />, to: '/derivaciones' },
          ]}
        />
      </Seccion>
    </>
  );
}

/* ------------------------- Autoridad, auditoría, administración y otros ------------------------- */
function DiaInstitucional() {
  const { me } = useAuth();
  const resumen = useQuery<any>({ queryKey: ['resumen'], queryFn: () => api.get('/api/office/resumen'), refetchInterval: 60_000 });
  const notif = useQuery<any>({ queryKey: ['notificaciones'], queryFn: () => api.get('/api/notificaciones') });
  const r = resumen.data;
  const accesos = [
    { label: 'Oficina virtual', icono: <Building2 size={20} />, to: '/', perm: 'oficina.ver' as const },
    { label: 'Centro de Comando', icono: <Gauge size={20} />, to: '/comando', perm: 'indicadores.agregados' as const },
    { label: 'Equipo', icono: <Users size={20} />, to: '/equipo', perm: 'equipo.ver' as const },
    { label: 'Mis solicitudes', icono: <Inbox size={20} />, to: '/solicitudes', perm: 'solicitudes.crear' as const },
    { label: 'Servidores', icono: <ClipboardList size={20} />, to: '/servidores', perm: 'servidores.ver_asignados' as const },
    { label: 'Reportes', icono: <HeartPulse size={20} />, to: '/reportes', perm: 'reportes.ver' as const },
  ].filter((a) => puede(me, a.perm));
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Indicador etiqueta="Profesionales conectados" valor={r?.conectados} />
        <Indicador etiqueta="En consulta ahora" valor={r?.en_consulta} />
        <Indicador etiqueta="Atenciones agendadas hoy" valor={r?.atenciones_hoy} />
        <Indicador etiqueta="Atendidas hoy" valor={r?.atendidas_hoy} />
      </div>
      <Seccion titulo="Notificaciones recientes" icono={<Bell size={18} />}>
        {notif.isLoading ? <Cargando /> : (notif.data?.items ?? []).length === 0 ? (
          <Vacio>No tiene notificaciones.</Vacio>
        ) : (
          <Lista>
            {notif.data.items.slice(0, 5).map((n: any) => (
              <Fila key={n.id} to={n.enlace ?? undefined}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-slate-100">{n.titulo}</span>
                  <span className="block text-xs faint">{fRelativo(n.created_at)}</span>
                </span>
              </Fila>
            ))}
          </Lista>
        )}
      </Seccion>
      {accesos.length > 0 && (
        <Seccion titulo="Accesos rápidos" icono={<ArrowUpRight size={18} />}>
          <Accesos items={accesos} />
        </Seccion>
      )}
    </>
  );
}
