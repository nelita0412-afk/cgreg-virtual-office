/**
 * Verifica, contra la API en ejecución, que cada cuenta de demostración tiene exactamente los permisos de la matriz
 * (rol base + funciones complementarias). Ingresa con cada cuenta y prueba una ruta representativa por permiso:
 * debe responder 200 si la matriz lo concede y 403 si no. Solo lectura (GET). Datos ficticios.
 *
 * Uso:  DEMO_URL=http://127.0.0.1:4000 npx tsx scripts/demo/verificar-permisos.ts
 */
import { puede, type Permiso } from '../../shared/permissions';
import type { Funcion, Rol } from '../../shared/domain';

const B = process.env.DEMO_URL ?? 'http://127.0.0.1:4000';
const PASS = 'Demo-CGREG-2026';
const CUENTAS = [
  'marianella.becerra', 'coordinacion', 'gabriel', 'sofia', 'betsabe', 'andrea', 'diego', 'maria', 'hugo', 'sally', 'demetrio', 'autoridad', 'auditoria', 'admin',
].map((k) => `${k}@demo.cgreg`);

/** Ruta representativa por permiso (o grupo de permisos equivalentes para esa ruta). */
const SONDAS: { ruta: string; permisos: Permiso[]; ok?: (cuerpo: any) => boolean }[] = [
  { ruta: '/api/office/presencia', permisos: ['oficina.entrar'] },
  { ruta: '/api/directorio', permisos: ['directorio.ver'] },
  { ruta: '/api/profesionales/gabriel-ordonez/panel', permisos: ['equipo.ver'], ok: (c) => 'seguimientos_pendientes' in c },
  { ruta: '/api/servidores', permisos: ['servidores.ver_todos', 'servidores.ver_asignados'] },
  { ruta: '/api/expedientes', permisos: ['hce.ver'] },
  { ruta: '/api/derivaciones', permisos: ['derivaciones.crear', 'derivaciones.coordinar'] },
  { ruta: '/api/consentimientos', permisos: ['consentimientos.gestionar'] },
  { ruta: '/api/coordinacion/panel', permisos: ['solicitudes.gestionar'] },
  { ruta: '/api/dashboard/indicadores', permisos: ['indicadores.agregados'] },
  { ruta: '/api/reportes/resumen.csv', permisos: ['reportes.ver'] },
  { ruta: '/api/articulaciones', permisos: ['territorio.registrar', 'indicadores.agregados'] },
  { ruta: '/api/auditoria', permisos: ['auditoria.ver'] },
  { ruta: '/api/admin/usuarios', permisos: ['usuarios.gestionar'] },
];

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ingresar(email: string) {
  for (let i = 0; ; i++) {
    const r = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS }) });
    if (r.status === 429 && i < 3) {
      console.log('  (límite de ingresos por minuto: esperando 61 s)');
      await esperar(61_000);
      continue;
    }
    if (!r.ok) throw new Error(`No se pudo ingresar con ${email}: ${r.status}`);
    return r.headers.get('set-cookie')!.split(';')[0];
  }
}

let fallos = 0;
for (const email of CUENTAS) {
  const cookie = await ingresar(email);
  const me = await (await fetch(`${B}/api/auth/me`, { headers: { cookie } })).json();
  const sujeto = { rol: me.rol as Rol, funciones: me.funciones as Funcion[] };
  const filas: string[] = [];
  for (const s of SONDAS) {
    const esperado = s.permisos.some((p) => puede(sujeto, p));
    const r = await fetch(B + s.ruta, { headers: { cookie } });
    const cuerpo = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
    const obtenido = r.status === 200 && (!s.ok || s.ok(cuerpo));
    if (esperado !== obtenido) fallos++;
    filas.push(`${esperado === obtenido ? '✓' : '✗'} ${obtenido ? 'sí' : 'no'} ${s.ruta}${esperado !== obtenido ? `  (esperado: ${esperado ? 'sí' : 'no'}, HTTP ${r.status})` : ''}`);
  }
  await fetch(`${B}/api/auth/logout`, { method: 'POST', headers: { cookie, 'x-cgreg': '1' } });
  console.log(`\n${email} · rol ${me.rol}${me.funciones.length ? ' + ' + me.funciones.join(', ') : ''}${me.profesional_id ? ' · ' + me.profesional_id : ''}`);
  for (const f of filas) console.log('  ' + f);
}
console.log(fallos ? `\n${fallos} diferencia(s) con la matriz` : '\nPERMISOS DE DEMOSTRACIÓN CONSISTENTES CON LA MATRIZ');
process.exit(fallos ? 1 : 0);
