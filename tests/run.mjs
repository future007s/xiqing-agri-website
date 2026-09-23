import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const folder = await mkdtemp(join(tmpdir(), 'xiqing-tests-'));
try {
  const entries = ['media.test.mjs', 'telemetry.test.mjs'].map((name) => join(folder, name));
  for (const entry of entries) {
    await build({ entryPoints: [entry.replace(`${folder}/`, 'tests/')], outfile: entry, bundle: true, platform: 'node', format: 'esm' });
    const result = spawnSync(process.execPath, ['--test', entry], { stdio: 'inherit' });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
} finally { await rm(folder, { recursive: true, force: true }); }
