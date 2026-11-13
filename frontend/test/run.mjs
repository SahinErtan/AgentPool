/**
 * The test runner.
 *
 * The tests are written in TypeScript and run in Node, so they are bundled
 * with esbuild first — the same bundler that builds the frontend. There is no
 * extra dependency to install.
 *
 *   node test/run.mjs            run everything
 *   node test/run.mjs spec       run the files whose name contains "spec"
 */

import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// The build directory can be moved out of the way, so that two test runs
// do not wipe each other's bundles.
const outDir = process.env.AGENTPOOL_TEST_OUT
  ? join(here, process.env.AGENTPOOL_TEST_OUT)
  : join(here, '.build');
const filter = process.argv[2] ?? '';

const files = (await readdir(here))
  .filter((name) => name.endsWith('.test.ts'))
  .filter((name) => (filter ? name.includes(filter) : true));

if (files.length === 0) {
  console.error(`no test files matched "${filter}"`);
  process.exit(1);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const file of files) {
  await build({
    entryPoints: [join(here, file)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: join(outDir, file.replace(/\.ts$/, '.mjs')),
    logLevel: 'error',
    external: ['pixi.js'],
  });
}

// The shim is loaded with --import, so the globals are in place before
// PixiJS is imported by the test files.
const child = spawn(
  process.execPath,
  ['--import', join(here, 'shim.mjs'), '--test', outDir],
  { stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 1));
