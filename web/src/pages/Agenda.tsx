import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Modal, PageHeader, Spinner, type Tono } from '../components/ui';
import { ProgramarCita } from '../components/ProgramarCita';
import { CitaAcciones } from '../components/CitaAcciones';
import { ahoraGal, fHora, gal } from '../lib/format';
import { ESTADO_ATENCION_LABEL, ESPECIALIDAD_LABEL, TZ_INSTITUCIONAL, type EstadoAtencion } from '@shared/domain';

export { tonoAtencion } from '../lib/tonos';
import { tonoAtencion } from '../lib/tonos';

export default function Agenda() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const esCoord = me?.rol === 'coordinacion';
  const pid = esCoord ? params.get('profesional') ?? '' : me?.profesional_id ?? '';
  const [semana, setSemana] = useState(() => ahoraGal().startOf('week'));
  const [nueva, setNueva] = useState(false);
  const [sel, setSel] = useState<any>(null);
  const desde = semana.toUTC().toISO()!;
  const hasta = semana.plus({ days: 7 }).toUTC().toISO()!;
  const pros = useQuery({ queryKey: ['profesionales'], queryFn: () => api.get('/api/profesionales') });
  const citas = useQuery({ queryKey: ['agenda', pid, desde], queryFn: () => api.get(`/api/agenda${qs({ desde, hasta, profesional_id: pid || undefined })}`) });
  const disp = useQuery({ queryKey: ['agenda', 'disp', pid, desde], queryFn: () => api.get(`/api/agenda/disponibilidad${qs({ profesional_id: pid, desde, hasta })}`), enabled: !!pid });

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => semana.plus({ days: i })), [semana]);
  const hoy = ahoraGal().toISODate();
  const visibles = (citas.data ?? []).filter((c: any) => c.estado !== 'reprogramada');

  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title="Agenda"
        subtitle="Todos los horarios se muestran en hora institucional de Galápagos (GMT-6). La disponibilidad programada no equivale a presencia digital."
        actions={<button className="btn-primary" onClick={() => setNueva(true)}><Plus size={16} /> Nueva cita</button>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn-ghost btn-sm" onClick={() => setSemana(semana.minus({ weeks: 1 }))} aria-label="Semana anterior"><ChevronLeft size={16} /></button>
        <button className="btn-ghost btn-sm" onClick={() => setSemana(ahoraGal().startOf('week'))}>Hoy</button>
        <button className="btn-ghost btn-sm" onClick={() => setSemana(semana.plus({ weeks: 1 }))} aria-label="Semana siguiente"><ChevronRight size={16} /></button>
        <span className="text-sm font-medium">{semana.setLocale('es').toFormat("d 'de' LLL")} – {semana.plus({ days: 6 }).setLocale('es').toFormat("d 'de' LLL yyyy")}</span>
        {esCoord && (
          <select className="input ml-auto w-auto" value={pid} onChange={(e) => setParams(e.target.value ? { profesional: e.target.value } : {})} aria-label="Filtrar por profesional">
            <option value="">Todos los profesionales</option>
            {(pros.data ?? []).filter((p: any) => p.es_teleatencion).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        )}
      </div>
      {citas.isLoading ? <Spinner /> : (
        <div className="grid gap-2 md:grid-cols-7">
          {dias.map((d) => {
            const iso = d.toISODate();
            const delDia = visibles.filter((c: any) => gal(c.inicio)!.toISODate() === iso);
            const bloques = (disp.data ?? []).filter((b: any) => gal(b.inicio)!.toISODate() === iso);
            return (
              <div key={iso} className={`panel min-h-[120px] p-2 ${iso === hoy ? 'ring-1 ring-cyan-400/60' : ''}`}>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-sm font-semibold capitalize">{d.setLocale('es').toFormat('ccc d')}</span>
                  {iso === hoy && <span className="text-[10px] text-cyan-300">HOY</span>}
                </div>
                {bloques.map((b: any, i: number) => (
                  <div key={i} className="mb-1 rounded-md border border-dashed border-emerald-400/30 bg-emerald-500/5 px-1.5 py-0.5 text-[11px] text-emerald-200">
                    Disponible {fHora(b.inicio)}–{fHora(b.fin)}
                  </div>
                ))}
                <ul className="space-y-1">
                  {delDia.map((c: any) => (
                    <li key={c.id}>
                      <button onClick={() => setSel(c)} className="w-full rounded-lg border bg-white/[.03] px-2 py-1.5 text-left text-xs hover:bg-white/10" style={{ borderColor: 'var(--line)' }}>
                        <div className="font-semibold tabular-nums">{fHora(c.inicio)}–{fHora(c.fin)}</div>
                        <Badge tono={tonoAtencion[c.estado as EstadoAtencion]} className="my-0.5 !px-1.5 !text-[10px]">{ESTADO_ATENCION_LABEL[c.estado as EstadoAtencion]}</Badge>
                        <div className="truncate">{c.servidor_nombre}</div>
                        {!pid && <div className="truncate faint">{c.profesional_nombre}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
                {!delDia.length && !bloques.length && <div className="text-[11px] faint">—</div>}
              </div>
            );
          })}
        </div>
      )}
      {!pid && esCoord && (
        <Card title="Disponibilidad semanal del equipo (hora de Galápagos)" className="mt-4">
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Profesional</th><th>Especialidad</th><th>Horario institucional</th><th>Horario de origen (Ecuador continental)</th></tr></thead>
              <tbody>
                {(pros.data ?? []).filter((p: any) => p.es_teleatencion).map((p: any) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.nombre}</td>
                    <td className="muted">{ESPECIALIDAD_LABEL[p.especialidad as keyof typeof ESPECIALIDAD_LABEL]}</td>
                    <td>{p.disponibilidad_institucional.map((d: any) => `${d.dia}: ${d.rangos.join(', ')}`).join(' · ') || <span className="faint">{p.notas_agenda}</span>}</td>
                    <td className="faint">{p.disponibilidad_origen.map((r: any) => `${['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][r.dia_semana]} ${r.hora_inicio}–${r.hora_fin}`).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {nueva && <ProgramarCita open onClose={() => setNueva(false)} profesionalId={me?.rol === 'profesional' ? me.profesional_id ?? undefined : pid || undefined} />}
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `Cita ${sel.codigo}` : ''}>
        {sel && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><div className="label">Servidor</div>{sel.servidor_nombre}</div>
              <div><div className="label">Profesional</div>{sel.profesional_nombre}</div>
              <div><div className="label">Horario (Galápagos)</div>{gal(sel.inicio)!.setZone(TZ_INSTITUCIONAL).setLocale('es').toFormat("cccc d LLL, HH:mm")} · {sel.duracion_min} min</div>
              <div><div className="label">Estado</div><Badge tono={tonoAtencion[sel.estado as EstadoAtencion]}>{ESTADO_ATENCION_LABEL[sel.estado as EstadoAtencion]}</Badge></div>
            </div>
            <CitaAcciones a={sel} />
          </div>
        )}
      </Modal>
    </div>
  );
}
export { DateTime };
