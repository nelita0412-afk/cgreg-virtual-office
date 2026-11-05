import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorMsg, Field, Modal, Spinner, useSubmit } from './ui';
import { ahoraGal, fHora } from '../lib/format';
import { DURACIONES, type Especialidad } from '@shared/domain';

interface Props {
  open: boolean;
  onClose: () => void;
  servidorId?: string;
  profesionalId?: string;
  derivacionId?: string;
  atencionId?: string; // atención pendiente a programar
  reprogramarId?: string; // cita a reprogramar
  titulo?: string;
}

/** Programación con franjas libres calculadas por el backend (disponibilidad real − citas reservadas). */
export function ProgramarCita({ open, onClose, servidorId, profesionalId, derivacionId, atencionId, reprogramarId, titulo }: Props) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const pros = useQuery({ queryKey: ['profesionales'], queryFn: () => api.get('/api/profesionales'), enabled: open });
  const servidores = useQuery({ queryKey: ['servidores-selector'], queryFn: () => api.get('/api/servidores-selector'), enabled: open && !servidorId });
  const [srv, setSrv] = useState(servidorId ?? '');
  const [pro, setPro] = useState(profesionalId ?? (me?.rol === 'profesional' ? me.profesional_id ?? '' : ''));
  const [fecha, setFecha] = useState(ahoraGal().toISODate()!);
  const [slot, setSlot] = useState<string | null>(null);
  const proSel = (pros.data ?? []).find((p: any) => p.id === pro);
  const esp: Especialidad | undefined = proSel?.especialidad;
  const duraciones = esp ? DURACIONES[esp] : [];
  const [dur, setDur] = useState<number | null>(null);
  const duracion = dur && duraciones.includes(dur) ? dur : duraciones[duraciones.length - 1];

  const libres = useQuery({
    queryKey: ['franjas', pro, fecha, duracion],
    queryFn: () => api.get<string[]>(`/api/agenda/franjas-libres${qs({ profesional_id: pro, fecha, duracion })}`),
    enabled: open && !!pro && !!duracion,
  });

  const s = useSubmit(
    () =>
      reprogramarId
        ? api.post(`/api/agenda/citas/${reprogramarId}/reprogramar`, { inicio: slot, duracion_min: duracion })
        : api.post('/api/agenda/citas', { servidor_id: servidorId ?? srv, profesional_id: pro, inicio: slot, duracion_min: duracion, derivacion_id: derivacionId, atencion_id: atencionId }),
    () => {
      qc.invalidateQueries();
      setSlot(null);
      onClose();
    },
  );

  const opcionesPro = useMemo(
    () => (pros.data ?? []).filter((p: any) => p.es_teleatencion && (derivacionId ? p.especialidad === 'psiquiatria' : p.especialidad !== 'psiquiatria')),
    [pros.data, derivacionId],
  );

  return (
    <Modal open={open} onClose={onClose} title={titulo ?? (reprogramarId ? 'Reprogramar cita' : 'Programar cita')} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        {!servidorId && !reprogramarId && (
          <Field label="Servidor">
            <select className="input" value={srv} onChange={(e) => setSrv(e.target.value)}>
              <option value="">Seleccione…</option>
              {(servidores.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.nombre}{x.codigo_institucional ? ` · ${x.codigo_institucional}` : ''}</option>)}
            </select>
          </Field>
        )}
        {!profesionalId && me?.rol !== 'profesional' && (
          <Field label="Profesional">
            <select className="input" value={pro} onChange={(e) => { setPro(e.target.value); setSlot(null); }}>
              <option value="">Seleccione…</option>
              {opcionesPro.map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Field>
        )}
        <Field label="Fecha (hora de Galápagos)">
          <input type="date" className="input" value={fecha} min={ahoraGal().toISODate()!} onChange={(e) => { setFecha(e.target.value); setSlot(null); }} />
        </Field>
        <Field label="Duración">
          <select className="input" value={duracion ?? ''} onChange={(e) => { setDur(Number(e.target.value)); setSlot(null); }} disabled={!esp}>
            {duraciones.map((d) => <option key={d} value={d}>{d} minutos</option>)}
          </select>
        </Field>
      </div>
      {proSel && (
        <div className="mt-3 text-xs muted">
          Disponibilidad (Galápagos): {proSel.disponibilidad_institucional.map((d: any) => `${d.dia.slice(0, 3)} ${d.rangos.join(', ')}`).join(' · ') || (proSel.franjas_confirmadas.length ? 'según franjas confirmadas' : 'sin franjas confirmadas')}
        </div>
      )}
      <div className="mt-4">
        <div className="label">Horarios libres</div>
        {!pro ? <div className="text-sm faint">Seleccione un profesional.</div> : libres.isLoading ? <Spinner /> : (libres.data ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed p-3 text-sm faint" style={{ borderColor: 'var(--line)' }}>No hay franjas libres ese día dentro de la disponibilidad del profesional.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {libres.data!.map((t) => (
              <button key={t} onClick={() => setSlot(t)} className={`rounded-lg border px-2.5 py-1 text-sm tabular-nums ${slot === t ? 'border-cyan-400 bg-cyan-500/20 text-white' : 'hover:bg-white/5'}`} style={slot === t ? undefined : { borderColor: 'var(--line)' }}>
                {fHora(t)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4"><ErrorMsg error={s.error} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={!slot || s.busy || (!servidorId && !srv && !reprogramarId)} onClick={() => s.run(undefined)}>
          {s.busy ? 'Guardando…' : slot ? `Confirmar ${fHora(slot)}` : 'Seleccione un horario'}
        </button>
      </div>
    </Modal>
  );
}
