// DATOS FICTICIOS DE DEMOSTRACIÓN — Ninguna persona real. Solo para probar la app en una base «demo» local.
// Uso: node scripts/demo/sembrar-demo.mjs   (lo ejecuta scripts/demo/probar-en-mac.sh)
// Se niega a correr si la base de datos no se llama con «demo»: nunca toca una base institucional.
import pg from 'pg';
import bcrypt from 'bcryptjs';
import WebSocket from 'ws';
import { DateTime } from 'luxon';
const B = process.env.DEMO_URL ?? 'http://localhost:4000', PASS = 'Demo-CGREG-2026';
const URL_DB = process.env.DATABASE_URL ?? '';
if (!/demo/i.test(new URL(URL_DB || 'postgres://x/sin_base').pathname)) {
  console.error('Por seguridad, este script solo funciona con una base de datos cuyo nombre contenga «demo».');
  process.exit(1);
}
const db = new pg.Client({ connectionString: URL_DB }); await db.connect();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const usuarios = [
  ['coordinacion@demo.cgreg', 'DEMO · Coordinación General', 'coordinacion', null],
  ['admin@demo.cgreg', 'DEMO · Administración', 'admin', null],
  ['autoridad@demo.cgreg', 'DEMO · Autoridad', 'autoridad', null],
  ['auditoria@demo.cgreg', 'DEMO · Auditoría', 'auditoria', null],
  ['gabriel@demo.cgreg', null, 'profesional', 'gabriel-ordonez'],
  ['maria@demo.cgreg', null, 'profesional', 'maria-alcivar'],
  ['hugo@demo.cgreg', null, 'profesional', 'hugo-cuenca'],
  ['sofia@demo.cgreg', null, 'profesional', 'sofia-guerra'],
  ['betsabe@demo.cgreg', null, 'profesional', 'betsabe-cordova'],
  ['zally@demo.cgreg', null, 'profesional', 'zally-pamela'],
  ['demetrio@demo.cgreg', null, 'profesional', 'demetrio-magallanes'],
  ['diego@demo.cgreg', null, 'profesional', 'diego-estrella'],
  ['andrea@demo.cgreg', null, 'territorial', 'andrea-mayorga'],
];
const hash = await bcrypt.hash(PASS, 10);
for (const [e, n, r, p] of usuarios)
  await db.query(`insert into core.usuarios (email,nombre,rol,profesional_id,password_hash,debe_cambiar_password) values ($1, coalesce($2,(select nombre from core.profesionales where id=$4)), $3,$4,$5,false) on conflict do nothing`, [e, n, r, p, hash]);

const nombres = ['Ana Lucía Ficticia Uno','Bruno Ejemplo Dos','Carla Prueba Tres','Diego Demo Cuatro','Elena Muestra Cinco','Fabián Ficticio Seis','Gloria Ejemplo Siete','Héctor Prueba Ocho','Inés Demo Nueve','Jorge Muestra Diez','Karla Ficticia Once','Luis Ejemplo Doce'];
const S = {};
for (let i = 0; i < 12; i++) {
  const cod = `DEMO-${String(i + 1).padStart(3, '0')}`;
  const r = await db.query(`insert into ops.servidores (clave_fuente,codigo_institucional,nombre,unidad,estado_servidor,en_base_maestra,en_santa_cruz,verificacion,origen,canal_contacto)
    values ($1,$2,$3,'UNIDAD DEMO (FICTICIA) · SANTA CRUZ','ACTIVO',true,true,'verificado_maestra','matriz_personal','WhatsApp (ficticio)') on conflict (clave_fuente) do update set nombre=excluded.nombre returning id`,
    [`DEMO:${cod}`, cod, `DEMO · ${nombres[i]}`]);
  S[i + 1] = { id: r.rows[0].id, cod, nombre: `DEMO · ${nombres[i]}` };
}

async function login(email) {
  const r = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS }) });
  if (!r.ok) throw new Error(`login ${email} ${r.status}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const call = async (m, u, b) => {
    const res = await fetch(B + u, { method: m, headers: { cookie, 'x-cgreg': '1', ...(m !== 'GET' ? { 'content-type': 'application/json' } : {}) }, body: m !== 'GET' ? JSON.stringify(b ?? {}) : undefined });
    const d = await res.json().catch(() => null);
    if (!res.ok) { log(`  ! ${m} ${u} → ${res.status} ${d?.error}`); return null; }
    return d;
  };
  return { cookie, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b) };
}
function conectar(nombre, cookie) {
  const abrir = () => {
    const ws = new WebSocket(B.replace(/^http/, 'ws') + '/ws', { headers: { cookie, origin: B } });
    let t; ws.on('open', () => { t = setInterval(() => ws.readyState === 1 && ws.send('{"t":"hb"}'), 10000); });
    ws.on('close', () => { clearInterval(t); setTimeout(abrir, 3000); }); ws.on('error', () => {});
  };
  abrir();
}
const pub = (m, u, b) => fetch(B + u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
const gal = () => DateTime.now().setZone('Pacific/Galapagos');
const proximo = (dias, hh, mm = 0) => { let d = gal().plus({ days: 1 }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 }); while (!dias.includes(d.weekday)) d = d.plus({ days: 1 }); return d.toUTC().toISO(); };

const U = {};
for (const k of ['coordinacion', 'admin', 'gabriel', 'maria', 'hugo', 'sofia', 'betsabe', 'demetrio', 'diego']) U[k] = await login(`${k}@demo.cgreg`);
// Conexiones reales por WebSocket (avatares). Zally, Andrea y la coordinadora quedan sin conectar.
for (const k of ['gabriel', 'maria', 'hugo', 'sofia', 'betsabe', 'demetrio', 'diego']) conectar(k, U[k].cookie);
await new Promise((r) => setTimeout(r, 2500));
const C = U.coordinacion;

const yaSembrado = (await db.query(`select count(*)::int n from ops.atenciones`)).rows[0].n > 0;
if (!yaSembrado) {
  log('Sembrando datos ficticios…');
  for (const p of await U.admin.get('/api/consentimientos/plantillas'))
    if (p.estado === 'borrador') await U.admin.post(`/api/consentimientos/plantillas/${p.id}/aprobar`, { referencia: 'DEMO — aprobación ficticia, NO oficial' });
  const asign = { 1: 'gabriel-ordonez', 2: 'gabriel-ordonez', 3: 'gabriel-ordonez', 4: 'maria-alcivar', 5: 'maria-alcivar', 6: 'hugo-cuenca', 7: 'sofia-guerra', 8: 'betsabe-cordova', 9: 'zally-pamela', 10: 'demetrio-magallanes' };
  for (const [n, p] of Object.entries(asign)) await C.post(`/api/servidores/${S[n].id}/asignaciones`, { profesional_id: p });
  // Consentimientos electrónicos (firma ficticia por la página pública)
  const consentir = async (pro, n, servicio) => {
    const s = await pro.post(`/api/servidores/${S[n].id}/consentimientos/solicitar`, { modalidad: 'electronica', servicio });
    const tok = s.enlace.split('/').pop();
    await pub('POST', `/api/publico/consentimiento/${tok}`, { nombre_completo: S[n].nombre.replace('DEMO · ', ''), identificador: S[n].cod, lectura_confirmada: true, acepta: true });
    await pro.post(`/api/consentimientos/${s.id}/validar`, { resultado: 'validado' });
  };
  await consentir(U.gabriel, 1, 'psicologia'); await consentir(U.gabriel, 2, 'psicologia'); await consentir(U.hugo, 6, 'psicologia'); await consentir(U.demetrio, 10, 'telemedicina');
  // Consentimiento firmado a mano (PDF ficticio) pendiente de validación; otro electrónico pendiente
  const m = await U.gabriel.post(`/api/servidores/${S[3].id}/consentimientos/solicitar`, { modalidad: 'firmada_manual', servicio: 'psicologia' });
  await fetch(`${B}/api/consentimientos/${m.id}/documento?nombre=DEMO-consentimiento-ficticio.pdf`, { method: 'POST', headers: { cookie: U.gabriel.cookie, 'x-cgreg': '1', 'content-type': 'application/pdf' }, body: Buffer.from('%PDF-1.4\n% DOCUMENTO FICTICIO DE DEMOSTRACION\n%%EOF') });
  await U.gabriel.post(`/api/consentimientos/${m.id}/enviar-validacion`);
  await U.maria.post(`/api/servidores/${S[4].id}/consentimientos/solicitar`, { modalidad: 'electronica', servicio: 'psicologia' });
  // Atenciones realizadas y documentadas
  const atender = async (pro, pid, n, nota, validar = true, terminar = true) => {
    const a = await C.post('/api/atenciones/pendiente', { servidor_id: S[n].id, profesional_id: pid });
    await pro.post(`/api/atenciones/${a.id}/iniciar`);
    if (!terminar) return a.id;
    await pro.post(`/api/atenciones/${a.id}/finalizar`);
    await pro.put(`/api/atenciones/${a.id}/nota`, nota);
    if (validar) await pro.post(`/api/atenciones/${a.id}/nota/validar`);
    return a.id;
  };
  await atender(U.gabriel, 'gabriel-ordonez', 1, { resumen: 'DEMO · Primera sesión de acompañamiento (contenido ficticio).', motivo_consulta: 'DEMO · Malestar tras la emergencia (ficticio).', intervencion: 'Primeros auxilios psicológicos (ejemplo).', plan: 'Seguimiento en una semana.' });
  await atender(U.gabriel, 'gabriel-ordonez', 2, { resumen: 'DEMO · Valoración inicial (contenido ficticio).', plan: 'Derivar a valoración psiquiátrica (ejemplo).' });
  await atender(U.demetrio, 'demetrio-magallanes', 10, { resumen: 'DEMO · Teleconsulta médica (contenido ficticio).', recomendaciones: 'Hidratación y control (ejemplo).' }, false);
  await atender(U.hugo, 'hugo-cuenca', 6, null, false, false); // queda EN CONSULTA → avatar en consultorio
  await U.gabriel.post('/api/seguimientos', { servidor_id: S[1].id, fecha_programada: proximo([1, 3, 5], 6, 30), nota_operativa: 'DEMO · Seguimiento semanal' });
  // Citas futuras dentro de la disponibilidad real
  await C.post('/api/agenda/citas', { servidor_id: S[7].id, profesional_id: 'sofia-guerra', inicio: proximo([2, 4], 17, 15), duracion_min: 45 });
  await C.post('/api/agenda/citas', { servidor_id: S[9].id, profesional_id: 'zally-pamela', inicio: proximo([2, 4], 16, 30), duracion_min: 60 });
  await C.post('/api/agenda/citas', { servidor_id: S[3].id, profesional_id: 'gabriel-ordonez', inicio: proximo([1, 3, 5], 6, 0), duracion_min: 45 });
  const c10 = await C.post('/api/agenda/citas', { servidor_id: S[10].id, profesional_id: 'demetrio-magallanes', inicio: proximo([1, 2, 3, 4, 5], 18, 30), duracion_min: 30 });
  if (c10) await C.post(`/api/agenda/citas/${c10.id}/confirmar`);
  // Derivaciones a Psiquiatría
  const d1 = await U.gabriel.post('/api/derivaciones', { servidor_id: S[2].id, prioridad: 'alta', motivo: 'DEMO · Motivo clínico ficticio para la demostración del flujo de derivación.' });
  await U.diego.post(`/api/derivaciones/${d1.id}/estado`, { estado: 'en_revision' });
  await U.diego.post(`/api/derivaciones/${d1.id}/estado`, { estado: 'aceptada' });
  const fr = proximo([1, 2, 3, 4, 5], 10, 0);
  await U.diego.post('/api/profesionales/diego-estrella/franjas', { inicio: fr, fin: DateTime.fromISO(fr).plus({ hours: 2 }).toUTC().toISO(), nota: 'DEMO · franja ficticia' });
  await C.post('/api/agenda/citas', { servidor_id: S[2].id, profesional_id: 'diego-estrella', inicio: fr, duracion_min: 30, derivacion_id: d1.id });
  await U.maria.post('/api/derivaciones', { servidor_id: S[5].id, prioridad: 'media', motivo: 'DEMO · Segundo motivo ficticio, pendiente de revisión por el especialista.' });
  // Seguimiento prioritario (clasificación registrada por el profesional; ficticia)
  await U.gabriel.post(`/api/servidores/${S[1].id}/riesgo`, { fecha_valoracion: gal().toISODate(), requiere_seguimiento: true, confirmacion_profesional: true });
  await U.maria.post(`/api/servidores/${S[4].id}/riesgo`, { fecha_valoracion: gal().toISODate(), requiere_seguimiento: true, confirmacion_profesional: true });
  // Contactos y necesidades
  for (const [n, pro, r] of [[1, U.gabriel, 'contactado'], [2, U.gabriel, 'contactado'], [4, U.maria, 'no_responde'], [7, U.sofia, 'contactado'], [6, U.hugo, 'contactado']]) await pro.post(`/api/servidores/${S[n].id}/contactos`, { resultado: r, canal: 'Llamada (ficticia)' });
  const n1 = await U.gabriel.post(`/api/servidores/${S[1].id}/necesidades`, { categoria: 'vivienda', descripcion: 'DEMO · Reparación de techo (ficticio)' });
  const n2 = await U.maria.post(`/api/servidores/${S[4].id}/necesidades`, { categoria: 'economica', descripcion: 'DEMO · Apoyo económico temporal (ficticio)' });
  await U.maria.patch?.(`/api/necesidades/${n2.id}`, { estado: 'parcial' });
  await fetch(`${B}/api/necesidades/${n2.id}`, { method: 'PATCH', headers: { cookie: U.maria.cookie, 'x-cgreg': '1', 'content-type': 'application/json' }, body: '{"estado":"parcial"}' });
  const n3 = await C.post(`/api/servidores/${S[11].id}/necesidades`, { categoria: 'alimentacion', descripcion: 'DEMO · Kit de alimentos (ficticio)' });
  await fetch(`${B}/api/necesidades/${n3.id}`, { method: 'PATCH', headers: { cookie: C.cookie, 'x-cgreg': '1', 'content-type': 'application/json' }, body: '{"estado":"resuelta"}' });
  // Mis Solicitudes y Gestiones
  const s1 = await U.gabriel.post('/api/solicitudes', { tipo: 'coordinacion_interinstitucional', descripcion: 'DEMO · Coordinar apoyo con una institución ficticia para un servidor asignado.', accion_requerida: 'DEMO · Contactar a la Dirección Ficticia de Apoyo Social', prioridad: 'urgente', fecha_respuesta_requerida: gal().plus({ days: 1 }).toISODate(), servidor_id: S[1].id });
  await U.demetrio.post('/api/solicitudes', { tipo: 'gestion_recursos', descripcion: 'DEMO · Se requiere conectividad para teleconsultas.', accion_requerida: 'DEMO · Gestionar un plan de datos', prioridad: 'media' });
  await U.maria.post('/api/solicitudes', { tipo: 'solicitud_informacion', descripcion: 'DEMO · Directorio de unidades educativas.', accion_requerida: 'DEMO · Compartir el directorio actualizado', prioridad: 'baja', fecha_respuesta_requerida: gal().minus({ days: 1 }).toISODate() });
  await C.get(`/api/solicitudes/${s1.id}`);
  await C.post(`/api/solicitudes/${s1.id}/acciones`, { accion: 'aceptar' });
  await C.post(`/api/solicitudes/${s1.id}/acciones`, { accion: 'gestion_registrada', comentario: 'DEMO · Llamada a institución ficticia', institucion: 'Institución Ficticia DEMO' });
  await C.post(`/api/solicitudes/${s1.id}/acciones`, { accion: 'estado_actualizado', estado: 'pendiente_respuesta_externa', fecha_seguimiento: gal().toISODate() });
  // Atención abierta (formulario público)
  await pub('POST', '/api/publico/solicitud-atencion', { nombre: nombres[11], identificador: 'DEMO-012', contacto: '0990000012 (ficticio)', preferencia: 'psicologia', acepta_aviso: true });
  await pub('POST', '/api/publico/solicitud-atencion', { nombre: 'Persona Solicitante Ficticia', contacto: 'demo@ejemplo.invalid', preferencia: 'no_sabe', motivo: 'DEMO · texto ficticio', acepta_aviso: true });
  // Debriefing en curso y capacitación programada
  const deb = await C.post('/api/debriefings', { titulo: 'DEMO · Debriefing equipo territorial', facilitador_id: 'betsabe-cordova', grupo_destinatario: 'DEMO · Equipo DECE ficticio', inicio: DateTime.now().plus({ minutes: 1 }).toUTC().toISO(), fin: DateTime.now().plus({ hours: 3 }).toUTC().toISO(), participantes_previstos: 8 });
  await U.betsabe.post(`/api/debriefings/${deb.id}/iniciar`);
  await C.post('/api/capacitaciones', { tema: 'primeros_auxilios_psicologicos', titulo: 'DEMO · Taller de primeros auxilios psicológicos', facilitador_id: 'zally-pamela', publico_objetivo: 'DEMO · Docentes ficticios', institucion: 'Unidad Educativa Ficticia', inicio: proximo([1, 2, 3, 4, 5], 9, 0), duracion_min: 90, participantes_previstos: 25 });
  log('Datos sembrados.');
}
// Estados manuales visibles en la oficina
await U.sofia.post('/api/office/estado', { estado: 'en_pausa' });
await U.maria.post('/api/office/estado', { estado: 'en_documentacion' });
log('Profesionales DEMO conectados (heartbeat activo). Mantener este proceso en ejecución.');
// Renovar sesiones de los bots periódicamente (caducidad por inactividad)
setInterval(() => Object.values(U).forEach((u) => u.get('/api/auth/me').catch(() => {})), 10 * 60_000);
