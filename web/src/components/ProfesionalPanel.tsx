import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, Stethoscope, CalendarClock, BarChart3, ListChecks, LifeBuoy, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar, EstadoPill, Spinner, ErrorMsg } from './ui';
import { SolicitarApoyoModal } from './SolicitarApoyo';
import { ESPECIALIDAD_LABEL, ESTADOS_MANUALES, ESTADO_PRESENCIA_LABEL, ESTADO_PRESENCIA_COLOR, type PresenciaSnapshot } from '@shared/domain';
import { fHora, fDiaLargo, minutosDesde } from '../lib/format';

export function ProfesionalPanel({ seleccion }: { seleccion: PresenciaSnapshot | null }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const pid = seleccion?.profesional_id;
  const q = useQuery({ queryKey: ['panel-pro', pid], queryFn: () => api.get(`/api/profesionales/${pid}/panel`), enabled: !!pid });
  const esYo = !!seleccion && seleccion.usuario_id === me?.id;

  if (!seleccion) return <div className="p-4 text-sm faint">Seleccione un profesional en la oficina.</div>;

  const cambiar = async (estado: string) => {
    setErr(null);
    try {
      await api.post('/api/office/estado', { estado });
      qc.invalidateQueries({ queryKey: ['panel-pro'] });
    } catch (e) {
      setErr(e);
    }
  };

  const d = q.data;
  const desde = minutosDesde(seleccion.desde);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar nombre={seleccion.nombre} color={seleccion.color} size={64} />
        <div className="min-w-0">
          <div className="text-[17px] font-semibold leading-tight text-white">{seleccion.nombre}</div>
          <div className="text-sm muted">{d?.profesional?.titulo ?? (seleccion.rol === 'coordinacion' ? 'Coordinación General' : '')}</div>
          <div className="mt-1.5">
            <EstadoPill estado={seleccion.estado} />
          </div>
          {seleccion.conectado && !seleccion.en_horario && seleccion.profesional_id && <div className="mt-1 text-[11px] text-amber-200">Conectado fuera de su horario programado</div>}
          {!seleccion.tiene_cuenta && <div className="mt-1 text-[11px] faint">Sin cuenta activa en la plataforma</div>}
        </div>
      </div>

      {esYo && (
        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
          <div className="mb-2 text-xs font-medium muted">Mi estado</div>
          <div className="flex flex-wrap gap-1.5">
            {ESTADOS_MANUALES.map((e) => (
              <button key={e} onClick={() => cambiar(e)} className={`btn-ghost btn-sm ${seleccion.estado === e ? 'bg-white/10' : ''}`} aria-pressed={seleccion.estado === e}>
                <span className="h-2 w-2 rounded-full" style={{ background: ESTADO_PRESENCIA_COLOR[e] }} />
                {ESTADO_PRESENCIA_LABEL[e]}
              </button>
            ))}
          </div>
          <div className="mt-2"><ErrorMsg error={err} /></div>
          {(me?.rol === 'profesional' || me?.rol === 'territorial') && (
            <button className="btn-primary mt-3 w-full" onClick={() => setModal(true)}>
              <LifeBuoy size={16} /> Solicitar apoyo a Coordinación
            </button>
          )}
        </div>
      )}

      {pid && q.isLoading && <Spinner />}
      {d && (
        <ul className="divide-y text-sm" style={{ borderColor: 'var(--line)' }}>
          <li className="flex gap-3 py-2.5" style={{ borderColor: 'var(--line)' }}>
            <CalendarDays size={18} className="mt-0.5 shrink-0 text-cyan-300" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Horario semanal <span className="font-normal muted">(Galápagos)</span></div>
              {d.disponibilidad_institucional.length === 0 && <div className="text-xs muted">{d.profesional.notas_agenda ?? 'Sin horario registrado'}</div>}
              {d.disponibilidad_institucional.map((x: any) => (
                <div key={x.dia_semana} className="flex justify-between gap-2 tabular-nums">
                  <span className="muted">{x.dia.slice(0, 3)}:</span>
                  <span>{x.rangos.join(', ')}</span>
                </div>
              ))}
              {d.franjas_confirmadas.length > 0 && (
                <div className="mt-1 text-xs">
                  <div className="muted">Franjas confirmadas:</div>
                  {d.franjas_confirmadas.slice(0, 3).map((f: any) => (
                    <div key={f.id} className="tabular-nums">{fDiaLargo(f.inicio)} · {fHora(f.inicio)}–{fHora(f.fin)}</div>
                  ))}
                </div>
              )}
            </div>
          </li>
          <li className="flex gap-3 py-2.5" style={{ borderColor: 'var(--line)' }}>
            <Stethoscope size={18} className="mt-0.5 shrink-0 text-cyan-300" />
            <div>
              <span className="font-semibold">Estado actual:</span> {ESTADO_PRESENCIA_LABEL[seleccion.estado]}
              {seleccion.conectado && <span className="muted"> (desde hace {desde} min)</span>}
            </div>
          </li>
          {d.profesional.es_teleatencion && (
            <>
              <li className="flex gap-3 py-2.5" style={{ borderColor: 'var(--line)' }}>
                <CalendarClock size={18} className="mt-0.5 shrink-0 text-cyan-300" />
                <div><span className="font-semibold">Próxima cita:</span> {d.proxima_cita ? `${fDiaLargo(d.proxima_cita.inicio)}, ${fHora(d.proxima_cita.inicio)}` : 'Sin citas programadas'}</div>
              </li>
              <li className="flex gap-3 py-2.5" style={{ borderColor: 'var(--line)' }}>
                <BarChart3 size={18} className="mt-0.5 shrink-0 text-cyan-300" />
                <div><span className="font-semibold">Atenciones hoy:</span> {d.atenciones_hoy} <span className="muted">de {d.agendadas_hoy} agendadas</span></div>
              </li>
              <li className="flex gap-3 py-2.5" style={{ borderColor: 'var(--line)' }}>
                <ListChecks size={18} className="mt-0.5 shrink-0 text-cyan-300" />
                <div><span className="font-semibold">Seguimientos pendientes:</span> {d.seguimientos_pendientes}</div>
              </li>
            </>
          )}
          <li className="py-2.5 text-xs muted" style={{ borderColor: 'var(--line)' }}>
            {ESPECIALIDAD_LABEL[d.profesional.especialidad as keyof typeof ESPECIALIDAD_LABEL]} · {d.profesional.modalidad}
          </li>
        </ul>
      )}
      {pid && d?.profesional.es_teleatencion && (
        <div className="flex gap-2">
          <Link to={`/agenda?profesional=${pid}`} className="btn-primary flex-1"><CalendarDays size={16} /> Ver agenda</Link>
          <Link to={`/equipo#${pid}`} className="btn-ghost" aria-label="Ficha profesional"><ExternalLink size={16} /></Link>
        </div>
      )}
      <SolicitarApoyoModal open={modal} onClose={() => setModal(false)} />
    </div>
  );
}
