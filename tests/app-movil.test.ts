import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import webpush from 'web-push';
import type { BuiltApp } from '../server/app';
import { client, crearUsuario, loginCookie, resetDb, testApp } from './helpers';

// El envío real a los servicios push de Apple/Google se sustituye: se comprueba qué saldría y cuándo.
const enviados: { endpoint: string; cuerpo: string }[] = [];
vi.spyOn(webpush, 'sendNotification').mockImplementation(async (sub, cuerpo) => {
  enviados.push({ endpoint: sub.endpoint, cuerpo: String(cuerpo) });
  return { statusCode: 201, body: '', headers: {} };
});

const claves = webpush.generateVAPIDKeys();
const suscripcion = (n: number) => ({
  endpoint: `https://push.example.test/sub/${n}`,
  keys: { p256dh: 'BPu7aB3sXy0kQ9mZ2c1e5f6g7h8i9j0kLmNoPqRsTuVwXyZ01234567890abcdefghijkl', auth: 'q1w2e3r4t5y6u7i8' },
});

describe('App móvil: notificaciones push y caché', () => {
  let sinClaves: BuiltApp;
  let conClaves: BuiltApp;

  beforeAll(async () => {
    await resetDb();
    sinClaves = await testApp(undefined, {});
    await crearUsuario(sinClaves, 'coord@movil.ec', 'coordinacion');
    await crearUsuario(sinClaves, 'gabriel@movil.ec', 'profesional', 'gabriel-ordonez');
    conClaves = await testApp(undefined, { VAPID_PUBLIC_KEY: claves.publicKey, VAPID_PRIVATE_KEY: claves.privateKey });
  });
  afterAll(async () => {
    await sinClaves.close();
    await conClaves.close();
  });

  it('las respuestas de datos llevan Cache-Control: no-store (nada clínico queda en cachés)', async () => {
    const r = await sinClaves.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('sin claves VAPID el push queda desactivado y la app lo indica', async () => {
    const c = client(sinClaves, await loginCookie(sinClaves, 'gabriel@movil.ec'));
    const r = await c.get('/api/push/clave');
    expect(r.body).toEqual({ activo: false, clave: null });
  });

  it('exige sesión y valida la suscripción (solo https)', async () => {
    const anon = await sinClaves.app.inject({ method: 'POST', url: '/api/push/suscribir', payload: suscripcion(1), headers: { 'x-cgreg': '1' } });
    expect(anon.statusCode).toBe(401);
    const c = client(sinClaves, await loginCookie(sinClaves, 'gabriel@movil.ec'));
    const mala = await c.post('/api/push/suscribir', { ...suscripcion(1), endpoint: 'http://inseguro.test/x' });
    expect(mala.status).toBe(400);
  });

  it('guarda y anula la suscripción del dispositivo; otra cuenta no puede anularla', async () => {
    const gabriel = client(sinClaves, await loginCookie(sinClaves, 'gabriel@movil.ec'));
    const coord = client(sinClaves, await loginCookie(sinClaves, 'coord@movil.ec'));
    expect((await gabriel.post('/api/push/suscribir', suscripcion(2))).status).toBe(200);
    const cuenta = async () => (await sinClaves.ctx.db.query(`select count(*)::int as n from ops.push_suscripciones where endpoint = $1`, [suscripcion(2).endpoint])).rows[0].n;
    expect(await cuenta()).toBe(1);
    await coord.post('/api/push/anular', { endpoint: suscripcion(2).endpoint });
    expect(await cuenta()).toBe(1);
    await gabriel.post('/api/push/anular', { endpoint: suscripcion(2).endpoint });
    expect(await cuenta()).toBe(0);
  });

  it('con claves, una notificación real llega al teléfono después del commit, solo con título y enlace', async () => {
    const coord = client(conClaves, await loginCookie(conClaves, 'coord@movil.ec'));
    const gabriel = client(conClaves, await loginCookie(conClaves, 'gabriel@movil.ec'));
    const clave = await coord.get('/api/push/clave');
    expect(clave.body).toEqual({ activo: true, clave: claves.publicKey });
    expect((await coord.post('/api/push/suscribir', suscripcion(3))).status).toBe(200);

    const r = await gabriel.post('/api/solicitudes', {
      tipo: 'gestion_recursos',
      descripcion: 'Descripción con detalle que no debe salir en la pantalla bloqueada',
      accion_requerida: 'Gestionar conectividad (prueba)',
      prioridad: 'alta',
    });
    expect(r.status).toBe(200);

    const t0 = Date.now();
    while (!enviados.some((e) => e.endpoint === suscripcion(3).endpoint) && Date.now() - t0 < 8000) await new Promise((x) => setTimeout(x, 100));
    const aviso = enviados.find((e) => e.endpoint === suscripcion(3).endpoint);
    expect(aviso).toBeTruthy();
    const datos = JSON.parse(aviso!.cuerpo);
    expect(Object.keys(datos).sort()).toEqual(['enlace', 'tag', 'titulo']);
    expect(datos.enlace).toMatch(/^\/solicitudes\//);
    expect(aviso!.cuerpo).not.toContain('pantalla bloqueada');
  });

  it('aviso de prueba: solo a los dispositivos de quien lo pide, sin datos institucionales, y con límite de envíos', async () => {
    const coord = client(conClaves, await loginCookie(conClaves, 'coord@movil.ec'));
    const gabriel = client(conClaves, await loginCookie(conClaves, 'gabriel@movil.ec'));
    expect((await client(sinClaves, await loginCookie(sinClaves, 'gabriel@movil.ec')).post('/api/push/prueba', {})).status).toBe(503);
    await gabriel.post('/api/push/anular', { endpoint: suscripcion(4).endpoint });
    expect((await gabriel.post('/api/push/prueba', {})).status).toBe(409); // sin dispositivos suscritos
    expect((await gabriel.post('/api/push/suscribir', suscripcion(4))).status).toBe(200);
    enviados.length = 0;
    const r = await gabriel.post('/api/push/prueba', {});
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ enviadas: 1, fallidas: 0 });
    expect(enviados.map((e) => e.endpoint)).toEqual([suscripcion(4).endpoint]); // la suscripción de Coordinación (3) no recibe nada
    expect(JSON.parse(enviados[0].cuerpo)).toEqual({ titulo: 'Prueba: las notificaciones funcionan en este dispositivo', enlace: '/inicio', tag: 'prueba' });
    const estados: number[] = [];
    for (let i = 0; i < 6; i++) estados.push((await gabriel.post('/api/push/prueba', {})).status);
    expect(estados).toContain(429);
    expect((await coord.get('/api/push/clave')).status).toBe(200);
  });
});

describe('Consulta pública del estado de una solicitud (sin cuenta)', () => {
  let app: BuiltApp;
  beforeAll(async () => {
    await resetDb();
    app = await testApp(undefined, {});
    await crearUsuario(app, 'coord@estado.ec', 'coordinacion');
  });
  afterAll(async () => {
    await app.close();
  });
  const consultar = (codigo: string, clave: string, ip = '10.0.0.1') =>
    app.app.inject({ method: 'POST', url: '/api/publico/solicitud-estado', payload: { codigo, clave }, remoteAddress: ip });

  it('entrega la clave una sola vez, guarda solo su HMAC y muestra únicamente la etapa', async () => {
    const r = await app.app.inject({
      method: 'POST',
      url: '/api/publico/solicitud-atencion',
      payload: { nombre: 'Persona de prueba', contacto: '0999999999', preferencia: 'psicologia', motivo: 'Motivo privado de prueba', acepta_aviso: true },
      remoteAddress: '10.0.0.9',
    });
    expect(r.statusCode).toBe(200);
    const { codigo, clave } = r.json();
    expect(clave).toMatch(/^[2-9A-HJKMNP-TW-Z]{5}-[2-9A-HJKMNP-TW-Z]{5}$/);
    const fila = (await app.ctx.db.query(`select clave_consulta_hash from ops.solicitudes_atencion where codigo = $1`, [codigo])).rows[0];
    expect(fila.clave_consulta_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(fila)).not.toContain(clave.replace('-', ''));

    const ok = await consultar(codigo.toLowerCase(), clave.toLowerCase().replace('-', ' '));
    expect(ok.statusCode).toBe(200);
    const cuerpo = ok.json();
    expect(Object.keys(cuerpo).sort()).toEqual(['actualizada', 'codigo', 'etapa']);
    expect(cuerpo.etapa).toBe('recibida');
    expect(ok.body).not.toMatch(/Persona de prueba|0999999999|Motivo privado/);
  });

  it('código o clave incorrectos dan la misma respuesta genérica (no revela si el código existe)', async () => {
    const r = await app.app.inject({
      method: 'POST',
      url: '/api/publico/solicitud-atencion',
      payload: { nombre: 'Otra persona de prueba', contacto: '0988888888', preferencia: 'medicina', acepta_aviso: true },
      remoteAddress: '10.0.0.8',
    });
    const { codigo } = r.json();
    const claveMala = await consultar(codigo, 'AAAAA-AAAAA', '10.0.0.2');
    const codigoInexistente = await consultar('SA-9999', 'AAAAA-AAAAA', '10.0.0.2');
    expect(claveMala.statusCode).toBe(404);
    expect(codigoInexistente.statusCode).toBe(404);
    expect(claveMala.json().error).toBe(codigoInexistente.json().error);
  });

  it('las solicitudes registradas internamente no tienen clave pública', async () => {
    const coord = client(app, await loginCookie(app, 'coord@estado.ec'));
    const r = await coord.post('/api/atencion-abierta', { nombre: 'Registro interno de prueba', contacto: '0977777777', preferencia: 'psicologia', acepta_aviso: true });
    expect(r.status).toBe(200);
    expect(r.body.clave).toBeNull();
    expect((await consultar(r.body.codigo, 'AAAAA-AAAAA', '10.0.0.3')).statusCode).toBe(404);
  });

  it('limita los intentos por dirección', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 12; i++) estados.push((await consultar('SA-0001', 'BBBBB-BBBBB', '10.0.0.4')).statusCode);
    expect(estados.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(estados.slice(10)).toEqual([429, 429]);
  });
});
