# WORLD//BREAK: THE REALITY RELAY

A cooperative multiplayer horror escape-room game that runs in the browser. One to four players are trapped in a failing facility. You search dark rooms, solve puzzles, talk to your team, and escape before a ghost finds you.

**Play it:** [https://YOUR-SERVICE-NAME.onrender.com](https://world-break.onrender.com/)
*(Hosted on a free plan: if nobody has played for a while the server sleeps, and the first load can take about a minute. Saved progress is not kept on the free plan, but guests can always play.)*

**Source code:** https://github.com/priyanshu2734/world-break

> **Made with AI agents, as a learning project.** I am a student learning how to build web applications. I designed the game, wrote the specifications and prompts, and played, tested and verified every milestone myself, while AI coding agents (Claude) wrote most of the code. See [How this project was made](#how-this-project-was-made) for the full and honest story.

---

## What the game is

You and up to three friends wake up in a dark facility. Reality is breaking down, and something is hunting you.

- **Escape rooms:** each stage is a chain of rooms (from 1 room at the start up to 6) that you escape through. Doors have different locks, and the rooms get taller and stranger as you progress.
- **Darkness and a flashlight:** you only see what your light touches. Hidden items sit in lockers, crates and safes, and you can carry only two at a time.
- **13 kinds of puzzle:** keys, codes, power, two-person switches, safes, levers, breaker panels, symbol matches whose halves are in different rooms, timed switches, and more. Clues state a goal, never the method.
- **A ghost you can hear:** its footsteps and heartbeat warn you. It reacts to noise (running is loud, sneaking is quiet) and you can hide in cupboards that hold up to two players.
- **Different ghosts:** the Wisp, the Shade (only moves while it is not in your flashlight) and the Howler (its scream breaks lights). From stage 20 a second ghost can join.
- **Identify the ghost:** from stage 7 the ghost's type is not named. You read evidence in the rooms (wet footprints, cold breath, scratched walls), talk it over, and mark your guess in a shared team journal. A correct guess helps, a wrong one costs you.
- **The Pulse Gun:** found in a safe or locker. A hit destroys the ghost, but it comes back after a timer. As stages rise, the gun recharges more slowly and the ghost returns sooner.
- **Real stakes:** if a ghost touches you, you die. Everything you carried drops where you fell. Dead players become free-flying spectators who can only see the ghost and their teammates, and who can warn the team. On Easy and Intermediate a teammate can revive you with a rare Revive Cell. If the whole team dies, you get a death review (built only from what really happened) and retry the same stage on a new layout.
- **Teamwork tools:** a ping wheel (hold Q) with seven markers, a team panel (Tab), and team chat.
- **Endless progression:** there is no final stage. Easy is available from the start, Intermediate unlocks at stage 10 and Hardcore at stage 20. After each stage you pick one of three upgrades for the run. Four visual themes (lab, hospital, factory, library) keep the rooms from looking alike.
- **Accounts are optional:** guests can play instantly. Signing in (Google) saves your progress so you can continue from stage N.

## Controls

| Key | Action |
|---|---|
| A / D | Move |
| W / Space | Jump |
| Mouse | Aim your flashlight (and the Pulse Gun) |
| E | Interact: open, pick up, use, hold to revive |
| G | Drop or swap an item |
| F | Use or fit an item |
| H | Hand an item to a teammate |
| Shift | Sneak (quieter) |
| Left click | Fire the Pulse Gun |
| Hold Q | Ping wheel |
| Tab | Team panel and chat |
| J | Ghost journal |
| M | Mute the ghost audio |
| R | Ready up in the lobby |
| D | Change difficulty (host, in the lobby) |
| Enter | Start the game (host) |
| N | Next stage after a clear, or retry after a wipe (host) |
| Arrow keys | Spectators: switch who you follow |
| G (when dead) | Spectators: ping where the ghost is |

The game needs a keyboard, so it is meant for laptops and desktops, not phones.

## Playing with friends

1. One player opens the game link and creates a room. The address bar now ends in `#CODE` (for example `...onrender.com/#AB12`).
2. Send that **whole address, including `#CODE`,** to your friends. Opening it joins your room.
3. Everyone presses **R** to ready up, and the host presses **Enter**.

## Run it on your own computer

Requirements: **Node.js 22.5 or newer** (the built-in `node:sqlite` module is used for saved progress) and **Git**.

```bash
git clone https://github.com/priyanshu2734/world-break.git
cd world-break
npm ci
```

Start the server and the client in two terminals:

```bash
# terminal 1: the authoritative game server (port 3001)
npm run dev:server

# terminal 2: the browser client (port 5173)
npm run dev:client
```

Open `http://localhost:5173`. Open a second tab with the room code to play against yourself.

For developers, the server can be started with extra testing options (these are **refused in production**):

```bash
AUTH_MODE=dev DEV_FLAGS=1 npm run dev:server
```

`AUTH_MODE=dev` lets you sign in as a fake account to test saving, and `DEV_FLAGS=1` allows links like `http://localhost:5173/?ghost=7&dark=1` that start a run at stage 7.

### Production build

```bash
npm run build
PUBLIC_ORIGIN=http://localhost:3001 npm start
```

The server then also serves the built game page, so one address serves everything. `GET /healthz` is a health check for hosting platforms.

### Tests

```bash
npm run typecheck   # TypeScript, all three packages
npm test            # about 2,000 automated tests
npm run build       # production build
```

The server tests take a few minutes because they simulate many full games.

## Putting it online (free)

The repository includes a Dockerfile and a deployment guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. The quick version for Render's free plan:

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| `PUBLIC_ORIGIN` | the service address, for example `https://my-game.onrender.com` |
| `TRUST_PROXY` | `1` |
| `AUTH_MODE` | `off` (guests only) |
| `NODE_VERSION` | `22.12.0` |

Free hosting puts the server to sleep after about 15 minutes without visitors and does not keep files between restarts, so saved progress needs a paid plan with a persistent disk. The server refuses to start in production with dev settings turned on. Security notes are in **[docs/SECURITY.md](docs/SECURITY.md)**.

## How it is built

A TypeScript monorepo (npm workspaces) with three packages:

| Package | What it does |
|---|---|
| `packages/shared` | Zod schemas, the network protocol, the deterministic movement simulation, the stage generator tables and rules |
| `packages/server` | The authoritative Node.js + Socket.IO game server: a fixed 20 Hz simulation, the ghost AI, stage generation, death and revive, saving (SQLite), sign-in verification |
| `packages/client` | The Phaser 3 + Vite browser client: rendering, input, lighting, sound, interface |

Key ideas:

- **The server is the authority.** Clients send only inputs (intents). The server decides positions, deaths, puzzles and what each player is allowed to see, and it never sends hidden information (items, codes, other rooms) to a client that should not have it.
- **Deterministic generation.** Stages are generated from a seed, so the same seed gives the same stage. A solver checks that every generated stage can be completed by one player and by a team.
- **Client prediction.** Movement is predicted in the browser using the same shared code as the server, so it feels responsive while the server stays in charge.

More detail lives in `docs/`: `ARCHITECTURE.md`, `GAMEPLAY.md`, `GHOST.md`, `ROOMS.md`, `SALVAGE.md`, `DEATH.md`, `VARIETY.md`, `PING.md`, `PROGRESSION.md`, `DEPLOYMENT.md`, `SECURITY.md`, and a handoff report for every milestone in `docs/handoffs/`.

## How this project was made

This project is part of my journey learning how to create web applications.

**What I did:** I came up with the game idea and kept redesigning it after playtests (for example, I changed it from a repair puzzle into an escape-room horror game because the first version felt boring). I wrote the design rules and the step-by-step prompts for the AI agents, split the work into milestones, applied each result to my own computer, ran the type checks, tests and builds, played the game with friends, and reported what was confusing, broken or not fun so it could be fixed.

**What the AI agents did:** AI coding agents (Claude) wrote most of the code, tests and documentation, one milestone at a time. Each milestone ended with a written handoff report listing what changed, which tests passed, what was *not* run, and known problems.

**What I learned along the way:** how a browser client and a game server talk over WebSockets, why the server must be the authority in a multiplayer game, how types and schemas catch mistakes (and why passing tests is not the same as passing the type checker), how to use Git branches, tags and merges for each milestone, how deterministic generation and automated testing work, how sign-in and a database fit in, and how a web app is built and deployed.

I want to be honest that I did not hand-write most of this code. The goal was to learn how real web applications are structured and shipped by directing, verifying and testing the work of AI agents.

## Known limitations

- **No OpenAI scenario generation yet.** An early plan was to have an AI model generate stage briefings. That part is not built: all stages come from the built-in deterministic generator.
- **No automated browser tests yet.** The ~2,000 tests are unit, simulation and network tests. Much of the visual work (themes, ghost looks, interface screens) was checked by playing, not by automated tests.
- **Saved progress needs a persistent disk.** On free hosting it is lost on restart. Real Google sign-in has not been verified against a live deployment.
- A player who disconnects in the middle of a run cannot rejoin that run; they come back through the lobby.
- Keyboard only. Some interface text can still be cluttered (see `docs/polish/VISUAL_ISSUES.md`).

## Credits and licence

Built with [Phaser 3](https://phaser.io), [Socket.IO](https://socket.io), [Vite](https://vitejs.dev), [TypeScript](https://www.typescriptlang.org), [Zod](https://zod.dev) and [Vitest](https://vitest.dev). Visuals and sounds are generated in code; no external art or audio files are used.

Created by **Priyanshu Sarkar** (second-year student, KIIT Bhubaneswar), with AI coding agents.

Licence: not chosen yet. Until one is added, all rights are reserved by the author.
