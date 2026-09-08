import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const folder = await mkdtemp(join(tmpdir(), 'xiqing-tests-'));
try {
  const entry = join(folder, 'media.test.mjs');
  await build({ entryPoints: ['tests/media.test.mjs'], outfile: entry, bundle: true, platform: 'node', format: 'esm' });
  const result = spawnSync(process.execPath, ['--test', entry], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { await rm(folder, { recursive: true, force: true }); }
