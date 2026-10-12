import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import {
  DifficultyPayloadSchema, JoinPayloadSchema, ReadyPayloadSchema,
  type ClientToServerEvents, type ServerToClientEvents, type Ack,
} from '@wb/shared';
import { RoomManager, type Result } from './room';

export interface GameServer {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  http: HttpServer;
  rooms: RoomManager;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

export function createGameServer(opts: { corsOrigin?: string } = {}): GameServer {
  const http = createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
    res.writeHead(404).end();
  });
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    cors: { origin: opts.corsOrigin ?? 'http://localhost:5173' },
  });
  const rooms = new RoomManager();
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
      const { roomCode, name } = parsed.data;
      const room = roomCode ? rooms.get(roomCode) : rooms.create();
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

    socket.on('disconnect', () => {
      const s = sessions.get(socket.id);
      if (!s) return;
      sessions.delete(socket.id);
      const room = rooms.get(s.roomCode);
      if (!room) return;
      room.leave(s.playerId);
      if (room.size === 0) rooms.remove(room.code);
      else broadcast(room.code);
    });
  });

  return {
    io, http, rooms,
    listen: (port) => new Promise((resolve) => {
      http.listen(port, () => {
        const addr = http.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    }),
    close: () => new Promise((resolve) => { void io.close(() => resolve()); }),
  };
}
