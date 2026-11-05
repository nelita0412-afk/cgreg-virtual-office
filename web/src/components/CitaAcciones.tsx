import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Play, Square, Check, CalendarClock, XCircle, FileText } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorMsg, Field, Modal } from './ui';
import { ProgramarCita } from './ProgramarCita';

const MOTIVOS: Record<string, string> = {
  servidor_no_se_conecto: 'El servidor no se conectó',
  servidor_cancelo: 'El servidor canceló',
  problema_tecnico: 'Problema técnico',
  profesional_no_disponible: 'Profesional no disponible',
  otro: 'Otro motivo',
};

/** Acciones operativas sobre una cita/atención según estado y rol. */
export function CitaAcciones({ a, compacto }: { a: any; compacto?: boolean }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [err, setErr] = useState<unknown>(null);
  const [repro, setRepro] = useState(false);
  const [noReal, setNoReal] = useState(false);
  const [motivo, setMotivo] = useState('servidor_no_se_conecto');
  const [urgencia, setUrgencia] = useState(false);
  const [justif, setJustif] = useState('');
  const propio = me?.rol === 'profesional' && me.profesional_id === a.profesional_id;
  const gestiona = propio || me?.rol === 'coordinacion';
  const run = async (fn: () => Promise<unknown>, irA?: string) => {
    setErr(null);
    try {
      await fn();
      qc.invalidateQueries();
      if (irA) nav(irA);
    } catch (e) {
      setErr(e);
    }
  };
  const sm = compacto ? 'btn-sm' : '';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {propio && ['programada', 'confirmada', 'pendiente'].includes(a.estado) && (
          <button
            className={`btn-primary ${sm}`}
            onClick={async () => {
              setErr(null);
              try {
                await api.post(`/api/atenciones/${a.id}/iniciar`);
                qc.invalidateQueries();
                nav(`/atenciones/${a.id}`);
              } catch (e) {
                if (e instanceof ApiError && e.code === 'sin_consentimiento') setUrgencia(true);
                setErr(e);
              }
            }}
          >
            <Play size={14} /> Iniciar atención
          </button>
        )}
        {propio && a.estado === 'en_atencion' && (
          <button className={`btn-primary ${sm}`} onClick={() => run(() => api.post(`/api/atenciones/${a.id}/finalizar`), `/atenciones/${a.id}`)}><Square size={14} /> Finalizar</button>
        )}
        {gestiona && a.estado === 'programada' && <button className={`btn-ghost ${sm}`} onClick={() => run(() => api.post(`/api/agenda/citas/${a.id}/confirmar`))}><Check size={14} /> Confirmar</button>}
        {gestiona && ['programada', 'confirmada'].includes(a.estado) && <button className={`btn-ghost ${sm}`} onClick={() => setRepro(true)}><CalendarClock size={14} /> Reprogramar</button>}
        {gestiona && ['programada', 'confirmada', 'pendiente'].includes(a.estado) && <button className={`btn-ghost ${sm}`} onClick={() => setNoReal(true)}><XCircle size={14} /> No realizada</button>}
        {(propio || me?.rol === 'coordinacion') && <button className={`btn-ghost ${sm}`} onClick={() => nav(`/atenciones/${a.id}`)}><FileText size={14} /> Detalle</button>}
      </div>
      <ErrorMsg error={err} />
      {repro && <ProgramarCita open onClose={() => setRepro(false)} reprogramarId={a.id} servidorId={a.servidor_id} profesionalId={a.profesional_id} />}
      <Modal open={urgencia} onClose={() => setUrgencia(false)} title="Consentimiento informado pendiente">
        <p className="text-sm muted">La atención ordinaria requiere un consentimiento documentado y validado. Puede gestionarlo desde la ficha del servidor.</p>
        <p className="mt-2 text-sm">Si se trata de una <strong>situación urgente</strong>, el protocolo profesional prevalece sobre el trámite: registre la justificación. El inicio quedará auditado, se notificará a Coordinación y el consentimiento deberá regularizarse.</p>
        <Field label="Justificación de la urgencia"><textarea className="input mt-2 min-h-[80px]" value={justif} onChange={(e) => setJustif(e.target.value)} /></Field>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={() => nav(`/servidores/${a.servidor_id}`)}>Ir a consentimiento</button>
          <button className="btn-danger" disabled={justif.trim().length < 10} onClick={() => run(() => api.post(`/api/atenciones/${a.id}/iniciar`, { urgente: true, justificacion: justif }), `/atenciones/${a.id}`).then(() => setUrgencia(false))}>Iniciar por protocolo de urgencia</button>
        </div>
      </Modal>
      <Modal open={noReal} onClose={() => setNoReal(false)} title="Registrar cita no realizada">
        <Field label="Motivo operativo">
          <select className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {Object.entries(MOTIVOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setNoReal(false)}>Cancelar</button>
          <button className="btn-danger" onClick={() => run(() => api.post(`/api/agenda/citas/${a.id}/no-realizada`, { motivo })).then(() => setNoReal(false))}>Registrar</button>
        </div>
      </Modal>
    </div>
  );
}

export { MOTIVOS };
