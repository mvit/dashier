// Unit tests: bundles tests/unit.test.ts with esbuild (installed with Vite) and runs it with node:test.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dashier-unit-'));
const out = join(dir, 'unit.test.mjs');
try {
  await build({ entryPoints: ['tests/unit.test.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=spec', out], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
