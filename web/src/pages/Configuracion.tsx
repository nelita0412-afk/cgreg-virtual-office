import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, UserPlus, FileSpreadsheet } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useCan } from '../lib/auth';
import { Badge, Card, ErrorMsg, Field, Modal, PageHeader, Spinner, Tabs, useSubmit } from '../components/ui';
import { CambiarPassword } from './Login';
import { AjustesDispositivo } from '../components/AppMovil';
import { fFechaHora } from '../lib/format';
import { ROLES, ROL_LABEL, SERVICIO_CONSENTIMIENTO_LABEL, type Rol, type ServicioConsentimiento } from '@shared/domain';

export default function Configuracion() {
  const puedeUsuarios = useCan('usuarios.gestionar');
  const puedeSync = useCan('sync.ver');
  const puedeFormatos = useCan('consentimientos.gestionar');
  const tabs = [
    { value: 'cuenta', label: 'Mi cuenta' },
    ...(puedeSync ? [{ value: 'sync', label: 'Integración Google Sheets' }] : []),
    ...(puedeFormatos ? [{ value: 'formatos', label: 'Formatos de consentimiento' }] : []),
    ...(puedeUsuarios ? [{ value: 'usuarios', label: 'Usuarios y roles' }] : []),
  ];
  const [tab, setTab] = useState('cuenta');
  return (
    <div className="p-3 sm:p-4">
      <PageHeader title="Configuración" />
      <Tabs value={tab} onChange={setTab} items={tabs} />
      {tab === 'cuenta' && <Cuenta />}
      {tab === 'sync' && <Sync />}
      {tab === 'usuarios' && <Usuarios />}
      {tab === 'formatos' && <Formatos />}
    </div>
  );
}

function Cuenta() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const ses = useQuery({ queryKey: ['sesiones'], queryFn: () => api.get('/api/auth/sesiones') });
  return (
    <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
      <Card title="Datos de la cuenta">
        <div className="space-y-1 text-sm">
          <div><span className="muted">Nombre:</span> {me?.nombre}</div>
          <div><span className="muted">Correo:</span> {me?.email}</div>
          <div><span className="muted">Rol:</span> {me && ROL_LABEL[me.rol]}</div>
        </div>
        <h3 className="mb-2 mt-5 text-sm font-semibold">Cambiar contraseña</h3>
        <CambiarPassword />
      </Card>
      <Card title="Este dispositivo">
        <p className="mb-3 text-sm muted">Instalación de la app y avisos en este teléfono o computadora. Los avisos muestran solo un título breve, nunca datos clínicos.</p>
        <AjustesDispositivo />
      </Card>
      <Card title="Sesiones activas" actions={<button className="btn-ghost btn-sm" onClick={async () => { await api.post('/api/auth/sesiones/cerrar-otras'); qc.invalidateQueries({ queryKey: ['sesiones'] }); }}>Cerrar las demás</button>}>
        {ses.isLoading ? <Spinner /> : (
          <ul className="space-y-2 text-sm">
            {(ses.data ?? []).map((s: any) => (
              <li key={s.ref} className="rounded-lg border p-2" style={{ borderColor: 'var(--line)' }}>
                <div className="flex min-w-0 items-center gap-2">{s.actual && <Badge tono="good" className="shrink-0">Esta sesión</Badge>}<span className="min-w-0 truncate text-xs muted">{s.user_agent}</span></div>
                <div className="break-words text-xs faint">Inicio {fFechaHora(s.creada_at)} · última actividad {fFechaHora(s.ultima_actividad)} · IP {s.ip}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Sync() {
  const qc = useQueryClient();
  const puede = useCan('sync.ejecutar');
  const q = useQuery({ queryKey: ['sync'], queryFn: () => api.get('/api/sync/estado'), refetchInterval: 30_000 });
  const s = useSubmit(() => api.post('/api/sync/ejecutar'), () => qc.invalidateQueries());
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  const tono = d.estado_conexion === 'conectado' ? 'good' : d.estado_conexion === 'no_configurado' ? 'warning' : d.estado_conexion === 'error' ? 'critical' : 'info';
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><FileSpreadsheet size={18} className="text-emerald-300" /> Matriz institucional (solo lectura)</span>} actions={puede && <button className="btn-ghost btn-sm" disabled={s.busy || !d.configurado} onClick={() => s.run(undefined)}><RefreshCw size={14} className={s.busy ? 'animate-spin' : ''} /> Sincronizar ahora</button>}>
        <dl className="space-y-1.5 text-sm">
          <div className="flex gap-2"><dt className="muted">Estado de conexión:</dt><dd><Badge tono={tono}>{d.estado_conexion.replace('_', ' ')}</Badge></dd></div>
          <div className="flex gap-2"><dt className="muted">Última sincronización exitosa:</dt><dd>{d.ultima_sincronizacion_exitosa ? fFechaHora(d.ultima_sincronizacion_exitosa) : 'Nunca'}</dd></div>
          <div className="flex gap-2"><dt className="muted">Registros procesados (último intento):</dt><dd>{d.ultimo_intento?.registros_procesados ?? 0}</dd></div>
          <div className="flex gap-2"><dt className="muted">Modo:</dt><dd>{d.modo}, cada {d.intervalo_segundos} s{!d.habilitado && ' (deshabilitado)'}</dd></div>
          <div className="flex gap-2"><dt className="muted">Fuentes:</dt><dd>{d.fuentes?.modo === 'base_maestra' ? `«Personal» (gid ${d.fuentes.maestra_gid}) + «Valoraciones» (gid ${d.fuentes.valoraciones_gid})` : `Solo «Valoraciones» (gid ${d.gid}) — base maestra no habilitada`}</dd></div>
          <div className="flex gap-2"><dt className="muted">Filtro Santa Cruz:</dt><dd>{d.filtro_ubicacion?.columna} contiene «{d.filtro_ubicacion?.valor}»</dd></div>
          {d.ultimo_intento?.detalle && Object.keys(d.ultimo_intento.detalle).length > 0 && (
            <div className="rounded-lg bg-white/5 p-2 text-xs">
              {d.ultimo_intento.detalle.santa_cruz} en Santa Cruz · {d.ultimo_intento.detalle.excluidos_fuera_santa_cruz} excluidos por ubicación · {d.ultimo_intento.detalle.valoraciones_vinculadas} valoraciones vinculadas · {d.ultimo_intento.detalle.valoraciones_sin_vinculo} sin vínculo · {d.ultimo_intento.detalle.contacto_validado_descartado} valores de «Contacto_Validado» descartados
            </div>
          )}
          <div className={`rounded-lg p-2 text-xs ${d.riesgo?.configurado ? 'bg-emerald-500/10 text-emerald-100' : 'bg-amber-500/10 text-amber-100'}`}>
            Clasificación de riesgo: {d.riesgo?.configurado ? `columna «${d.riesgo.columna}», valores alto: ${d.riesgo.valores_alto}` : d.riesgo?.nota}
          </div>
          <div className="break-all text-xs faint">Spreadsheet: {d.spreadsheet_id}</div>
          {d.ultimo_intento?.mensaje && <div className="rounded-lg bg-white/5 p-2 text-xs">{d.ultimo_intento.mensaje}</div>}
        </dl>
        <ErrorMsg error={s.error} />
        {!d.configurado && (
          <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            La integración está preparada pero no tiene credenciales. Un administrador debe crear una cuenta de servicio de Google con ámbito <code>spreadsheets.readonly</code>, compartir la matriz con ella como <strong>Lector</strong> y configurar <code>GOOGLE_SERVICE_ACCOUNT_JSON_BASE64</code> en el servidor. Ver <code>docs/GOOGLE_SHEETS.md</code>.
          </div>
        )}
      </Card>
      <Card title="Columnas utilizadas (únicas que se leen)">
        <table className="table">
          <thead><tr><th>Campo</th><th>Encabezado en la matriz</th><th>Uso</th></tr></thead>
          <tbody>{d.columnas.map((c: any) => <tr key={c.campo}><td className="font-mono text-xs">{c.campo}</td><td>{c.encabezado}</td><td className="muted">{c.descripcion}</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-xs faint">Las columnas de vivienda, salud, red de apoyo y demás datos sensibles de la pestaña no se importan. No se leen otras pestañas ni se escribe en la matriz.</p>
      </Card>
      <Card title="Historial de sincronizaciones" className="lg:col-span-2">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>#</th><th>Inicio</th><th>Fin</th><th>Estado</th><th>Procesados</th><th>Nuevos</th><th>Actualizados</th><th>Errores</th><th>Mensaje</th></tr></thead>
            <tbody>
              {d.historial.map((h: any) => (
                <tr key={h.id}>
                  <td className="faint">{h.id}</td><td className="tabular-nums">{fFechaHora(h.inicio)}</td><td className="tabular-nums">{fFechaHora(h.fin)}</td>
                  <td><Badge tono={h.estado === 'ok' ? 'good' : h.estado === 'error' ? 'critical' : 'warning'}>{h.estado}</Badge></td>
                  <td className="tabular-nums">{h.registros_procesados}</td><td className="tabular-nums">{h.creados}</td><td className="tabular-nums">{h.actualizados}</td><td className="tabular-nums">{h.n_errores}</td>
                  <td className="max-w-[320px] text-xs muted">{h.mensaje}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Usuarios() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['usuarios'], queryFn: () => api.get('/api/admin/usuarios') });
  const pros = useQuery({ queryKey: ['profesionales'], queryFn: () => api.get('/api/profesionales') });
  const [nuevo, setNuevo] = useState(false);
  const [temporal, setTemporal] = useState<string | null>(null);
  const [f, setF] = useState({ email: '', nombre: '', rol: 'profesional' as Rol, profesional_id: '' });
  const s = useSubmit(() => api.post('/api/admin/usuarios', { ...f, profesional_id: f.profesional_id || undefined }), (r) => { setTemporal(r.password_temporal); setNuevo(false); qc.invalidateQueries({ queryKey: ['usuarios'] }); });
  const accion = async (id: string, a: string) => {
    const r = await api.post(`/api/admin/usuarios/${id}/${a}`);
    if (r.password_temporal) setTemporal(r.password_temporal);
    qc.invalidateQueries({ queryKey: ['usuarios'] });
  };
  return (
    <Card title="Usuarios" actions={<button className="btn-primary btn-sm" onClick={() => setNuevo(true)}><UserPlus size={14} /> Nuevo usuario</button>}>
      {q.isLoading ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Profesional</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead>
            <tbody>
              {q.data.map((u: any) => (
                <tr key={u.id}>
                  <td>{u.nombre}</td><td className="muted">{u.email}</td><td>{ROL_LABEL[u.rol as Rol]}</td><td className="muted">{u.profesional_id ?? '—'}</td>
                  <td>{u.activo ? <Badge tono="good">Activo</Badge> : <Badge>Inactivo</Badge>}{u.debe_cambiar_password && <Badge tono="warning" className="ml-1">Clave temporal</Badge>}</td>
                  <td className="tabular-nums">{fFechaHora(u.ultimo_acceso)}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <button className="btn-ghost btn-sm" onClick={() => accion(u.id, 'restablecer')}>Restablecer clave</button>
                      <button className="btn-ghost btn-sm" onClick={() => accion(u.id, 'cerrar-sesiones')}>Cerrar sesiones</button>
                      {u.activo ? <button className="btn-ghost btn-sm text-red-300" onClick={() => accion(u.id, 'desactivar')}>Desactivar</button> : <button className="btn-ghost btn-sm" onClick={() => accion(u.id, 'activar')}>Activar</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={nuevo} onClose={() => setNuevo(false)} title="Nuevo usuario">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); s.run(undefined); }}>
          <Field label="Nombre completo"><input className="input" required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Field>
          <Field label="Correo institucional"><input type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Rol"><select className="input" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value as Rol })}>{ROLES.map((r) => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}</select></Field>
          {f.rol === 'trabajo_social' && <p className="text-xs muted">Se creará su registro de Trabajo Social (no forma parte de los ocho profesionales de teleatención ni de la oficina virtual).</p>}
          {(f.rol === 'profesional' || f.rol === 'territorial') && (
            <Field label="Registro profesional vinculado">
              <select className="input" required={f.rol === 'profesional'} value={f.profesional_id} onChange={(e) => setF({ ...f, profesional_id: e.target.value })}>
                <option value="">Seleccione…</option>
                {(pros.data ?? []).filter((p: any) => (f.rol === 'profesional' ? p.es_teleatencion : !p.es_teleatencion)).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Field>
          )}
          <ErrorMsg error={s.error} />
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setNuevo(false)}>Cancelar</button><button className="btn-primary" disabled={s.busy}>Crear</button></div>
        </form>
      </Modal>
      <Modal open={!!temporal} onClose={() => setTemporal(null)} title="Contraseña temporal">
        <p className="text-sm muted">Entréguela por un canal seguro. Se muestra una sola vez y debe cambiarse en el primer ingreso.</p>
        <div className="mt-3 select-all rounded-xl bg-eucalipto p-3 text-center font-mono text-lg tracking-wider">{temporal}</div>
      </Modal>
    </Card>
  );
}

function Formatos() {
  const qc = useQueryClient();
  const esAdmin = useCan('plantillas.gestionar');
  const q = useQuery({ queryKey: ['consentimientos', 'plantillas'], queryFn: () => api.get('/api/consentimientos/plantillas') });
  const [ver, setVer] = useState<any>(null);
  const [aprobar, setAprobar] = useState<any>(null);
  const [ref, setRef] = useState('');
  const [nueva, setNueva] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['consentimientos'] });
      return true;
    } catch (e) {
      setErr(e);
      return false;
    }
  };
  if (q.isLoading) return <Spinner />;
  return (
    <Card title="Formatos institucionales de consentimiento informado">
      <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
        El contenido jurídico debe ser revisado y aprobado por la institución antes de su uso oficial. Los formatos en borrador solo se descargan con la marca «BORRADOR — NO VÁLIDO» y no permiten registrar consentimientos.
      </div>
      <ErrorMsg error={err} />
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Servicio</th><th>Versión</th><th>Título</th><th>Estado</th><th>Aprobación</th><th></th></tr></thead>
          <tbody>
            {q.data.map((p: any) => (
              <tr key={p.id}>
                <td>{SERVICIO_CONSENTIMIENTO_LABEL[p.servicio as ServicioConsentimiento]}</td>
                <td className="font-mono">{p.version}</td>
                <td>{p.titulo}</td>
                <td><Badge tono={p.estado === 'aprobada' ? 'good' : p.estado === 'borrador' ? 'warning' : 'neutral'}>{p.estado}</Badge></td>
                <td className="text-xs muted">{p.aprobada_at ? `${fFechaHora(p.aprobada_at)} · ${p.aprobada_por_nombre} · ref. ${p.aprobacion_referencia}` : '—'}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <button className="btn-ghost btn-sm" onClick={() => setVer(p)}>Ver</button>
                    <a className="btn-ghost btn-sm" href={`/api/consentimientos/plantillas/${p.id}/pdf`}>PDF</a>
                    {esAdmin && <button className="btn-ghost btn-sm" onClick={() => setNueva({ servicio: p.servicio, version: '', titulo: p.titulo, secciones: p.secciones.map((s: any) => ({ ...s })) })}>Nueva versión</button>}
                    {esAdmin && p.estado === 'borrador' && <button className="btn-primary btn-sm" onClick={() => { setAprobar(p); setRef(''); }}>Aprobar</button>}
                    {esAdmin && p.estado === 'aprobada' && <button className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/api/consentimientos/plantillas/${p.id}/retirar`))}>Retirar</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!ver} onClose={() => setVer(null)} title={ver ? `${ver.titulo} · v${ver.version}` : ''} wide>
        {ver?.secciones.map((s: any) => (
          <section key={s.titulo} className="mb-3 text-sm">
            <h3 className="font-semibold">{s.titulo}</h3>
            <p className="whitespace-pre-wrap muted">{s.texto}</p>
          </section>
        ))}
      </Modal>
      <Modal open={!!aprobar} onClose={() => setAprobar(null)} title="Aprobar formato para uso oficial">
        <p className="text-sm muted">Registre la referencia del acto institucional de aprobación (memorando, resolución u oficio) tras la revisión jurídica.</p>
        <Field label="Referencia de aprobación"><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setAprobar(null)}>Cancelar</button>
          <button className="btn-primary" disabled={ref.trim().length < 3} onClick={() => run(() => api.post(`/api/consentimientos/plantillas/${aprobar.id}/aprobar`, { referencia: ref })).then((ok) => ok && setAprobar(null))}>Aprobar</button>
        </div>
      </Modal>
      <Modal open={!!nueva} onClose={() => setNueva(null)} title="Nueva versión del formato" wide>
        {nueva && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
              <Field label="Versión"><input className="input" placeholder="1.1" value={nueva.version} onChange={(e) => setNueva({ ...nueva, version: e.target.value })} /></Field>
              <Field label="Título"><input className="input" value={nueva.titulo} onChange={(e) => setNueva({ ...nueva, titulo: e.target.value })} /></Field>
            </div>
            <p className="text-xs faint">Variables disponibles: {'{{servidor_nombre}} {{servidor_codigo}} {{servidor_unidad}} {{profesional_nombre}} {{profesional_titulo}} {{servicio}} {{fecha}}'}</p>
            {nueva.secciones.map((s: any, i: number) => (
              <div key={i} className="rounded-lg border p-2" style={{ borderColor: 'var(--line)' }}>
                <input className="input mb-1" value={s.titulo} onChange={(e) => { const x = [...nueva.secciones]; x[i] = { ...s, titulo: e.target.value }; setNueva({ ...nueva, secciones: x }); }} />
                <textarea className="input min-h-[80px]" value={s.texto} onChange={(e) => { const x = [...nueva.secciones]; x[i] = { ...s, texto: e.target.value }; setNueva({ ...nueva, secciones: x }); }} />
              </div>
            ))}
            <ErrorMsg error={err} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setNueva(null)}>Cancelar</button>
              <button className="btn-primary" disabled={!nueva.version} onClick={() => run(() => api.post('/api/consentimientos/plantillas', nueva)).then((ok) => ok && setNueva(null))}>Guardar como borrador</button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
