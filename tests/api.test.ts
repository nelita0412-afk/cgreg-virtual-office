import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { BuiltApp } from '../server/app';
import { client, crearMedicoPrueba, crearUsuario, insertarServidor, loginCookie, proximoHabilGalapagos, resetDb, testApp } from './helpers';

let b: BuiltApp;
let coord: ReturnType<typeof client>;
let demetrio: ReturnType<typeof client>;
let gabriel: ReturnType<typeof client>;
let diego: ReturnType<typeof client>;
let autoridad: ReturnType<typeof client>;
let auditor: ReturnType<typeof client>;
let servidorA: string;
let servidorB: string;

beforeAll(async () => {
  await resetDb();
  b = await testApp();
  await crearUsuario(b, 'coord@test.ec', 'coordinacion');
  await crearMedicoPrueba(b);
  await crearUsuario(b, 'demetrio@test.ec', 'profesional', 'medico-prueba');
  await crearUsuario(b, 'gabriel@test.ec', 'profesional', 'gabriel-ordonez');
  await crearUsuario(b, 'diego@test.ec', 'profesional', 'diego-estrella');
  await crearUsuario(b, 'autoridad@test.ec', 'autoridad');
  await crearUsuario(b, 'auditor@test.ec', 'auditoria');
  coord = client(b, await loginCookie(b, 'coord@test.ec'));
  demetrio = client(b, await loginCookie(b, 'demetrio@test.ec'));
  gabriel = client(b, await loginCookie(b, 'gabriel@test.ec'));
  diego = client(b, await loginCookie(b, 'diego@test.ec'));
  autoridad = client(b, await loginCookie(b, 'autoridad@test.ec'));
  auditor = client(b, await loginCookie(b, 'auditor@test.ec'));
  servidorA = await insertarServidor(b, 'Servidor Prueba A', 'TEST:A');
  servidorB = await insertarServidor(b, 'Servidor Prueba B', 'TEST:B');
});
afterAll(async () => b?.close());

describe('Registro de profesionales', () => {
  it('directorio oficial de la Brigada: nombres completos, funciones y registros separados', async () => {
    const r = await coord.get('/api/profesionales');
    expect(r.status).toBe(200);
    const de = (id: string) => r.body.find((p: any) => p.id === id);
    // Teleatención clínica: Psicología (Gabriel, María, Hugo, Sofía, Betsabé, Sally y el registro previo de Zally) y Psiquiatría.
    expect(r.body.filter((p: any) => p.es_teleatencion && p.id !== 'medico-prueba').map((p: any) => p.id).sort()).toEqual(
      ['betsabe-cordova', 'diego-estrella', 'gabriel-ordonez', 'hugo-cuenca', 'maria-alcivar', 'sally-tinizaray', 'sofia-guerra', 'zally-pamela'].sort(),
    );
    expect(de('gabriel-ordonez').nombre).toBe('Gabriel Alexander Ordóñez Guzmán');
    expect(de('hugo-cuenca')).toMatchObject({ nombre: 'Hugo Xavier Cuenca Guerrero', especialidad: 'psicologia', funcion_brigada: 'Profesional de Salud Mental' });
    expect(de('diego-estrella')).toMatchObject({ nombre: 'Diego Estrella Almeida', especialidad: 'psiquiatria', funcion_brigada: 'Psiquiatría' });
    expect(de('demetrio-magallanes')).toMatchObject({ especialidad: 'epidemiologia', es_teleatencion: false, funcion_brigada: 'Apoyo Epidemiológico y Territorial' });
    expect(de('demetrio-magallanes').instituciones).toEqual(['IESS', 'Corporación Kimirina']); // descriptivas, no otorgan permisos
    expect(de('andrea-mayorga')).toMatchObject({ especialidad: 'psicologia', funcion_brigada: 'Profesional de Salud Mental · Función territorial' });
    // Sally es un registro propio; el registro previo de Zally se conserva intacto, fuera del directorio oficial.
    expect(de('sally-tinizaray')).toMatchObject({ nombre: 'Sally Tinizaray Soriano', especialidad: 'psicologia', en_directorio: true });
    expect(de('zally-pamela')).toMatchObject({ nombre: 'Zally Pamela', en_directorio: false });
    expect(de('marianella-becerra')).toMatchObject({ nombre: 'Lic. Marianella del Cisne Becerra Hernández, Espc.', especialidad: 'trabajo_social', funcion_brigada: 'Coordinación General · Trabajo Social' });
    expect(de('diego-estrella').disponibilidad_origen).toHaveLength(0); // sin horarios inventados
    const mar = de('maria-alcivar').disponibilidad_institucional;
    expect(mar.find((d: any) => d.dia_semana === 2).rangos).toEqual(['13:15–16:00']);
  });
});

describe('Seguridad', () => {
  it('rechaza mutaciones sin cabecera anti-CSRF y accesos sin sesión', async () => {
    const res = await b.app.inject({ method: 'POST', url: '/api/office/estado', payload: { estado: 'disponible' } });
    expect(res.statusCode).toBe(401);
  });
  it('la autoridad no accede a servidores, solicitudes ni derivaciones', async () => {
    expect((await autoridad.get('/api/servidores')).status).toBe(403);
    expect((await autoridad.get('/api/solicitudes')).status).toBe(403);
    expect((await autoridad.get('/api/derivaciones')).status).toBe(403);
    expect((await autoridad.get('/api/dashboard/indicadores')).status).toBe(200);
  });
  it('un profesional no ve servidores no asignados', async () => {
    expect((await gabriel.get('/api/servidores')).body).toHaveLength(0);
    expect((await gabriel.get(`/api/servidores/${servidorA}`)).status).toBe(403);
  });
  it('bloquea la cuenta tras 5 intentos fallidos', async () => {
    await crearUsuario(b, 'bloqueo@test.ec', 'autoridad');
    for (let i = 0; i < 5; i++) await b.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.9.9.9', payload: { email: 'bloqueo@test.ec', password: 'incorrecta' } });
    const u = (await b.ctx.db.query(`select bloqueado_hasta from core.usuarios where email = 'bloqueo@test.ec'`)).rows[0];
    expect(new Date(u.bloqueado_hasta).getTime()).toBeGreaterThan(Date.now());
    // Además el límite de frecuencia por IP rechaza ráfagas de intentos (401 o 429).
    const r = await b.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bloqueo@test.ec', password: 'ClaveDePrueba2026' } });
    expect([401, 429]).toContain(r.statusCode);
  });
  it('la bitácora de auditoría es inmutable', async () => {
    await expect(b.ctx.db.query(`delete from audit.registro`)).rejects.toThrow(/inmutable/);
    await expect(b.ctx.db.query(`update audit.registro set accion = 'x'`)).rejects.toThrow(/inmutable/);
  });
});

describe('Agenda y atenciones (telemedicina)', () => {
  let citaId: string;
  const inicio = proximoHabilGalapagos('18:00');

  it('Coordinación asigna y programa dentro de la disponibilidad', async () => {
    const r = await coord.post('/api/agenda/citas', { servidor_id: servidorA, profesional_id: 'medico-prueba', inicio, duracion_min: 30 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    citaId = r.body.id;
  });
  it('impide citas duplicadas en el mismo horario', async () => {
    const r = await coord.post('/api/agenda/citas', { servidor_id: servidorB, profesional_id: 'medico-prueba', inicio, duracion_min: 20 });
    expect(r.status).toBe(409);
  });
  it('rechaza horarios fuera de la disponibilidad y duraciones inválidas', async () => {
    const fuera = proximoHabilGalapagos('10:00');
    expect((await coord.post('/api/agenda/citas', { servidor_id: servidorB, profesional_id: 'medico-prueba', inicio: fuera, duracion_min: 30 })).status).toBe(400);
    const dentro = proximoHabilGalapagos('19:00');
    expect((await coord.post('/api/agenda/citas', { servidor_id: servidorB, profesional_id: 'medico-prueba', inicio: dentro, duracion_min: 45 })).status).toBe(400);
  });
  it('exige consentimiento antes de iniciar', async () => {
    const r = await demetrio.post(`/api/atenciones/${citaId}/iniciar`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('sin_consentimiento');
  });
  it('inicia y finaliza: la presencia refleja el evento real', async () => {
    expect((await demetrio.post(`/api/servidores/${servidorA}/consentimientos`, { tipo: 'teleatencion', base_legitimacion: 'consentimiento', otorgado: true, canal: 'videollamada' })).status).toBe(200);
    // Sin conexión real no se representa presencia
    await demetrio.post(`/api/atenciones/${citaId}/iniciar`);
    let snap = (await coord.get('/api/office/presencia')).body.find((s: any) => s.profesional_id === 'medico-prueba');
    expect(snap.conectado).toBe(false);
    expect(snap.estado).not.toBe('en_consulta');
    // Simula una conexión real (lo que hace el WebSocket) y verifica recuperación de estado
    const uid = (await b.ctx.db.query(`select id from core.usuarios where email = 'demetrio@test.ec'`)).rows[0].id;
    await b.presence.conectar(uid);
    snap = (await coord.get('/api/office/presencia')).body.find((s: any) => s.profesional_id === 'medico-prueba');
    expect(snap.estado).toBe('en_consulta');
    expect(snap.zona).toBe('telemedicina');
    expect((await demetrio.post(`/api/atenciones/${citaId}/finalizar`)).status).toBe(200);
    snap = (await coord.get('/api/office/presencia')).body.find((s: any) => s.profesional_id === 'medico-prueba');
    expect(snap.estado).toBe('en_documentacion');
    expect((await demetrio.put(`/api/atenciones/${citaId}/nota`, { resumen: 'Nota clínica de prueba', plan: 'Control' })).status).toBe(200);
    snap = (await coord.get('/api/office/presencia')).body.find((s: any) => s.profesional_id === 'medico-prueba');
    expect(snap.estado).toBe('disponible');
  });
  it('la nota clínica está cifrada en reposo y solo la ve su autor', async () => {
    const raw = (await b.ctx.db.query(`select contenido_cifrado from clinical.notas_atencion where atencion_id = $1`, [citaId])).rows[0].contenido_cifrado;
    expect(raw).toMatch(/^v1\./);
    expect(raw).not.toContain('Nota clínica');
    expect((await demetrio.get(`/api/atenciones/${citaId}`)).body.nota.resumen).toBe('Nota clínica de prueba');
    const vistaCoord = await coord.get(`/api/atenciones/${citaId}`);
    expect(vistaCoord.body.nota).toBeNull();
  });
  it('el feed general no expone nombres de servidores', async () => {
    const ev = (await coord.get('/api/office/eventos?limit=100')).body;
    expect(ev.length).toBeGreaterThan(0);
    expect(JSON.stringify(ev)).not.toContain('Servidor Prueba');
  });
  it('el heartbeat vencido desconecta al profesional', async () => {
    await b.ctx.db.query(`update ops.presencia set ultimo_heartbeat = now() - interval '10 minutes'`);
    expect(await b.presence.barrer(45)).toBeGreaterThan(0);
    const snap = (await coord.get('/api/office/presencia')).body.find((s: any) => s.profesional_id === 'medico-prueba');
    expect(snap.conectado).toBe(false);
  });
});

describe('Atención pendiente (sin horario previo)', () => {
  it('el psicólogo asignado la inicia y su presencia pasa al consultorio', async () => {
    const sid = await insertarServidor(b, 'Servidor Prueba C', 'TEST:C');
    await coord.post(`/api/servidores/${sid}/asignaciones`, { profesional_id: 'gabriel-ordonez' });
    const r = await coord.post('/api/atenciones/pendiente', { servidor_id: sid, profesional_id: 'gabriel-ordonez' });
    expect(r.status).toBe(200);
    await gabriel.post(`/api/servidores/${sid}/consentimientos`, { tipo: 'teleatencion', base_legitimacion: 'consentimiento', otorgado: true });
    const uid = (await b.ctx.db.query(`select id from core.usuarios where email = 'gabriel@test.ec'`)).rows[0].id;
    await b.presence.conectar(uid);
    const ini = await gabriel.post(`/api/atenciones/${r.body.id}/iniciar`);
    expect(ini.status, JSON.stringify(ini.body)).toBe(200);
    const snap = (await coord.get('/api/office/presencia')).body.find((s: any) => s.profesional_id === 'gabriel-ordonez');
    expect(snap.zona).toBe('consultorio_psicologia');
    expect((await gabriel.post(`/api/atenciones/${r.body.id}/finalizar`)).status).toBe(200);
    expect((await gabriel.post('/api/office/estado', { estado: 'disponible' })).status).toBe(200);
    await b.presence.desconectar(uid, 'cierre');
  });
});

describe('Derivación a Psiquiatría', () => {
  let derId: string;
  it('un psicólogo asignado deriva; Coordinación no ve el motivo', async () => {
    await coord.post(`/api/servidores/${servidorB}/asignaciones`, { profesional_id: 'gabriel-ordonez' });
    const r = await gabriel.post('/api/derivaciones', { servidor_id: servidorB, prioridad: 'alta', motivo: 'Motivo clínico confidencial de prueba' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.codigo).toMatch(/^DPQ-/);
    derId = r.body.id;
    const vc = await coord.get(`/api/derivaciones/${derId}`);
    expect(vc.body.clinico).toBeNull();
    expect(JSON.stringify(vc.body)).not.toContain('confidencial');
    const vd = await diego.get(`/api/derivaciones/${derId}`);
    expect(vd.body.clinico.motivo).toContain('confidencial');
  });
  it('respeta el flujo de estados y requiere franja confirmada', async () => {
    expect((await diego.post(`/api/derivaciones/${derId}/estado`, { estado: 'valorada' })).status).toBe(409);
    expect((await diego.post(`/api/derivaciones/${derId}/estado`, { estado: 'en_revision' })).status).toBe(200);
    expect((await diego.post(`/api/derivaciones/${derId}/estado`, { estado: 'aceptada' })).status).toBe(200);
    const inicio = proximoHabilGalapagos('10:00');
    // Sin franja confirmada no hay disponibilidad
    expect((await coord.post('/api/agenda/citas', { servidor_id: servidorB, profesional_id: 'diego-estrella', inicio, duracion_min: 30, derivacion_id: derId })).status).toBe(400);
    const fin = new Date(new Date(inicio).getTime() + 2 * 3600_000).toISOString();
    expect((await diego.post('/api/profesionales/diego-estrella/franjas', { inicio, fin })).status).toBe(200);
    const r = await coord.post('/api/agenda/citas', { servidor_id: servidorB, profesional_id: 'diego-estrella', inicio, duracion_min: 30, derivacion_id: derId });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await diego.get(`/api/derivaciones/${derId}`)).body.derivacion.estado).toBe('programada');
  });
});

describe('Solicitudes a Coordinación', () => {
  let solId: string;
  it('el profesional solicita apoyo y Coordinación recibe notificación', async () => {
    const r = await gabriel.post('/api/solicitudes', {
      tipo: 'coordinacion_interinstitucional',
      descripcion: 'Se requiere coordinar con el MIES',
      accion_requerida: 'Contactar a la dirección distrital',
      prioridad: 'urgente',
      fecha_respuesta_requerida: '2030-01-10',
    });
    expect(r.status).toBe(200);
    solId = r.body.id;
    const n = await coord.get('/api/notificaciones');
    expect(n.body.no_leidas).toBeGreaterThan(0);
    const panel = await coord.get('/api/coordinacion/panel');
    expect(panel.body.que_necesitan.map((s: any) => s.id)).toContain(solId);
    expect(panel.body.urgentes).toBe(1);
  });
  it('Coordinación gestiona con trazabilidad completa', async () => {
    await coord.get(`/api/solicitudes/${solId}`); // revisar → recibida
    expect((await coord.post(`/api/solicitudes/${solId}/acciones`, { accion: 'aceptar' })).status).toBe(200);
    expect((await coord.post(`/api/solicitudes/${solId}/acciones`, { accion: 'gestion_registrada', comentario: 'Llamada a MIES', institucion: 'MIES' })).status).toBe(200);
    expect((await coord.post(`/api/solicitudes/${solId}/acciones`, { accion: 'solicitar_informacion', comentario: '¿Qué unidad?' })).status).toBe(200);
    expect((await gabriel.post(`/api/solicitudes/${solId}/acciones`, { accion: 'informacion_aportada', comentario: 'Unidad X' })).status).toBe(200);
    expect((await coord.post(`/api/solicitudes/${solId}/acciones`, { accion: 'cerrar' })).status).toBe(409); // aún no resuelta
    expect((await coord.post(`/api/solicitudes/${solId}/acciones`, { accion: 'estado_actualizado', estado: 'resuelta' })).status).toBe(200);
    expect((await coord.post(`/api/solicitudes/${solId}/acciones`, { accion: 'responder', comentario: 'Gestión resuelta' })).status).toBe(200);
    expect((await coord.post(`/api/solicitudes/${solId}/acciones`, { accion: 'cerrar' })).status).toBe(200);
    const d = await gabriel.get(`/api/solicitudes/${solId}`);
    expect(d.body.solicitud.estado).toBe('cerrada');
    expect(d.body.solicitud.respuesta).toBe('Gestión resuelta');
    expect(d.body.acciones.map((a: any) => a.accion)).toEqual(['creada', 'revisada', 'aceptada', 'gestion_registrada', 'solicitar_informacion', 'informacion_aportada', 'estado_actualizado', 'respuesta', 'cerrada']);
    const n = await gabriel.get('/api/notificaciones');
    expect(n.body.items.some((x: any) => x.titulo.includes('respondió'))).toBe(true);
  });
  it('un profesional no puede gestionar solicitudes ajenas', async () => {
    expect((await demetrio.get(`/api/solicitudes/${solId}`)).status).toBe(403);
    expect((await gabriel.post(`/api/solicitudes/${solId}/acciones`, { accion: 'aceptar' })).status).toBe(403);
  });
});

describe('Indicadores y auditoría', () => {
  it('el dashboard refleja registros reales', async () => {
    const r = await coord.get('/api/dashboard/indicadores');
    expect(r.body.personas.registrados).toBe(3);
    expect(r.body.personas.atenciones_realizadas).toBe(2);
    const tele = (await b.ctx.db.query(`select count(*)::int as n from core.profesionales where es_teleatencion and activo`)).rows[0].n;
    expect(r.body.equipo.registrados).toBe(tele);
    expect(r.body.derivaciones.find((d: any) => d.estado === 'programada').n).toBe(1);
  });
  it('el auditor consulta la trazabilidad', async () => {
    const r = await auditor.get('/api/auditoria?limit=500');
    expect(r.status).toBe(200);
    const acciones = r.body.map((x: any) => x.accion);
    expect(acciones).toContain('clinico.nota_guardada');
    expect(acciones).toContain('solicitud.cerrada');
    expect(JSON.stringify(r.body)).not.toContain('Nota clínica');
    expect((await coord.get('/api/auditoria')).status).toBe(403);
  });
});
