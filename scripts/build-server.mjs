import { build } from 'esbuild';
import { cpSync } from 'node:fs';
await build({
  entryPoints: ['server/index.ts', 'server/cli/migrate.ts', 'server/cli/create-user.ts', 'server/cli/sheets-check.ts'],
  outdir: 'dist/server',
  outbase: 'server',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  alias: { '@shared': './shared' },
  sourcemap: true,
});
cpSync('db', 'dist/db', { recursive: true });
console.log('Servidor compilado en dist/server');
