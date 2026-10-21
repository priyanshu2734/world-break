import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import {
  AbilityActionSchema, DifficultyPayloadSchema, GameInputSchema, ItemActionSchema, JoinPayloadSchema, ReadyPayloadSchema, SERVER_TICK_HZ, StageActionSchema,
  type ClientToServerEvents, type ServerToClientEvents, type Ack,
} from '@wb/shared';
import { RoomManager, type Result } from './room';
import { startFixedLoop } from './loop';

export interface GameServer {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  http: HttpServer;
  rooms: RoomManager;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

export function createGameServer(opts: { corsOrigin?: string; briefingTicks?: number; abilityLab?: boolean; huntStage?: boolean; escapeStages?: boolean } = {}): GameServer {
  const http = createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
    res.writeHead(404).end();
  });
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    cors: { origin: opts.corsOrigin ?? 'http://localhost:5173' },
  });
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
      const { roomCode, name, lab, rooms: wantRooms } = parsed.data;
      // P3B dev flag: only a NEW room can become an Ability Lab room, and only if the server allows it (ABILITY_LAB=1).
      if (lab && !roomCode && !opts.abilityLab) return reply(ack, { ok: false, error: 'The Ability Lab is not enabled on this server (start it with ABILITY_LAB=1).' });
      // P3D dev flag: the multi-room demo, only on creation and only when escape stages are enabled (ESCAPE_STAGES, default on for the dev server).
      if (wantRooms && !roomCode && !opts.escapeStages) return reply(ack, { ok: false, error: 'Escape stages are not enabled on this server (ESCAPE_STAGES is 0).' });
      const room = roomCode ? rooms.get(roomCode) : rooms.create({ lab: lab === true, rooms: wantRooms === true });
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
      rooms.get(s.roomCode)?.submitInput(s.playerId, p.data.seq, { moveX: p.data.moveX, jump: p.data.jump });
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
    socket.on('item:action', (payload, ack) => {
      const s = sessions.get(socket.id);
      if (!s) return reply(ack, { ok: false, error: 'Join a room first' });
      const p = ItemActionSchema.safeParse(payload);
      if (!p.success) return reply(ack, { ok: false, error: 'Invalid item request' });
      const r = rooms.get(s.roomCode)?.itemAction(s.playerId, p.data);
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
  const onTick = () => {
    rooms.forEach((room) => {
      if (room.phase !== 'briefing' && room.phase !== 'playing') return;
      const { phaseChanged } = room.tick();
      if (phaseChanged) broadcast(room.code);
      const snap = room.gameSnapshot();
      // Steady-state snapshots are volatile (a stale one is worthless). A snapshot that carries a phase change is
      // sent reliably: after stage completion the sim stops, so a dropped one would leave clients on a stale phase.
      if (snap) (phaseChanged ? io.to(room.code) : io.to(room.code).volatile).emit('game:snapshot', snap);
      // P3D: each player is told the layout of the room they begin in or enter: to that player's socket only, never broadcast.
      const layouts = room.drainLayouts();
      if (layouts.length > 0) {
        const socketOf = new Map<string, string>();
        for (const [sid, sess] of sessions) if (sess.roomCode === room.code) socketOf.set(sess.playerId, sid);
        for (const { playerId, layout } of layouts) { const sid = socketOf.get(playerId); if (sid) io.to(sid).emit('room:layout', layout); }
      }
      const stage = room.consumeStageState();
      if (stage) io.to(room.code).emit('stage:state', stage); // reliable: full, idempotent state
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
