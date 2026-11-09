import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig, effectiveAuthMode, devFlagsOn, assertDeployable, publicOrigins } from './config';
import { createGameServer } from './gateway';
import { AuthService } from './auth';
import { SqliteProgressStore } from './store/sqlite';
import { ProgressService } from './store/service';
import { createShutdown } from './shutdown';
import { hasBuiltClient } from './static';
import type { ProgressStore } from './store/types';

const log = (m: string): void => console.log(`[world-break] ${m}`);
const warn = (m: string): void => console.warn(`[world-break] ${m}`);

const config = ((): ReturnType<typeof loadConfig> => {
  try {
    const c = loadConfig();
    assertDeployable(c);
    return c;
  } catch (e) {
    // names the variable, never a value (zod messages and our own checks carry no secrets)
    console.error(`[world-break] invalid configuration: ${e instanceof Error ? e.message : 'error'}`);
    return process.exit(1);
  }
})();
const production = config.NODE_ENV === 'production';
const origins = publicOrigins(config);
const authMode = effectiveAuthMode(config);
const auth = new AuthService({ mode: authMode, secret: config.AUTH_SESSION_SECRET, ttlSeconds: config.AUTH_SESSION_TTL_SECONDS, googleClientId: config.GOOGLE_CLIENT_ID });

// P6 C: the progress store. If it cannot be opened the game still runs: every player is guest-like and the lobby says progress is not being saved.
let store: ProgressStore | null = null;
let storeNote = 'off (guests only)';
if (authMode !== 'off') {
  try { store = new SqliteProgressStore(config.DATABASE_PATH); storeNote = `SQLite ${config.DATABASE_PATH} (schema ${store.schemaVersion})`; }
  catch (e) { storeNote = `DOWN (${e instanceof Error ? e.message : 'error'}); playing guest-like, nothing is saved`; }
}
const progress = new ProgressService(store, { log: warn });

// P7: the built client sits at packages/client/dist, next to this file's package (works from src/ under tsx and from dist/ after the build)
const clientDir = resolve(config.CLIENT_DIST ?? fileURLToPath(new URL('../../client/dist', import.meta.url)));
const serveClient = config.SERVE_CLIENT !== '0';
const clientBuilt = serveClient && hasBuiltClient(clientDir);
if (serveClient && !clientBuilt) {
  if (production) { console.error(`[world-break] the built client was not found (run \`npm run build\`, or set CLIENT_DIST, or SERVE_CLIENT=0 for an API-only server)`); process.exit(1); }
  warn('the built client was not found: this process serves the game server only (use the Vite dev server for the page)');
}
const httpsOnly = origins.length > 0 && origins.every((o) => o.startsWith('https://'));

const server = createGameServer({
  abilityLab: config.ABILITY_LAB === '1' && !production, huntStage: config.HUNT_STAGE !== '0', escapeStages: config.ESCAPE_STAGES !== '0',
  corsOrigin: config.CORS_ORIGIN, publicOrigins: origins, enforceOrigins: production, trustProxy: config.TRUST_PROXY,
  devFlags: devFlagsOn(config), auth, progress, ...(clientBuilt ? { staticDir: clientDir } : {}),
  csp: clientBuilt ? config.CSP_MODE : 'off', hsts: production && httpsOnly, log: warn,
  limits: {
    maxConnections: config.MAX_CONNECTIONS, maxConnectionsPerIp: config.MAX_CONNECTIONS_PER_IP, maxRooms: config.MAX_ROOMS,
    joinsPerMinutePerIp: config.JOINS_PER_MINUTE_PER_IP, httpPerMinutePerIp: config.HTTP_REQUESTS_PER_MINUTE_PER_IP, eventLimits: true,
  },
});
const port = await server.listen(config.PORT);

// The banner: what is on and where, never a secret, a key, a connection string or a player's data.
log(`${production ? 'PRODUCTION' : 'development'} server listening on :${port}`);
log(`public origin(s): ${origins.join(', ') || '(none valid)'} | trusted proxies: ${config.TRUST_PROXY} | origin check: ${production ? 'enforced' : 'off (development)'} | CSP: ${clientBuilt ? config.CSP_MODE : 'n/a'}`);
log(`client: ${clientBuilt ? `served from ${clientDir}` : 'not served by this process'} | health: GET /healthz`);
log(`sign-in: ${authMode} | progress store: ${storeNote} | session secret: ${config.AUTH_SESSION_SECRET ? 'set' : authMode === 'off' ? 'not needed' : 'throwaway (dev)'}`);
log(`limits: ${config.MAX_CONNECTIONS} connections (${config.MAX_CONNECTIONS_PER_IP} per address), ${config.MAX_ROOMS} rooms`);
// "AI director: deterministic fallback only" is the extension point for the OpenAI scenario workstream (P6 B, NOT BUILT): nothing reads OPENAI_* yet.
log(`AI director: ${config.OPENAI_API_KEY ? 'OpenAI key present but scenario generation is NOT BUILT; deterministic fallback only' : 'deterministic fallback only'} | Ability Lab: ${config.ABILITY_LAB === '1' && !production ? 'ON, open /?lab=1' : 'off'} | escape stages: ${config.ESCAPE_STAGES !== '0' ? 'ON' : 'off'}; stage 1: ${config.ESCAPE_STAGES !== '0' ? 'escape tutorial' : config.HUNT_STAGE !== '0' ? 'salvage hunt' : 'tutorial'} | dev flags: ${devFlagsOn(config) ? 'ON' : 'off'}`);
if (config.ABILITY_LAB === '1' && production) warn('ABILITY_LAB=1 is ignored because NODE_ENV=production');

const shutdown = createShutdown({ server, progress, log, exit: (code) => process.exit(code), timeoutMs: config.SHUTDOWN_TIMEOUT_MS });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { void shutdown(sig); });
