import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Modal, ErrorMsg, useSubmit } from './ui';
import { PRIORIDADES, PRIORIDAD_LABEL, TIPOS_SOLICITUD, TIPO_SOLICITUD_LABEL } from '@shared/domain';
import { ahoraGal } from '../lib/format';

export function SolicitarApoyoModal({ open, onClose, onCreada }: { open: boolean; onClose: () => void; onCreada?: (id: string) => void }) {
  const { me } = useAuth();
  const servidores = useQuery({ queryKey: ['servidores-selector'], queryFn: () => api.get('/api/servidores-selector'), enabled: open && me?.rol === 'profesional' });
  const vacio = { tipo: 'apoyo_institucional_servidor', descripcion: '', accion_requerida: '', prioridad: 'media', fecha_respuesta_requerida: '', observaciones: '', servidor_id: '' };
  const [f, setF] = useState(vacio);
  const s = useSubmit(
    () =>
      api.post('/api/solicitudes', {
        ...f,
        fecha_respuesta_requerida: f.fecha_respuesta_requerida || undefined,
        observaciones: f.observaciones || undefined,
        servidor_id: f.servidor_id || undefined,
      }),
    (r) => {
      setF(vacio);
      onClose();
      onCreada?.(r.id);
    },
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="Solicitar apoyo a Coordinación General" wide>
      <div className="mb-4 flex gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <div>
          <strong>{me?.emergencia_texto}</strong>
          <div className="mt-1 text-xs opacity-80">No incluya información clínica en la solicitud. Usted mantiene la responsabilidad técnica y clínica del caso.</div>
        </div>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          s.run(undefined);
        }}
      >
        <Field label="Profesional solicitante">
          <input className="input" value={me?.nombre ?? ''} disabled />
        </Field>
        <Field label="Fecha y hora (Galápagos)">
          <input className="input" value={ahoraGal().toFormat('dd/MM/yyyy HH:mm')} disabled />
        </Field>
        <Field label="Tipo de solicitud">
          <select className="input" value={f.tipo} onChange={set('tipo')}>
            {TIPOS_SOLICITUD.map((t) => (
              <option key={t} value={t}>{TIPO_SOLICITUD_LABEL[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Prioridad">
          <select className="input" value={f.prioridad} onChange={set('prioridad')}>
            {PRIORIDADES.map((p) => (
              <option key={p} value={p}>{PRIORIDAD_LABEL[p]}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Descripción de la necesidad">
            <textarea className="input min-h-[80px]" required minLength={5} value={f.descripcion} onChange={set('descripcion')} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Acción específica requerida de Coordinación General">
            <textarea className="input min-h-[60px]" required minLength={3} value={f.accion_requerida} onChange={set('accion_requerida')} />
          </Field>
        </div>
        <Field label="Fecha en que necesita respuesta">
          <input type="date" className="input" value={f.fecha_respuesta_requerida} onChange={set('fecha_respuesta_requerida')} />
        </Field>
        {me?.rol === 'profesional' && (
          <Field label="Servidor relacionado (opcional)" hint="Solo servidores asignados a usted">
            <select className="input" value={f.servidor_id} onChange={set('servidor_id')}>
              <option value="">— Ninguno —</option>
              {(servidores.data ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label="Observaciones operativas (opcional)">
            <textarea className="input" value={f.observaciones} onChange={set('observaciones')} />
          </Field>
        </div>
        <div className="sm:col-span-2"><ErrorMsg error={s.error} /></div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={s.busy}>{s.busy ? 'Enviando…' : 'Enviar solicitud'}</button>
        </div>
      </form>
    </Modal>
  );
}
