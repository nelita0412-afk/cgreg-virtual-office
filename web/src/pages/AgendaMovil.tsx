import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import type { DateTime } from 'luxon';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge } from '../components/ui';
import { ProgramarCita } from '../components/ProgramarCita';
import { CitaAcciones } from '../components/CitaAcciones';
import { HojaInferior } from '../components/HojaInferior';
import { ahoraGal, fHora, gal } from '../lib/format';
import { useDeslizarHorizontal } from '../lib/gestos';
import { tonoAtencion } from '../lib/tonos';
import { ESTADO_ATENCION_LABEL, TZ_INSTITUCIONAL, type EstadoAtencion } from '@shared/domain';

/**
 * Agenda en el teléfono: tira de la semana arriba y el día elegido abajo. Se desliza a izquierda/derecha para
 * cambiar de día (también sobre la tira, para cambiar de semana) y la cita se abre en una hoja inferior con
 * las mismas acciones que en escritorio. Los datos se piden por semana a la API; nada se guarda en el teléfono.
 */
export default function AgendaMovil() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const esCoord = me?.rol === 'coordinacion';
  const pid = esCoord ? params.get('profesional') ?? '' : me?.profesional_id ?? '';
  const [dia, setDia] = useState(() => ahoraGal().startOf('day'));
  const [entrada, setEntrada] = useState<'dia-desde-derecha' | 'dia-desde-izquierda' | ''>('');
  const [sel, setSel] = useState<any>(null);
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const [nueva, setNueva] = useState(false);

  const semana = dia.startOf('week');
  const desde = semana.toUTC().toISO()!;
  const hasta = semana.plus({ days: 7 }).toUTC().toISO()!;
  const pros = useQuery({ queryKey: ['profesionales'], queryFn: () => api.get('/api/profesionales'), enabled: esCoord });
  const citas = useQuery({ queryKey: ['agenda', pid, desde], queryFn: () => api.get(`/api/agenda${qs({ desde, hasta, profesional_id: pid || undefined })}`) });
  const disp = useQuery({ queryKey: ['agenda', 'disp', pid, desde], queryFn: () => api.get(`/api/agenda/disponibilidad${qs({ profesional_id: pid, desde, hasta })}`), enabled: !!pid });

  const hoy = ahoraGal().toISODate();
  const iso = dia.toISODate();
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => semana.plus({ days: i })), [semana.toISODate()]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibles = (citas.data ?? []).filter((c: any) => c.estado !== 'reprogramada');
  const porDia = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const c of visibles) {
      const k = gal(c.inicio)!.toISODate()!;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return m;
  }, [visibles]);
  const delDia = porDia.get(iso!) ?? [];
  const bloques = (disp.data ?? []).filter((b: any) => gal(b.inicio)!.toISODate() === iso);

  // La hoja muestra la versión más reciente de la cita (las acciones invalidan la consulta de la agenda).
  const actual = sel ? visibles.find((c: any) => c.id === sel.id) ?? sel : null;

  const ir = (nuevo: DateTime) => {
    if (nuevo.toISODate() === iso) return;
    setEntrada(nuevo > dia ? 'dia-desde-derecha' : 'dia-desde-izquierda');
    setDia(nuevo.startOf('day'));
  };
  const gestoDia = useDeslizarHorizontal({ alSiguiente: () => ir(dia.plus({ days: 1 })), alAnterior: () => ir(dia.minus({ days: 1 })) });
  const gestoSemana = useDeslizarHorizontal({ alSiguiente: () => ir(dia.plus({ weeks: 1 })), alAnterior: () => ir(dia.minus({ weeks: 1 })) });

  const abrir = (c: any) => {
    setSel(c);
    setHojaAbierta(true);
  };

  // Indicador «ahora»: entre la última cita que ya empezó y la siguiente, solo en el día de hoy.
  const [ahora, setAhora] = useState(() => ahoraGal());
  useEffect(() => {
    const t = setInterval(() => setAhora(ahoraGal()), 60_000);
    return () => clearInterval(t);
  }, []);
  const indiceAhora = iso === hoy ? delDia.findIndex((c: any) => gal(c.inicio)! > ahora) : -2;

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-4">
      <header className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-bold capitalize leading-tight tracking-tight text-profundo-900">{dia.setLocale('es').toFormat('LLLL yyyy')}</h1>
          <p className="text-xs muted">Hora de Galápagos (GMT-6)</p>
        </div>
        {iso !== hoy && (
          <button className="btn-ghost btn-sm min-h-11" onClick={() => ir(ahoraGal())}>
            Hoy
          </button>
        )}
        <button className="btn-primary min-h-11 px-3.5" onClick={() => setNueva(true)} aria-label="Nueva cita">
          <CalendarPlus size={18} aria-hidden /> <span className="hidden min-[380px]:inline">Nueva</span>
        </button>
      </header>

      {esCoord && (
        <select className="input min-h-11" value={pid} onChange={(e) => setParams(e.target.value ? { profesional: e.target.value } : {})} aria-label="Filtrar por profesional">
          <option value="">Todo el equipo</option>
          {(pros.data ?? []).filter((p: any) => p.es_teleatencion).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      )}

      <div className="flex items-center gap-1">
        <button className="grid h-11 w-8 shrink-0 place-items-center rounded-xl text-profundo-600 active:scale-[0.94]" onClick={() => ir(dia.minus({ weeks: 1 }))} aria-label="Semana anterior">
          <ChevronLeft size={18} />
        </button>
        <div
          className="grid flex-1 touch-pan-y select-none grid-cols-7 gap-1"
          {...gestoSemana.handlers}
          style={{ transform: gestoSemana.dx ? `translateX(${gestoSemana.dx * 0.35}px)` : undefined, transition: gestoSemana.arrastrando ? 'none' : 'transform .2s var(--ease-out)' }}
          role="tablist"
          aria-label="Días de la semana"
        >
          {dias.map((d) => {
            const k = d.toISODate()!;
            const activo = k === iso;
            const n = porDia.get(k)?.length ?? 0;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={activo}
                aria-label={`${d.setLocale('es').toFormat("cccc d 'de' LLLL")}${n ? `, ${n} ${n === 1 ? 'cita' : 'citas'}` : ''}`}
                onClick={() => ir(d)}
                className={`flex min-h-[62px] flex-col items-center justify-center gap-0.5 rounded-2xl text-center transition-[background-color,color,transform] duration-150 active:scale-[0.94] ${
                  activo ? 'bg-profundo-900 text-marfil shadow-glow' : k === hoy ? 'bg-eucalipto text-profundo-900' : 'text-profundo-700'
                }`}
              >
                <span className={`text-[11px] font-medium uppercase ${activo ? 'text-eucalipto' : 'opacity-70'}`}>{d.setLocale('es').toFormat('ccc').replace('.', '')}</span>
                <span className="text-[17px] font-semibold tabular-nums">{d.day}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${n ? (activo ? 'bg-arena-300' : 'bg-salvia-500') : 'bg-transparent'}`} aria-hidden />
              </button>
            );
          })}
        </div>
        <button className="grid h-11 w-8 shrink-0 place-items-center rounded-xl text-profundo-600 active:scale-[0.94]" onClick={() => ir(dia.plus({ weeks: 1 }))} aria-label="Semana siguiente">
          <ChevronRight size={18} />
        </button>
      </div>

      <section
        className="-mx-4 min-h-[50dvh] touch-pan-y px-4"
        {...gestoDia.handlers}
        aria-label={`Citas del ${dia.setLocale('es').toFormat("cccc d 'de' LLLL")}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') ir(dia.plus({ days: 1 }));
          if (e.key === 'ArrowLeft') ir(dia.minus({ days: 1 }));
        }}
      >
        <div
          style={{ transform: gestoDia.dx ? `translateX(${gestoDia.dx}px)` : undefined, opacity: gestoDia.dx ? Math.max(0.4, 1 - Math.abs(gestoDia.dx) / 360) : undefined, transition: gestoDia.arrastrando ? 'none' : 'transform .2s var(--ease-out), opacity .2s var(--ease-out)' }}
        >
          <div key={iso} className={`flex flex-col gap-2.5 ${entrada}`}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold text-profundo-900 first-letter:uppercase">
                {iso === hoy ? 'Hoy, ' : ''}
                {dia.setLocale('es').toFormat("cccc d 'de' LLLL")}
              </h2>
              <span className="text-xs tabular-nums muted">{delDia.length ? `${delDia.length} ${delDia.length === 1 ? 'cita' : 'citas'}` : ''}</span>
            </div>

            {bloques.map((b: any, i: number) => (
              <div key={i} className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-[13px] text-salvia-700" style={{ borderColor: 'rgba(120,149,138,.45)', background: 'rgba(220,232,225,.45)' }}>
                <Clock3 size={14} aria-hidden /> Disponible {fHora(b.inicio)}–{fHora(b.fin)}
              </div>
            ))}

            {citas.isLoading ? (
              [0, 1, 2].map((i) => <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-white/[0.05]" />)
            ) : citas.isError ? (
              <p className="rounded-2xl border px-4 py-5 text-center text-sm muted" style={{ borderColor: 'var(--line)' }}>
                No se pudo cargar la agenda. Revise su conexión; se reintentará automáticamente.
              </p>
            ) : !delDia.length ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-8 text-center" style={{ borderColor: 'var(--line-strong)' }}>
                <p className="text-sm muted">Sin citas este día.</p>
                <button className="btn-ghost btn-sm min-h-11" onClick={() => setNueva(true)}>
                  <CalendarPlus size={16} aria-hidden /> Programar una cita
                </button>
                <p className="text-[11px] faint">Deslice a los lados para ver otros días.</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {delDia.map((c: any, i: number) => (
                  <li key={c.id}>
                    {i === indiceAhora && <MarcaAhora ahora={ahora} />}
                    <button
                      onClick={() => abrir(c)}
                      className="flex w-full items-stretch gap-3 rounded-2xl border p-3 text-left shadow-suave transition-transform duration-150 active:scale-[0.98]"
                      style={{ borderColor: 'var(--line)', background: 'var(--panel-solid)' }}
                    >
                      <span className="flex w-14 shrink-0 flex-col justify-center border-r pr-2 tabular-nums" style={{ borderColor: 'var(--line)' }}>
                        <span className="text-[16px] font-semibold text-profundo-900">{fHora(c.inicio)}</span>
                        <span className="text-xs faint">{fHora(c.fin)}</span>
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                        <span className="truncate text-[15px] font-semibold text-profundo-900">{c.servidor_nombre}</span>
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge tono={tonoAtencion[c.estado as EstadoAtencion]} className="!text-[11px]">{ESTADO_ATENCION_LABEL[c.estado as EstadoAtencion]}</Badge>
                          {!pid && <span className="truncate text-xs muted">{c.profesional_nombre}</span>}
                        </span>
                      </span>
                      <ChevronRight size={18} className="shrink-0 self-center text-profundo-400" aria-hidden />
                    </button>
                  </li>
                ))}
                {indiceAhora === -1 && <li><MarcaAhora ahora={ahora} /></li>}
              </ul>
            )}
          </div>
        </div>
      </section>

      <HojaInferior abierta={hojaAbierta} onCerrar={() => setHojaAbierta(false)} titulo={actual ? `Cita ${actual.codigo}` : 'Cita'}>
        {actual && (
          <div className="flex flex-col gap-4 pt-1 text-sm">
            <div className="rounded-2xl p-4" style={{ background: 'var(--surface)' }}>
              <div className="text-[13px] text-salvia-700 first-letter:uppercase">{gal(actual.inicio)!.setZone(TZ_INSTITUCIONAL).setLocale('es').toFormat("cccc d 'de' LLLL")}</div>
              <div className="mt-0.5 text-[22px] font-semibold tabular-nums text-profundo-900">
                {fHora(actual.inicio)} – {fHora(actual.fin)} <span className="text-sm font-normal muted">· {actual.duracion_min} min</span>
              </div>
              <div className="mt-2">
                <Badge tono={tonoAtencion[actual.estado as EstadoAtencion]}>{ESTADO_ATENCION_LABEL[actual.estado as EstadoAtencion]}</Badge>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <dt className="label">Servidor</dt>
                <dd className="truncate font-medium text-profundo-900">{actual.servidor_nombre}</dd>
              </div>
              <div className="min-w-0">
                <dt className="label">Profesional</dt>
                <dd className="truncate font-medium text-profundo-900">{actual.profesional_nombre}</dd>
              </div>
            </dl>
            <CitaAcciones a={actual} />
          </div>
        )}
      </HojaInferior>

      {nueva && (
        <ProgramarCita open onClose={() => setNueva(false)} profesionalId={me?.rol === 'profesional' ? me.profesional_id ?? undefined : pid || undefined} />
      )}
    </div>
  );
}

function MarcaAhora({ ahora }: { ahora: DateTime }) {
  return (
    <div className="my-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-arena-700" aria-label={`Ahora, ${ahora.toFormat('HH:mm')}`}>
      <span className="h-2 w-2 rounded-full bg-arena-400" aria-hidden />
      Ahora · {ahora.toFormat('HH:mm')}
      <span className="h-px flex-1 bg-arena-300" aria-hidden />
    </div>
  );
}
