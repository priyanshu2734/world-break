// `npm start`: runs the COMPILED server with NODE_ENV=production. Cross-platform (no inline env syntax), and Node receives SIGTERM directly
// when the host stops the process (the server shuts down gracefully). Build first: `npm run build`.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NODE_ENV = 'production';
const entry = fileURLToPath(new URL('../packages/server/dist/main.js', import.meta.url));
if (!existsSync(entry)) {
  console.error('[world-break] packages/server/dist/main.js is missing. Run `npm run build` first.');
  process.exit(1);
}
await import(pathToFileURL(entry).href);
