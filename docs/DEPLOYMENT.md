# Deployment (P7)

One Node process serves the built page, the WebSocket and the HTTP API on ONE port, so one URL is the whole game (same origin: no CORS needed in practice).

**Status: NOT RUN.** No deployment was made or tested in the milestone that wrote this document (the build sandbox had no Docker, no browser and no
network to a host). The commands and recipes below are written from the code, not from a live deployment. Treat the first deploy as the test, using the checklist at the end.

## Build and run (any machine with Node 22.5+)

    npm ci
    npm run build        # typechecks shared, bundles the server to packages/server/dist/main.js (plain JS), builds the client to packages/client/dist
    PUBLIC_ORIGIN=http://localhost:3001 npm start     # a LOCAL production run; http is accepted for localhost only

`npm start` runs `scripts/start.mjs`: it sets `NODE_ENV=production` (works on Windows too) and runs the compiled server. Open `http://localhost:3001`.
Health check: `GET /healthz` returns `{"status":"ok","uptimeSeconds":N,"storage":"off|ok|down"}` (503 with `"draining"` during shutdown). No secrets, no player data.

## Environment variables

Names and meaning only; never commit values. The server does not read `.env` itself: export them or set them in the host.

| Variable | Default | Production | Meaning |
|---|---|---|---|
| `NODE_ENV` | development | `production` (set by `npm start`) | Switches on the rules below. |
| `PORT` | 3001 | host usually sets it | Listen port. |
| `PUBLIC_ORIGIN` | none | **required**, https | The site's address, comma separated for several (`https://play.example.com`). The only origins accepted for the WebSocket and the browser API. No wildcard, no path. `CORS_ORIGIN` is the older name (still read; `PUBLIC_ORIGIN` wins). |
| `TRUST_PROXY` | 0 | `1` behind Render/Railway/Caddy/nginx | Number of reverse proxies in front. With 0 the `X-Forwarded-For` header is ignored. Wrong value = limits count the proxy's address instead of the player's (too strict) or trust a spoofable header (too lax). |
| `AUTH_MODE` | google if `GOOGLE_CLIENT_ID` set, else off | `off` or `google` | `dev` is refused in production (server will not start). |
| `GOOGLE_CLIENT_ID` | none | needed for `google` | Public OAuth client id (not a secret). |
| `AUTH_SESSION_SECRET` | none | **required when sign-in is on**, 32+ random chars, not a placeholder | Signs session tokens. Rotating it signs everyone out. A set-but-weak value is refused even when sign-in is off. |
| `AUTH_SESSION_TTL_SECONDS` | 3600 | | Session lifetime (60 to 86400). |
| `DATABASE_PATH` | data/world-break.sqlite | a path on a **persistent disk** | SQLite file. Created with its folder if missing. |
| `DEV_FLAGS` | off | **must be unset or 0** | `1` is refused in production. |
| `ABILITY_LAB` | off | ignored in production | Dev-only lab rooms. |
| `ESCAPE_STAGES`, `HUNT_STAGE`, `GHOST_STAGES` | see CLAUDE.md | leave default | Existing gameplay switches. |
| `CLIENT_DIST` | packages/client/dist | | Where the built client is. `SERVE_CLIENT=0` = API and sockets only. In production a missing client is a startup error unless `SERVE_CLIENT=0`. |
| `CSP_MODE` | enforce | enforce | `report-only` or `off` only to debug a blank page (the policy was never run in a real browser in the milestone that wrote it). |
| `MAX_CONNECTIONS` / `MAX_CONNECTIONS_PER_IP` | 400 / 12 | tune to the instance | WebSocket caps (global, per address). |
| `MAX_ROOMS` | 120 | | New rooms are refused beyond this; people can still join existing ones. |
| `JOINS_PER_MINUTE_PER_IP` | 20 | | Room join/create attempts per address. |
| `HTTP_REQUESTS_PER_MINUTE_PER_IP` | 600 | | Page, asset and `/auth` requests per address (`/healthz` is exempt). |
| `SHUTDOWN_TIMEOUT_MS` | 10000 | | After SIGTERM the process exits within this even if a step hangs. |
| `OPENAI_*`, `AI_SCENARIO*` | | | Reserved. The OpenAI workstream is NOT built; nothing reads them; a key would stay server-side. |

Startup refuses (exit 1, message names the variable, never a value): `AUTH_MODE=dev`, `DEV_FLAGS=1`, a missing or weak `AUTH_SESSION_SECRET` when sign-in is on, a weak one even when it is off, a missing or non-https `PUBLIC_ORIGIN` (http is accepted for localhost), a missing built client.
Behind TLS the session cookie is `HttpOnly; Secure; SameSite=Strict`; HSTS is sent when every public origin is https.

## The database needs a persistent disk

Progress (accounts, highest stage, the saved run) lives in ONE SQLite file (`DATABASE_PATH`, WAL mode, so `-wal` and `-shm` files appear beside it). On a host with an
**ephemeral filesystem** (the default on most platforms) the file is **erased at every deploy, restart on some hosts, and when the instance moves**: players lose their
accounts and saves, and nothing warns them. Guests are unaffected (they save nothing). So either mount a persistent disk/volume and point `DATABASE_PATH` into it, or run guests-only (`AUTH_MODE=off`).
Run ONE instance: SQLite is a single-writer file and room state is in memory, so two instances would split players across separate worlds (and a shared disk is not a safe way to share SQLite).
If the file cannot be opened the game still runs, everyone plays guest-like, and the lobby says progress is not being saved; `/healthz` then reports `storage: down`.

### Backups

    node scripts/backup-db.mjs                       # writes backups/world-break-<UTC time>.sqlite, keeps the newest 14
    node scripts/backup-db.mjs /var/data/world-break.sqlite /var/data/backups

It uses `VACUUM INTO`, a consistent snapshot that is safe while the server runs (do not just copy the `.sqlite` file while it is open: the newest writes may be in the `-wal` file).
Schedule it (cron, or a host's cron job) and copy the result OFF the disk (object storage, another machine). **Restore:** stop the server, replace the file at `DATABASE_PATH` with a backup (delete any old `-wal`/`-shm` beside it), start the server. Migrations run forward on start. The backup script was NOT RUN against a real deployment.

## Google sign-in setup

1. Google Cloud Console, APIs and Services, Credentials, create an **OAuth client ID** of type **Web application**.
2. **Authorised JavaScript origins:** exactly your public origin, for example `https://play.example.com` (scheme and host, no path, no trailing slash). Add `http://localhost:3001` (and `http://localhost:5173` for the dev server) only while testing.
3. No redirect URI is needed for the button flow the client uses; if you see `redirect_uri_mismatch`, the flow differs from what was assumed (unverified).
4. Put the client id in `GOOGLE_CLIENT_ID` and set `AUTH_SESSION_SECRET`. The server checks Google's signature, that the token was issued for YOUR client id, and expiry; it reads `sub` and `name` only (never the email).
5. While the OAuth consent screen is in "Testing", only listed test users can sign in. Publish it for the public.
Real Google sign-in has NEVER been run against Google (tested with locally generated keys only).

## Recipe A: Render or Railway (a Node host with a persistent process, WebSockets and a persistent disk)

Setting names change; check the host's current UI. Unverified, NOT RUN.

**Render (Web Service)**
- Runtime Node 22 (set `NODE_VERSION=22` if asked), or Docker using the repo's `Dockerfile`.
- Build command `npm ci && npm run build`; start command `npm start`; health check path `/healthz`.
- Add a **Disk** (needs a paid instance type: check current plans), mount path `/var/data`; set `DATABASE_PATH=/var/data/world-break.sqlite`.
- Environment: `PUBLIC_ORIGIN=https://<your-service>.onrender.com` (or your custom domain), `TRUST_PROXY=1`, `AUTH_MODE=google`, `GOOGLE_CLIENT_ID`, `AUTH_SESSION_SECRET`. Keep it to 1 instance.
- Free instances sleep when idle (a cold start drops live games) and have no disk: fine for a demo with `AUTH_MODE=off`, not for saves.

**Railway**
- Deploy from the repo (Nixpacks: build `npm ci && npm run build`, start `npm start`) or the Dockerfile. Generate a public domain.
- Add a **Volume**, mount it (for example `/data`), set `DATABASE_PATH=/data/world-break.sqlite`.
- `PUBLIC_ORIGIN` must be the full `https://...` address of the generated or custom domain; `TRUST_PROXY=1`.
- With the Dockerfile the process runs as user `node`: if the volume is root-owned and the database cannot be created, the game runs guest-only and `/healthz` says `storage: down`. Fix the volume's ownership (or the host's volume-permission setting) rather than running as root.

## Recipe B: a small VPS with Docker or Node behind HTTPS (Caddy)

    # on the server: Docker installed, DNS A record of play.example.com pointing here
    git clone <your repo> world-break && cd world-break
    docker build -t world-break .
    docker volume create wb-data
    docker run -d --name world-break --restart unless-stopped \
      -p 127.0.0.1:3001:3001 -v wb-data:/data \
      -e PUBLIC_ORIGIN=https://play.example.com -e TRUST_PROXY=1 \
      -e AUTH_MODE=google -e GOOGLE_CLIENT_ID=... -e AUTH_SESSION_SECRET=... \
      world-break

`Caddyfile` (Caddy gets and renews the certificate and proxies WebSockets with no extra settings):

    play.example.com {
        reverse_proxy 127.0.0.1:3001
    }

Without Docker: install Node 22.5+, `npm ci && npm run build`, then run `npm start` under systemd (`Restart=always`, `Environment=` lines for the variables, `KillSignal=SIGTERM`, `WorkingDirectory` the repo, `DATABASE_PATH` on the VPS disk, which IS persistent). Back up with a daily cron job of `scripts/backup-db.mjs`.
With nginx instead of Caddy, forward WebSockets: `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_read_timeout 3600s;`.

## Shutdown and updates

SIGTERM (a deploy, `docker stop`, systemd stop) makes the server: turn `/healthz` to 503 and refuse new players, stop the simulation and close sockets, let queued progress writes finish, close the database, exit 0 (hard exit after `SHUTDOWN_TIMEOUT_MS`).
**Live games end on every restart** (rooms are in memory): deploy when few people are playing. Players with saves keep them; guests lose the run.

## First-deploy checklist

1. `npm ci && npm run typecheck && npm test && npm run build` pass on the machine you build from.
2. Local production run (`PUBLIC_ORIGIN=http://localhost:3001 npm start`): page loads, two tabs play together, `/healthz` is 200.
3. Persistent disk mounted and `DATABASE_PATH` inside it (only if sign-in is on); one instance.
4. `PUBLIC_ORIGIN` is the exact https address; `TRUST_PROXY` matches the number of proxies.
5. `AUTH_SESSION_SECRET` generated (32+ random bytes) and stored only in the host's secret settings.
6. Google: authorised origin added, consent screen published (if sign-in is on).
7. Open the live URL: no console errors (a CSP violation shows here; use `CSP_MODE=report-only` to diagnose), the lobby shows, a second device joins by link.
8. Sign in, clear a stage, restart the service, sign in again: "Continue stage N" appears (proves the disk).
9. `curl -i https://<host>/healthz` returns 200; headers include `Strict-Transport-Security` and `Content-Security-Policy`.
10. First backup taken and restored once onto a scratch copy.
11. Only then write the live URL anywhere: record the real result in `docs/handoffs/P7.md`.
