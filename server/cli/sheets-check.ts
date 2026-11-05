/** Verifica credenciales, pestañas y encabezados autorizados SIN importar datos ni mostrar datos personales. */
import { loadConfig } from '../config';
import { SheetsClient } from '../sheets/client';
import { enUbicacion, mapeoMaestra, mapeoValoracion } from '../sheets/columns';

const cfg = loadConfig();
const c = new SheetsClient(cfg);
if (!c.configurado) {
  console.error('No hay credenciales. Configure GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 o GOOGLE_APPLICATION_CREDENTIALS (ver docs/GOOGLE_SHEETS.md).');
  process.exit(1);
}
const tabs = await c.pestanas();
const hv = tabs.get(cfg.SHEETS_GID);
console.log(`Valoraciones: gid ${cfg.SHEETS_GID} → «${hv ?? 'NO ENCONTRADA'}»`);
if (cfg.SHEETS_MAESTRA_GID) {
  const hp = tabs.get(cfg.SHEETS_MAESTRA_GID);
  console.log(`Base maestra: gid ${cfg.SHEETS_MAESTRA_GID} → «${hp ?? 'NO ENCONTRADA'}»`);
  if (hp) {
    const p = await c.leerTabla(hp, mapeoMaestra(cfg.SHEETS_MAESTRA_COLUMNS, cfg.SHEETS_UBICACION_COLUMNA), ['codigo_institucional', 'nombre']);
    const sc = p.filas.filter((f) => enUbicacion(f.valores.ubicacion ?? f.valores.unidad, cfg.SHEETS_UBICACION_VALOR)).length;
    console.log('Columnas de «Personal» leídas:', p.columnas);
    console.log(`Filas: ${p.filas.length} · en Santa Cruz: ${sc} · excluidas: ${p.filas.length - sc}`);
  }
}
if (hv) {
  const v = await c.leerTabla(hv, mapeoValoracion(cfg.SHEETS_RIESGO_COLUMNA, cfg.SHEETS_SEGUIMIENTO_COLUMNA), ['id_registro']);
  console.log('Columnas de «Valoraciones» leídas:', v.columnas);
  console.log(`Filas: ${v.filas.length} · riesgo: ${cfg.SHEETS_RIESGO_COLUMNA ? `columna «${cfg.SHEETS_RIESGO_COLUMNA}»` : 'no configurado (no se importa)'}`);
}
