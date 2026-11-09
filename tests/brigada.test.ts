import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { BuiltApp } from '../server/app';
import { PASSWORD, client, crearUsuario, insertarServidor, resetDb, testApp } from './helpers';
import { PERMISOS, permisosEfectivos, puede } from '../shared/permissions';
import { ROLES } from '../shared/domain';
import WebSocket from 'ws';

/**
 * Brigada de Apoyo Psicosocial: matriz de roles, funciones complementarias y acceso por caso.
 * Todas las comprobaciones se hacen contra la API (acceso directo a rutas), no contra la visibilidad del menú.
 * Datos ficticios.
 */
let b: BuiltApp;
type C = ReturnType<typeof client>;
let admin: C, coord: C, gabriel: C, sofia: C, andrea: C, diego: C, demetrio: C, autoridad: C, auditor: C;
const uid: Record<string, string> = {};
const s: Record<string, string> = {};
const TEXTO_CLINICO = 'Contenido clínico ficticio de Sofía 9c1e';
const TEXTO_SOCIAL = 'Valoración social ficticia de la Coordinadora 4b7d';
let ipLogin = 0;
/** Ingreso desde direcciones distintas: el límite de 10 ingresos por minuto y dirección sigue activo en la API. */
async function entrar(email: string) {
  const res = await b.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD }, remoteAddress: `10.9.0.${++ipLogin}` });
  if (res.statusCode !== 200) throw new Error(`login ${email}: ${res.statusCode}`);
  return `cgreg_sid=${res.cookies.find((x) => x.name === 'cgreg_sid')!.value}`;
}

beforeAll(async () => {
  await resetDb();
  b = await testApp(undefined, {});
  const cuentas: [string, string, string | null][] = [
    ['admin', 'admin', null],
    ['coord', 'coordinacion', 'marianella-becerra'],
    ['gabriel', 'profesional', 'gabriel-ordonez'],
    ['sofia', 'profesional', 'sofia-guerra'],
    ['andrea', 'profesional', 'andrea-mayorga'],
    ['diego', 'profesional', 'diego-estrella'],
    ['demetrio', 'epidemiologia', 'demetrio-magallanes'],
    ['autoridad', 'autoridad', null],
    ['auditor', 'auditoria', null],
  ];
  for (const [k, rol, pid] of cuentas) uid[k] = await crearUsuario(b, `${k}@brigada.ec`, rol, pid);
  const c = async (k: string) => client(b, await entrar(`${k}@brigada.ec`));
  [admin, coord, gabriel, sofia, andrea, diego, demetrio, autoridad, auditor] = await Promise.all(['admin', 'coord', 'gabriel', 'sofia', 'andrea', 'diego', 'demetrio', 'autoridad', 'auditor'].map(c));
  for (const k of ['g', 'so', 'co', 'an', 'libre']) s[k] = await insertarServidor(b, `Servidor ficticio ${k}`, `PRUEBA:BR-${k}`);
  // Andrea: Psicología + función territorial, otorgada por Administración (con motivo, auditado).
  expect((await admin.post(`/api/admin/usuarios/${uid.andrea}/funciones`, { funcion: 'territorial', motivo: 'Directorio oficial: función territorial adicional' })).status).toBe(200);
  andrea = await c('andrea'); // nueva sesión para tomar las funciones
  await coord.post(`/api/servidores/${s.g}/asignaciones`, { profesional_id: 'gabriel-ordonez' });
  await coord.post(`/api/servidores/${s.so}/asignaciones`, { profesional_id: 'sofia-guerra' });
  await coord.post(`/api/servidores/${s.an}/asignaciones`, { profesional_id: 'andrea-mayorga' });
  // Sofía documenta en la historia de su caso (contenido que nadie más debe leer sin relación asistencial).
  const exp = await sofia.post(`/api/servidores/${s.so}/expediente`, {});
  expect(exp.status).toBe(200);
  s.expSo = exp.body.id;
  expect((await sofia.post(`/api/expedientes/${s.expSo}/secciones`, { area: 'psicologia', seccion: 'antecedentes', contenido: TEXTO_CLINICO })).status).toBe(200);
});
afterAll(async () => {
  await b.close();
});

describe('Matriz de permisos (mínimo privilegio)', () => {
  it('la matriz es coherente: cada permiso pertenece a roles válidos y nadie obtiene todo', () => {
    for (const roles of Object.values(PERMISOS)) for (const r of roles) expect(ROLES).toContain(r);
    for (const r of ROLES) expect(permisosEfectivos({ rol: r }).length).toBeLessThan(Object.keys(PERMISOS).length);
  });
  it('las funciones complementarias suman permisos y no dependen del nombre', () => {
    expect(puede({ rol: 'coordinacion' }, 'social.registrar')).toBe(false);
    expect(puede({ rol: 'coordinacion', funciones: ['trabajo_social'] }, 'social.registrar')).toBe(true);
    expect(puede({ rol: 'profesional', funciones: ['territorial'] }, 'territorio.registrar')).toBe(true);
    expect(puede({ rol: 'profesional', funciones: ['territorial'] }, 'atenciones.registrar')).toBe(true); // no pierde Psicología
    expect(puede({ rol: 'profesional' }, 'equipo.ver')).toBe(false);
    expect(puede({ rol: 'profesional', funciones: ['gestion_operativa'] }, 'equipo.ver')).toBe(true);
  });
});

describe('1. Un profesional puede ingresar a la Oficina Virtual', () => {
  it('ve la disponibilidad del equipo, cambia su estado y la ficha de un colega es limitada', async () => {
    expect((await gabriel.get('/api/office/presencia')).status).toBe(200);
    await b.presence.conectar(uid.gabriel); // lo que hace la conexión en tiempo real al entrar a la oficina
    expect((await gabriel.post('/api/office/estado', { estado: 'en_pausa' })).status).toBe(200);
    const yo = (await gabriel.get('/api/office/presencia')).body.find((p: any) => p.profesional_id === 'gabriel-ordonez');
    expect(yo.estado).toBe('en_pausa');
    const ficha = await gabriel.get('/api/profesionales/sofia-guerra/panel');
    expect(ficha.status).toBe(200);
    expect(ficha.body.limitado).toBe(true);
    for (const k of ['atenciones_hoy', 'agendadas_hoy', 'seguimientos_pendientes', 'proxima_cita', 'franjas_confirmadas']) expect(ficha.body).not.toHaveProperty(k);
  });
});

describe('2. Un profesional NO accede a Mi Equipo', () => {
  it('sin cargas, horarios ni panel de gestión; sí el directorio limitado', async () => {
    const lista = await gabriel.get('/api/profesionales');
    expect(lista.status).toBe(200);
    for (const p of lista.body) {
      expect(p).not.toHaveProperty('disponibilidad_origen');
      expect(p).not.toHaveProperty('tiene_cuenta');
      expect(p).not.toHaveProperty('notas_agenda');
    }
    expect((await gabriel.put('/api/profesionales/sofia-guerra/disponibilidad', { reglas: [] })).status).toBe(403);
    expect((await gabriel.post('/api/profesionales/sofia-guerra/franjas', { inicio: new Date().toISOString(), fin: new Date(Date.now() + 3600e3).toISOString() })).status).toBe(403);
    expect((await gabriel.get('/api/coordinacion/panel')).status).toBe(403);
    const dir = await gabriel.get('/api/directorio');
    expect(dir.status).toBe(200);
    expect(dir.body.find((p: any) => p.id === 'sally-tinizaray')).toBeUndefined(); // duplicado consolidado: no aparece
    expect(dir.body.filter((p: any) => /sally|zally/i.test(p.nombre)).map((p: any) => [p.id, p.nombre])).toEqual([['zally-pamela', 'Sally Tinizaray Soriano']]);
    expect(Object.keys(dir.body[0]).sort()).toEqual(
      ['color', 'disponibilidad_derivacion', 'es_teleatencion', 'especialidad', 'experiencia', 'funcion_brigada', 'id', 'instituciones', 'modalidad', 'nombre', 'nombre_corto', 'orden', 'perfil', 'titulo'].sort(),
    );
    // La disponibilidad solo se informa para Psiquiatría (coordinación de derivaciones).
    expect(dir.body.filter((p: any) => p.disponibilidad_derivacion).map((p: any) => p.id)).toEqual(['diego-estrella']);
  });
  it('el intento queda registrado como evento de seguridad', async () => {
    const r = await b.ctx.db.query(`select detalle from audit.registro where usuario_id = $1 and accion = 'acceso.denegado'`, [uid.gabriel]);
    expect(r.rows.map((x) => x.detalle.ruta)).toContain('/api/coordinacion/panel');
  });
});

describe('3. Un profesional solo consulta sus casos asignados', () => {
  it('lista y ficha', async () => {
    const lista = await gabriel.get('/api/servidores');
    expect(lista.body.map((x: any) => x.id)).toEqual([s.g]);
    expect((await gabriel.get(`/api/servidores/${s.g}`)).status).toBe(200);
    expect((await gabriel.get(`/api/servidores/${s.so}`)).status).toBe(403);
    expect((await gabriel.get(`/api/servidores/${s.libre}`)).status).toBe(403);
  });
});

describe('4. Sin relación asistencial no hay historia clínica de otro profesional', () => {
  it('Gabriel no lee ni escribe en la historia del caso de Sofía', async () => {
    const r = await gabriel.get(`/api/servidores/${s.so}/expediente`);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain(TEXTO_CLINICO);
    expect((await gabriel.get(`/api/expedientes/${s.expSo}/secciones/psicologia/antecedentes`)).status).toBe(403);
    expect((await gabriel.post(`/api/expedientes/${s.expSo}/secciones`, { area: 'psicologia', seccion: 'antecedentes', contenido: 'x', motivo_cambio: 'x' })).status).toBe(403);
    // Sofía sí (relación asistencial).
    const propia = await sofia.get(`/api/servidores/${s.so}/expediente`);
    expect(propia.body.nivel).toBe('clinico');
  });
});

describe('5. Coordinación: Mi Equipo y agenda general', () => {
  it('ve cargas, horarios y la agenda de toda la Brigada', async () => {
    const lista = await coord.get('/api/profesionales');
    expect(lista.body.find((p: any) => p.id === 'maria-alcivar')).toHaveProperty('disponibilidad_origen');
    const panel = await coord.get('/api/profesionales/sofia-guerra/panel');
    expect(panel.body).toHaveProperty('seguimientos_pendientes');
    const desde = new Date(Date.now() - 7 * 864e5).toISOString();
    const hasta = new Date(Date.now() + 7 * 864e5).toISOString();
    expect((await coord.get(`/api/agenda?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`)).status).toBe(200);
    expect((await coord.get('/api/coordinacion/panel')).status).toBe(200);
  });
  it('no lee las notas clínicas por su cargo', async () => {
    const r = await coord.get(`/api/servidores/${s.so}/expediente`);
    expect(r.body.nivel).toBe('administrativo');
    expect(JSON.stringify(r.body)).not.toContain(TEXTO_CLINICO);
    expect(r.body).not.toHaveProperty('secciones');
  });
});

describe('6. Coordinación ejerce Trabajo Social con la misma cuenta', () => {
  it('sin la función no registra intervención social; con la función, sí, y solo en sus casos', async () => {
    await coord.post(`/api/servidores/${s.co}/asignaciones`, { profesional_id: 'marianella-becerra' });
    const fecha = new Date().toISOString();
    expect((await coord.post(`/api/servidores/${s.co}/intervenciones-sociales`, { fecha, tipo: 'valoracion_social', contenido: TEXTO_SOCIAL })).status).toBe(403);
    // Administración otorga la función (no se deduce del nombre ni del título).
    expect((await admin.post(`/api/admin/usuarios/${uid.coord}/funciones`, { funcion: 'trabajo_social', motivo: 'Coordinadora que ejerce Trabajo Social' })).status).toBe(200);
    expect((await admin.post(`/api/admin/usuarios/${uid.autoridad}/funciones`, { funcion: 'trabajo_social', motivo: 'Prueba de incompatibilidad' })).status).toBe(400);
    const coordTS = client(b, await entrar('coord@brigada.ec'));
    expect((await coordTS.get('/api/auth/me')).body.funciones).toEqual(['trabajo_social']);
    expect((await coordTS.post(`/api/servidores/${s.co}/intervenciones-sociales`, { fecha, tipo: 'valoracion_social', contenido: TEXTO_SOCIAL })).status).toBe(200);
    expect((await coordTS.post(`/api/servidores/${s.co}/necesidades`, { categoria: 'vivienda', descripcion: 'Gestión de apoyo habitacional (ficticio)' })).status).toBe(200);
    const exp = await coordTS.get(`/api/servidores/${s.co}/expediente`);
    expect(exp.body.nivel).toBe('social');
    expect(exp.body.intervenciones_sociales.map((i: any) => i.contenido)).toContain(TEXTO_SOCIAL);
    expect(exp.body).toHaveProperty('resumen_areas'); // conserva la vista de Coordinación
    // En un caso que no le está asignado sigue siendo información administrativa, sin contenido clínico.
    const ajeno = await coordTS.get(`/api/servidores/${s.so}/expediente`);
    expect(ajeno.body.nivel).toBe('administrativo');
    expect(JSON.stringify(ajeno.body)).not.toContain(TEXTO_CLINICO);
    // Sigue siendo Coordinación (Mi Equipo) y no se vuelve administradora técnica.
    expect((await coordTS.get('/api/profesionales/sofia-guerra/panel')).body).toHaveProperty('seguimientos_pendientes');
    expect((await coordTS.get('/api/admin/usuarios')).status).toBe(403);
  });
  it('los vínculos con el directorio no se reasignan', async () => {
    expect((await admin.post(`/api/admin/usuarios/${uid.coord}/vincular`, { profesional_id: 'sally-tinizaray', motivo: 'Intento de reasignación' })).status).toBe(409);
    const otro = await crearUsuario(b, 'otra@brigada.ec', 'profesional', null);
    expect((await admin.post(`/api/admin/usuarios/${otro}/vincular`, { profesional_id: 'gabriel-ordonez', motivo: 'Registro con cuenta' })).status).toBe(409);
    expect((await admin.post(`/api/admin/usuarios/${otro}/vincular`, { profesional_id: 'demetrio-magallanes', motivo: 'Rol incompatible' })).status).toBe(409);
    // El duplicado consolidado no admite vínculos: se indica el registro canónico.
    const retirado = await admin.post(`/api/admin/usuarios/${otro}/vincular`, { profesional_id: 'sally-tinizaray', motivo: 'Intento sobre el duplicado' });
    expect(retirado.status).toBe(409);
    expect(retirado.body.error).toContain('zally-pamela');
    expect((await admin.post(`/api/admin/usuarios/${otro}/vincular`, { profesional_id: 'zally-pamela', motivo: 'Alta de Sally Tinizaray Soriano' })).status).toBe(200);
    const sally = (await b.ctx.db.query(`select profesional_id from core.usuarios where id = $1`, [otro])).rows[0];
    expect(sally.profesional_id).toBe('zally-pamela');
  });
});

describe('7. Andrea conserva Psicología y suma la función territorial', () => {
  it('clínico en su caso asignado y territorial', async () => {
    const me = (await andrea.get('/api/auth/me')).body;
    expect(me).toMatchObject({ rol: 'profesional', funciones: ['territorial'], especialidad: 'psicologia' });
    expect((await andrea.get('/api/servidores')).body.map((x: any) => x.id)).toEqual([s.an]);
    expect((await andrea.post(`/api/servidores/${s.an}/expediente`, {})).status).toBe(200);
    expect((await andrea.get(`/api/servidores/${s.an}/expediente`)).body.nivel).toBe('clinico');
    expect((await andrea.get(`/api/servidores/${s.so}/expediente`)).status).toBe(403);
    expect((await andrea.post('/api/articulaciones', { fecha: new Date().toISOString(), lugar: 'Unidad educativa ficticia', tipo: 'acompanamiento', descripcion: 'Contención grupal (ficticio)' })).status).toBe(200);
    expect((await andrea.get('/api/office/presencia')).status).toBe(200);
  });
});

describe('8. Diego: flujo de Psiquiatría', () => {
  it('recibe la derivación, la gestiona y accede a la información clínica del caso derivado', async () => {
    const d = await gabriel.post('/api/derivaciones', { servidor_id: s.g, prioridad: 'alta', motivo: 'Motivo clínico ficticio para valoración especializada.' });
    expect(d.status).toBe(200);
    expect((await diego.get('/api/derivaciones')).body.map((x: any) => x.id)).toContain(d.body.id);
    expect((await gabriel.post(`/api/derivaciones/${d.body.id}/estado`, { estado: 'en_revision' })).status).toBe(403);
    expect((await diego.post(`/api/derivaciones/${d.body.id}/estado`, { estado: 'en_revision' })).status).toBe(200);
    expect((await diego.get(`/api/servidores/${s.g}/expediente`)).body.nivel).toBe('clinico');
    expect((await diego.get(`/api/servidores/${s.so}/expediente`)).status).toBe(403); // sin derivación, sin acceso
    expect((await diego.post('/api/derivaciones', { servidor_id: s.g, prioridad: 'alta', motivo: 'El especialista no deriva.' })).status).toBe(403);
    expect((await diego.get('/api/coordinacion/panel')).status).toBe(403); // sin operación administrativa
  });
});

describe('9. Demetrio no obtiene permisos clínicos por defecto', () => {
  it('Oficina, indicadores agregados y territorio sí; casos e historias no', async () => {
    expect((await demetrio.get('/api/office/presencia')).status).toBe(200);
    await b.presence.conectar(uid.demetrio);
    expect((await demetrio.post('/api/office/estado', { estado: 'en_pausa' })).status).toBe(200);
    expect((await demetrio.get('/api/dashboard/indicadores')).status).toBe(200);
    expect((await demetrio.get('/api/directorio')).status).toBe(200);
    expect((await demetrio.post('/api/articulaciones', { fecha: new Date().toISOString(), lugar: 'Puerto Ayora', tipo: 'reunion_equipo', descripcion: 'Gestión de riesgos (ficticio)' })).status).toBe(200);
    for (const ruta of ['/api/servidores', `/api/servidores/${s.so}`, `/api/servidores/${s.so}/expediente`, '/api/expedientes', '/api/atenciones', '/api/derivaciones', '/api/consentimientos'])
      expect((await demetrio.get(ruta)).status, ruta).toBe(403);
    expect((await demetrio.post(`/api/servidores/${s.so}/expediente`, {})).status).toBe(403);
    expect((await coord.post(`/api/servidores/${s.libre}/asignaciones`, { profesional_id: 'demetrio-magallanes' })).status).toBe(403);
  });
});

describe('10. Autoridad solo ve indicadores agregados', () => {
  it('indicadores y reportes sin identidades; ninguna ruta individual', async () => {
    const ind = await autoridad.get('/api/dashboard/indicadores');
    expect(ind.status).toBe(200);
    expect(JSON.stringify(ind.body)).not.toMatch(/Servidor ficticio/);
    expect((await autoridad.get('/api/reportes/resumen.csv')).status).toBe(200);
    for (const ruta of ['/api/servidores', `/api/servidores/${s.g}`, `/api/servidores/${s.g}/expediente`, '/api/office/presencia', '/api/profesionales', '/api/directorio', '/api/auditoria', '/api/agenda?desde=2026-01-01T00:00:00Z&hasta=2026-12-31T00:00:00Z'])
      expect((await autoridad.get(ruta)).status, ruta).toBe(403);
  });
});

describe('11. Auditoría consulta la trazabilidad sin contenido clínico', () => {
  it('ve accesos, cambios de funciones y denegaciones; no el contenido', async () => {
    const r = await auditor.get('/api/auditoria?limit=500');
    expect(r.status).toBe(200);
    const acciones = r.body.map((x: any) => x.accion);
    for (const a of ['acceso.denegado', 'usuario.funcion_otorgada', 'hce.lectura_social', 'servidor.asignado']) expect(acciones).toContain(a);
    const todo = JSON.stringify(r.body);
    expect(todo).not.toContain(TEXTO_CLINICO);
    expect(todo).not.toContain(TEXTO_SOCIAL);
    for (const ruta of [`/api/servidores/${s.so}/expediente`, '/api/servidores', '/api/office/presencia'])
      expect((await auditor.get(ruta)).status, ruta).toBe(403);
  });
});

describe('12. Administración no obtiene acceso clínico rutinario', () => {
  it('usuarios, funciones y auditoría técnica sí; casos, historias y consentimientos no', async () => {
    expect((await admin.get('/api/admin/usuarios')).status).toBe(200);
    expect((await admin.get('/api/admin/registros-directorio')).status).toBe(200);
    expect((await admin.get('/api/auditoria')).status).toBe(200);
    for (const ruta of ['/api/servidores', `/api/servidores/${s.so}`, `/api/servidores/${s.so}/expediente`, '/api/expedientes', '/api/consentimientos', '/api/atenciones', '/api/profesionales', '/api/office/presencia', '/api/dashboard/indicadores'])
      expect((await admin.get(ruta)).status, ruta).toBe(403);
  });
});

describe('Tiempo real: la disponibilidad del equipo solo llega a quien entra a la Oficina', () => {
  it('Gabriel recibe la presencia del equipo; Autoridad no', async () => {
    await b.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = b.app.server.address() as { port: number };
    const abrir = async (email: string) => {
      const cookie = await entrar(email);
      const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`, { headers: { cookie, origin: `http://127.0.0.1:${addr.port}` } });
      const tipos: string[] = [];
      ws.on('message', (m) => tipos.push(JSON.parse(String(m)).type));
      await new Promise((r) => ws.on('open', r));
      return { ws, tipos };
    };
    const g = await abrir('gabriel@brigada.ec');
    const a = await abrir('autoridad@brigada.ec');
    await new Promise((r) => setTimeout(r, 300));
    await b.presence.conectar(uid.sofia);
    await sofia.post('/api/office/estado', { estado: 'en_documentacion' });
    await new Promise((r) => setTimeout(r, 1500));
    expect(g.tipos).toContain('presencia');
    expect(a.tipos).not.toContain('presencia');
    g.ws.close();
    a.ws.close();
  });
});
