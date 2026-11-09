import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileSignature } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Empty, ErrorMsg, PageHeader, Spinner, type Tono } from '../components/ui';
import { fFechaHora } from '../lib/format';
import {
  ESTADO_CONSENTIMIENTO_LABEL, MODALIDAD_CONSENTIMIENTO_LABEL, SERVICIO_CONSENTIMIENTO_LABEL,
  type EstadoConsentimiento, type ModalidadConsentimiento, type ServicioConsentimiento,
} from '@shared/domain';

const TONO: Partial<Record<EstadoConsentimiento, Tono>> = { validado: 'good', revocado: 'critical', no_otorgado: 'critical', requiere_correccion: 'serious', pendiente_validacion: 'warning' };

/**
 * Consentimientos de las personas que el profesional atiende (la API solo devuelve los de sus casos asignados o
 * derivados). Coordinación ve todos con el mismo listado. Los documentos se abren desde la ficha de la persona.
 */
export default function MisConsentimientos() {
  const { me } = useAuth();
  const [estado, setEstado] = useState('');
  const q = useQuery<any[]>({ queryKey: ['consentimientos', estado], queryFn: () => api.get(`/api/consentimientos${estado ? `?estado=${estado}` : ''}`) });
  const titulo = me?.rol === 'profesional' ? 'Mis consentimientos' : 'Consentimientos';
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-3 sm:p-4">
      <PageHeader title={titulo} subtitle="Consentimiento informado de las personas que atiende. Sin un consentimiento validado no se inicia una atención ordinaria." />
      <label className="block max-w-xs">
        <span className="label">Estado</span>
        <select className="input min-h-11" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos</option>
          {(Object.keys(ESTADO_CONSENTIMIENTO_LABEL) as EstadoConsentimiento[]).map((k) => <option key={k} value={k}>{ESTADO_CONSENTIMIENTO_LABEL[k]}</option>)}
        </select>
      </label>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorMsg error={q.error} /> : !q.data?.length ? <Empty>No hay consentimientos con ese criterio.</Empty> : (
        <ul className="flex flex-col gap-2.5">
          {q.data.map((k) => (
            <li key={k.id}>
              <Link to={`/servidores/${k.servidor_id}`} className="panel flex items-center gap-3 p-3.5 transition-transform duration-150 active:scale-[0.99]">
                <FileSignature size={20} className="shrink-0 text-salvia-700" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-profundo-900">{k.servidor_nombre}</span>
                  <span className="block text-xs muted">
                    {SERVICIO_CONSENTIMIENTO_LABEL[k.servicio as ServicioConsentimiento] ?? k.servicio} · {MODALIDAD_CONSENTIMIENTO_LABEL[k.modalidad as ModalidadConsentimiento] ?? k.modalidad} · {k.codigo} · {fFechaHora(k.updated_at)}
                  </span>
                </span>
                <Badge tono={TONO[k.estado as EstadoConsentimiento] ?? 'info'}>{ESTADO_CONSENTIMIENTO_LABEL[k.estado as EstadoConsentimiento] ?? k.estado}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
