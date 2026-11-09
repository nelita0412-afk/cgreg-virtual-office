import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { BuiltApp } from '../server/app';
import { client, crearUsuario, insertarServidor, loginCookie, resetDb, testApp } from './helpers';
import { mensajeInicial, normalizarCelularEc } from '../server/teleatencion';

/**
 * Teleatención por WhatsApp (videollamada manual): número autorizado, enlace wa.me con mensaje institucional sin
 * información clínica, estados y registro. Datos y números ficticios (rango de prueba).
 */
const NUMERO = '099 000 0001'; // número ficticio de prueba
let b: BuiltApp;
let apagado: BuiltApp;
type C = ReturnType<typeof client>;
let coord: C, gabriel: C, sofia: C, demetrio: C, autoridad: C;
let s1: string, s2: string, at1: string, at2: string;
const NOMBRE_SERVIDOR = 'Servidora Ficticia Teleatención';

beforeAll(async () => {
  await resetDb();
  b = await testApp(undefined, { CONSENTIMIENTO_CONSTANCIA_PROFESIONAL: 'true', TELEATENCION_WHATSAPP_HABILITADA: 'true' });
  apagado = await testApp(undefined, { CONSENTIMIENTO_CONSTANCIA_PROFESIONAL: 'true' });
  const uid: Record<string, string> = {};
  for (const [k, rol, pid] of [
    ['coord', 'coordinacion', null],
    ['gabriel', 'profesional', 'gabriel-ordonez'],
    ['sofia', 'profesional', 'sofia-guerra'],
    ['demetrio', 'epidemiologia', 'demetrio-magallanes'],
    ['autoridad', 'autoridad', null],
  ] as const)
    uid[k] = await crearUsuario(b, `${k}@tele.ec`, rol, pid);
  [coord, gabriel, sofia, demetrio, autoridad] = await Promise.all(['coord', 'gabriel', 'sofia', 'demetrio', 'autoridad'].map(async (k) => client(b, await loginCookie(b, `${k}@tele.ec`))));
  s1 = await insertarServidor(b, NOMBRE_SERVIDOR, 'PRUEBA:TELE-1');
  s2 = await insertarServidor(b, 'Servidor Ficticio Sin WhatsApp', 'PRUEBA:TELE-2');
  for (const s of [s1, s2]) await coord.post(`/api/servidores/${s}/asignaciones`, { profesional_id: 'gabriel-ordonez' });
  const cita = async (s: string, horas: number) =>
    (await b.ctx.db.query(
      `insert into ops.atenciones (servidor_id, profesional_id, tipo, estado, inicio, fin, duracion_min, creado_por)
       values ($1, 'gabriel-ordonez', 'psicologia', 'programada', now() + make_interval(hours => $3), now() + make_interval(hours => $3, mins => 45), 45, $2) returning id`,
      [s, uid.coord, horas],
    )).rows[0].id as string;
  at1 = await cita(s1, 0);
  at2 = await cita(s2, 3);
});
afterAll(async () => {
  await b.close();
  await apagado.close();
});

describe('Número de WhatsApp autorizado', () => {
  it('normaliza celulares de Ecuador y rechaza lo demás', () => {
    expect(normalizarCelularEc('099 000 0001')).toBe('593990000001');
    expect(normalizarCelularEc('+593 99 000 0001')).toBe('593990000001');
    expect(normalizarCelularEc('02 123 4567')).toBeNull(); // fijo
    expect(normalizarCelularEc('12345')).toBeNull();
  });
  it('solo con autorización expresa, por Coordinación o el profesional asignado', async () => {
    expect((await sofia.put(`/api/servidores/${s1}/whatsapp`, { numero: NUMERO, autorizado: true })).status).toBe(403); // no asignada
    expect((await demetrio.put(`/api/servidores/${s1}/whatsapp`, { numero: NUMERO, autorizado: true })).status).toBe(403);
    expect((await gabriel.put(`/api/servidores/${s1}/whatsapp`, { numero: NUMERO })).status).toBe(400); // sin autorización
    expect((await gabriel.put(`/api/servidores/${s1}/whatsapp`, { numero: '02 123 4567', autorizado: true })).status).toBe(400);
    const ok = await gabriel.put(`/api/servidores/${s1}/whatsapp`, { numero: NUMERO, autorizado: true });
    expect(ok.status).toBe(200);
    expect(ok.body.terminacion).toBe('•••• 0001');
  });
  it('se guarda cifrado y solo se muestra enmascarado', async () => {
    const fila = (await b.ctx.db.query(`select whatsapp_cifrado, whatsapp_ultimos from ops.servidores where id = $1`, [s1])).rows[0];
    expect(fila.whatsapp_cifrado).toMatch(/^v1\./);
    expect(fila.whatsapp_cifrado).not.toContain('990000001');
    const ficha = await coord.get(`/api/servidores/${s1}`);
    expect(ficha.body.servidor.whatsapp).toMatchObject({ autorizado: true, terminacion: '•••• 0001' });
    const todo = JSON.stringify(ficha.body);
    expect(todo).not.toContain('990000001');
    expect(todo).not.toContain('whatsapp_cifrado');
  });
});

describe('Contactar por WhatsApp desde la cita', () => {
  it('solo el profesional responsable; nadie más obtiene el enlace', async () => {
    for (const c of [sofia, coord, demetrio, autoridad]) expect((await c.post(`/api/atenciones/${at1}/whatsapp`, {})).status).toBe(403);
  });
  it('sin número autorizado no hay contacto', async () => {
    const r = await gabriel.post(`/api/atenciones/${at2}/whatsapp`, {});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('sin_whatsapp_autorizado');
  });
  it('sin habilitación institucional el canal no está disponible', async () => {
    const g = client(apagado, await loginCookie(apagado, 'gabriel@tele.ec'));
    const r = await g.post(`/api/atenciones/${at1}/whatsapp`, {});
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('whatsapp_no_habilitado');
    expect((await g.get('/api/teleatencion/config')).body.canales[0]).toMatchObject({ id: 'whatsapp_manual', habilitado: false, llamada_automatica: false });
  });
  it('abre el chat oficial con el número autorizado y un mensaje institucional sin datos clínicos', async () => {
    const r = await gabriel.post(`/api/atenciones/${at1}/whatsapp`, {});
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/wa\.me\/593990000001\?text=/);
    const texto = decodeURIComponent(r.body.url.split('?text=')[1]);
    expect(texto).toBe(r.body.mensaje);
    expect(texto).toContain('Brigada de Apoyo Psicosocial del CGREG');
    expect(texto).toContain('videollamada');
    expect(texto).not.toContain(NOMBRE_SERVIDOR);
    expect(texto).not.toMatch(/diagn|motivo|historia|cl[ií]nic|psicol[oó]g|psiqui|ansiedad|depresi|consumo|riesgo|crisis/i);
  });
  it('la cita pasa a «Contacto iniciado» con fecha, hora y profesional; auditado sin el número completo', async () => {
    const a = (await b.ctx.db.query(`select estado, contacto_iniciado_at, contacto_iniciado_por from ops.atenciones where id = $1`, [at1])).rows[0];
    expect(a.estado).toBe('contacto_iniciado');
    expect(a.contacto_iniciado_at).not.toBeNull();
    const aud = (await b.ctx.db.query(`select detalle from audit.registro where accion = 'teleatencion.contacto_whatsapp' and entidad_id = $1`, [at1])).rows;
    expect(aud).toHaveLength(1);
    expect(aud[0].detalle).toEqual({ canal: 'whatsapp_manual', terminacion: '0001' });
    const hist = (await b.ctx.db.query(`select estado_anterior, estado_nuevo from ops.atencion_historial where atencion_id = $1 order by id`, [at1])).rows;
    expect(hist.at(-1)).toEqual({ estado_anterior: 'programada', estado_nuevo: 'contacto_iniciado' });
  });
  it('Iniciar teleatención registra la modalidad; Coordinación ve el estado, no el contenido clínico', async () => {
    expect((await gabriel.post(`/api/servidores/${s1}/consentimientos`, { tipo: 'teleatencion', base_legitimacion: 'consentimiento', otorgado: true, canal: 'videollamada' })).status).toBe(200);
    const ini = await gabriel.post(`/api/atenciones/${at1}/iniciar`, { modalidad: 'videollamada_whatsapp' });
    expect(ini.status, JSON.stringify(ini.body)).toBe(200);
    expect((await gabriel.post(`/api/atenciones/${at1}/finalizar`, {})).status).toBe(200);
    expect((await gabriel.put(`/api/atenciones/${at1}/nota`, { resumen: 'Evolución ficticia de prueba', recomendaciones: 'Recomendación ficticia', plan: 'Seguimiento en 7 días' })).status).toBe(200);
    const a = (await b.ctx.db.query(`select estado, modalidad, iniciada_at, finalizada_at from ops.atenciones where id = $1`, [at1])).rows[0];
    expect(a).toMatchObject({ estado: 'atendida', modalidad: 'videollamada_whatsapp' });
    expect(a.iniciada_at).not.toBeNull();
    const vista = await coord.get(`/api/atenciones/${at1}`);
    expect(vista.body.atencion.estado).toBe('atendida');
    expect(vista.body.nota ?? null).toBeNull();
    expect(JSON.stringify(vista.body)).not.toContain('Evolución ficticia');
    expect((await gabriel.post(`/api/atenciones/${at1}/whatsapp`, {})).status).toBe(409); // cita cerrada: sin contacto
  });
});

describe('Mensaje institucional', () => {
  it('nunca incluye datos de la persona atendida', () => {
    const m = mensajeInicial('Gabriel', '2026-11-10T15:00:00Z');
    expect(m).toBe('Hola, le saluda Gabriel, de la Brigada de Apoyo Psicosocial del CGREG, a propósito de su cita del 10 de noviembre a las 09:00 (hora de Galápagos). ¿Puede recibir una videollamada por este medio?');
  });
});
