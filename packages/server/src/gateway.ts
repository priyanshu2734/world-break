import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import {
  AbilityActionSchema, DifficultyPayloadSchema, EscapeActionSchema, GHOST_CUE, GameInputSchema, GhostActionSchema, ItemActionSchema, JoinPayloadSchema, ReadyPayloadSchema, SERVER_TICK_HZ, StageActionSchema,
  type ClientToServerEvents, type ServerToClientEvents, type Ack,
} from '@wb/shared';
import { RoomManager, type Result, type Room } from './room';
import { startFixedLoop } from './loop';

export interface GameServer {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  http: HttpServer;
  rooms: RoomManager;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

export function createGameServer(opts: { corsOrigin?: string; briefingTicks?: number; abilityLab?: boolean; huntStage?: boolean; escapeStages?: boolean; ghostStages?: boolean } = {}): GameServer {
  const http = createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
    res.writeHead(404).end();
  });
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    cors: { origin: opts.corsOrigin ?? 'http://localhost:5173' },
  });
  // P3E: the ghost. Off unless the caller says so or the server is started with GHOST_STAGES=1 (config.ts and main.ts are outside this phase's file list, so the variable is read here).
  const ghostOn = opts.ghostStages ?? process.env.GHOST_STAGES === '1';
  const rooms = new RoomManager({ briefingTicks: opts.briefingTicks, huntStage: opts.huntStage });
  // socket.id -> membership. playerId is a server-issued opaque id, never client-chosen.
  const sessions = new Map<string, { playerId: string; roomCode: string }>();

  const broadcast = (code: string) => {
    const room = rooms.get(code);
    if (room) io.to(code).emit('room:state', room.snapshot());
  };
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
    socket.on('room:join', (payload, ack) => {
      const parsed = JoinPayloadSchema.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, error: 'Invalid join request' });
      if (sessions.has(socket.id)) return reply(ack, { ok: false, error: 'Already joined' });
      const { roomCode, name, lab, rooms: wantRooms, ghost: wantGhost } = parsed.data;
      // P3B dev flag: only a NEW room can become an Ability Lab room, and only if the server allows it (ABILITY_LAB=1).
      if (lab && !roomCode && !opts.abilityLab) return reply(ack, { ok: false, error: 'The Ability Lab is not enabled on this server (start it with ABILITY_LAB=1).' });
      // P3D dev flag: the multi-room demo, only on creation and only when escape stages are enabled (ESCAPE_STAGES, default on for the dev server).
      if (wantRooms && !roomCode && !opts.escapeStages) return reply(ack, { ok: false, error: 'Escape stages are not enabled on this server (ESCAPE_STAGES is 0).' });
      // P3E dev flag: the ghost, starting at a given stage, only on creation and only when escape stages are enabled (like the multi-room demo).
      if (wantGhost !== undefined && !roomCode && !opts.escapeStages) return reply(ack, { ok: false, error: 'Escape stages are not enabled on this server (ESCAPE_STAGES is 0).' });
      const room = roomCode ? rooms.get(roomCode) : rooms.create({ lab: lab === true, ...(wantRooms ? { rooms: wantRooms } : {}), escape: opts.escapeStages === true, ghost: opts.escapeStages === true && (ghostOn || wantGhost !== undefined), ...(wantGhost !== undefined ? { startStage: Math.max(2, wantGhost) } : {}) });
      if (!room) return reply(ack, { ok: false, error: 'Room not found' });
      const playerId = randomUUID();
      const r = room.join(playerId, name);
      if (!r.ok) { if (room.size === 0) rooms.remove(room.code); return reply(ack, r); }
      sessions.set(socket.id, { playerId, roomCode: room.code });
      void socket.join(room.code);
      reply(ack, { ok: true, roomCode: room.code, playerId });
      broadcast(room.code);
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
    // P3A: host advances to the next stage (endless loop). Uses the existing NEXT_STAGE room transition.
    socket.on('room:nextStage', (_payload, ack) => {
      run(socket.id, ack, (pid, code) => rooms.get(code)!.nextStage(pid));
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
      else broadcast(room.code);
    });
  });

  // Fixed-rate authoritative simulation for every room with an active run.
  let stopLoop: (() => void) | null = null;
  /** P3D step 4: the last stage state each player of a restricted room was sent (cleared with the room). */
  const views = new WeakMap<Room, Map<string, { key: string; rev: number }>>();
  /** P3E: the last ghost cue each player was sent (key without the tick, and the tick it was sent at). */
  const cues = new WeakMap<Room, Map<string, { key: string; tick: number }>>();
  const onTick = () => {
    rooms.forEach((room) => {
      if (room.phase !== 'briefing' && room.phase !== 'playing') return;
      const { phaseChanged } = room.tick();
      if (phaseChanged) broadcast(room.code);
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
    close: () => new Promise((resolve) => { stopLoop?.(); void io.close(() => resolve()); }),
  };
}
