import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import {
  AbilityActionSchema, ChatSendSchema, DifficultyPayloadSchema, DraftVoteSchema, EscapeActionSchema, GHOST_CUE, GameInputSchema, GhostActionSchema, ItemActionSchema, JoinPayloadSchema, PingRequestSchema, ReadyPayloadSchema, SERVER_TICK_HZ, SpectateFollowSchema, SpectateMoveSchema, SpectateRoomSchema, StageActionSchema,
  RunChoiceSchema, guestProfile, isDifficultyUnlocked, unlockedDifficulties,
  type ClientToServerEvents, type ServerToClientEvents, type Ack, type Profile, type RunSave,
} from '@wb/shared';
import { AuthService } from './auth';
import { createAuthHandler, parseCookies } from './auth/http';
import { ProgressService } from './store/service';
import { RoomManager, type Result, type Room } from './room';
import { startFixedLoop } from './loop';
import { EventLimiter, KeyedLimiter, clientIp, originAllowed, parseOrigins, securityHeaders, type CspMode } from './security';
import { createStaticHandler } from './static';

export interface GameServer {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  http: HttpServer;
  rooms: RoomManager;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
  /** P7: stop taking new players and report 503 on /healthz (a host stops routing to this process); the loop and open sockets keep running until `close()`. */
  drain(): void;
  /** P7: live counters (no player data). */
  stats(): { connections: number; rooms: number; draining: boolean };
}

/** P7: abuse caps. Absent (the default for tests) = no cap; `main.ts` always passes the configured values. */
export interface GatewayLimits {
  maxConnections?: number; maxConnectionsPerIp?: number; maxRooms?: number;
  /** room:join calls per minute per address (creating or joining a room). */
  joinsPerMinutePerIp?: number;
  /** non-socket HTTP requests per minute per address (page, assets, /auth). */
  httpPerMinutePerIp?: number;
  /** per-socket event rate limits (EVENT_LIMITS) and the flood kick. */
  eventLimits?: boolean;
}

export function createGameServer(opts: {
  corsOrigin?: string; briefingTicks?: number; abilityLab?: boolean; huntStage?: boolean; escapeStages?: boolean; ghostStages?: boolean;
  /** P6 C: dev-only client flags (`?ghost=N`). Off unless true here or DEV_FLAGS=1, and NEVER on when NODE_ENV=production. */
  devFlags?: boolean;
  /** P6 C: sign-in. Absent = guests only. */
  auth?: AuthService;
  /** P6 C: storage. Absent = nothing is saved (every player is guest-like). */
  progress?: ProgressService;
  /** P7: the origins the browser may use (wins over `corsOrigin`). */
  publicOrigins?: string[];
  /** P7: refuse WebSocket handshakes and state-changing HTTP calls whose Origin header is not one of the origins. Default off (dev proxies); main.ts turns it on in production. */
  enforceOrigins?: boolean;
  /** P7: reverse proxies in front (0 = none). */
  trustProxy?: number;
  /** P7: the built client directory to serve (absent = the server serves no pages). */
  staticDir?: string;
  csp?: CspMode;
  hsts?: boolean;
  limits?: GatewayLimits;
  /** P7: operational log lines (no secrets, no player data). */
  log?: (message: string) => void;
} = {}): GameServer {
  const origins = opts.publicOrigins && opts.publicOrigins.length > 0 ? opts.publicOrigins : parseOrigins(opts.corsOrigin ?? 'http://localhost:5173');
  const corsOrigin = origins.join(',');
  const enforceOrigins = opts.enforceOrigins === true;
  const trustProxy = opts.trustProxy ?? 0;
  const limits = opts.limits ?? {};
  const log = opts.log ?? (() => undefined);
  let draining = false;
  const baseHeaders = securityHeaders({ csp: opts.csp ?? 'off', origins, hsts: opts.hsts === true });
  const staticHandler = opts.staticDir ? createStaticHandler({ root: opts.staticDir }) : null;
  const httpLimiter = limits.httpPerMinutePerIp ? new KeyedLimiter({ perSecond: limits.httpPerMinutePerIp / 60, burst: Math.max(20, Math.ceil(limits.httpPerMinutePerIp / 4)) }) : null;
  const joinLimiter = limits.joinsPerMinutePerIp ? new KeyedLimiter({ perSecond: limits.joinsPerMinutePerIp / 60, burst: Math.max(3, Math.ceil(limits.joinsPerMinutePerIp / 3)) }) : null;
  const connectionsByIp = new Map<string, number>();
  let connections = 0;
  const devFlags = (opts.devFlags ?? process.env.DEV_FLAGS === '1') && process.env.NODE_ENV !== 'production';
  const auth = opts.auth ?? new AuthService({ mode: 'off' });
  const progress = opts.progress ?? new ProgressService(null);
  // socket.id -> membership. playerId is a server-issued opaque id, never client-chosen. `accountId` is set only from a verified session token.
  const sessions = new Map<string, { playerId: string; roomCode: string; accountId?: string }>();
  const joining = new Set<string>();
  const authHttp = createAuthHandler({
    auth, progress, corsOrigin, allowedOrigins: origins, enforceOrigin: enforceOrigins, trustProxy,
    onAccountDeleted: (id) => {
      for (const [sid, sess] of sessions) if (sess.accountId === id) { delete sess.accountId; refreshRoom(sess.roomCode); const sock = io.sockets.sockets.get(sid); if (sock) sock.data.accountId = undefined; }
    },
  });
  const startedAt = Date.now();
  const http = createServer((req, res) => {
    for (const [k, v] of Object.entries(baseHeaders)) res.setHeader(k, v);
    const path = (req.url ?? '').split('?')[0] ?? '';
    // P7: the host's health check. No secrets and no player data: only whether the process is up, draining, and whether saving works.
    if (path === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      const body = JSON.stringify({ status: draining ? 'draining' : 'ok', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), storage: !progress.configured ? 'off' : progress.available ? 'ok' : 'down' });
      res.writeHead(draining ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (httpLimiter && !httpLimiter.take(clientIp(req.headers, req.socket.remoteAddress, trustProxy))) {
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30', 'Cache-Control': 'no-store' }).end('Too many requests');
      return;
    }
    if (authHttp(req, res)) return;
    if (staticHandler && staticHandler(req, res)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  });
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    cors: { origin: origins, credentials: true },
    // P7: a message is at most a few hundred bytes; 16 KB is generous. The default (1 MB) would let one client send huge frames.
    maxHttpBufferSize: 16 * 1024,
    connectTimeout: 10_000,
    // P7: a browser always sends Origin on a WebSocket handshake; refuse any that is not the configured site (cross-site WebSocket hijacking).
    allowRequest: (req, cb) => {
      const ok = !enforceOrigins || originAllowed(typeof req.headers.origin === 'string' ? req.headers.origin : undefined, origins);
      cb(ok ? null : 'Origin not allowed', ok);
    },
  });
  // P7: global and per-address connection caps (counted when a socket connects, below). The auth middleware that follows is synchronous.
  io.use((socket, next) => {
    if (draining) return next(new Error('server_restarting'));
    const ip = clientIp(socket.handshake.headers, socket.handshake.address, trustProxy);
    if (limits.maxConnections !== undefined && connections >= limits.maxConnections) return next(new Error('server_busy'));
    if (limits.maxConnectionsPerIp !== undefined && (connectionsByIp.get(ip) ?? 0) >= limits.maxConnectionsPerIp) return next(new Error('too_many_connections'));
    next();
  });
  // P6 C: the session token is checked ONCE, when the socket connects (and again on every automatic reconnect, which presents it again). A forged,
  // altered or expired token is refused outright (the client then signs in again or plays as a guest); no token at all is a guest.
  io.use((socket, next) => {
    const raw: unknown = (socket.handshake.auth as { token?: unknown } | undefined)?.token ?? parseCookies(socket.handshake.headers.cookie)['wb_session'];
    if (raw === undefined || raw === null || raw === '') return next();
    const id = auth.verify(raw);
    if (!id) return next(new Error('invalid_session'));
    socket.data.accountId = id;
    next();
  });
  // P3E: the ghost. Off unless the caller says so or the server is started with GHOST_STAGES=1 (config.ts and main.ts are outside this phase's file list, so the variable is read here).
  const ghostOn = opts.ghostStages ?? process.env.GHOST_STAGES === '1';
  const rooms = new RoomManager({ briefingTicks: opts.briefingTicks, huntStage: opts.huntStage });
  const broadcast = (code: string) => {
    const room = rooms.get(code);
    if (room) io.to(code).emit('room:state', room.snapshot());
  };

  // ---------------------------------------------------------------- P6 C: profiles, the host's save, results
  /** The account of the room's host (null for a guest host or when nobody is there). */
  const hostAccount = (room: Room): string | null => {
    for (const sess of sessions.values()) if (sess.roomCode === room.code && sess.playerId === room.hostId) return sess.accountId ?? null;
    return null;
  };
  const choices = new WeakMap<Room, 'new' | 'continue'>();
  /** Everything the room needs to know about its host, from the server's own store: unlocks (the floor) and whether a save exists. */
  const hostInfo = async (room: Room): Promise<{ floor: number; save: RunSave | null; signedIn: boolean }> => {
    const id = hostAccount(room);
    if (!id) return { floor: 0, save: null, signedIn: false };
    const a = await progress.account(id);
    if (!a) return { floor: 0, save: null, signedIn: false };
    return { floor: a.highestStage, save: await progress.runSave(id), signedIn: true };
  };
  const profileFor = async (room: Room | undefined, accountId: string | undefined): Promise<Profile> => {
    const p = await progress.profile(accountId ?? null);
    if (!room) return p;
    const h = await hostInfo(room);
    const allowed = unlockedDifficulties(Math.max(room.unlockBasis, 1));
    return { ...p, room: { allowed, hostSave: h.save ? { stage: h.save.stage, mode: h.save.mode } : null, choice: choices.get(room) ?? 'new', hostSignedIn: h.signedIn } };
  };
  const sendProfile = async (sid: string): Promise<void> => {
    const sess = sessions.get(sid);
    if (!sess) return;
    const p = await profileFor(rooms.get(sess.roomCode), sess.accountId);
    io.to(sid).emit('profile:state', p);
  };
  /** The host (or the host's progress) may have changed: re-derive the room's unlock floor, drop a stale "continue", and tell everyone. Lobby only changes anything. */
  const refreshRoom = (code: string): void => {
    const room = rooms.get(code);
    if (!room) return;
    void (async () => {
      const h = await hostInfo(room);
      if (room.phase === 'lobby') {
        room.setHostFloor(h.floor);
        if (choices.get(room) === 'continue' && !h.save) { choices.set(room, 'new'); room.newRun(); }
        broadcast(code);
      }
      for (const [sid, sess] of sessions) if (sess.roomCode === code) void sendProfile(sid);
    })();
  };
  /** A stage was cleared: every signed-in player in the room earns the result (and the highest stage it reaches); only the HOST's save slot is written. */
  const handleProgress = (room: Room): void => {
    for (const ev of room.drainClears()) {
      const byPlayer = new Map<string, string>();
      for (const sess of sessions.values()) if (sess.roomCode === room.code && sess.accountId) byPlayer.set(sess.playerId, sess.accountId);
      const done = new Set<string>();
      for (const pid of ev.playerIds) {
        const acct = byPlayer.get(pid);
        if (!acct || done.has(acct)) continue; // one account counts once
        done.add(acct);
        progress.recordClear(acct, ev.result, pid === ev.hostId ? ev.save : null);
      }
    }
    const host = hostAccount(room);
    for (const save of room.drainSaveUpdates()) if (host) progress.saveRun(host, save);
    if (done0(room)) void progress.idle().then(() => { for (const [sid, sess] of sessions) if (sess.roomCode === room.code) void sendProfile(sid); });
  };
  const done0 = (room: Room): boolean => progress.configured && [...sessions.values()].some((x) => x.roomCode === room.code && x.accountId);

  const reply = <T extends object = Record<never, never>>(ack: unknown, r: Ack<T>) => {
    if (typeof ack === 'function') (ack as (r: Ack<T>) => void)(r);
  };
  const run = (socketId: string, ack: unknown, fn: (playerId: string, roomCode: string) => Result) => {
    const s = sessions.get(socketId);
    if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
    const r = fn(s.playerId, s.roomCode);
    reply(ack, r);
    if (r.ok) broadcast(s.roomCode);
  };

  io.on('connection', (socket) => {
    // P7: count the connection, rate limit every incoming event of this socket, and disconnect a flooder.
    const ip = clientIp(socket.handshake.headers, socket.handshake.address, trustProxy);
    connections++;
    connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
    socket.on('disconnect', () => {
      connections = Math.max(0, connections - 1);
      const n = (connectionsByIp.get(ip) ?? 1) - 1;
      if (n <= 0) connectionsByIp.delete(ip); else connectionsByIp.set(ip, n);
    });
    if (limits.eventLimits) {
      const limiter = new EventLimiter();
      socket.use((packet, next) => {
        const event = typeof packet[0] === 'string' ? packet[0] : '?';
        const verdict = limiter.check(event);
        if (verdict === 'ok') return next();
        const last: unknown = packet[packet.length - 1];
        if (typeof last === 'function') (last as (r: Ack) => void)({ ok: false, error: 'Slow down.' });
        if (verdict === 'kick') { log('a socket was disconnected for flooding'); socket.disconnect(true); }
        // the packet is dropped: `next` is not called, so no handler runs
      });
    }
    socket.on('room:join', (payload, ack) => {
      const parsed = JoinPayloadSchema.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, error: 'Invalid join request' });
      if (sessions.has(socket.id) || joining.has(socket.id)) return reply(ack, { ok: false, error: 'Already joined' });
      const { roomCode, name, lab, rooms: wantRooms, ghost: wantGhost } = parsed.data;
      if (draining) return reply(ack, { ok: false, error: 'The server is restarting. Try again in a moment.' });
      if (joinLimiter && !joinLimiter.take(ip)) return reply(ack, { ok: false, error: 'Too many join attempts. Wait a moment.' });
      if (!roomCode && limits.maxRooms !== undefined && rooms.count >= limits.maxRooms) return reply(ack, { ok: false, error: 'The server is full right now. Try again in a few minutes.' });
      // P7: the multi-room demo stage is a dev switch; a production server does not honour it
      if (wantRooms && process.env.NODE_ENV === 'production') return reply(ack, { ok: false, error: 'Not available on this server.' });
      // P3B dev flag: only a NEW room can become an Ability Lab room, and only if the server allows it (ABILITY_LAB=1).
      if (lab && !roomCode && !opts.abilityLab) return reply(ack, { ok: false, error: 'The Ability Lab is not enabled on this server (start it with ABILITY_LAB=1).' });
      // P3D dev flag: the multi-room demo, only on creation and only when escape stages are enabled (ESCAPE_STAGES, default on for the dev server).
      if (wantRooms && !roomCode && !opts.escapeStages) return reply(ack, { ok: false, error: 'Escape stages are not enabled on this server (ESCAPE_STAGES is 0).' });
      // P6 C: the ghost-at-stage-N flag is a DEV flag: refused unless DEV_FLAGS=1, and never honoured in production.
      if (wantGhost !== undefined && !devFlags) return reply(ack, { ok: false, error: 'Dev flags are disabled on this server (DEV_FLAGS=1 enables them outside production).' });
      // P3E dev flag: the ghost, starting at a given stage, only on creation and only when escape stages are enabled (like the multi-room demo).
      if (wantGhost !== undefined && !roomCode && !opts.escapeStages) return reply(ack, { ok: false, error: 'Escape stages are not enabled on this server (ESCAPE_STAGES is 0).' });
      joining.add(socket.id);
      void (async () => {
        try {
          // a signed-in socket uses the account's name (the server's record, not the browser's); an unknown or unreachable account plays as a guest
          const tokenAccount: string | undefined = socket.data.accountId;
          const account = tokenAccount ? await progress.account(tokenAccount) : null;
          const accountId = account ? account.id : undefined;
          const duplicate = !!accountId && !!roomCode && [...sessions.values()].some((x) => x.accountId === accountId && x.roomCode === roomCode);
          if (duplicate) return reply(ack, { ok: false, error: 'This account is already in that room' });
          const room = roomCode ? rooms.get(roomCode) : rooms.create({ lab: lab === true, ...(wantRooms ? { rooms: wantRooms } : {}), escape: opts.escapeStages === true, ghost: opts.escapeStages === true && (ghostOn || wantGhost !== undefined), ...(wantGhost !== undefined ? { startStage: Math.max(2, wantGhost) } : {}) });
          if (!room) return reply(ack, { ok: false, error: 'Room not found' });
          const playerId = randomUUID();
          const r = room.join(playerId, account ? account.name.slice(0, 16) : name);
          if (!r.ok) { if (room.size === 0) rooms.remove(room.code); return reply(ack, r); }
          sessions.set(socket.id, { playerId, roomCode: room.code, ...(accountId ? { accountId } : {}) });
          void socket.join(room.code);
          reply(ack, { ok: true, roomCode: room.code, playerId });
          broadcast(room.code);
          refreshRoom(room.code);
        } catch {
          reply(ack, { ok: false, error: 'Could not join right now' });
        } finally { joining.delete(socket.id); }
      })();
    });

    // P6 C: the host chooses "Continue stage N" or "New run". The server reads the HOST's save from its own store; the client names nothing but the choice.
    socket.on('run:choose', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = RunChoiceSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid request' });
      const room = rooms.get(s.roomCode);
      if (!room) return reply(ack, { ok: false, error: 'Join a room first' });
      if (s.playerId !== room.hostId) return reply(ack, { ok: false, error: 'Only the host can choose how the run starts' });
      if (room.phase !== 'lobby') return reply(ack, { ok: false, error: 'Not in lobby' });
      void (async () => {
        try {
          if (p.data.choice === 'new') {
            const r = room.newRun();
            if (r.ok) choices.set(room, 'new');
            reply(ack, r.ok ? { ok: true, message: 'Starting a new run at stage 1.' } : r);
          } else {
            const h = await hostInfo(room);
            if (!h.signedIn) return reply(ack, { ok: false, error: 'Sign in to keep and continue a run.' });
            if (!h.save) return reply(ack, { ok: false, error: 'There is no saved run to continue.' });
            const r = room.restoreRun(h.save, h.floor);
            if (r.ok) choices.set(room, 'continue');
            reply(ack, r.ok ? { ok: true, message: `Continuing at stage ${h.save.stage}.` } : { ok: false, error: 'The saved run could not be loaded.' });
          }
        } catch { reply(ack, { ok: false, error: 'Could not do that right now' }); }
        broadcast(room.code);
        for (const [sid, sess] of sessions) if (sess.roomCode === room.code) void sendProfile(sid);
      })();
    });

    socket.on('room:ready', (payload, ack) => {
      const p = ReadyPayloadSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid request' });
      run(socket.id, ack, (pid, code) => rooms.get(code)!.setReady(pid, p.data.ready));
    });
    socket.on('room:setDifficulty', (payload, ack) => {
      const p = DifficultyPayloadSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid request' });
      run(socket.id, ack, (pid, code) => rooms.get(code)!.setDifficulty(pid, p.data.difficulty));
    });
    socket.on('room:start', (_payload, ack) => {
      run(socket.id, ack, (pid, code) => rooms.get(code)!.start(pid));
    });

    // P1: movement intents. Fire-and-forget; malformed payloads are dropped silently.
    socket.on('game:input', (payload) => {
      const s = sessions.get(socket.id);
      if (!s) return;
      const p = GameInputSchema.safeParse(payload);
      if (!p.success) return;
      rooms.get(s.roomCode)?.submitInput(s.playerId, p.data.seq, { moveX: p.data.moveX, jump: p.data.jump }, { ...(p.data.aim !== undefined ? { aim: p.data.aim } : {}), ...(p.data.sneak !== undefined ? { sneak: p.data.sneak } : {}), ...(p.data.use !== undefined ? { use: p.data.use } : {}) });
    });
    // P2: stage actions (interact / tool use / cancel). Validated by Zod here, by the engine for rules.
    socket.on('stage:action', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = StageActionSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid action' });
      const r = rooms.get(s.roomCode)?.stageAction(s.playerId, p.data);
      if (!r) return reply(ack, { ok: false, error: 'No stage is running.' });
      reply(ack, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
    });
    // P3B: reality abilities (gravity well, freeze, duplicate, momentum). Zod here, rules in the ability system.
    socket.on('ability:use', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = AbilityActionSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid ability request' });
      const r = rooms.get(s.roomCode)?.abilityAction(s.playerId, p.data);
      if (!r) return reply(ack, { ok: false, error: 'No stage is running.' });
      reply(ack, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
    });
    // P3C: salvage (pick up, drop, swap, hand over, install). Zod here, rules in the item system.
    socket.on('escape:action', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = EscapeActionSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid escape request' });
      const r = rooms.get(s.roomCode)?.escapeAction(s.playerId, p.data);
      if (!r) return reply(ack, { ok: false, error: 'No stage is running.' });
      reply(ack, r.ok ? { ok: true, message: r.message, ...(r.note ? { note: r.note } : {}) } : { ok: false, error: r.error });
    });
    // P3F step 4: the draft pick after a cleared stage. Zod here, rules in the Room.
    socket.on('draft:vote', (payload, ack) => {
      const p = DraftVoteSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid draft vote' });
      run(socket.id, ack, (pid, code) => rooms.get(code)!.draftVote(pid, p.data.index));
    });
    socket.on('item:action', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = ItemActionSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid item request' });
      const r = rooms.get(s.roomCode)?.itemAction(s.playerId, p.data);
      if (!r) return reply(ack, { ok: false, error: 'No stage is running.' });
      reply(ack, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
    });
    // P3E step 3: hide in the hiding spot in reach, or come out. Zod here, rules in the catch system.
    socket.on('ghost:action', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = GhostActionSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid request' });
      const r = rooms.get(s.roomCode)?.ghostAction(s.playerId, p.data);
      if (!r) return reply(ack, { ok: false, error: 'No stage is running.' });
      reply(ack, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
    });
    // P4 step 2: a dead player picks whom to watch, or says "ghost here". Zod here, rules in the spectate system (every refusal comes from there).
    socket.on('spectate:follow', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = SpectateFollowSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid request' });
      const r = rooms.get(s.roomCode)?.spectateFollow(s.playerId, p.data);
      if (!r) return reply(ack, { ok: false, error: 'No stage is running.' });
      reply(ack, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
    });
    // P4 step 6: the free-fly camera. Zod here (an intent of -1, 0 or 1 per axis, or a room), the bounds and the rate limit in the spectate system.
    socket.on('spectate:move', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = SpectateMoveSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid request' });
      const r = rooms.get(s.roomCode)?.spectateMove(s.playerId, p.data);
      if (!r) return reply(ack, { ok: false, error: 'No stage is running.' });
      reply(ack, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
    });
    socket.on('spectate:room', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = SpectateRoomSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid request' });
      const r = rooms.get(s.roomCode)?.spectateRoom(s.playerId, p.data);
      if (!r) return reply(ack, { ok: false, error: 'No stage is running.' });
      reply(ack, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
    });
    socket.on('spectate:ping', (_payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const r = rooms.get(s.roomCode)?.spectatePing(s.playerId);
      if (!r) return reply(ack, { ok: false, error: 'No stage is running.' });
      reply(ack, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
    });
    // P6 A: the ping wheel. Zod here (kind is an enum, coordinates are bounded numbers), every rule in Room.placePing / social/pings.ts. Sent at once, not on the next tick.
    socket.on('ping:place', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = PingRequestSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid request' });
      const room = rooms.get(s.roomCode);
      if (!room) return reply(ack, { ok: false, error: 'No stage is running.' });
      const r = room.placePing(s.playerId, p.data);
      if (r.ok) for (const { to, marker } of room.drainPingMarkers()) for (const [sid, sess] of sessions) if (sess.roomCode === room.code && sess.playerId === to) io.to(sid).emit('ping:marker', marker);
      reply(ack, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
    });
    // P6 A: team chat. Room scoped; the server cleans, limits and forwards the line to the room and keeps nothing.
    socket.on('chat:send', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = ChatSendSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid request' });
      const room = rooms.get(s.roomCode);
      if (!room) return reply(ack, { ok: false, error: 'Join a room first' });
      const r = room.chat(s.playerId, p.data.text, Date.now());
      if (r.ok) for (const msg of room.drainChat()) io.to(room.code).emit('chat:message', msg);
      reply(ack, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
    });
    // P3A: host advances to the next stage (endless loop). Uses the existing NEXT_STAGE room transition.
    socket.on('room:nextStage', (_payload, ack) => {
      run(socket.id, ack, (pid, code) => rooms.get(code)!.nextStage(pid));
    });
    // P4 step 4: from the death review, the SAME stage again on a new seed (the host; anyone once the host has left)
    socket.on('room:retry', (_payload, ack) => {
      run(socket.id, ack, (pid, code) => rooms.get(code)!.retryStage(pid));
    });
    socket.on('game:reset', (_payload, ack) => {
      run(socket.id, ack, (pid, code) => rooms.get(code)!.resetArena(pid));
    });

    socket.on('disconnect', () => {
      const s = sessions.get(socket.id);
      if (!s) return;
      sessions.delete(socket.id);
      const room = rooms.get(s.roomCode);
      if (!room) return;
      room.disconnect(s.playerId);
      if (room.connectedCount === 0) rooms.remove(room.code);
      else { broadcast(room.code); refreshRoom(room.code); } // the host may have changed: the room follows the NEW host's save and unlocks
    });
  });

  // Fixed-rate authoritative simulation for every room with an active run.
  let stopLoop: (() => void) | null = null;
  /** P3D step 4: the last stage state each player of a restricted room was sent (cleared with the room). */
  const views = new WeakMap<Room, Map<string, { key: string; rev: number }>>();
  /** P3E: the last ghost cue each player was sent (key without the tick, and the tick it was sent at). */
  const cues = new WeakMap<Room, Map<string, { key: string; tick: number }>>();
  /** P4: the last death state each player was sent (key without the countdowns, and the tick it was sent at). */
  const lifeSent = new WeakMap<Room, Map<string, { key: string; tick: number }>>();
  /** P6 A: the last team panel each player was sent (key without the tick, and when), and a per-room tick counter that thins the work to every 5th tick. */
  const panelSent = new WeakMap<Room, Map<string, { key: string; tick: number }>>();
  const panelClock = new WeakMap<Room, number>();
  const onTick = () => {
    rooms.forEach((room) => {
      // P4 step 4: a team wipe holds for a short beat, then turns into the review: each player is sent their OWN review (to that player's socket only)
      if (room.phase === 'team_wiped') {
        const { phaseChanged } = room.tick();
        if (phaseChanged) {
          broadcast(room.code);
          for (const [sid, sess] of sessions) {
            if (sess.roomCode !== room.code) continue;
            const review = room.reviewFor(sess.playerId);
            if (review) io.to(sid).emit('death:review', review);
          }
        }
        return;
      }
      if (room.phase !== 'briefing' && room.phase !== 'playing') return;
      const { phaseChanged } = room.tick();
      if (phaseChanged) broadcast(room.code);
      handleProgress(room); // P6 C: results and the host's save, queued (never blocks the tick)
      const restricted = room.restrictsViews; // P3D: an escape stage sends every player their own view
      const snap = restricted ? null : room.gameSnapshot();
      // Steady-state snapshots are volatile (a stale one is worthless). A snapshot that carries a phase change is
      // sent reliably: after stage completion the sim stops, so a dropped one would leave clients on a stale phase.
      if (snap) (phaseChanged ? io.to(room.code) : io.to(room.code).volatile).emit('game:snapshot', snap);
      // P3D: each player is told the layout of the room they begin in or enter: to that player's socket only, never broadcast.
      // P3E: what each player can HEAR of the ghost (distance bucket and direction; the documented exception to the vision invariant).
      // Sent when it changes (at most every GHOST_CUE.minGapTicks) and at least every GHOST_CUE.keepaliveTicks while the stage has a ghost.
      if (room.phase === 'playing') {
        let sentCues = cues.get(room);
        if (!sentCues) cues.set(room, (sentCues = new Map()));
        for (const [sid, sess] of sessions) {
          if (sess.roomCode !== room.code) continue;
          const cue = room.ghostCue(sess.playerId);
          if (!cue) continue;
          // the gun's countdown and the lights' countdown change every tick and are counted down by the client, so only their on/off flips make a new cue
          const key = JSON.stringify({ w: cue.warning, s: cue.sounds, t: cue.status, k: cue.warnKinds, g: cue.gun ? cue.gun.left > 0 : null, d: (cue.lightsOut ?? 0) > 0 });
          const last = sentCues.get(sess.playerId);
          const due = !last || (key !== last.key && cue.tick - last.tick >= GHOST_CUE.minGapTicks) || cue.tick - last.tick >= GHOST_CUE.keepaliveTicks || cue.tick < last.tick;
          if (!due) continue;
          sentCues.set(sess.playerId, { key, tick: cue.tick });
          io.to(sid).emit('ghost:cue', cue);
        }
      }
      // P4 step 2: each player's life and whom they watch (to that player only), when it changes and once a second; and the pings, to the players they concern.
      if (room.phase === 'playing') {
        let sentLife = lifeSent.get(room);
        if (!sentLife) lifeSent.set(room, (sentLife = new Map()));
        for (const [sid, sess] of sessions) {
          if (sess.roomCode !== room.code) continue;
          const ds = room.deathState(sess.playerId);
          if (!ds) continue;
          const key = JSON.stringify({ l: ds.life, f: ds.following?.id ?? null, w: ds.watchable.map((x) => x.id), p: ds.pingReadyIn > 0, c: ds.cam ? `${ds.cam.room}|${ds.cam.free}` : null, r: ds.reviving ? Math.floor(ds.reviving.progress * 10) : null, b: ds.beingRevived != null ? Math.floor(ds.beingRevived * 10) : null });
          const last = sentLife.get(sess.playerId);
          if (last && last.key === key && ds.tick - last.tick < SERVER_TICK_HZ && ds.tick >= last.tick) continue;
          sentLife.set(sess.playerId, { key, tick: ds.tick });
          io.to(sid).emit('death:state', ds);
        }
        for (const { to, ping } of room.drainPings()) {
          for (const [sid, sess] of sessions) if (sess.roomCode === room.code && to.includes(sess.playerId)) io.to(sid).emit('ghost:ping', ping);
        }
      }
      // P6 A: the team panel, to each player alone: when it changes (checked every 5th tick) and at least once a second.
      if (room.phase === 'playing') {
        const n = (panelClock.get(room) ?? 0) + 1;
        panelClock.set(room, n);
        if (n % 5 === 0) {
          let sentPanels = panelSent.get(room);
          if (!sentPanels) panelSent.set(room, (sentPanels = new Map()));
          for (const [sid, sess] of sessions) {
            if (sess.roomCode !== room.code) continue;
            const panel = room.teamPanel(sess.playerId);
            if (!panel) continue;
            const key = JSON.stringify({ ...panel, tick: 0 });
            const last = sentPanels.get(sess.playerId);
            if (last && last.key === key && panel.tick - last.tick < SERVER_TICK_HZ && panel.tick >= last.tick) continue;
            sentPanels.set(sess.playerId, { key, tick: panel.tick });
            io.to(sid).emit('team:panel', panel);
          }
        }
      }
      // P3E step 4: Pulse Gun shots, each to the players who can see where it was fired (and its shooter) only.
      for (const { to, shot } of room.drainShots()) {
        for (const [sid, sess] of sessions) if (sess.roomCode === room.code && to.includes(sess.playerId)) io.to(sid).emit('ghost:shot', shot);
      }
      // P3E step 5: a ghost dissolved or a Howler screamed: only to the players who can see the spot.
      for (const { to, fx } of room.drainFx()) {
        for (const [sid, sess] of sessions) if (sess.roomCode === room.code && to.includes(sess.playerId)) io.to(sid).emit('ghost:fx', fx);
      }
      const layouts = room.drainLayouts();
      if (layouts.length > 0) {
        const socketOf = new Map<string, string>();
        for (const [sid, sess] of sessions) if (sess.roomCode === room.code) socketOf.set(sess.playerId, sid);
        for (const { playerId, layout } of layouts) { const sid = socketOf.get(playerId); if (sid) io.to(sid).emit('room:layout', layout); }
      }
      const stage = room.consumeStageState();
      if (!restricted) {
        if (stage) io.to(room.code).emit('stage:state', stage); // reliable: full, idempotent state
        return;
      }
      // P3D step 4: per player, only what that player can see. The stage state changes when the player MOVES (things come into view),
      // not only when the stage does, so it is sent whenever this player's own view differs from the last one they were sent.
      let sent = views.get(room);
      if (!sent) views.set(room, (sent = new Map()));
      for (const [sid, sess] of sessions) {
        if (sess.roomCode !== room.code) continue;
        const v = room.viewFor(sess.playerId);
        if (!v) continue;
        (phaseChanged ? io.to(sid) : io.to(sid).volatile).emit('game:snapshot', v.snapshot);
        const key = JSON.stringify({ ...v.stage, rev: 0, tick: 0 }); // `tick` moves every tick; clients take the time from the snapshot
        const last = sent.get(sess.playerId);
        if (last?.key === key) continue;
        const rev = Math.max(v.stage.rev, (last?.rev ?? 0) + 1); // the client ignores an older revision: keep this player's strictly rising
        sent.set(sess.playerId, { key, rev });
        io.to(sid).emit('stage:state', { ...v.stage, rev });
      }
    });
  };

  return {
    io, http, rooms,
    listen: (port) => new Promise((resolve) => {
      http.listen(port, () => {
        stopLoop = startFixedLoop(SERVER_TICK_HZ, onTick);
        const addr = http.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    }),
    drain: () => { draining = true; },
    stats: () => ({ connections, rooms: rooms.count, draining }),
    close: () => new Promise((resolve) => {
      draining = true;
      stopLoop?.(); stopLoop = null;
      // `io.close` closes the http server too; a keep-alive connection could hold it open, so close any idle ones as well
      void io.close(() => resolve());
      http.closeIdleConnections?.();
      setTimeout(() => { http.closeAllConnections?.(); }, 2000).unref();
    }),
  };
}
