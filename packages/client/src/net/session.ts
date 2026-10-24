import { io, type Socket } from 'socket.io-client';
import {
  GameSnapshotSchema, RoomLayoutSchema, RoomSnapshotSchema, StageStateSchema,
  type AbilityAction, type Ack, type ItemAction, type ClientToServerEvents, type Difficulty, type GameSnapshot, type InputIntent, type StageAction, type StageState,
  type EscapeAction, type EscapeAck, type RoomLayout, type RoomSnapshot, type ServerToClientEvents,
} from '@wb/shared';
import { addNote } from '../ui/escapeUse';
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
  /** P3D: the layout of every room this player has been told about, by room id (= arena id). Only rooms the server sent are known. */
  readonly layouts = new Map<string, RoomLayout>();
  /** Counts every layout received: the server re-sends the layout of the room you are in whenever a door moves you, even within one room (a gate). */
  layoutSeq = 0;
  /** P3D: clue text this player has read (it is never in the public state; only the reader gets it). */
  readonly notes: { id: string; text: string }[] = [];
  /** Result of the most recent action, for HUD feedback. */
  notice: { text: string; ok: boolean; at: number } | null = null;
  playerId = '';
  connected = false;
  error = '';

  constructor() {
    this.socket.on('connect', () => { this.connected = true; });
    this.socket.on('disconnect', () => { this.connected = false; this.snapshot = null; this.game = null; this.stage = null; this.layouts.clear(); this.buffer.clear(); });
    this.socket.on('connect_error', () => { this.connected = false; this.error = 'Cannot reach server'; });
    this.socket.on('room:state', (raw) => {
      const parsed = RoomSnapshotSchema.safeParse(raw);
      if (parsed.success) this.snapshot = parsed.data;
    });
    this.socket.on('room:layout', (raw) => {
      const parsed = RoomLayoutSchema.safeParse(raw);
      if (parsed.success) { this.layouts.set(parsed.data.roomId, parsed.data); this.layoutSeq++; }
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

  async join(name: string, roomCode?: string, lab = false, rooms: boolean | 2 = false): Promise<void> {
    const r = await this.call<Ack<{ roomCode: string; playerId: string }>>('room:join', { name, roomCode, ...(lab && !roomCode ? { lab: true } : {}), ...(rooms && !roomCode ? { rooms } : {}) });
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
  /** P3B: ask the server to use a reality ability; the server's verdict shows in the HUD. */
  async abilityUse(action: AbilityAction): Promise<void> {
    const r = await this.call<Ack<{ message: string }>>('ability:use', action);
    this.notice = { text: r.ok ? r.message : r.error, ok: r.ok, at: performance.now() };
  }
  /** P3C: ask the server to pick up, drop, swap, hand over, install or open. The server's verdict shows in the HUD. */
  async itemAction(action: ItemAction): Promise<void> {
    const r = await this.call<Ack<{ message: string }>>('item:action', action);
    this.notice = { text: r.ok ? r.message : r.error, ok: r.ok, at: performance.now() };
  }
  /** P3D: use a door, enter a code, press a switch or read a clue. The server's verdict shows in the HUD; a clue's text is kept as a note. */
  async escapeAction(action: EscapeAction): Promise<Ack<EscapeAck>> {
    const r = await this.call<Ack<EscapeAck>>('escape:action', action);
    this.notice = { text: r.ok ? r.message : r.error, ok: r.ok, at: performance.now() };
    if (r.ok && r.note) addNote(this.notes, r.note);
    return r;
  }
  async resetArena() { this.report(await this.call('game:reset', {})); }
  /** P3A: host-only. Asks the server to advance from a completed stage to the next one (stages are endless). */
  async nextStage() { this.report(await this.call('room:nextStage', {})); }
  private report(r: Ack<any>) { this.error = r.ok ? '' : r.error; }
}
