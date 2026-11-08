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
});
