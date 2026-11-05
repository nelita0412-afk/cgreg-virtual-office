import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarPlus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar, Badge, Card, ErrorMsg, EstadoPill, Field, Modal, PageHeader, Spinner, useSubmit } from '../components/ui';
import { fDiaLargo, fHora, localGalToISO } from '../lib/format';
import { ESPECIALIDAD_LABEL, type PresenciaSnapshot } from '@shared/domain';

function ConfirmarFranja({ pid, onClose }: { pid: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ inicio: '', fin: '', nota: '' });
  const s = useSubmit(
    () => api.post(`/api/profesionales/${pid}/franjas`, { inicio: localGalToISO(f.inicio), fin: localGalToISO(f.fin), nota: f.nota || undefined }),
    () => {
      qc.invalidateQueries();
      onClose();
    },
  );
  return (
    <Modal open onClose={onClose} title="Confirmar disponibilidad (franja puntual)">
      <p className="mb-3 text-sm muted">Registre únicamente disponibilidad confirmada por el profesional. Horas en hora de Galápagos.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Inicio"><input type="datetime-local" className="input" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></Field>
        <Field label="Fin"><input type="datetime-local" className="input" value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label="Nota (opcional)"><input className="input" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></Field></div>
      </div>
      <div className="mt-3"><ErrorMsg error={s.error} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={!f.inicio || !f.fin || s.busy} onClick={() => s.run(undefined)}>Confirmar franja</button>
      </div>
    </Modal>
  );
}

export default function Equipo() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const pros = useQuery({ queryKey: ['profesionales'], queryFn: () => api.get('/api/profesionales') });
  const pres = useQuery<PresenciaSnapshot[]>({ queryKey: ['presencia'], queryFn: () => api.get('/api/office/presencia') });
  const [franja, setFranja] = useState<string | null>(null);
  const puedeFranja = (pid: string) => me?.rol === 'coordinacion' || me?.rol === 'admin' || me?.profesional_id === pid;
  if (pros.isLoading) return <Spinner />;
  const tele = (pros.data ?? []).filter((p: any) => p.es_teleatencion);
  const terr = (pros.data ?? []).filter((p: any) => !p.es_teleatencion && p.especialidad !== 'trabajo_social');
  const ts = (pros.data ?? []).filter((p: any) => p.especialidad === 'trabajo_social');
  const tarjeta = (p: any) => {
    const st = pres.data?.find((x) => x.profesional_id === p.id);
    return (
      <Card key={p.id} className="scroll-mt-20" title={undefined}>
        <div id={p.id} className="flex items-start gap-3">
          <Avatar nombre={p.nombre} color={p.color} size={52} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{p.nombre}</h2>
              {st && <EstadoPill estado={st.estado} size="sm" />}
              {!p.tiene_cuenta && <Badge>Sin cuenta</Badge>}
            </div>
            <div className="text-sm muted">{p.titulo} · {ESPECIALIDAD_LABEL[p.especialidad as keyof typeof ESPECIALIDAD_LABEL]}</div>
            <p className="mt-2 text-sm">{p.perfil}</p>
            <div className="mt-2 flex flex-wrap gap-1">{p.experiencia.map((e: string) => <Badge key={e} tono="info">{e}</Badge>)}</div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <div className="label">Disponibilidad (Galápagos)</div>
                {p.disponibilidad_institucional.length ? p.disponibilidad_institucional.map((d: any) => <div key={d.dia_semana} className="tabular-nums">{d.dia}: {d.rangos.join(', ')}</div>) : <div className="faint">{p.notas_agenda ?? '—'}</div>}
              </div>
              <div>
                <div className="label">Origen (Ecuador continental)</div>
                {p.disponibilidad_origen.length ? p.disponibilidad_origen.map((r: any) => <div key={r.id} className="tabular-nums faint">{['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][r.dia_semana]}: {r.hora_inicio}–{r.hora_fin}</div>) : <div className="faint">—</div>}
              </div>
            </div>
            {(p.franjas_confirmadas.length > 0 || puedeFranja(p.id)) && p.es_teleatencion && (
              <div className="mt-3">
                <div className="label">Franjas confirmadas</div>
                {p.franjas_confirmadas.map((f: any) => (
                  <div key={f.id} className="flex items-center gap-2 text-sm tabular-nums">
                    {fDiaLargo(f.inicio)}, {fHora(f.inicio)}–{fHora(f.fin)} {f.nota && <span className="faint">· {f.nota}</span>}
                    {puedeFranja(p.id) && (
                      <button className="text-red-300 hover:text-red-200" aria-label="Anular franja" onClick={async () => { await api.del(`/api/profesionales/${p.id}/franjas/${f.id}`); qc.invalidateQueries(); }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {puedeFranja(p.id) && <button className="btn-ghost btn-sm mt-1" onClick={() => setFranja(p.id)}><CalendarPlus size={14} /> Confirmar franja</button>}
              </div>
            )}
            {p.es_teleatencion && <Link to={`/agenda?profesional=${p.id}`} className="mt-3 inline-block text-sm text-cyan-300 hover:underline">Ver agenda →</Link>}
          </div>
        </div>
      </Card>
    );
  };
  return (
    <div className="p-3 sm:p-4">
      <PageHeader title="Mi Equipo" subtitle={`${tele.length} profesionales de teleatención · trabajan desde Ecuador continental (America/Guayaquil); agenda institucional en hora de Galápagos.`} />
      <div className="grid gap-3 xl:grid-cols-2">{tele.map(tarjeta)}</div>
      {terr.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide muted">Colaboración territorial (no incluida en los ocho profesionales de teleatención)</h2>
          <div className="grid gap-3 xl:grid-cols-2">{terr.map(tarjeta)}</div>
        </>
      )}
      {ts.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide muted">Trabajo Social (intervención social, registros separados de la historia clínica)</h2>
          <div className="grid gap-3 xl:grid-cols-2">{ts.map(tarjeta)}</div>
        </>
      )}
      {franja && <ConfirmarFranja pid={franja} onClose={() => setFranja(null)} />}
    </div>
  );
}
