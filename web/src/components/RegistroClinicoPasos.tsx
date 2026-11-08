import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, CloudOff, Lock, Save, ShieldCheck } from 'lucide-react';
import { api, esErrorDeRed } from '../lib/api';
import { ErrorMsg } from './ui';
import { CAMPO_ENTRADA_LABEL, type CampoEntrada } from '@shared/domain';

/**
 * Registro clínico por pasos. El contenido vive solo en la memoria de esta pantalla y se guarda cifrado en el
 * servidor (PUT /api/atenciones/:id/nota, que versiona cada guardado). Nada se escribe en el almacenamiento del
 * teléfono ni del navegador. Se guarda al avanzar o retroceder de paso, al pulsar «Guardar» y cuando la app pasa
 * a segundo plano (cambio de app en el teléfono). Si hay cambios sin guardar, avisa antes de salir.
 */

const LIMITE = 8000;
type Nota = Record<CampoEntrada, string>;
type Paso = { titulo: string; ayuda: string; campos: CampoEntrada[] };

const PASOS: Paso[] = [
  { titulo: 'Motivo', ayuda: 'Qué trajo a la persona a la atención y un resumen breve de lo ocurrido.', campos: ['resumen', 'motivo_consulta'] },
  { titulo: 'Evaluación', ayuda: 'Lo observado en la valoración y la intervención que se realizó.', campos: ['evaluacion', 'intervencion'] },
  { titulo: 'Evolución y plan', ayuda: 'Cómo terminó la atención y qué sigue.', campos: ['evolucion', 'resultado', 'plan', 'recomendaciones'] },
  { titulo: 'Revisión', ayuda: 'Revise el registro, elija la confidencialidad y guarde.', campos: [] },
];

const AYUDA_CAMPO: Partial<Record<CampoEntrada, string>> = {
  resumen: 'Obligatorio. Dos o tres frases bastan.',
  plan: 'Próximos pasos acordados con la persona.',
};

export function erroresDelPaso(nota: Nota, paso: number): Partial<Record<CampoEntrada, string>> {
  const e: Partial<Record<CampoEntrada, string>> = {};
  const campos = paso >= PASOS.length - 1 ? PASOS.flatMap((p) => p.campos) : PASOS[paso].campos;
  for (const c of campos) {
    if (nota[c].length > LIMITE) e[c] = `Máximo ${LIMITE.toLocaleString('es')} caracteres.`;
  }
  if (campos.includes('resumen') && !nota.resumen.trim()) e.resumen = 'Escriba el resumen de la atención para poder guardar.';
  return e;
}

type Props = {
  atencionId: string;
  inicial: Nota;
  confidencialidadInicial: 'equipo_clinico' | 'restringida';
  version: number;
  puedeValidar: boolean;
  onValidar: () => void;
};

export function RegistroClinicoPasos({ atencionId, inicial, confidencialidadInicial, version, puedeValidar, onValidar }: Props) {
  const qc = useQueryClient();
  const uid = useId();
  const [paso, setPaso] = useState(0);
  const [dir, setDir] = useState<'dia-desde-derecha' | 'dia-desde-izquierda' | ''>('');
  const [nota, setNota] = useState<Nota>(inicial);
  const [conf, setConf] = useState(confidencialidadInicial);
  const [guardado, setGuardado] = useState({ nota: inicial, conf: confidencialidadInicial });
  const [estado, setEstado] = useState<{ tipo: 'listo' | 'guardando' | 'guardado' | 'sin_conexion' | 'error'; error?: unknown; hora?: string }>({ tipo: 'listo' });
  const [mostrarErrores, setMostrarErrores] = useState(false);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  const sucio = conf !== guardado.conf || (Object.keys(nota) as CampoEntrada[]).some((c) => nota[c] !== guardado.nota[c]);
  const errores = erroresDelPaso(nota, paso);
  const pasoValido = Object.keys(errores).length === 0;
  const totalValido = Object.keys(erroresDelPaso(nota, PASOS.length - 1)).length === 0;

  const guardar = useCallback(async () => {
    if (!sucio) return true;
    if (!totalValido) return false;
    const enviado = { nota, conf };
    setEstado({ tipo: 'guardando' });
    try {
      const contenido = Object.fromEntries(Object.entries(nota).filter(([, v]) => v.trim()));
      await api.put(`/api/atenciones/${atencionId}/nota`, { ...contenido, resumen: nota.resumen, confidencialidad: conf });
      setGuardado(enviado);
      setEstado({ tipo: 'guardado', hora: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) });
      void qc.invalidateQueries({ queryKey: ['atencion', atencionId] });
      return true;
    } catch (err) {
      setEstado({ tipo: esErrorDeRed(err) ? 'sin_conexion' : 'error', error: err });
      return false;
    }
  }, [sucio, totalValido, nota, conf, atencionId, qc]);

  // Al pasar a segundo plano (cambiar de app, bloquear el teléfono) se guarda lo escrito en el servidor.
  const guardarRef = useRef(guardar);
  guardarRef.current = guardar;
  useEffect(() => {
    const f = () => document.visibilityState === 'hidden' && void guardarRef.current();
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);

  // Aviso antes de cerrar o recargar la página, y antes de seguir un enlace interno, con cambios sin guardar.
  useEffect(() => {
    if (!sucio) return;
    const antes = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const enlaces = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || e.defaultPrevented) return;
      if (!window.confirm('Hay cambios del registro clínico sin guardar. ¿Salir de todos modos? Se perderán los cambios.')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', antes);
    document.addEventListener('click', enlaces, true);
    return () => {
      window.removeEventListener('beforeunload', antes);
      document.removeEventListener('click', enlaces, true);
    };
  }, [sucio]);

  const ir = async (destino: number) => {
    if (destino > paso && !pasoValido) {
      setMostrarErrores(true);
      return;
    }
    setMostrarErrores(false);
    if (totalValido) await guardar(); // si no hay conexión, se avanza igual y el aviso queda visible
    setDir(destino > paso ? 'dia-desde-derecha' : 'dia-desde-izquierda');
    setPaso(destino);
    requestAnimationFrame(() => tituloRef.current?.focus());
  };

  const validar = async () => {
    if (!totalValido) {
      setMostrarErrores(true);
      return;
    }
    if (await guardar()) onValidar();
  };

  const actual = PASOS[paso];
  const ultimo = paso === PASOS.length - 1;

  return (
    <div className="flex flex-col gap-4">
      <ol className="grid grid-cols-4 gap-1.5" aria-label="Pasos del registro">
        {PASOS.map((p, i) => (
          <li key={p.titulo}>
            <button
              type="button"
              onClick={() => i !== paso && void ir(i)}
              aria-current={i === paso ? 'step' : undefined}
              className="flex w-full flex-col gap-1.5 text-left"
            >
              <span className={`h-1.5 rounded-full transition-colors duration-200 ${i < paso ? 'bg-salvia-500' : i === paso ? 'bg-profundo-900' : 'bg-profundo-200'}`} />
              <span className={`truncate text-[11px] ${i === paso ? 'font-semibold text-profundo-900' : 'muted'}`}>
                {i < paso && <Check size={11} className="mr-0.5 inline" aria-hidden />}
                {p.titulo}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div key={paso} className={`flex flex-col gap-4 ${dir}`}>
        <div>
          <h3 ref={tituloRef} tabIndex={-1} className="text-[17px] font-semibold text-profundo-900 outline-none">
            Paso {paso + 1} de {PASOS.length}: {actual.titulo}
          </h3>
          <p className="text-sm muted">{actual.ayuda}</p>
        </div>

        {!ultimo &&
          actual.campos.map((c) => {
            const err = mostrarErrores ? errores[c] : undefined;
            const n = nota[c].length;
            return (
              <div key={c}>
                <label htmlFor={`${uid}-${c}`} className="label">
                  {CAMPO_ENTRADA_LABEL[c]}
                  {c === 'resumen' && <span aria-hidden> *</span>}
                </label>
                <textarea
                  id={`${uid}-${c}`}
                  className={`input text-[16px] leading-relaxed ${c === 'resumen' ? 'min-h-[120px]' : 'min-h-[96px]'}`}
                  value={nota[c]}
                  aria-invalid={!!err}
                  aria-required={c === 'resumen'}
                  aria-describedby={`${uid}-${c}-ayuda`}
                  onChange={(e) => setNota((x) => ({ ...x, [c]: e.target.value }))}
                />
                <div id={`${uid}-${c}-ayuda`} className="mt-1 flex justify-between gap-2 text-[11px]">
                  <span className={err ? 'font-medium text-red-300' : 'faint'}>{err ?? AYUDA_CAMPO[c] ?? 'Opcional.'}</span>
                  {n > LIMITE * 0.85 && <span className={`tabular-nums ${n > LIMITE ? 'text-red-300' : 'faint'}`}>{n.toLocaleString('es')}/{LIMITE.toLocaleString('es')}</span>}
                </div>
              </div>
            );
          })}

        {ultimo && (
          <>
            <dl className="flex flex-col gap-2 rounded-2xl p-4 text-sm" style={{ background: 'var(--surface)' }}>
              {PASOS.flatMap((p) => p.campos).map((c) => (
                <div key={c} className="flex gap-3">
                  <dt className="w-32 shrink-0 text-[12px] muted">{CAMPO_ENTRADA_LABEL[c]}</dt>
                  <dd className="min-w-0 flex-1 truncate text-profundo-900">{nota[c].trim() ? nota[c] : <span className="faint">—</span>}</dd>
                </div>
              ))}
            </dl>
            {mostrarErrores && errores.resumen && <p className="text-sm font-medium text-red-300">{errores.resumen}</p>}
            <div>
              <label htmlFor={`${uid}-conf`} className="label">Confidencialidad</label>
              <select id={`${uid}-conf`} className="input min-h-12" value={conf} onChange={(e) => setConf(e.target.value as typeof conf)}>
                <option value="equipo_clinico">Equipo clínico tratante</option>
                <option value="restringida">Restringida al autor</option>
              </select>
              <p className="mt-1 text-[11px] faint">«Equipo clínico»: accesible a los profesionales clínicos con relación asistencial (continuidad). «Restringida»: solo usted.</p>
            </div>
          </>
        )}
      </div>

      <EstadoGuardado estado={estado} sucio={sucio} version={version} onReintentar={() => void guardar()} />

      <div className="flex flex-wrap items-center gap-2">
        {paso > 0 && (
          <button type="button" className="btn-ghost min-h-12" onClick={() => void ir(paso - 1)}>
            <ChevronLeft size={16} aria-hidden /> Anterior
          </button>
        )}
        {!ultimo ? (
          <button type="button" className="btn-primary min-h-12 flex-1 sm:flex-none" onClick={() => void ir(paso + 1)} disabled={estado.tipo === 'guardando'}>
            {sucio && totalValido ? 'Guardar y continuar' : 'Continuar'} <ChevronRight size={16} aria-hidden />
          </button>
        ) : (
          <button type="button" className="btn-primary min-h-12 flex-1 sm:flex-none" onClick={() => { if (!totalValido) setMostrarErrores(true); else void guardar(); }} disabled={estado.tipo === 'guardando' || !sucio}>
            <Save size={16} aria-hidden /> {sucio ? 'Guardar borrador' : 'Borrador guardado'}
          </button>
        )}
        {ultimo && puedeValidar && (
          <button type="button" className="btn-ghost min-h-12" onClick={() => void validar()} disabled={estado.tipo === 'guardando'}>
            <ShieldCheck size={16} aria-hidden /> Validar y firmar
          </button>
        )}
      </div>
      <p className="flex gap-1.5 text-[11px] faint">
        <Lock size={12} className="mt-px shrink-0" aria-hidden />
        Se guarda cifrado en el servidor; nada queda en este dispositivo. Cada guardado conserva la versión anterior. Tras validar, la entrada es inmutable y solo admite adendas. No se realizan diagnósticos automáticos.
      </p>
    </div>
  );
}

function EstadoGuardado({ estado, sucio, version, onReintentar }: { estado: { tipo: string; error?: unknown; hora?: string }; sucio: boolean; version: number; onReintentar: () => void }) {
  if (estado.tipo === 'sin_conexion')
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm text-amber-200" style={{ borderColor: 'rgba(183,121,31,.3)', background: 'rgba(183,121,31,.08)' }}>
        <CloudOff size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span className="flex-1">Sin conexión: el registro no se guardó. Lo escrito sigue en esta pantalla; no la cierre.</span>
        <button type="button" className="btn-ghost btn-sm" onClick={onReintentar}>Reintentar</button>
      </div>
    );
  if (estado.tipo === 'error') return <ErrorMsg error={estado.error} />;
  return (
    <p className="text-xs muted" role="status" aria-live="polite">
      {estado.tipo === 'guardando'
        ? 'Guardando…'
        : sucio
          ? 'Cambios sin guardar.'
          : estado.tipo === 'guardado'
            ? `Guardado a las ${estado.hora}.`
            : `Borrador versión ${version}.`}
    </p>
  );
}
