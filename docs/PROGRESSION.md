# PROGRESSION.md: accounts, saving and endless progression (P6 workstream C)

Stages are endless: there is no final stage and no ending (stage 1,000,000 is tested). **Easy** from stage 1, **Intermediate** unlocks at stage 10, **Hardcore** at stage 20. The server decides everything through `isDifficultyUnlocked` (`phases.ts` and `difficulty.ts` are frozen). A browser never submits a stage, score, unlock flag or save: the only things it sends are a sign-in credential (once), a session token, and the choice "continue" or "new".

## Definitions
- **Highest stage reached.** Clearing stage S reaches S + 1, so `highestStage = max(highestStage, S + 1)`. It only ever goes up: a failed attempt (a team wipe) writes nothing, and clearing an older stage again changes nothing. Clearing stage 9 reaches 10 and unlocks Intermediate (the same moment the room's own `highestStage` rises when the host presses "next stage").
- **Rewards.** One cosmetic per milestone stage reached (10, 20, 30, ...), taken in a fixed order from twelve ids (`COSMETIC_IDS`); no gameplay power. After twelve milestones nothing new is granted; arithmetic, no loop (stage 1,000,000 is instant).
- **Save at stage-cleared moments only.** The save slot is written when a stage is cleared and rewritten once when the draft after it is settled (when the host goes on): `{ stage (the NEXT stage), mode, seedBase (the run seed), variety (Room.varietyRecords, last 6), upgrades, pickOrder }`. A wipe never writes it, so a Hardcore wipe's lost upgrade is not saved (Continue returns to the last clear). Drafted upgrades follow the P3F step 4 rule: the team's owned upgrades carry stage to stage (`upgrades` counts, bounded by each upgrade's max) and `pickOrder` keeps Hardcore's "a wipe costs the newest".

## Multiplayer rules (tested)
1. **The room runs the HOST's save.** "Continue stage N" loads the host's slot; the save is written to whoever hosts at the moment of the clear (a host change keeps the same rules and writes to the new host's slot).
2. **Every signed-in player earns personal results and unlocks** (each account once per clear, with `players` = the room size). A guest earns and stores nothing.
3. **The difficulty a room may choose is limited by the HOST's unlocks** (`Room.unlockBasis = max(run's highest stage, host's highest stage)`; a guest host has only what the run itself reaches). The lobby snapshot's `highestStage` is that basis. When the host changes in the lobby the floor is recomputed, a now-locked mode falls back, and a stale "continue" is dropped.
4. **A joiner with lower or higher personal progress can join**; a guest can join a signed-in host. Their own profile shows their own numbers.
5. **Reconnect uses the session token**: the token is presented at every Socket.IO connect (handshake `auth.token`, else the httpOnly cookie) and renewed every 15 minutes. **Not built:** reclaiming a seat in a run that already started (the existing room only lets players join in the lobby and drops disconnected players at the next stage); a reconnect re-enters the lobby as the same account.
6. The same account cannot sit in one room twice.

## Sign-in
- `AuthProvider` interface (`server/src/auth/provider.ts`): `verify(credential) -> { provider, subject, displayName } | null`.
- **Google (default when `GOOGLE_CLIENT_ID` is set):** the browser gets an ID token, the server verifies the RS256 signature against Google's published keys, `iss`, `aud` = this app, `exp`, then reads only `sub` and `name` (never the email). It then issues its OWN token (`wb1.<payload>.<HMAC-SHA256>`, 1 hour by default, claims `sub`, `iat`, `exp` only). **NOT RUN against the real Google** (tested with locally generated keys).
- **Dev provider (`AUTH_MODE=dev`):** the credential is just a display name. Refused when `NODE_ENV=production` (config, `AuthService` and the provider each refuse).
- HTTP: `GET /auth/config`, `POST /auth/login`, `POST /auth/refresh` (Bearer only), `POST /auth/logout`, `GET /auth/me`, `DELETE /auth/account` (Bearer only, so a cookie alone cannot trigger it from another site). Login is rate limited per address, bodies are capped at 8 KB, errors are generic.
- Stored: provider, provider subject, display name, created/last-seen times, highest stage, rewards, version. No password, no email.
- **Delete my account and data**: removes the account, every result and the save; live sockets of that account become guests; the token then names nothing (`/auth/me` and refresh answer 401).
- A guest's display name is whatever they typed; a signed-in player is named by the server's record.

## Storage
- `ProgressStore` interface (`server/src/store/types.ts`). Production: **`node:sqlite`** (the Node built-in, needs Node 22.5+; it is flagged experimental by Node, and a warning is printed). Chosen because it installs on Windows with no native compilation, no new dependency and no second persistence framework. Alternatives rejected: `better-sqlite3` (native build), JSON files (no transactions or versioning).
- **Hosting caveat: it needs a persistent disk.** The file (`DATABASE_PATH`, default `data/world-break.sqlite`, WAL mode) is lost on every deploy of an ephemeral filesystem. A multi-instance deployment needs a shared disk or a different `ProgressStore` (the interface is the extension point). The file and `.env` are in `.gitignore`.
- **Migrations:** `schema_version` table; forward-only migrations, each in a transaction with the version bump; a database from a newer build is refused. `test/progress/store.test.ts` builds a real schema-1 database (migration 1 alone), fills it and opens it with the current build: rows survive, rewards are backfilled, the new features work.
- **Concurrency:** every progress write is a compare-and-set on the account version, retried up to 5 times; the highest stage is a monotone max, so two rooms (or two processes) can never lower or overwrite each other. Tested with two connections to one file.
- **Storage failures:** if the store is missing or down, the game still starts, guest-like, and the lobby says "PROGRESS IS NOT BEING SAVED". Reads that fail mark the store down; writes go through a bounded ordered queue (64, oldest dropped and counted; 5 attempts with growing delay; failures logged, never thrown into the tick). Sign-in is refused (503, "you can still play as a guest") while the store is down: it is never faked.

## Dev flags
`?ghost=N` is refused unless `DEV_FLAGS=1`, and is never honoured when `NODE_ENV=production` (even with the flag set; main logs a warning). Joining an existing room with the flag is refused too.

## Variables
| Variable | What it does |
|---|---|
| `PORT` | Server port (3001). |
| `NODE_ENV` | `production` turns on the production rules: a real session secret is required when sign-in is on, `AUTH_MODE=dev` and dev flags are refused. |
| `CORS_ORIGIN` | The browser origin allowed to call the server (CORS with credentials). |
| `DEV_FLAGS` | `1` enables `?ghost=N` outside production. |
| `AUTH_MODE` | `off` (guests only), `google`, `dev`. Default: `google` if `GOOGLE_CLIENT_ID` is set, else `off`. |
| `GOOGLE_CLIENT_ID` | The Google OAuth client id the ID token must be issued for. |
| `AUTH_SESSION_SECRET` | Signs the server's session tokens. 32+ characters, required in production with sign-in on. Never commit it. Without one (dev only) a throwaway secret is made and sessions end with the process. |
| `AUTH_SESSION_TTL_SECONDS` | Session token lifetime (60 to 86400, default 3600). |
| `DATABASE_PATH` | The SQLite file. Needs a persistent disk. |
| `ABILITY_LAB`, `HUNT_STAGE`, `ESCAPE_STAGES`, `GHOST_STAGES` | Existing dev switches (unchanged). |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_SCENARIOS_ENABLED`, `AI_SCENARIO_TIMEOUT_MS`, `AI_SCENARIO_CALLS_PER_HOUR`, `AI_SCENARIO_CALLS_PER_DAY` | Reserved for the OpenAI scenario workstream (**NOT BUILT**). Nothing reads them; the "AI director: deterministic fallback only" line is the hook. |

## Files
shared `src/progress/index.ts`, protocol (`run:choose`, `profile:state`); server `src/store/**`, `src/auth/**`, `room.ts` (`restoreRun`, `newRun`, `setHostFloor`, `unlockBasis`, `drainClears`, `drainSaveUpdates`), `gateway.ts`, `config.ts`, `main.ts`; client `ui/account/**`, `net/session.ts`, `LobbyScene`, `vite.config.ts`. Tests: `shared/test/progress.test.ts`, `server/test/progress/*`, `client/test/account.test.ts`.
