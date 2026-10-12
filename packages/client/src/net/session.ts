import { io, type Socket } from 'socket.io-client';
import {
  RoomSnapshotSchema,
  type Ack, type ClientToServerEvents, type Difficulty, type RoomSnapshot, type ServerToClientEvents,
} from '@wb/shared';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Thin typed wrapper over the server connection. The client never mutates game state itself. */
export class Session {
  private socket: S = io({ transports: ['websocket'] });
  snapshot: RoomSnapshot | null = null;
  playerId = '';
  connected = false;
  error = '';

  constructor() {
    this.socket.on('connect', () => { this.connected = true; });
    this.socket.on('disconnect', () => { this.connected = false; this.snapshot = null; });
    this.socket.on('connect_error', () => { this.connected = false; this.error = 'Cannot reach server'; });
    this.socket.on('room:state', (raw) => {
      const parsed = RoomSnapshotSchema.safeParse(raw);
      if (parsed.success) this.snapshot = parsed.data;
    });
  }

  private call<T extends Ack<any>>(ev: keyof ClientToServerEvents, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      (this.socket as Socket).timeout(5000).emit(ev, payload, (err: Error | null, res: T) =>
        resolve(err ? ({ ok: false, error: 'Server timeout' } as T) : res));
    });
  }

  async join(name: string, roomCode?: string): Promise<void> {
    const r = await this.call<Ack<{ roomCode: string; playerId: string }>>('room:join', { name, roomCode });
    if (r.ok) { this.playerId = r.playerId; this.error = ''; } else this.error = r.error;
  }
  async setReady(ready: boolean) { this.report(await this.call('room:ready', { ready })); }
  async setDifficulty(difficulty: Difficulty) { this.report(await this.call('room:setDifficulty', { difficulty })); }
  async start() { this.report(await this.call('room:start', {})); }
  private report(r: Ack<any>) { this.error = r.ok ? '' : r.error; }
}
