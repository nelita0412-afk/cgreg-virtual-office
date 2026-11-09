import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Building, CalendarClock } from 'lucide-react';
import { api } from '../lib/api';
import { Avatar, Empty, ErrorMsg, PageHeader, Spinner } from '../components/ui';
import { fDiaLargo, fHora } from '../lib/format';
import { ESPECIALIDAD_LABEL, type Especialidad } from '@shared/domain';

type Ficha = {
  id: string;
  nombre: string;
  titulo: string;
  especialidad: Especialidad;
  perfil: string;
  experiencia: string[];
  instituciones: string[];
  funcion_brigada: string | null;
  color: string;
  disponibilidad_derivacion: { conectado: boolean; disponible_ahora: boolean; proximas_franjas: { inicio: string; fin: string }[] } | null;
};

/**
 * Directorio de profesionales de la Brigada (consulta limitada): quién es quién, su profesión, experiencia y función.
 * No muestra casos, cargas de trabajo, estadísticas individuales ni datos personales. La disponibilidad aparece solo
 * para Psiquiatría, porque es la que se necesita para coordinar una derivación.
 */
export default function Directorio() {
  const q = useQuery<Ficha[]>({ queryKey: ['directorio'], queryFn: () => api.get('/api/directorio') });
  const [texto, setTexto] = useState('');
  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (q.data ?? []).filter((p) => !t || [p.nombre, p.titulo, p.funcion_brigada, ...p.experiencia].join(' ').toLowerCase().includes(t));
  }, [q.data, texto]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-3 sm:p-4">
      <PageHeader title="Directorio de profesionales" subtitle="Brigada de Apoyo Psicosocial del CGREG · Profesión, experiencia y función de cada integrante." />
      <label className="relative block">
        <span className="sr-only">Buscar en el directorio</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 faint" aria-hidden />
        <input className="input min-h-11 pl-9" placeholder="Buscar por nombre, profesión o experiencia" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </label>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorMsg error={q.error} />
      ) : !lista.length ? (
        <Empty>Sin resultados.</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {lista.map((p) => (
            <li key={p.id} className="panel flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <Avatar nombre={p.nombre} color={p.color} size={48} />
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold leading-tight text-profundo-900">{p.nombre}</h2>
                  <div className="text-sm muted">{p.titulo}</div>
                  {p.funcion_brigada && <div className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-salvia-700">{p.funcion_brigada}</div>}
                </div>
              </div>
              <p className="text-sm leading-relaxed">{p.perfil}</p>
              {p.experiencia.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={`Experiencia de ${p.nombre}`}>
                  {p.experiencia.map((x) => (
                    <li key={x} className="rounded-full bg-eucalipto px-2.5 py-0.5 text-[12px] text-profundo-800">{x}</li>
                  ))}
                </ul>
              )}
              {p.instituciones.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs muted"><Building size={13} aria-hidden /> {p.instituciones.join(' · ')}</div>
              )}
              {p.disponibilidad_derivacion && (
                <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--surface)' }}>
                  <div className="flex items-center gap-1.5 font-semibold text-profundo-900">
                    <CalendarClock size={13} aria-hidden /> Disponibilidad para derivaciones ({ESPECIALIDAD_LABEL[p.especialidad]})
                  </div>
                  <div className="mt-0.5 muted">
                    {p.disponibilidad_derivacion.disponible_ahora ? 'Disponible ahora en la Oficina Virtual.' : p.disponibilidad_derivacion.conectado ? 'Conectado, ocupado en este momento.' : 'No conectado en este momento.'}
                  </div>
                  {p.disponibilidad_derivacion.proximas_franjas.map((f) => (
                    <div key={f.inicio} className="tabular-nums">{fDiaLargo(f.inicio)} · {fHora(f.inicio)}–{fHora(f.fin)}</div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
