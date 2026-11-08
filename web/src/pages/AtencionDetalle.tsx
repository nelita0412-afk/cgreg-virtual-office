import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Lock, ShieldCheck, FolderHeart, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Card, ErrorMsg, Field, Modal, PageHeader, Spinner, useSubmit } from '../components/ui';
import { CitaAcciones } from '../components/CitaAcciones';
import { RegistroClinicoPasos } from '../components/RegistroClinicoPasos';
import { fFechaHora, localGalToISO } from '../lib/format';
import { tonoAtencion } from './Agenda';
import { CAMPOS_ENTRADA, CAMPO_ENTRADA_LABEL, ESTADO_ATENCION_LABEL, ESPECIALIDAD_LABEL, type CampoEntrada, type EstadoAtencion } from '@shared/domain';

const vacio = Object.fromEntries(CAMPOS_ENTRADA.map((c) => [c, ''])) as Record<CampoEntrada, string>;

export default function AtencionDetalle() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['atencion', id], queryFn: () => api.get(`/api/atenciones/${id}`) });
  const [seg, setSeg] = useState({ fecha: '', nota: '' });
  const [adenda, setAdenda] = useState(false);
  const [ad, setAd] = useState({ motivo: '', contenido: '' });
  const [confirmar, setConfirmar] = useState(false);
  const validar = useSubmit(() => api.post(`/api/atenciones/${id}/nota/validar`), () => { setConfirmar(false); qc.invalidateQueries(); });
  const adendar = useSubmit(() => api.post(`/api/expedientes/entradas/${q.data.entrada.id}/adendas`, ad), () => { setAdenda(false); setAd({ motivo: '', contenido: '' }); qc.invalidateQueries(); });
  const crearSeg = useSubmit(
    () => api.post('/api/seguimientos', { servidor_id: q.data.atencion.servidor_id, fecha_programada: localGalToISO(seg.fecha), nota_operativa: seg.nota || undefined, atencion_origen_id: id }),
    () => {
      setSeg({ fecha: '', nota: '' });
      qc.invalidateQueries();
    },
  );
  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-4"><ErrorMsg error={q.error} /></div>;
  const { atencion: a, servidor, historial, puede_ver_nota, puede_editar, entrada } = q.data;
  const validada = entrada?.estado === 'validada';
  const editable = puede_editar && ['en_atencion', 'atendida'].includes(a.estado) && !validada;
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title={`Atención ${a.codigo}`}
        subtitle={<>{ESPECIALIDAD_LABEL[a.tipo as keyof typeof ESPECIALIDAD_LABEL]} · <Link className="text-cyan-300 hover:underline" to={`/servidores/${servidor.id}`}>{servidor.nombre}</Link> · {a.profesional_nombre}</>}
        actions={
          <>
            {a.inicio_urgente && <Badge tono="critical">Inicio por protocolo de urgencia</Badge>}
            <Badge tono={tonoAtencion[a.estado as EstadoAtencion]}>{ESTADO_ATENCION_LABEL[a.estado as EstadoAtencion]}</Badge>
            {entrada && <Link className="btn-ghost btn-sm" to={`/servidores/${servidor.id}/expediente`}><FolderHeart size={14} /> {entrada.expediente_codigo}</Link>}
          </>
        }
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_340px] [&>*]:min-w-0">
        <div className="space-y-3">
          <Card title="Acciones">
            <CitaAcciones a={a} />
            {a.estado === 'en_atencion' && <p className="mt-2 text-xs muted">Su avatar está en el consultorio mientras la atención está en curso. Al finalizar pasará a «En documentación».</p>}
          </Card>
          {editable ? (
            <Card title={<span className="flex items-center gap-2"><Lock size={16} className="text-emerald-300" /> Registro clínico (borrador v{entrada?.version ?? 1}, cifrado)</span>}>
              <RegistroClinicoPasos
                key={a.id}
                atencionId={a.id}
                inicial={{ ...vacio, ...(q.data.nota ?? {}) }}
                confidencialidadInicial={entrada?.confidencialidad ?? 'equipo_clinico'}
                version={entrada?.version ?? 1}
                puedeValidar={a.estado === 'atendida'}
                onValidar={() => setConfirmar(true)}
              />
              {a.documentada_at && <p className="mt-2 text-xs muted">Documentada {fFechaHora(a.documentada_at)}</p>}
            </Card>
          ) : puede_ver_nota && (q.data.nota || validada) ? (
            <Card
              title={<span className="flex items-center gap-2"><Lock size={16} className="text-emerald-300" /> Registro clínico</span>}
              actions={validada ? <Badge tono="good"><ShieldCheck size={12} /> Validada {fFechaHora(entrada.validada_at)}</Badge> : <Badge tono="warning">Borrador</Badge>}
            >
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {CAMPOS_ENTRADA.filter((c) => q.data.nota?.[c]).map((c) => (
                  <div key={c} className={c === 'resumen' ? 'sm:col-span-2' : ''}><dt className="label !mb-0">{CAMPO_ENTRADA_LABEL[c]}</dt><dd className="whitespace-pre-wrap">{q.data.nota[c]}</dd></div>
                ))}
              </dl>
              {(entrada?.adendas ?? []).map((x: any) => (
                <div key={x.id} className="mt-2 rounded-lg border-l-2 border-cyan-400 bg-white/5 px-3 py-2 text-sm">
                  <div className="text-xs font-semibold text-cyan-200">Adenda · {x.motivo}</div>
                  <div className="whitespace-pre-wrap">{x.contenido}</div>
                  <div className="text-[11px] faint">{x.autor} · {fFechaHora(x.created_at)}</div>
                </div>
              ))}
              {validada && entrada.hash && <div className="mt-2 text-[11px] faint">Huella de integridad: {entrada.hash}</div>}
              {validada && puede_editar && <button className="btn-ghost btn-sm mt-3" onClick={() => setAdenda(true)}><Plus size={13} /> Registrar adenda</button>}
            </Card>
          ) : (
            <Card title="Registro clínico">
              <p className="text-sm muted">{puede_editar ? 'Disponible al iniciar la atención.' : 'Contenido clínico reservado al equipo clínico autorizado.'}</p>
            </Card>
          )}
          {puede_editar && a.estado === 'atendida' && (
            <Card title="Programar seguimiento">
              <form className="grid gap-3 sm:grid-cols-[200px_1fr_auto]" onSubmit={(e) => { e.preventDefault(); crearSeg.run(undefined); }}>
                <Field label="Fecha y hora (GAL)"><input type="datetime-local" className="input" required value={seg.fecha} onChange={(e) => setSeg({ ...seg, fecha: e.target.value })} /></Field>
                <Field label="Nota operativa"><input className="input" value={seg.nota} onChange={(e) => setSeg({ ...seg, nota: e.target.value })} /></Field>
                <div className="flex items-end"><button className="btn-primary" disabled={crearSeg.busy}>Agregar</button></div>
              </form>
              <ErrorMsg error={crearSeg.error} />
            </Card>
          )}
        </div>
        <Card title="Trazabilidad">
          <div className="mb-3 space-y-1 text-sm">
            <div><span className="muted">Programada:</span> {a.inicio ? `${fFechaHora(a.inicio)} (${a.duracion_min} min)` : '—'}</div>
            <div><span className="muted">Iniciada:</span> {fFechaHora(a.iniciada_at)}</div>
            <div><span className="muted">Finalizada:</span> {fFechaHora(a.finalizada_at)}</div>
          </div>
          <ol className="space-y-2 border-l pl-3 text-sm" style={{ borderColor: 'var(--line)' }}>
            {historial.map((h: any, i: number) => (
              <li key={i}>
                <div>{h.estado_anterior ? `${ESTADO_ATENCION_LABEL[h.estado_anterior as EstadoAtencion]} → ` : ''}<strong>{ESTADO_ATENCION_LABEL[h.estado_nuevo as EstadoAtencion]}</strong></div>
                <div className="text-xs faint">{fFechaHora(h.ts)} · {h.actor}{h.nota_operativa ? ` · ${h.nota_operativa}` : ''}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <Modal open={confirmar} onClose={() => setConfirmar(false)} title="Validar y firmar el registro">
        <p className="text-sm muted">Al validar, el registro queda cerrado con su huella de integridad, fecha, hora y su identificación como profesional responsable. No podrá modificarse; las correcciones se harán mediante adendas.</p>
        <ErrorMsg error={validar.error} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmar(false)}>Cancelar</button>
          <button className="btn-primary" disabled={validar.busy} onClick={() => validar.run(undefined)}>Validar y firmar</button>
        </div>
      </Modal>
      <Modal open={adenda} onClose={() => setAdenda(false)} title="Adenda">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); adendar.run(undefined); }}>
          <Field label="Motivo"><input className="input" required value={ad.motivo} onChange={(e) => setAd({ ...ad, motivo: e.target.value })} /></Field>
          <Field label="Contenido"><textarea className="input min-h-[110px]" required value={ad.contenido} onChange={(e) => setAd({ ...ad, contenido: e.target.value })} /></Field>
          <ErrorMsg error={adendar.error} />
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setAdenda(false)}>Cancelar</button><button className="btn-primary" disabled={adendar.busy}>Registrar adenda</button></div>
        </form>
      </Modal>
    </div>
  );
}
