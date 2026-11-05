import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import type { Config } from '../config';
import { CAMPOS_SERVIDOR, colLetter, mapeoColumnas, type CampoServidor } from './columns';

/** Ámbito de SOLO LECTURA: la credencial no puede modificar la matriz aunque se intentara. */
export const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsNoConfigurado extends Error {}

export interface FilaFuente {
  fila: number;
  valores: Partial<Record<CampoServidor, string>>;
}

export function credenciales(cfg: Config): Record<string, unknown> | null {
  if (cfg.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) return JSON.parse(Buffer.from(cfg.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8'));
  if (cfg.GOOGLE_APPLICATION_CREDENTIALS) return JSON.parse(readFileSync(cfg.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  return null;
}

export class SheetsClient {
  private auth: GoogleAuth | null;
  constructor(private cfg: Config, private fetchImpl: typeof fetch = fetch) {
    const cred = credenciales(cfg);
    this.auth = cred ? new GoogleAuth({ credentials: cred, scopes: [SCOPE] }) : null;
  }

  get configurado() {
    return !!this.auth;
  }

  private async get(path: string): Promise<any> {
    if (!this.auth) throw new SheetsNoConfigurado('No hay credenciales de Google configuradas.');
    const token = await this.auth.getAccessToken();
    const res = await this.fetchImpl(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google Sheets API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  /** Lee SOLO metadatos (sheetId y título) de todas las pestañas; nunca su contenido. */
  async pestanas(): Promise<Map<number, string>> {
    const meta = await this.get(`${this.cfg.SHEETS_SPREADSHEET_ID}?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`);
    return new Map((meta.sheets ?? []).map((s: any) => [s.properties?.sheetId as number, s.properties?.title as string]));
  }

  /**
   * Lee la fila de encabezados de una pestaña autorizada y luego únicamente las columnas mapeadas.
   */
  async leerTabla<C extends string>(hoja: string, mapeo: Record<C, string>, obligatorios: NoInfer<C>[]): Promise<{ columnas: Partial<Record<C, string>>; filas: { fila: number; valores: Partial<Record<C, string>> }[] }> {
    const q = `'${hoja.replace(/'/g, "''")}'`;
    const head = await this.get(`${this.cfg.SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(`${q}!1:1`)}`);
    const encabezados: string[] = (head.values?.[0] ?? []).map((h: string) => String(h).trim());
    const columnas: Partial<Record<C, string>> = {};
    const faltantes: string[] = [];
    for (const [campo, encabezado] of Object.entries(mapeo) as [C, string][]) {
      const idx = encabezados.indexOf(encabezado);
      if (idx === -1) {
        if (obligatorios.includes(campo)) faltantes.push(encabezado);
        continue;
      }
      columnas[campo] = colLetter(idx);
    }
    if (faltantes.length) throw new Error(`La pestaña "${hoja}" no contiene los encabezados obligatorios: ${faltantes.join(', ')}.`);
    // Columnas únicas (dos campos pueden apuntar al mismo encabezado).
    const letras = [...new Set(Object.values(columnas) as string[])];
    const ranges = letras.map((l) => `ranges=${encodeURIComponent(`${q}!${l}2:${l}`)}`).join('&');
    const data = await this.get(`${this.cfg.SHEETS_SPREADSHEET_ID}/values:batchGet?majorDimension=COLUMNS&${ranges}`);
    const cols = new Map<string, string[]>(letras.map((l, i) => [l, (data.valueRanges?.[i]?.values?.[0] ?? []) as string[]]));
    const n = Math.max(0, ...[...cols.values()].map((c) => c.length));
    const filas: { fila: number; valores: Partial<Record<C, string>> }[] = [];
    for (let i = 0; i < n; i++) {
      const valores: Partial<Record<C, string>> = {};
      for (const [campo, letra] of Object.entries(columnas) as [C, string][]) {
        const v = cols.get(letra)?.[i];
        if (v != null && String(v).trim() !== '') valores[campo] = String(v).trim();
      }
      if (Object.keys(valores).length) filas.push({ fila: i + 2, valores });
    }
    return { columnas, filas };
  }

  /** Resuelve el gid a nombre de pestaña leyendo SOLO metadatos (sheetId y título). */
  async resolverPestana(): Promise<string> {
    const meta = await this.get(`${this.cfg.SHEETS_SPREADSHEET_ID}?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`);
    const hoja = (meta.sheets ?? []).find((s: any) => s.properties?.sheetId === this.cfg.SHEETS_GID);
    if (!hoja) throw new Error(`No existe una pestaña con gid ${this.cfg.SHEETS_GID}.`);
    return hoja.properties.title as string;
  }

  /**
   * Lee exclusivamente la fila de encabezados de la pestaña autorizada y luego solo las columnas mapeadas.
   */
  async leerServidores(): Promise<{ hoja: string; columnas: Record<string, string>; filas: FilaFuente[] }> {
    const hoja = await this.resolverPestana();
    const q = `'${hoja.replace(/'/g, "''")}'`;
    const head = await this.get(`${this.cfg.SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(`${q}!1:1`)}`);
    const encabezados: string[] = (head.values?.[0] ?? []).map((h: string) => String(h).trim());
    const mapeo = mapeoColumnas(this.cfg.SHEETS_COLUMNS);
    const columnas: Record<string, string> = {};
    const faltantes: string[] = [];
    for (const [campo, encabezado] of Object.entries(mapeo) as [CampoServidor, string][]) {
      const idx = encabezados.indexOf(encabezado);
      if (idx === -1) {
        if (CAMPOS_SERVIDOR[campo].obligatorio) faltantes.push(encabezado);
        continue;
      }
      columnas[campo] = colLetter(idx);
    }
    if (faltantes.length) throw new Error(`La pestaña "${hoja}" no contiene los encabezados obligatorios: ${faltantes.join(', ')}.`);
    const campos = Object.keys(columnas) as CampoServidor[];
    const ranges = campos.map((c) => `ranges=${encodeURIComponent(`${q}!${columnas[c]}2:${columnas[c]}`)}`).join('&');
    const data = await this.get(`${this.cfg.SHEETS_SPREADSHEET_ID}/values:batchGet?majorDimension=COLUMNS&${ranges}`);
    const cols: string[][] = (data.valueRanges ?? []).map((vr: any) => vr.values?.[0] ?? []);
    const n = Math.max(0, ...cols.map((c) => c.length));
    const filas: FilaFuente[] = [];
    for (let i = 0; i < n; i++) {
      const valores: Partial<Record<CampoServidor, string>> = {};
      campos.forEach((c, j) => {
        const v = cols[j]?.[i];
        if (v != null && String(v).trim() !== '') valores[c] = String(v).trim();
      });
      if (Object.keys(valores).length) filas.push({ fila: i + 2, valores });
    }
    return { hoja, columnas, filas };
  }
}
