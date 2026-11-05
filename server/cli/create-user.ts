/**
 * Crea una cuenta. Uso:
 *   npm run user:create -- --email coordinacion@cgreg.gob.ec --nombre "Nombre Apellido" --rol coordinacion
 *   npm run user:create -- --email x@y --nombre "Gabriel Ordóñez" --rol profesional --profesional gabriel-ordonez
 * Se imprime una contraseña temporal que debe cambiarse en el primer ingreso.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../config';
import { createPool, migrate } from '../db';
import { hashPassword } from '../auth';
import { passwordTemporal } from '../routes/admin';
import { audit } from '../audit';
import { ROLES } from '@shared/domain';

const { values } = parseArgs({ options: { email: { type: 'string' }, nombre: { type: 'string' }, rol: { type: 'string' }, profesional: { type: 'string' } } });
if (!values.email || !values.nombre || !values.rol || !ROLES.includes(values.rol as never)) {
  console.error(`Uso: --email <correo> --nombre "<nombre>" --rol <${ROLES.join('|')}> [--profesional <id>]`);
  process.exit(1);
}
const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
await migrate(db, () => {});
const temporal = passwordTemporal();
const r = await db.query(
  `insert into core.usuarios (email, nombre, rol, profesional_id, password_hash, debe_cambiar_password) values ($1,$2,$3,$4,$5,true) returning id`,
  [values.email.toLowerCase(), values.nombre, values.rol, values.profesional ?? null, await hashPassword(temporal)],
);
await audit(db, null, 'usuario.creado_cli', 'usuario', r.rows[0].id, { rol: values.rol });
console.log(`Usuario creado (${values.rol}): ${values.email}\nContraseña temporal (cámbiela al ingresar): ${temporal}`);
await db.end();
