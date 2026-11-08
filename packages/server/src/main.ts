import { loadConfig, effectiveAuthMode, devFlagsOn } from './config';
import { createGameServer } from './gateway';
import { AuthService } from './auth';
import { SqliteProgressStore } from './store/sqlite';
import { ProgressService } from './store/service';
import type { ProgressStore } from './store/types';

const config = loadConfig();
const authMode = effectiveAuthMode(config);
const auth = new AuthService({ mode: authMode, secret: config.AUTH_SESSION_SECRET, ttlSeconds: config.AUTH_SESSION_TTL_SECONDS, googleClientId: config.GOOGLE_CLIENT_ID });

// P6 C: the progress store. If it cannot be opened the game still runs: every player is guest-like and the lobby says progress is not being saved.
let store: ProgressStore | null = null;
let storeNote = 'off (guests only)';
if (authMode !== 'off') {
  try { store = new SqliteProgressStore(config.DATABASE_PATH); storeNote = `SQLite ${config.DATABASE_PATH} (schema ${store.schemaVersion})`; }
  catch (e) { storeNote = `DOWN (${e instanceof Error ? e.message : 'error'}); playing guest-like, nothing is saved`; }
}
const progress = new ProgressService(store, { log: (m) => console.warn(`[world-break] ${m}`) });

const server = createGameServer({
  abilityLab: config.ABILITY_LAB === '1', huntStage: config.HUNT_STAGE !== '0', escapeStages: config.ESCAPE_STAGES !== '0',
  corsOrigin: config.CORS_ORIGIN, devFlags: devFlagsOn(config), auth, progress,
});
const port = await server.listen(config.PORT);
// "AI director: deterministic fallback only" is the extension point for the OpenAI scenario workstream (P6 B, NOT BUILT): nothing reads OPENAI_* yet.
console.log(`[world-break] server listening on :${port} (AI director: ${config.OPENAI_API_KEY ? 'OpenAI key present but scenario generation is NOT BUILT; deterministic fallback only' : 'deterministic fallback only'}; Ability Lab: ${config.ABILITY_LAB === '1' ? 'ON, open /?lab=1' : 'off'}; escape stages: ${config.ESCAPE_STAGES !== '0' ? 'ON (every stage is generated; /?rooms=1 and /?rooms=2 open the dev stages)' : 'off'}; stage 1: ${config.ESCAPE_STAGES !== '0' ? 'escape tutorial' : config.HUNT_STAGE !== '0' ? 'salvage hunt' : 'tutorial'}; sign-in: ${authMode}; progress store: ${storeNote}; dev flags: ${devFlagsOn(config) ? 'ON' : 'off'})`);
if (config.DEV_FLAGS === '1' && config.NODE_ENV === 'production') console.warn('[world-break] DEV_FLAGS=1 is ignored because NODE_ENV=production');
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { void progress.close().finally(() => process.exit(0)); });
