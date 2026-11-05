import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { SheetsClient } from '../server/sheets/client';
import { loadConfig } from '../server/config';
import type { BuiltApp } from '../server/app';
import { client, crearUsuario, loginCookie, resetDb, testApp } from './helpers';

/* ---------- Simulación de Google Sheets (pestañas «Personal» y «Valoraciones») ---------- */
const H_PERSONAL = ['ID_Distributivo', 'Nombres_Apellidos', 'Cargo', 'Regimen_Laboral', 'Unidad_Organica', 'Estado_Distributivo', 'Contacto_Validado', 'Encuesta_Recibida', 'Prioridad_Social', 'Ultimo_Contacto', 'Observacion_Administrativa'];
const H_VALORACIONES = ['ID_Valoracion', 'Fecha_Registro', 'ID_Distributivo', 'Servidor', 'Sector_Residencia', 'Situacion_Seguridad', 'Afectacion_Vivienda', 'Evacuacion', 'Integrantes_Hogar', 'Familiares_Afectados', 'Grupos_Atencion_Prioritaria', 'Necesidades_Sociales', 'Necesidad_Atencion_Salud', 'Necesidad_Apoyo_Psicosocial', 'Red_Apoyo_Familiar', 'Solicita_Seguimiento_TS', 'Prioridad_TS', 'Estado_Gestion', 'Canal_Contacto', 'Aviso_Privacidad_Aceptado'];

const fuente = {
  personal: [
    { ID_Distributivo: 'D-1', Nombres_Apellidos: 'Ana María Torres Vega', Cargo: 'Analista', Unidad_Organica: 'DIRECCIÓN DISTRITAL SANTA CRUZ', Estado_Distributivo: 'ACTIVO', Contacto_Validado: 'Sí', Observacion_Administrativa: 'NO DEBE IMPORTARSE' },
    { ID_Distributivo: 'D-2', Nombres_Apellidos: 'Luis Alberto Pérez Mora', Unidad_Organica: 'DIRECCIÓN DISTRITAL SANTA CRUZ', Estado_Distributivo: 'NOMBRAMIENTO PROVISIONAL', Contacto_Validado: 'No' },
    { ID_Distributivo: 'D-3', Nombres_Apellidos: 'Persona Otra Isla', Unidad_Organica: 'DIRECCIÓN DISTRITAL SAN CRISTÓBAL', Estado_Distributivo: 'ACTIVO' },
    { ID_Distributivo: 'D-4', Nombres_Apellidos: 'Carla Beatriz Ruiz León', Unidad_Organica: 'Dirección Distrital Santa Cruz', Estado_Distributivo: 'ACTIVO', Contacto_Validado: '0991234567' },
  ] as Record<string, string>[],
  valoraciones: [
    { ID_Valoracion: 'V-1', Fecha_Registro: '14/02/2026', ID_Distributivo: 'D-1', Servidor: 'Ana María Torres Vega', Necesidad_Atencion_Salud: 'SENSIBLE-SALUD', Canal_Contacto: 'WhatsApp', Aviso_Privacidad_Aceptado: 'Sí', Clasificacion_Riesgo: 'ALTO' },
    { ID_Valoracion: 'V-2', Fecha_Registro: '2026-02-15', ID_Distributivo: 'D-3', Servidor: 'Persona Otra Isla', Clasificacion_Riesgo: 'ALTO' },
    { ID_Valoracion: 'V-3', Fecha_Registro: '2026-02-16', Servidor: 'Sin identificador' },
  ] as Record<string, string>[],
  conColumnaRiesgo: false,
};

const urls: string[] = [];
function headersDe(tab: string) {
  return tab === 'Personal' ? H_PERSONAL : fuente.conColumnaRiesgo ? [...H_VALORACIONES, 'Clasificacion_Riesgo'] : H_VALORACIONES;
}
const letraAIndice = (l: string) => [...l].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const fakeFetch = (async (url: string) => {
  urls.push(decodeURIComponent(url));
  const u = decodeURIComponent(url);
  let body: unknown;
  if (u.includes('fields=sheets.properties')) {
    body = { sheets: [[1340025527, 'Personal'], [133021335, 'Valoraciones'], [1536954505, 'Seguimiento'], [1439082756, 'Dashboard'], [1553298609, 'Catalogos']].map(([sheetId, title]) => ({ properties: { sheetId, title } })) };
  } else if (u.includes('!1:1')) {
    const tab = /'([^']+)'!1:1/.exec(u)![1];
    body = { values: [headersDe(tab)] };
  } else if (u.includes('values:batchGet')) {
    const ranges = new URL(url).searchParams.getAll('ranges');
    body = {
      valueRanges: ranges.map((r) => {
        const [, tab, col] = /'([^']+)'!([A-Z]+)2:/.exec(r)!;
        const h = headersDe(tab)[letraAIndice(col)];
        const rows = tab === 'Personal' ? fuente.personal : fuente.valoraciones;
        return { range: r, values: [rows.map((x) => x[h] ?? '')] };
      }),
    };
  } else throw new Error('URL inesperada ' + url);
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

class FakeSheets extends SheetsClient {
  constructor() {
    super(loadConfig({ DATABASE_URL: 'x', DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv), fakeFetch);
    (this as any).auth = { getAccessToken: async () => 'token-prueba' };
  }
}

/* ---------- utilidades ---------- */
let b: BuiltApp;
type C = ReturnType<typeof client>;
let coord: C, admin: C, gabriel: C, sofia: C, demetrio: C, autoridad: C, auditor: C, ts: C;
const sid: Record<string, string> = {};
const publico = (method: 'GET' | 'POST', url: string, payload?: unknown, remoteAddress = '127.0.0.1') =>
  b.app.inject({ method, url, payload: payload as any, remoteAddress }).then((r) => ({ status: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
const proximo = (dias: number[], hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  let d = DateTime.now().setZone('Pacific/Galapagos').plus({ days: 1 }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
  while (!dias.includes(d.weekday)) d = d.plus({ days: 1 });
  return d.toUTC().toISO()!;
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\nFIRMA-MANUSCRITA-DE-PRUEBA\n%%EOF');
const subir = (c: string, id: string, data: Buffer, ct = 'application/pdf', nombre = 'consentimiento.pdf') =>
  b.app.inject({ method: 'POST', url: `/api/consentimientos/${id}/documento?nombre=${nombre}`, payload: data, headers: { cookie: c, 'x-cgreg': '1', 'content-type': ct } });
const cookies: Record<string, string> = {};

beforeAll(async () => {
  await resetDb();
  // Configuración por defecto (constancia profesional NO aceptada) + pestaña maestra habilitada.
  b = await testApp(new FakeSheets(), { SHEETS_MAESTRA_GID: '1340025527' });
  for (const [k, rol, pid] of [
    ['coord', 'coordinacion', null],
    ['admin', 'admin', null],
    ['gabriel', 'profesional', 'gabriel-ordonez'],
    ['sofia', 'profesional', 'sofia-guerra'],
    ['demetrio', 'profesional', 'demetrio-magallanes'],
    ['autoridad', 'autoridad', null],
    ['auditor', 'auditoria', null],
  ] as const) {
    await crearUsuario(b, `${k}@amp.ec`, rol, pid);
    cookies[k] = await loginCookie(b, `${k}@amp.ec`);
  }
  [coord, admin, gabriel, sofia, demetrio, autoridad, auditor] = ['coord', 'admin', 'gabriel', 'sofia', 'demetrio', 'autoridad', 'auditor'].map((k) => client(b, cookies[k]));
});
afterAll(async () => b?.close());

describe('1. Base maestra de servidores (pestaña «Personal»)', () => {
  it('lee solo «Personal» y «Valoraciones», solo GET y solo las columnas necesarias', async () => {
    const r = await b.sync.ejecutar();
    expect(r.estado, r.mensaje).toBe('ok');
    const datos = urls.filter((x) => !x.includes('fields=sheets.properties'));
    expect(datos.every((x) => x.includes("'Personal'!") || x.includes("'Valoraciones'!"))).toBe(true);
    expect(datos.some((x) => /Seguimiento|Dashboard|Catalogos/.test(x))).toBe(false);
    const cols = (tab: string) => [...new Set(datos.filter((x) => x.includes('batchGet')).flatMap((x) => [...x.matchAll(new RegExp(`'${tab}'!([A-Z]+)2:`, 'g'))].map((m) => m[1])))].sort();
    // Personal: ID, nombre, unidad, estado, contacto validado — nunca Cargo, Régimen, Prioridad social, Observación…
    expect(cols('Personal')).toEqual(['A', 'B', 'E', 'F', 'G']);
    // Valoraciones: ID, fecha, ID_Distributivo, canal, aviso — nunca nombre ni respuestas (M = salud, N = psicosocial).
    expect(cols('Valoraciones')).toEqual(['A', 'B', 'C', 'S', 'T']);
  });

  it('filtra Santa Cruz por la unidad registrada y no almacena registros de otras islas', async () => {
    const s = (await b.ctx.db.query(`select * from ops.servidores order by codigo_institucional`)).rows;
    expect(s.map((x) => x.codigo_institucional)).toEqual(['D-1', 'D-2', 'D-4']);
    expect(JSON.stringify(s)).not.toContain('Otra Isla');
    expect(JSON.stringify(s)).not.toContain('NO DEBE IMPORTARSE');
    expect(s.every((x) => x.en_base_maestra && x.en_santa_cruz && x.verificacion === 'verificado_maestra')).toBe(true);
    expect(s.find((x) => x.codigo_institucional === 'D-2').estado_servidor).toBe('NOMBRAMIENTO PROVISIONAL');
    // «Contacto_Validado» con un valor que no es Sí/No (p. ej. un teléfono) se descarta.
    expect(s.find((x) => x.codigo_institucional === 'D-4').contacto_validado).toBeNull();
    expect(JSON.stringify(s)).not.toContain('0991234567');
    for (const x of s) sid[x.codigo_institucional] = x.id;
  });

  it('vincula valoraciones por ID_Distributivo (no por nombre) y no importa datos sensibles', async () => {
    const det = (await b.ctx.db.query(`select detalle from ops.sync_ejecuciones where estado = 'ok' order by id desc limit 1`)).rows[0].detalle;
    expect(det).toMatchObject({ santa_cruz: 3, excluidos_fuera_santa_cruz: 1, valoraciones_vinculadas: 1, valoraciones_sin_vinculo: 2, riesgo_configurado: false });
    const v1 = (await b.ctx.db.query(`select * from ops.registros_fuente where registro_id = 'V-1'`)).rows[0];
    expect(v1.servidor_id).toBe(sid['D-1']);
    const todo = JSON.stringify((await b.ctx.db.query(`select * from ops.registros_fuente`)).rows);
    expect(todo).not.toContain('SENSIBLE-SALUD');
    // Sin columna explícita de riesgo: no se importa ni se infiere ninguna clasificación.
    expect((await b.ctx.db.query(`select count(*)::int as n from clinical.clasificaciones_riesgo`)).rows[0].n).toBe(0);
    const est = await admin.get('/api/sync/estado');
    expect(est.body.riesgo.configurado).toBe(false);
    expect(est.body.fuentes.modo).toBe('base_maestra');
  });
});

describe('2. Clasificación de riesgo alto (solo si la institución confirma la columna)', () => {
  it('con la columna configurada importa «ALTO» solo de servidores vinculados', async () => {
    fuente.conColumnaRiesgo = true;
    b.ctx.cfg.SHEETS_RIESGO_COLUMNA = 'Clasificacion_Riesgo';
    const r = await b.sync.ejecutar();
    expect(r.estado, r.mensaje).toBe('ok');
    expect(r.detalle).toMatchObject({ riesgo_alto: 1, riesgo_alto_sin_vinculo: 1 });
    const c = (await b.ctx.db.query(`select * from clinical.clasificaciones_riesgo`)).rows;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ servidor_id: sid['D-1'], fuente: 'matriz_valoraciones', registro_fuente_id: 'V-1', fecha_valoracion: '2026-02-14', vigente: true });
  });
  it('si el valor cambia en la matriz, la clasificación se retira sin borrarse', async () => {
    fuente.valoraciones[0].Clasificacion_Riesgo = 'MEDIO';
    await b.sync.ejecutar();
    expect((await b.ctx.db.query(`select vigente, motivo_retiro from clinical.clasificaciones_riesgo`)).rows[0]).toMatchObject({ vigente: false });
    fuente.valoraciones[0].Clasificacion_Riesgo = 'ALTO';
    await b.sync.ejecutar();
    expect((await b.ctx.db.query(`select vigente from clinical.clasificaciones_riesgo`)).rows[0].vigente).toBe(true);
  });
});

describe('3A. Atención prioritaria', () => {
  it('Coordinación ve la cola operativa sin el detalle clínico de la clasificación', async () => {
    const r = await coord.get('/api/atencion-prioritaria');
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.id)).toEqual([sid['D-1']]);
    expect(r.body[0].clasificacion).toBeUndefined();
    expect((await coord.get(`/api/servidores/${sid['D-1']}`)).body.clasificaciones).toBeUndefined();
  });
  it('un profesional no asignado no ve la condición; el asignado sí, con detalle', async () => {
    expect((await gabriel.get('/api/atencion-prioritaria')).body).toHaveLength(0);
    expect((await gabriel.get(`/api/servidores/${sid['D-1']}`)).status).toBe(403);
    expect((await coord.post(`/api/servidores/${sid['D-1']}/asignaciones`, { profesional_id: 'gabriel-ordonez' })).status).toBe(200);
    const r = await gabriel.get('/api/atencion-prioritaria');
    expect(r.body[0].clasificacion[0]).toMatchObject({ fuente: 'matriz_valoraciones', fecha_valoracion: '2026-02-14' });
  });
  it('la autoridad solo accede a conteos agregados', async () => {
    expect((await autoridad.get('/api/atencion-prioritaria')).status).toBe(403);
    const ind = await autoridad.get('/api/dashboard/indicadores');
    expect(ind.body.prioritaria.identificados).toBe(1);
    expect(JSON.stringify(ind.body)).not.toContain('Torres');
  });
  it('un profesional asignado registra una clasificación profesional (sin algoritmos) y puede retirarla', async () => {
    await coord.post(`/api/servidores/${sid['D-2']}/asignaciones`, { profesional_id: 'gabriel-ordonez' });
    expect((await gabriel.post(`/api/servidores/${sid['D-2']}/riesgo`, { fecha_valoracion: '2026-11-01', requiere_seguimiento: true })).status).toBe(400); // falta confirmación
    const r = await gabriel.post(`/api/servidores/${sid['D-2']}/riesgo`, { fecha_valoracion: '2026-11-01', requiere_seguimiento: true, confirmacion_profesional: true });
    expect(r.status).toBe(200);
    expect((await gabriel.post(`/api/servidores/${sid['D-2']}/riesgo`, { fecha_valoracion: '2026-11-01', requiere_seguimiento: true, confirmacion_profesional: true })).status).toBe(409);
    expect((await sofia.post(`/api/servidores/${sid['D-2']}/riesgo`, { fecha_valoracion: '2026-11-01', requiere_seguimiento: true, confirmacion_profesional: true })).status).toBe(403);
    expect((await gabriel.post(`/api/riesgo/${r.body.id}/retirar`, { motivo: 'Reevaluación profesional' })).status).toBe(200);
    expect((await b.ctx.db.query(`select count(*)::int as n from clinical.clasificaciones_riesgo where id = $1`, [r.body.id])).rows[0].n).toBe(1);
  });
});

let saDesconocida: string;
describe('3B. Atención abierta (sin valoración previa)', () => {
  it('cualquier persona solicita sin cuenta; verificación automática con ID + nombre', async () => {
    const r = await publico('POST', '/api/publico/solicitud-atencion', { nombre: 'Carla Ruiz', identificador: 'D-4', contacto: '0990000000', preferencia: 'psicologia', motivo: 'Motivo voluntario confidencial', acepta_aviso: true });
    expect(r.status).toBe(200);
    expect(r.body.codigo).toMatch(/^SA-/);
    const row = (await b.ctx.db.query(`select * from ops.solicitudes_atencion where codigo = $1`, [r.body.codigo])).rows[0];
    expect(row).toMatchObject({ verificacion: 'verificado_maestra', servidor_id: sid['D-4'] });
    expect(row.motivo_cifrado).toMatch(/^v1\./);
  });
  it('si no aparece en la base, queda pendiente de verificación (no se rechaza) y la respuesta es idéntica', async () => {
    const r = await publico('POST', '/api/publico/solicitud-atencion', { nombre: 'Jorge Nuevo Ingreso', contacto: 'jorge@correo.ec', preferencia: 'no_sabe', acepta_aviso: true });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['codigo', 'mensaje']);
    const row = (await b.ctx.db.query(`select * from ops.solicitudes_atencion where codigo = $1`, [r.body.codigo])).rows[0];
    expect(row).toMatchObject({ verificacion: 'pendiente_verificacion', servidor_id: null, estado: 'pendiente_asignacion' });
    saDesconocida = row.id;
  });
  it('rechaza envíos sin aceptación del aviso, ignora el campo trampa y limita la frecuencia', async () => {
    expect((await publico('POST', '/api/publico/solicitud-atencion', { nombre: 'Sin Aviso Persona', contacto: '0990000001', preferencia: 'psicologia' })).status).toBe(400);
    const antes = (await b.ctx.db.query(`select count(*)::int as n from ops.solicitudes_atencion`)).rows[0].n;
    expect((await publico('POST', '/api/publico/solicitud-atencion', { nombre: 'Bot Bot', contacto: '000000', preferencia: 'psicologia', acepta_aviso: true, sitio_web: 'http://spam' })).status).toBe(200);
    expect((await b.ctx.db.query(`select count(*)::int as n from ops.solicitudes_atencion`)).rows[0].n).toBe(antes);
    const res: number[] = [];
    for (let i = 0; i < 6; i++) res.push((await publico('POST', '/api/publico/solicitud-atencion', {}, '10.5.5.5')).status);
    expect(res.at(-1)).toBe(429);
  });
  it('Coordinación ve contacto y verificación, no el motivo; asigna y se crea el registro provisional', async () => {
    const l = await coord.get('/api/atencion-abierta');
    const x = l.body.find((s: any) => s.id === saDesconocida);
    expect(x.contacto).toBe('jorge@correo.ec');
    expect(x.motivo).toBeUndefined();
    const a = await coord.post(`/api/atencion-abierta/${saDesconocida}/asignar`, { profesional_id: 'sofia-guerra' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const s = (await b.ctx.db.query(`select * from ops.servidores where id = $1`, [a.body.servidor_id])).rows[0];
    expect(s).toMatchObject({ origen: 'solicitud_abierta', verificacion: 'pendiente_verificacion', en_base_maestra: false });
    expect((await sofia.get(`/api/atencion-abierta/${saDesconocida}`)).body.solicitud.estado).toBe('asignada');
    expect((await gabriel.get(`/api/atencion-abierta/${saDesconocida}`)).status).toBe(403);
    // «No verificable» deja constancia pero no bloquea la atención
    expect((await coord.post(`/api/atencion-abierta/${saDesconocida}/verificar`, { resultado: 'no_verificable', nota: 'Sin registro en Talento Humano aún' })).status).toBe(200);
    const inicio = proximo([2, 4], '17:00');
    const p = await coord.post('/api/agenda/citas', { servidor_id: a.body.servidor_id, profesional_id: 'sofia-guerra', inicio, duracion_min: 45, atencion_id: a.body.atencion_id });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect((await sofia.get(`/api/atencion-abierta/${saDesconocida}`)).body.solicitud.estado).toBe('programada');
  });
});

let atP1: string;
let kElectronico: string;
describe('6–8. Consentimiento informado', () => {
  it('ni la constancia previa ni el aviso de privacidad de la matriz habilitan la atención', async () => {
    const s = (await b.ctx.db.query(`select aviso_privacidad_aceptado from ops.servidores where id = $1`, [sid['D-1']])).rows[0];
    expect(s.aviso_privacidad_aceptado).toBe(true);
    await gabriel.post(`/api/servidores/${sid['D-1']}/consentimientos`, { tipo: 'teleatencion', base_legitimacion: 'consentimiento', otorgado: true });
    atP1 = (await coord.post('/api/atenciones/pendiente', { servidor_id: sid['D-1'], profesional_id: 'gabriel-ordonez' })).body.id;
    const r = await gabriel.post(`/api/atenciones/${atP1}/iniciar`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('sin_consentimiento');
  });
  it('los formatos en borrador se descargan con marca «no válido» pero no permiten consentimientos', async () => {
    const pl = (await gabriel.get('/api/consentimientos/plantillas')).body;
    expect(pl.every((p: any) => p.estado === 'borrador')).toBe(true);
    const psico = pl.find((p: any) => p.servicio === 'psicologia');
    const pdf = await b.app.inject({ method: 'GET', url: `/api/consentimientos/plantillas/${psico.id}/pdf?servidor_id=${sid['D-1']}`, headers: { cookie: cookies.gabriel } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.headers['content-disposition']).toContain('BORRADOR');
    const r = await gabriel.post(`/api/servidores/${sid['D-1']}/consentimientos/solicitar`, { modalidad: 'electronica', servicio: 'psicologia' });
    expect(r.body.code).toBe('sin_plantilla_aprobada');
    // Solo el administrador institucional aprueba (con referencia del acto de aprobación).
    expect((await gabriel.post(`/api/consentimientos/plantillas/${psico.id}/aprobar`, { referencia: 'x' })).status).toBe(403);
    expect((await admin.post(`/api/consentimientos/plantillas/${psico.id}/aprobar`, { referencia: 'Memorando CGREG-2026-001' })).status).toBe(200);
  });
  it('aceptación electrónica: enlace de un solo uso, verificación de identidad y evidencia', async () => {
    const r = await gabriel.post(`/api/servidores/${sid['D-1']}/consentimientos/solicitar`, { modalidad: 'electronica', servicio: 'psicologia' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    kElectronico = r.body.id;
    const token = r.body.enlace.split('/').pop();
    expect((await b.ctx.db.query(`select count(*)::int as n from ops.consentimiento_tokens where token_hash = $1`, [token])).rows[0].n).toBe(0); // solo hash
    const g = await publico('GET', `/api/publico/consentimiento/${token}`);
    expect(g.status).toBe(200);
    expect(JSON.stringify(g.body.secciones)).toContain('Ana María Torres Vega');
    expect((await publico('POST', `/api/publico/consentimiento/${token}`, { nombre_completo: 'Ana María Torres Vega', identificador: 'D-9', lectura_confirmada: true, acepta: true })).status).toBe(400);
    const ok = await publico('POST', `/api/publico/consentimiento/${token}`, { nombre_completo: 'Ana Torres', identificador: 'D-1', lectura_confirmada: true, acepta: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await publico('GET', `/api/publico/consentimiento/${token}`)).status).toBe(410);
    const k = (await gabriel.get(`/api/consentimientos/${kElectronico}`)).body;
    expect(k.consentimiento.estado).toBe('pendiente_validacion');
    expect(k.consentimiento.evidencia.hash_documento).toMatch(/^[a-f0-9]{64}$/);
    expect((await gabriel.post(`/api/consentimientos/${kElectronico}/validar`, { resultado: 'validado' })).status).toBe(200);
    expect((await gabriel.post(`/api/atenciones/${atP1}/iniciar`)).status).toBe(200);
  });

  let kManual: string;
  it('firmado manualmente: carga cifrada, validación, corrección y versiones del documento', async () => {
    // D-2 necesita su propio consentimiento (aplica por servidor y servicio)
    kManual = (await gabriel.post(`/api/servidores/${sid['D-2']}/consentimientos/solicitar`, { modalidad: 'firmada_manual', servicio: 'psicologia' })).body.id;
    expect((await subir(cookies.gabriel, kManual, Buffer.from('MZ ejecutable'), 'application/octet-stream', 'x.exe')).statusCode).toBe(415);
    const up = await subir(cookies.gabriel, kManual, PDF);
    expect(up.statusCode, up.body).toBe(200);
    const doc = (await b.ctx.db.query(`select contenido_cifrado, sha256, mime from clinical.documentos where id = $1`, [up.json().documento_id])).rows[0];
    expect(doc.mime).toBe('application/pdf');
    expect(Buffer.from(doc.contenido_cifrado).includes(Buffer.from('FIRMA-MANUSCRITA'))).toBe(false);
    expect((await gabriel.post(`/api/consentimientos/${kManual}/validar`, { resultado: 'validado' })).status).toBe(409); // aún «cargado»
    await gabriel.post(`/api/consentimientos/${kManual}/enviar-validacion`);
    expect((await gabriel.post(`/api/consentimientos/${kManual}/validar`, { resultado: 'requiere_correccion' })).status).toBe(400);
    expect((await gabriel.post(`/api/consentimientos/${kManual}/validar`, { resultado: 'requiere_correccion', observaciones: 'Falta la fecha' })).status).toBe(200);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('IMAGEN')]);
    expect((await subir(cookies.gabriel, kManual, png, 'image/png', 'foto.png')).statusCode).toBe(200);
    await gabriel.post(`/api/consentimientos/${kManual}/enviar-validacion`);
    expect((await gabriel.post(`/api/consentimientos/${kManual}/validar`, { resultado: 'validado' })).status).toBe(200);
    const det = (await gabriel.get(`/api/consentimientos/${kManual}`)).body;
    expect(det.historial.filter((h: any) => h.accion === 'documento_cargado')).toHaveLength(2);
    expect(det.historial.map((h: any) => h.estado_nuevo)).toEqual(['pendiente', 'cargado', 'pendiente_validacion', 'requiere_correccion', 'cargado', 'pendiente_validacion', 'validado']);
    const dl = await b.app.inject({ method: 'GET', url: `/api/consentimientos/${kManual}/documento`, headers: { cookie: cookies.gabriel } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['cache-control']).toBe('no-store');
    expect(dl.rawPayload.equals(png)).toBe(true);
    expect((await demetrio.get(`/api/consentimientos/${kManual}/documento`)).status).toBe(403);
  });
  it('la revocación conserva los registros, bloquea la atención ordinaria y no admite borrado', async () => {
    expect((await gabriel.post(`/api/consentimientos/${kManual}/revocar`, { motivo: 'La persona retira su consentimiento' })).status).toBe(200);
    const at = (await coord.post('/api/atenciones/pendiente', { servidor_id: sid['D-2'], profesional_id: 'gabriel-ordonez' })).body.id;
    // gabriel tiene una atención en curso (D-1): se finaliza antes
    await gabriel.post(`/api/atenciones/${atP1}/finalizar`);
    expect((await gabriel.post(`/api/atenciones/${at}/iniciar`)).body.code).toBe('sin_consentimiento');
    await expect(b.ctx.db.query(`delete from ops.consentimientos where id = $1`, [kManual])).rejects.toThrow(/inmutable/);
    await expect(b.ctx.db.query(`delete from clinical.documentos`)).rejects.toThrow(/inmutable/);
    // Urgencia: el trámite no retrasa la atención; queda justificado, auditado y notificado.
    expect((await gabriel.post(`/api/atenciones/${at}/iniciar`, { urgente: true })).status).toBe(400);
    const u = await gabriel.post(`/api/atenciones/${at}/iniciar`, { urgente: true, justificacion: 'Crisis aguda con riesgo, protocolo de urgencia' });
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect((await b.ctx.db.query(`select inicio_urgente from ops.atenciones where id = $1`, [at])).rows[0].inicio_urgente).toBe(true);
    expect((await coord.get('/api/notificaciones')).body.items.some((n: any) => n.titulo.includes('protocolo de urgencia'))).toBe(true);
    await gabriel.put(`/api/atenciones/${at}/nota`, { resumen: 'Contención en crisis (restringida)', confidencialidad: 'restringida' });
    await gabriel.post(`/api/atenciones/${at}/finalizar`);
  });
});

describe('4–5. Historia clínica electrónica y continuidad asistencial', () => {
  let expId: string;
  it('cada atención abre el expediente único y una entrada cronológica', async () => {
    const x = (await b.ctx.db.query(`select * from clinical.expedientes where servidor_id = $1`, [sid['D-1']])).rows[0];
    expect(x.codigo).toMatch(/^HC-\d{5}$/);
    expect(x.profesional_responsable_id).toBe('gabriel-ordonez');
    expId = x.id;
    const e = (await b.ctx.db.query(`select * from clinical.entradas where atencion_id = $1`, [atP1])).rows[0];
    expect(e).toMatchObject({ area: 'psicologia', estado: 'borrador', autor_profesional_id: 'gabriel-ordonez' });
  });
  it('cada guardado crea una versión; tras validar, la entrada es inmutable y solo admite adendas', async () => {
    await gabriel.put(`/api/atenciones/${atP1}/nota`, { resumen: 'Primera sesión', motivo_consulta: 'Ansiedad tras la emergencia', evaluacion: 'Eval', intervencion: 'PAP', evolucion: 'Estable', plan: 'Seguimiento semanal', recomendaciones: 'Rutina de sueño' });
    await gabriel.put(`/api/atenciones/${atP1}/nota`, { resumen: 'Primera sesión (corregido)', plan: 'Seguimiento semanal' });
    const v = (await b.ctx.db.query(`select count(*)::int as n from clinical.entrada_versiones v join clinical.entradas e on e.id = v.entrada_id where e.atencion_id = $1`, [atP1])).rows[0].n;
    expect(v).toBe(3);
    const val = await gabriel.post(`/api/atenciones/${atP1}/nota/validar`);
    expect(val.status, JSON.stringify(val.body)).toBe(200);
    expect(val.body.hash).toMatch(/^[a-f0-9]{64}$/);
    const r = await gabriel.put(`/api/atenciones/${atP1}/nota`, { resumen: 'Cambio silencioso' });
    expect(r.body.code).toBe('entrada_validada');
    const eid = (await b.ctx.db.query(`select id from clinical.entradas where atencion_id = $1`, [atP1])).rows[0].id;
    expect((await gabriel.post(`/api/expedientes/entradas/${eid}/adendas`, { contenido: 'Se aclara la fecha de inicio de síntomas.', motivo: 'Aclaración' })).status).toBe(200);
    await expect(b.ctx.db.query(`update clinical.entradas set contenido_cifrado = 'x' where id = $1`, [eid])).rejects.toThrow(/inmutable/);
    await expect(b.ctx.db.query(`delete from clinical.entradas where id = $1`, [eid])).rejects.toThrow(/inmutable/);
    await expect(b.ctx.db.query(`update ops.atenciones set estado = 'programada' where id = $1`, [atP1])).rejects.toThrow(/cerrada/);
    await expect(b.ctx.db.query(`delete from ops.atenciones where id = $1`, [atP1])).rejects.toThrow(/no se eliminan/);
  });
  it('secciones por área con control de versiones; cada especialidad escribe solo en la suya', async () => {
    expect((await gabriel.post(`/api/expedientes/${expId}/secciones`, { area: 'psicologia', seccion: 'antecedentes', contenido: 'Sin antecedentes relevantes' })).status).toBe(200);
    expect((await gabriel.post(`/api/expedientes/${expId}/secciones`, { area: 'psicologia', seccion: 'antecedentes', contenido: 'Antecedente de duelo' })).status).toBe(400);
    expect((await gabriel.post(`/api/expedientes/${expId}/secciones`, { area: 'psicologia', seccion: 'antecedentes', contenido: 'Antecedente de duelo', motivo_cambio: 'Nueva información' })).body.version).toBe(2);
    expect((await gabriel.get(`/api/expedientes/${expId}/secciones/psicologia/antecedentes`)).body).toHaveLength(2);
    await coord.post(`/api/servidores/${sid['D-1']}/asignaciones`, { profesional_id: 'demetrio-magallanes' });
    expect((await demetrio.post(`/api/expedientes/${expId}/secciones`, { area: 'psicologia', seccion: 'antecedentes', contenido: 'x', motivo_cambio: 'x' })).status).toBe(403);
    expect((await demetrio.post(`/api/expedientes/${expId}/secciones`, { area: 'medicina', seccion: 'antecedentes', contenido: 'Hipertensión controlada' })).status).toBe(200);
  });
  it('continuidad: el equipo clínico asignado lee lo necesario; las entradas restringidas no', async () => {
    const r = await demetrio.get(`/api/servidores/${sid['D-1']}/expediente`);
    expect(r.body.nivel).toBe('clinico');
    expect(r.body.entradas[0].contenido.resumen).toBe('Primera sesión (corregido)');
    expect(r.body.entradas[0].adendas).toHaveLength(1);
    expect(r.body.secciones.map((s: any) => s.area).sort()).toEqual(['medicina', 'psicologia']);
    await coord.post(`/api/servidores/${sid['D-2']}/asignaciones`, { profesional_id: 'demetrio-magallanes' });
    const r2 = await demetrio.get(`/api/servidores/${sid['D-2']}/expediente`);
    expect(r2.body.entradas[0]).toMatchObject({ restringida: true, contenido: null });
    expect(JSON.stringify(r2.body)).not.toContain('Contención en crisis');
    expect((await sofia.get(`/api/servidores/${sid['D-1']}/expediente`)).status).toBe(403);
  });
  it('Coordinación: acceso administrativo sin notas clínicas', async () => {
    const r = await coord.get(`/api/servidores/${sid['D-1']}/expediente`);
    expect(r.body.nivel).toBe('administrativo');
    expect(r.body.entradas).toBeUndefined();
    expect(r.body.secciones).toBeUndefined();
    expect(r.body.expediente.codigo).toMatch(/^HC-/);
    const txt = JSON.stringify(r.body);
    expect(txt).not.toContain('Primera sesión');
    expect(txt).not.toContain('duelo');
  });
  it('Trabajo Social: sus registros separados, sin acceso a notas clínicas', async () => {
    const nu = await admin.post('/api/admin/usuarios', { email: 'ts@amp.ec', nombre: 'Trabajadora Social Prueba', rol: 'trabajo_social' });
    expect(nu.status, JSON.stringify(nu.body)).toBe(200);
    const login = await b.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ts@amp.ec', password: nu.body.password_temporal } });
    const ck = `cgreg_sid=${login.cookies.find((c) => c.name === 'cgreg_sid')!.value}`;
    ts = client(b, ck);
    expect((await ts.post('/api/auth/password', { actual: nu.body.password_temporal, nueva: 'TrabajoSocial2026' })).status).toBe(200);
    expect((await ts.get(`/api/servidores/${sid['D-1']}/expediente`)).status).toBe(403);
    const pid = (await b.ctx.db.query(`select profesional_id from core.usuarios where email = 'ts@amp.ec'`)).rows[0].profesional_id;
    expect((await coord.post(`/api/servidores/${sid['D-1']}/asignaciones`, { profesional_id: pid })).status).toBe(200);
    expect((await ts.post(`/api/servidores/${sid['D-1']}/intervenciones-sociales`, { fecha: new Date().toISOString(), tipo: 'gestion_recursos', contenido: 'Gestión de kit de vivienda temporal' })).status).toBe(200);
    const r = await ts.get(`/api/servidores/${sid['D-1']}/expediente`);
    expect(r.body.nivel).toBe('social');
    expect(r.body.intervenciones_sociales[0].contenido).toContain('vivienda temporal');
    expect(r.body.entradas).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('Primera sesión');
    expect((await gabriel.get(`/api/servidores/${sid['D-1']}/expediente`)).body.intervenciones_sociales).toHaveLength(1);
    // Trabajo Social no aparece en la oficina virtual ni cuenta entre los 8 profesionales.
    const snap = (await coord.get('/api/office/presencia')).body;
    expect(snap.some((p: any) => p.profesional_id === pid)).toBe(false);
    expect((await coord.get('/api/profesionales')).body.filter((p: any) => p.es_teleatencion)).toHaveLength(8);
  });
  it('cada acceso y modificación queda auditado', async () => {
    const r = await auditor.get('/api/auditoria?limit=500');
    const acc = r.body.map((x: any) => x.accion);
    for (const a of ['hce.lectura_clinica', 'hce.consulta_administrativa', 'hce.lectura_social', 'hce.seccion_version', 'hce.adenda', 'clinico.entrada_validada', 'consentimiento.documento_descargado', 'consentimiento.aceptacion_electronica', 'atencion.inicio_urgente_sin_consentimiento', 'riesgo.clasificacion_registrada']) {
      expect(acc, a).toContain(a);
    }
    expect(JSON.stringify(r.body)).not.toContain('Primera sesión');
  });
});

describe('9. Centro de Comando ampliado (solo agregados)', () => {
  it('incluye los cuatro grupos de indicadores', async () => {
    const r = await coord.get('/api/dashboard/indicadores');
    expect(r.body.prioritaria).toMatchObject({ identificados: 1, asignados: 1, atenciones_realizadas: 1 });
    expect(r.body.abierta).toMatchObject({ solicitudes_recibidas: 2, servidores_verificados: 1, atenciones_programadas: 1 });
    expect(r.body.hce.expedientes_abiertos).toBe(2);
    expect(r.body.hce.entradas_validadas).toBe(1);
    expect(r.body.consentimiento).toMatchObject({ validados: 1, revocados: 1, inicios_urgentes: 1 });
    const txt = JSON.stringify(r.body);
    for (const s of ['Torres', 'Jorge', 'Primera sesión', 'Ansiedad']) expect(txt).not.toContain(s);
    const csv = await b.app.inject({ method: 'GET', url: '/api/reportes/resumen.csv', headers: { cookie: cookies.coord } });
    expect(csv.body).toContain('atencion_prioritaria');
    expect(csv.body).toContain('consentimiento');
  });
});
