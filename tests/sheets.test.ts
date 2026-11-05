import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SheetsClient, SCOPE } from '../server/sheets/client';
import { loadConfig } from '../server/config';
import type { BuiltApp } from '../server/app';
import { resetDb, testApp, crearUsuario, loginCookie, client } from './helpers';
import { randomBytes } from 'node:crypto';

const HEADERS = ['ID_Valoracion', 'Fecha_Registro', 'ID_Distributivo', 'Servidor', 'Sector_Residencia', 'Situacion_Seguridad', 'Afectacion_Vivienda', 'Evacuacion', 'Integrantes_Hogar', 'Familiares_Afectados', 'Grupos_Atencion_Prioritaria', 'Necesidades_Sociales', 'Necesidad_Atencion_Salud', 'Necesidad_Apoyo_Psicosocial', 'Red_Apoyo_Familiar', 'Solicita_Seguimiento_TS', 'Prioridad_TS', 'Estado_Gestion', 'Canal_Contacto', 'Aviso_Privacidad_Aceptado'];

/** Simula la API de Google y registra cada URL solicitada. */
function fakeGoogle(rows: Record<string, string>[]) {
  const urls: { url: string; method: string }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    urls.push({ url, method: init?.method ?? 'GET' });
    const u = decodeURIComponent(url);
    let body: unknown;
    if (u.includes('fields=sheets.properties')) body = { sheets: [{ properties: { sheetId: 1340025527, title: 'Personal' } }, { properties: { sheetId: 133021335, title: 'Valoraciones' } }] };
    else if (u.includes('/values/') && u.includes('!1:1')) body = { values: [HEADERS] };
    else if (u.includes('values:batchGet')) {
      const ranges = [...new URL(url).searchParams.getAll('ranges')];
      body = {
        valueRanges: ranges.map((r) => {
          const col = /!([A-Z]+)2:/.exec(r)![1];
          const h = HEADERS[col.charCodeAt(0) - 65];
          return { range: r, values: [rows.map((x) => x[h] ?? '')] };
        }),
      };
    } else throw new Error('URL inesperada ' + url);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, urls };
}

class TestClient extends SheetsClient {
  constructor(f: typeof fetch) {
    super(loadConfig({ DATABASE_URL: 'x', DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv), f);
    (this as any).auth = { getAccessToken: async () => 'token-prueba' };
  }
}

let b: BuiltApp;
const g = fakeGoogle([
  { ID_Valoracion: 'V-1', ID_Distributivo: 'D-100', Servidor: 'Persona Uno', Canal_Contacto: 'WhatsApp', Aviso_Privacidad_Aceptado: 'Sí', Necesidad_Atencion_Salud: 'DATO SENSIBLE' },
  { ID_Valoracion: 'V-2', ID_Distributivo: 'D-100', Servidor: 'Persona Uno', Canal_Contacto: 'Llamada' },
  { ID_Valoracion: 'V-3', Servidor: 'Persona Dos', Aviso_Privacidad_Aceptado: 'No' },
  { ID_Valoracion: '', Servidor: 'Sin ID' },
]);

beforeAll(async () => {
  await resetDb();
  b = await testApp(new TestClient(g.f));
});
afterAll(async () => b?.close());

describe('Integración limitada con Google Sheets', () => {
  it('usa un ámbito de solo lectura', () => expect(SCOPE).toBe('https://www.googleapis.com/auth/spreadsheets.readonly'));

  it('lee solo la pestaña autorizada y solo las columnas necesarias', async () => {
    const r = await b.sync.ejecutar();
    expect(r.estado).toBe('ok');
    expect(r.procesados).toBe(3);
    expect(r.errores).toHaveLength(1);
    expect(g.urls.every((x) => x.method === 'GET')).toBe(true);
    const data = g.urls.map((x) => decodeURIComponent(x.url)).filter((u) => !u.includes('fields=sheets.properties'));
    expect(data.every((u) => u.includes("'Valoraciones'!"))).toBe(true);
    expect(data.some((u) => u.includes('Personal'))).toBe(false);
    const batch = data.find((u) => u.includes('batchGet'))!;
    // A=ID_Valoracion, B=Fecha, C=ID_Distributivo, D=Servidor, S=Canal, T=Aviso — nunca M (salud) ni N (psicosocial)
    expect([...batch.matchAll(/!([A-Z]+)2:/g)].map((m) => m[1]).sort()).toEqual(['A', 'B', 'C', 'D', 'S', 'T']);
  });

  it('crea servidores sin duplicarlos y conserva la relación con el registro de origen', async () => {
    const s = (await b.ctx.db.query(`select * from ops.servidores order by nombre`)).rows;
    expect(s.map((x) => x.nombre)).toEqual(['Persona Dos', 'Persona Uno']);
    const f = (await b.ctx.db.query(`select registro_id from ops.registros_fuente order by registro_id`)).rows.map((x) => x.registro_id);
    expect(f).toEqual(['V-1', 'V-2', 'V-3']);
    expect(JSON.stringify(s)).not.toContain('DATO SENSIBLE');
    expect(s.find((x) => x.nombre === 'Persona Dos').aviso_privacidad_aceptado).toBe(false);
  });

  it('expone el estado de sincronización', async () => {
    await crearUsuario(b, 'admin@test.ec', 'admin');
    const c = client(b, await loginCookie(b, 'admin@test.ec'));
    const r = await c.get('/api/sync/estado');
    expect(r.body.estado_conexion).toBe('conectado');
    expect(r.body.ultima_sincronizacion_exitosa).toBeTruthy();
    expect(r.body.ultimo_intento.registros_procesados).toBe(3);
  });
});
