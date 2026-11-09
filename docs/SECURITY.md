# Security review (P7, package 1)

Scope: the real code at tag `p6-complete` plus the P7 changes. Method: reading the code and writing tests. **Nothing here was run** (the build sandbox had no npm registry,
so `npm audit`, typecheck, vitest and the build were NOT RUN; only the pure new modules were smoke-run with tsx: origins, client address, rate limiters, static serving incl. traversal cases, shutdown order, and the server bundle was produced with esbuild).

## Fixed in this package
| Area | Before | Now |
|---|---|---|
| WebSocket origin | socket.io `cors` only (does not stop a cross-site WebSocket) | `allowRequest` refuses any Origin not in `PUBLIC_ORIGIN` when `NODE_ENV=production` (missing header allowed: non-browser clients) |
| HTTP origin / CORS | one fixed `Access-Control-Allow-Origin` | echo only configured origins; POST/DELETE on `/auth` with a foreign Origin: 403 (production) |
| Socket events | no rate limit | per-socket token bucket per event (`EVENT_LIMITS`), unknown names share one bucket, a whole-socket budget, drop with `Slow down.` ack, disconnect after 150 refusals in 10 s |
| Message size | socket.io default 1 MB | 16 KB (`maxHttpBufferSize`), `connectTimeout` 10 s |
| Connections | unlimited | global cap, per-address cap, per-address join rate, global room cap (joining an existing room still works) |
| HTTP routes | login only (30/min) | every `/auth` route 120/min/address, whole HTTP surface 600/min/address; `/healthz` exempt |
| Client address | socket address (behind a proxy: the proxy's) | `TRUST_PROXY` hops from the right of `X-Forwarded-For`; ignored when 0 |
| Headers | none | nosniff, frame deny, no-referrer, permissions policy, COOP, CSP (`CSP_MODE`), HSTS when all origins are https |
| Static files | none | traversal, encoded traversal, backslash, NUL and dotfiles refused; GET/HEAD only |
| Production config | `DEV_FLAGS` ignored with a warning; no origin rules | refused at start (`assertDeployable`): DEV_FLAGS=1, AUTH_MODE=dev, weak/missing secret, missing or non-https origin, missing client |
| Dev switches | `ABILITY_LAB` and `/?rooms=` honoured | both ignored/refused in production |
| Shutdown | closed the database only | drain, stop loop, close sockets, flush writes, close database, hard timeout |
| Banner / logs | | no secrets, keys, tokens, addresses or player names are logged (flood kicks log a fixed sentence) |

## Reviewed, no change needed (from reading the code)
- **Tokens:** HMAC-signed, expiry checked, signature compared with `timingSafeEqual`, `exp`, `iat` and a maximum lifetime checked (read in `auth/token.ts`; earlier phases have forged/expired tests, not re-run here); the token lives in `sessionStorage`, the cookie is `HttpOnly; SameSite=Strict` and `Secure` in production. Tokens are stateless: **a token is not revocable before it expires** (logout clears the cookie only; account deletion makes the token useless because the account no longer exists). Default lifetime 1 h.
- **Database:** every query is parameterised (`node:sqlite` prepared statements), writes are compare-and-set, the path comes from configuration only, the file is outside the web root (static serving is confined to `packages/client/dist`).
- **Google:** the id token's signature, audience (your client id) and expiry are checked; only `sub` and `name` are read.
- **OpenAI:** nothing reads `OPENAI_*`; the key cannot reach the client (it is not in any shared or client code; the banner only says whether one is present).
- **Bounded memory (spot-checked, not exhaustively audited):** chat is not stored on the server, the ping outbox is capped at 16 per tick, per-player ping attempts are windowed, the death event log is capped (`DEATH_TABLE.maxEvents`), clear/save/layout queues are drained each tick, a room is deleted when its last player leaves, per-IP and global connection caps bound the number of rooms (`MAX_ROOMS` too).
- **Hidden information (spectators, reviews, journal, ping, restricted views):** NOT re-audited here and not changed; the earlier phases' parity and isolation tests remain the evidence. A fresh adversarial review is on the blocker list.

## Residual risks (honest list, not fixed)
1. **`npm audit` NOT RUN.** Run `npm audit` and `npm audit --omit=dev`; findings that appear only without `--omit=dev` are dev/build-time (vite, vitest, esbuild dev server, tsx). Runtime dependencies of the server are `socket.io` and `zod` (plus Node built-ins).
2. **CSP was never run in a browser.** If it blocks something (Phaser, the Google button) the page breaks; `CSP_MODE=report-only` shows violations without breaking. Package 2's browser tests are where this is to be verified.
3. **Single process, single thread.** A burst of room creation or a slow stage generation stalls every room. Not measured yet (package 2 measures tick time).
4. **Room codes are 4 characters (about 1.05 million)**; with 120 live rooms and 20 join attempts per minute per address, one address finds an existing lobby in roughly a few minutes of guessing on average. Mitigations present: lobby-only joining, the join limiter, `MAX_ROOMS`. Longer codes would change the shared contract (not done).
5. **Addresses are not grouped:** an IPv6 user can rotate addresses inside a /64; a determined attacker can spread across many addresses. These limits stop casual abuse, not a distributed attack (use the host/CDN for that).
6. **No account-level rate limit** on login beyond the per-address limits; no lockout. Google does the credential check.
7. **Tokens are not revocable** (see above) and live in `sessionStorage`, so an XSS bug would expose them; the CSP is the mitigation.
8. **`node:sqlite` is experimental** in Node 22 (it prints a warning) and needs Node 22.5+. A single file, no replication; see backups in DEPLOYMENT.md.
9. **Names** shown to other players are length-limited text rendered as canvas text (no HTML); the DOM UI was not searched for `innerHTML` use beyond a single grep that found none in the client.
10. **Logs** of the host platform may still contain request lines with client addresses (outside our control).
11. **`/healthz`** reveals only up/draining and whether saving works.
