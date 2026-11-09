import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Lock, FolderPlus, History, PenLine, ShieldCheck, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { puede } from '@shared/permissions';
import { Badge, Card, Empty, ErrorMsg, Field, Modal, PageHeader, Spinner, Tabs, useSubmit } from '../components/ui';
import { ConsentimientosPanel } from '../components/Consentimientos';
import { fDiaSolo, fFechaHora, localGalToISO } from '../lib/format';
import { tonoAtencion } from './Agenda';
import {
  AREAS_HCE, AREA_HCE_LABEL, CAMPOS_ENTRADA, CAMPO_ENTRADA_LABEL, ESTADO_ATENCION_LABEL, ESPECIALIDAD_LABEL, ESTADO_DERIVACION_LABEL, SECCIONES_HCE, SECCION_HCE_LABEL,
  TIPOS_INTERVENCION_SOCIAL, TIPO_INTERVENCION_SOCIAL_LABEL, type AreaHce, type EstadoAtencion, type EstadoDerivacion, type SeccionHce, type TipoIntervencionSocial,
} from '@shared/domain';

export default function Expediente() {
  const { id } = useParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['expediente', id], queryFn: () => api.get(`/api/servidores/${id}/expediente`) });
  const srv = useQuery({ queryKey: ['servidor', id], queryFn: () => api.get(`/api/servidores/${id}`) });
  const [tab, setTab] = useState('resumen');
  const [editar, setEditar] = useState<{ area: AreaHce; seccion: SeccionHce; actual: string } | null>(null);
  const [versiones, setVersiones] = useState<any[] | null>(null);
  const [adenda, setAdenda] = useState<string | null>(null);
  const [social, setSocial] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-4"><ErrorMsg error={q.error} /></div>;
  const d = q.data;
  const x = d.expediente;
  const clinico = d.nivel === 'clinico';
  const tabs = [
    { value: 'resumen', label: clinico ? 'Historia por área' : 'Resumen' },
    ...(clinico ? [{ value: 'entradas', label: `Evolución (${d.entradas?.length ?? 0})` }] : []),
    { value: 'consultas', label: `Consultas (${d.atenciones.length})` },
    { value: 'seguimientos', label: 'Seguimientos' },
    ...(d.nivel !== 'social' ? [{ value: 'derivaciones', label: 'Derivaciones' }] : []),
    ...(d.nivel !== 'administrativo' ? [{ value: 'social', label: 'Intervención social' }] : []),
    { value: 'consentimiento', label: 'Consentimiento' },
  ];
  const abrir = async () => {
    setErr(null);
    try {
      await api.post(`/api/servidores/${id}/expediente`);
      qc.invalidateQueries();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div className="p-3 sm:p-4">
      <PageHeader
        title={x ? `Historia clínica ${x.codigo}` : 'Historia clínica'}
        subtitle={
          <>
            <Link className="text-cyan-300 hover:underline" to={`/servidores/${id}`}>{d.servidor.nombre}</Link>
            {d.servidor.codigo_institucional && ` · ${d.servidor.codigo_institucional}`}
            {x && ` · apertura ${fFechaHora(x.fecha_apertura)} · responsable: ${x.responsable_nombre} (${ESPECIALIDAD_LABEL[x.especialidad_apertura as keyof typeof ESPECIALIDAD_LABEL] ?? x.especialidad_apertura})`}
          </>
        }
        actions={
          <>
            <Badge tono={clinico ? 'good' : d.nivel === 'social' ? 'violet' : 'info'}>
              <Lock size={12} /> Acceso {clinico ? 'clínico' : d.nivel === 'social' ? 'de Trabajo Social' : 'administrativo'}
            </Badge>
            {!x && clinico && <button className="btn-primary" onClick={abrir}><FolderPlus size={15} /> Abrir expediente</button>}
          </>
        }
      />
      <ErrorMsg error={err} />
      {d.nivel === 'administrativo' && <div className="mb-3 rounded-xl border p-3 text-sm muted" style={{ borderColor: 'var(--line)' }}>Coordinación General accede a la información administrativa y operativa. Las notas clínicas son confidenciales y no se muestran.</div>}
      <Tabs value={tab} onChange={setTab} items={tabs} />

      {tab === 'resumen' && (
        clinico ? (
          !x ? <Empty>El expediente se abre con la primera atención o manualmente.</Empty> : (
            <div className="grid gap-3 xl:grid-cols-3">
              {AREAS_HCE.map((area) => (
                <Card key={area} title={AREA_HCE_LABEL[area]} actions={d.mi_area === area ? <Badge tono="good">Su área</Badge> : undefined}>
                  <div className="space-y-3">
                    {SECCIONES_HCE.map((sec) => {
                      const s = d.secciones.find((z: any) => z.area === area && z.seccion === sec);
                      return (
                        <div key={sec}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="label !mb-0">{SECCION_HCE_LABEL[sec]}</div>
                            <div className="flex gap-1">
                              {s && s.version > 1 && <button className="text-xs text-cyan-300 hover:underline" onClick={() => api.get(`/api/expedientes/${x.id}/secciones/${area}/${sec}`).then(setVersiones).catch(setErr)}><History size={12} className="inline" /> v{s.version}</button>}
                              {d.mi_area === area && <button className="text-xs text-cyan-300 hover:underline" onClick={() => setEditar({ area, seccion: sec, actual: s?.contenido ?? '' })}><PenLine size={12} className="inline" /> {s ? 'Nueva versión' : 'Registrar'}</button>}
                            </div>
                          </div>
                          {s ? <p className="whitespace-pre-wrap text-sm">{s.contenido}</p> : <p className="text-xs faint">Sin registro.</p>}
                          {s && <div className="text-[11px] faint">{s.autor} · {fFechaHora(s.created_at)}{s.motivo_cambio ? ` · cambio: ${s.motivo_cambio}` : ''}</div>}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : (
          <Card title="Resumen administrativo">
            {!x ? <Empty>Aún no hay expediente abierto.</Empty> : (
              <ul className="space-y-1 text-sm">
                <li>Código: <strong className="font-mono">{x.codigo}</strong> · estado {x.estado}</li>
                <li>Última actualización: {fFechaHora(x.updated_at)}</li>
                {(d.resumen_areas ?? []).map((r: any) => <li key={r.area}>{AREA_HCE_LABEL[r.area as AreaHce]}: {r.entradas} registro(s), {r.validadas} validado(s)</li>)}
              </ul>
            )}
          </Card>
        )
      )}

      {tab === 'entradas' && clinico && (
        <div className="space-y-3">
          {(d.entradas ?? []).length === 0 && <Empty>Sin entradas. Cada atención genera una entrada cronológica.</Empty>}
          {(d.entradas ?? []).map((e: any) => (
            <Card
              key={e.id}
              title={<span className="flex flex-wrap items-center gap-2">{fFechaHora(e.fecha_hora)} · {AREA_HCE_LABEL[e.area as AreaHce]}<span className="text-xs font-normal muted">{e.autor}{e.atencion_codigo ? ` · ${e.atencion_codigo}` : ''}</span></span>}
              actions={
                <div className="flex flex-wrap gap-1">
                  {e.estado === 'validada' ? <Badge tono="good"><ShieldCheck size={12} /> Validada</Badge> : <Badge tono="warning">Borrador v{e.version}</Badge>}
                  {e.confidencialidad === 'restringida' && <Badge tono="critical"><Lock size={12} /> Restringida</Badge>}
                </div>
              }
            >
              {e.restringida ? (
                <p className="text-sm faint">Contenido de confidencialidad restringida: solo lo consulta su autor.</p>
              ) : (
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  {CAMPOS_ENTRADA.filter((c) => e.contenido?.[c]).map((c) => (
                    <div key={c} className={c === 'resumen' ? 'sm:col-span-2' : ''}><dt className="label !mb-0">{CAMPO_ENTRADA_LABEL[c]}</dt><dd className="whitespace-pre-wrap">{e.contenido[c]}</dd></div>
                  ))}
                  {!Object.keys(e.contenido ?? {}).length && <div className="faint">Sin contenido registrado aún.</div>}
                </dl>
              )}
              {e.adendas.map((a: any) => (
                <div key={a.id} className="mt-2 rounded-lg border-l-2 border-cyan-400 bg-white/5 px-3 py-2 text-sm">
                  <div className="text-xs font-semibold text-cyan-200">Adenda · {a.motivo}</div>
                  <div className="whitespace-pre-wrap">{a.contenido}</div>
                  <div className="text-[11px] faint">{a.autor} · {fFechaHora(a.created_at)}</div>
                </div>
              ))}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] faint">
                {e.validada_at && <span>Validada {fFechaHora(e.validada_at)} por {e.validada_por} · huella {e.hash?.slice(0, 12)}…</span>}
                {e.es_autor && e.estado === 'validada' && <button className="btn-ghost btn-sm" onClick={() => setAdenda(e.id)}><Plus size={12} /> Adenda</button>}
                {e.es_autor && e.estado !== 'validada' && e.atencion_id && <Link className="text-cyan-300 hover:underline" to={`/atenciones/${e.atencion_id}`}>Completar y validar →</Link>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'consultas' && (
        <Card title="Historial de consultas">
          {d.atenciones.length === 0 ? <Empty>Sin consultas.</Empty> : (
            <table className="table">
              <thead><tr><th>Código</th><th>Fecha (GAL)</th><th>Servicio</th><th>Profesional</th><th>Estado</th></tr></thead>
              <tbody>
                {d.atenciones.map((a: any) => (
                  <tr key={a.id}>
                    <td><Link className="text-cyan-200 hover:underline" to={`/atenciones/${a.id}`}>{a.codigo}</Link>{a.inicio_urgente && <Badge tono="critical" className="ml-1">Urgencia</Badge>}</td>
                    <td className="tabular-nums">{fFechaHora(a.iniciada_at ?? a.inicio)}</td>
                    <td className="muted">{ESPECIALIDAD_LABEL[a.tipo as keyof typeof ESPECIALIDAD_LABEL]}</td>
                    <td className="muted">{a.profesional_nombre}</td>
                    <td><Badge tono={tonoAtencion[a.estado as EstadoAtencion]}>{ESTADO_ATENCION_LABEL[a.estado as EstadoAtencion]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'seguimientos' && (
        <Card title="Seguimientos">
          {(d.seguimientos ?? []).length === 0 ? <Empty>Sin seguimientos.</Empty> : (
            <ul className="space-y-1 text-sm">{d.seguimientos.map((g: any) => <li key={g.id}>{fFechaHora(g.fecha_programada)} · {g.profesional_nombre} · <Badge tono={g.estado === 'pendiente' ? 'warning' : 'good'}>{g.estado}</Badge>{g.nota_operativa && <span className="muted"> · {g.nota_operativa}</span>}</li>)}</ul>
          )}
        </Card>
      )}

      {tab === 'derivaciones' && (
        <Card title="Derivaciones a Psiquiatría">
          {(d.derivaciones ?? []).length === 0 ? <Empty>Sin derivaciones.</Empty> : (
            <ul className="space-y-3 text-sm">
              {d.derivaciones.map((r: any) => (
                <li key={r.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
                  <div className="flex flex-wrap items-center gap-2"><Link className="text-cyan-200 hover:underline" to={`/derivaciones/${r.id}`}>{r.codigo}</Link><Badge tono="info">{ESTADO_DERIVACION_LABEL[r.estado as EstadoDerivacion]}</Badge><span className="muted">{r.derivante} → {r.especialista} · {fDiaSolo(r.fecha_solicitud?.slice(0, 10))}</span></div>
                  {clinico && r.valoracion && <div className="mt-2"><div className="label !mb-0">Valoración psiquiátrica</div><p className="whitespace-pre-wrap">{r.valoracion}</p></div>}
                  {clinico && r.recomendaciones && <div className="mt-1"><div className="label !mb-0">Recomendaciones</div><p className="whitespace-pre-wrap">{r.recomendaciones}</p></div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'social' && d.nivel !== 'administrativo' && (
        <Card title="Intervención social (registro separado)" actions={puede(me, 'social.registrar') && <button className="btn-primary btn-sm" onClick={() => setSocial(true)}><Plus size={13} /> Registrar intervención</button>}>
          {(d.intervenciones_sociales ?? []).length === 0 ? <Empty>Sin intervenciones sociales registradas.</Empty> : (
            <ul className="space-y-2 text-sm">
              {d.intervenciones_sociales.map((i: any) => (
                <li key={i.id} className="rounded-lg border p-2" style={{ borderColor: 'var(--line)' }}>
                  <div className="text-xs muted">{fFechaHora(i.fecha)} · {TIPO_INTERVENCION_SOCIAL_LABEL[i.tipo as TipoIntervencionSocial]} · {i.profesional_nombre}</div>
                  <p className="whitespace-pre-wrap">{i.contenido}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'consentimiento' && (d.nivel === 'clinico' || d.nivel === 'administrativo') && srv.data && <ConsentimientosPanel servidorId={id!} consentimientos={srv.data.consentimientos} />}
      {tab === 'consentimiento' && d.nivel === 'social' && (
        <Card title="Consentimiento informado">
          <ul className="text-sm">{d.consentimientos.map((k: any) => <li key={k.id}>{k.servicio ?? '—'} · {k.estado}</li>)}</ul>
        </Card>
      )}

      {editar && x && <EditarSeccion expId={x.id} {...editar} onClose={() => setEditar(null)} />}
      <Modal open={!!versiones} onClose={() => setVersiones(null)} title="Versiones anteriores (control de cambios)" wide>
        <ol className="space-y-3">
          {(versiones ?? []).map((v: any) => (
            <li key={v.version} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
              <div className="text-xs muted">Versión {v.version} · {v.autor} · {fFechaHora(v.created_at)}{v.motivo_cambio ? ` · ${v.motivo_cambio}` : ''}</div>
              <p className="whitespace-pre-wrap">{v.contenido}</p>
            </li>
          ))}
        </ol>
      </Modal>
      {adenda && <NuevaAdenda entradaId={adenda} onClose={() => setAdenda(null)} />}
      {social && <NuevaSocial servidorId={id!} onClose={() => setSocial(false)} />}
    </div>
  );
}

function EditarSeccion({ expId, area, seccion, actual, onClose }: { expId: string; area: AreaHce; seccion: SeccionHce; actual: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [contenido, setContenido] = useState(actual);
  const [motivo, setMotivo] = useState('');
  const s = useSubmit(() => api.post(`/api/expedientes/${expId}/secciones`, { area, seccion, contenido, motivo_cambio: motivo || undefined }), () => { qc.invalidateQueries(); onClose(); });
  return (
    <Modal open onClose={onClose} title={`${SECCION_HCE_LABEL[seccion]} — ${AREA_HCE_LABEL[area]}`} wide>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); s.run(undefined); }}>
        <Field label="Contenido"><textarea className="input min-h-[160px]" required value={contenido} onChange={(e) => setContenido(e.target.value)} /></Field>
        {actual && <Field label="Motivo del cambio (obligatorio: la versión anterior se conserva)"><input className="input" required value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>}
        <ErrorMsg error={s.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={s.busy}>Guardar nueva versión</button></div>
      </form>
    </Modal>
  );
}

function NuevaAdenda({ entradaId, onClose }: { entradaId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ contenido: '', motivo: '' });
  const s = useSubmit(() => api.post(`/api/expedientes/entradas/${entradaId}/adendas`, f), () => { qc.invalidateQueries(); onClose(); });
  return (
    <Modal open onClose={onClose} title="Adenda a una entrada validada">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); s.run(undefined); }}>
        <Field label="Motivo"><input className="input" required value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} /></Field>
        <Field label="Contenido de la adenda"><textarea className="input min-h-[120px]" required value={f.contenido} onChange={(e) => setF({ ...f, contenido: e.target.value })} /></Field>
        <p className="text-[11px] faint">La entrada original no se modifica. La adenda queda fechada, firmada y con su propia huella.</p>
        <ErrorMsg error={s.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={s.busy}>Registrar adenda</button></div>
      </form>
    </Modal>
  );
}

function NuevaSocial({ servidorId, onClose }: { servidorId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ fecha: '', tipo: 'valoracion_social', contenido: '' });
  const s = useSubmit(() => api.post(`/api/servidores/${servidorId}/intervenciones-sociales`, { ...f, fecha: localGalToISO(f.fecha) }), () => { qc.invalidateQueries(); onClose(); });
  return (
    <Modal open onClose={onClose} title="Registrar intervención social">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); s.run(undefined); }}>
        <Field label="Fecha y hora (GAL)"><input type="datetime-local" className="input" required value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Field>
        <Field label="Tipo"><select className="input" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{TIPOS_INTERVENCION_SOCIAL.map((t) => <option key={t} value={t}>{TIPO_INTERVENCION_SOCIAL_LABEL[t]}</option>)}</select></Field>
        <Field label="Descripción"><textarea className="input min-h-[120px]" required value={f.contenido} onChange={(e) => setF({ ...f, contenido: e.target.value })} /></Field>
        <ErrorMsg error={s.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={s.busy}>Registrar</button></div>
      </form>
    </Modal>
  );
}
