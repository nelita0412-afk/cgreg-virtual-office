import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { loadConfig } from '../server/config';

/**
 * El Bash de macOS (3.2) decide dónde termina el nombre de una variable con la libc del sistema, que en UTF-8
 * considera letras los bytes de caracteres como «»áé. Así, "«$BASE»" se lee como la variable inexistente
 * "BASE\xC2" y con `set -u` el script se detiene («BASE?: unbound variable»). Por eso en los scripts de
 * demostración toda expansión va con llaves (${BASE}) y "$@" usa la forma segura para Bash 3.2.
 */
describe('Scripts de demostración compatibles con el Bash de macOS', () => {
  const dir = new URL('../scripts/demo/', import.meta.url);
  const scripts = readdirSync(dir).filter((f) => f.endsWith('.sh'));

  it('hay scripts que revisar', () => expect(scripts.length).toBeGreaterThan(0));

  for (const f of scripts) {
    const lineas = readFileSync(new URL(f, dir), 'utf8').split('\n');
    it(`${f}: ninguna variable sin llaves`, () => {
      const malas = lineas.map((l, i) => [i + 1, l] as const).filter(([, l]) => /\$[A-Za-z_]/.test(l));
      expect(malas).toEqual([]);
    });
    it(`${f}: "$@" en forma segura para Bash 3.2 con set -u`, () => {
      expect(lineas.filter((l) => l.includes('"$@"') && !l.includes('${@+"$@"}'))).toEqual([]);
    });
  }
});

describe('Garantías del kit de demostración y de producción', () => {
  const kit = readFileSync(new URL('../scripts/demo/probar-en-mac.sh', import.meta.url), 'utf8');
  const codigo = kit.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  it('instala dependencias de desarrollo y nunca descarga herramientas con npx', () => {
    expect(codigo).toContain('npm ci --include=dev');
    expect(codigo).not.toMatch(/\bnpx\b/);
    expect(codigo).toContain('./node_modules/.bin/tsx server/cli/migrate.ts');
  });
  it('usa la base DEMO nueva y protege las bases anteriores', () => {
    expect(codigo).toContain('BASE=${BASE:-cgreg_demo_brigada}');
    expect(codigo).toContain('BASES_PROTEGIDAS="cgreg_demo cgreg_demo_prueba_20261108"');
  });
  it('comparte solo con Tailscale Serve (privado), nunca con Funnel (público)', () => {
    expect(codigo).toMatch(/serve --bg --https=443 http:\/\/127\.0\.0\.1:/);
    expect(codigo).not.toMatch(/funnel/i);
  });
  it('en producción WhatsApp y el modo demo están desactivados por defecto', () => {
    const cfg = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x@localhost/x', DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') } as NodeJS.ProcessEnv);
    expect(cfg.TELEATENCION_WHATSAPP_HABILITADA).toBe('false');
    expect(cfg.MODO_DEMO).toBe('false');
  });
});

