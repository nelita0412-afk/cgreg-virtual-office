import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

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
