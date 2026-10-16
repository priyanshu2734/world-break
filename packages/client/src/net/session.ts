import { io, type Socket } from 'socket.io-client';
import {
  GameSnapshotSchema, RoomSnapshotSchema, StageStateSchema,
  type Ack, type ClientToServerEvents, type Difficulty, type GameSnapshot, type InputIntent, type StageAction, type StageState,
  type RoomSnapshot, type ServerToClientEvents,
} from '@wb/shared';
import { SnapshotBuffer } from './interpolation';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Thin typed wrapper over the server connection. The client never mutates game state itself. */
export class Session {
  private socket: S = io({ transports: ['websocket'] });
  snapshot: RoomSnapshot | null = null;
  /** P1: latest authoritative simulation snapshot, its history, and a counter bumped per snapshot. */
  game: GameSnapshot | null = null;
  readonly buffer = new SnapshotBuffer();
  gameSerial = 0;
  /** P2: latest public stage state (server-authoritative; the client never computes repair outcomes). */
  stage: StageState | null = null;
  /** Result of the most recent action, for HUD feedback. */
  notice: { text: string; ok: boolean; at: number } | null = null;
  playerId = '';
  connected = false;
  error = '';

  constructor() {
    this.socket.on('connect', () => { this.connected = true; });
    this.socket.on('disconnect', () => { this.connected = false; this.snapshot = null; this.game = null; this.stage = null; this.buffer.clear(); });
    this.socket.on('connect_error', () => { this.connected = false; this.error = 'Cannot reach server'; });
    this.socket.on('room:state', (raw) => {
      const parsed = RoomSnapshotSchema.safeParse(raw);
      if (parsed.success) this.snapshot = parsed.data;
    });
    this.socket.on('stage:state', (raw) => {
      const parsed = StageStateSchema.safeParse(raw);
      if (parsed.success && (!this.stage || parsed.data.rev >= this.stage.rev)) this.stage = parsed.data;
    });
    this.socket.on('game:snapshot', (raw) => {
      const parsed = GameSnapshotSchema.safeParse(raw);
      if (!parsed.success) return;
      this.game = parsed.data;
      this.buffer.push(performance.now(), parsed.data);
      this.gameSerial++;
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
  /**
   * Send a movement intent (never a position). Deliberately NOT volatile: after a frame hitch the
   * predictor emits a burst of ticks in one frame and Socket.IO drops all but the first volatile
   * packet while the transport is mid-write. Inputs are tiny and ordered by seq, so reliable is right.
   */
  sendInput(seq: number, input: InputIntent) {
    if (!this.socket.connected) return; // never queue stale input for a later reconnect
    this.socket.emit('game:input', { seq, moveX: input.moveX, jump: input.jump });
  }
  /** Ask the server to perform a stage action; shows the server's verdict in the HUD. */
  async stageAction(action: StageAction): Promise<void> {
    const r = await this.call<Ack<{ message: string }>>('stage:action', action);
    this.notice = { text: r.ok ? r.message : r.error, ok: r.ok, at: performance.now() };
  }
  async resetArena() { this.report(await this.call('game:reset', {})); }
  /** P3A: host-only. Asks the server to advance from a completed stage to the next one (stages are endless). */
  async nextStage() { this.report(await this.call('room:nextStage', {})); }
  private report(r: Ack<any>) { this.error = r.ok ? '' : r.error; }
}
