// Bundles the server (and the shared package it imports) into packages/server/dist/main.js: plain JavaScript, no tsx at run time.
// socket.io and zod stay external (they are real runtime dependencies of @wb/server); node:sqlite is a Node built-in loaded at run time.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
rmSync(`${root}packages/server/dist`, { recursive: true, force: true });
await build({
  entryPoints: [`${root}packages/server/src/main.ts`],
  outfile: `${root}packages/server/dist/main.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['socket.io', 'zod'],
  legalComments: 'none',
  logLevel: 'info',
});
