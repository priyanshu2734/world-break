import {
  CHAT_LIMITS, PING_ANCHOR, PING_KINDS, PING_LABELS, PING_LIMITS, SERVER_TICK_HZ, sanitiseChat,
  type ChatMessage, type PingKind, type PingMarker, type PingRequest, type TeamPanel, type TeamState,
} from '@wb/shared';

/**
 * P6 A: the logic of the team panel, the ping wheel, ping markers and team chat, as pure functions and small classes (docs/PING.md).
 * Nothing here talks to the server or draws: `TeamView` does that. The server decides every outcome; this side only asks and shows.
 */

/** The wheel opens when Q is HELD this long; a shorter press is the old Q (cancel). */
export const WHEEL = { holdMs: 220, deadzone: 28, radius: 104 } as const;
/** How long a marker is drawn (the server's ttl, in ms) and how long a chat toast stays up. */
export const MARKER_MS = (PING_LIMITS.ttlTicks / SERVER_TICK_HZ) * 1000;
export const TOAST_MS = 7000;
export const FADE_MS = 1000;
/** The longest chat line the box accepts (the server enforces the same limit). */
export const CHAT_MAX = CHAT_LIMITS.maxLen;

/** The wheel slot a pointer offset (from the wheel's centre, screen pixels) selects. Slot 0 is straight up, then clockwise; inside the dead zone = nothing. */
export function wheelSlot(dx: number, dy: number, deadzone: number = WHEEL.deadzone): PingKind | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < deadzone) return null;
  const turn = 2 * Math.PI, n = PING_KINDS.length;
  const a = (Math.atan2(dy, dx) + Math.PI / 2 + turn) % turn; // 0 = up, clockwise
  const i = Math.floor(((a + turn / n / 2) % turn) / (turn / n));
  return PING_KINDS[i % n] ?? null;
}
/** Screen angle (radians, 0 = right) of the middle of slot `i`, for drawing. */
export const slotAngle = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / PING_KINDS.length;

export type QEvent = 'none' | 'open' | 'tap' | 'select';
/**
 * The Q key: a tap (released before `WHEEL.holdMs`) is a tap (the old Q, cancel); holding it opens the wheel; releasing an open wheel selects.
 * `step` is called once per frame with whether Q is down.
 */
export class QGesture {
  private downAt: number | null = null;
  private open = false;
  get isOpen(): boolean { return this.open; }
  step(isDown: boolean, now: number): QEvent {
    if (isDown) {
      if (this.downAt === null) { this.downAt = now; return 'none'; }
      if (!this.open && now - this.downAt >= WHEEL.holdMs) { this.open = true; return 'open'; }
      return 'none';
    }
    if (this.downAt === null) return 'none';
    const was = this.open;
    this.downAt = null; this.open = false;
    return was ? 'select' : 'tap';
  }
  /** Forget a half-made gesture (Esc, losing focus, becoming a spectator). */
  reset(): void { this.downAt = null; this.open = false; }
}

/** Does this kind need a point in the world (the others are placed by the server)? */
export const needsPoint = (kind: PingKind): boolean => PING_ANCHOR[kind] === 'point';
/** The request for a kind: a point kind carries the (rounded) world point, the others carry nothing the server would read. */
export function pingRequest(kind: PingKind, point: { x: number; y: number } | null): PingRequest | null {
  if (!needsPoint(kind)) return { kind };
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { kind, x: Math.round(point.x), y: Math.round(point.y) };
}

// ---------------------------------------------------------------- markers

export interface LiveMarker { marker: PingMarker; at: number }
export interface Rect { x: number; y: number; w: number; h: number }
/** Adds a marker (same id replaces), drops the expired and keeps at most one team's worth. */
export function addMarker(list: readonly LiveMarker[], marker: PingMarker, now: number): LiveMarker[] {
  return [...pruneMarkers(list, now).filter((l) => l.marker.id !== marker.id), { marker, at: now }].slice(-PING_LIMITS.perTeam);
}
export function pruneMarkers(list: readonly LiveMarker[], now: number): LiveMarker[] { return list.filter((l) => now - l.at < MARKER_MS); }
/** 1 for most of the life, then a fade over the last `FADE_MS`. */
export function markerAlpha(ageMs: number): number {
  if (ageMs < 0) return 1;
  const left = MARKER_MS - ageMs;
  return left <= 0 ? 0 : left >= FADE_MS ? 1 : left / FADE_MS;
}
export interface MarkerDraw {
  /** `world`: draw at (x, y) in the world. `edge`: it is off screen: draw an arrow at (x, y) on the edge of the view, pointing `angle`. `room`: it is in another room: only a label. */
  mode: 'world' | 'edge' | 'room';
  x: number; y: number; angle: number; alpha: number; label: string; slot: number;
}
/** Where and how to draw one marker. A marker the server sent without a position (another room) is ONLY ever a label. */
export function placeMarker(l: LiveMarker, now: number, view: Rect, margin = 28): MarkerDraw | null {
  const age = now - l.at, alpha = markerAlpha(age);
  if (alpha <= 0) return null;
  const m = l.marker, text = `${m.name}: ${PING_LABELS[m.kind]}`;
  if (m.x === undefined || m.y === undefined) return { mode: 'room', x: 0, y: 0, angle: 0, alpha, label: `${text} (another room)`, slot: m.slot };
  const inside = m.x >= view.x + margin && m.x <= view.x + view.w - margin && m.y >= view.y + margin && m.y <= view.y + view.h - margin;
  if (inside) return { mode: 'world', x: m.x, y: m.y, angle: 0, alpha, label: text, slot: m.slot };
  const cx = view.x + view.w / 2, cy = view.y + view.h / 2, dx = m.x - cx, dy = m.y - cy;
  const t = Math.min(dx === 0 ? Infinity : (view.w / 2 - margin) / Math.abs(dx), dy === 0 ? Infinity : (view.h / 2 - margin) / Math.abs(dy));
  return { mode: 'edge', x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx), alpha, label: text, slot: m.slot };
}

// ---------------------------------------------------------------- chat

export interface ChatLine { msg: ChatMessage; at: number }
/**
 * What this client remembers of the team chat: the last few lines, in memory only (the server keeps nothing, and this is dropped when the room is left).
 * A muted sender's lines are never stored. Your own lines cannot be muted.
 */
export class ChatLog {
  private lines: ChatLine[] = [];
  private muted = new Set<string>();
  get mutedIds(): ReadonlySet<string> { return this.muted; }
  isMuted(id: string): boolean { return this.muted.has(id); }
  /** Returns the new state (true = now muted), or null for yourself. */
  toggleMute(id: string, selfId: string): boolean | null {
    if (id === selfId) return null;
    if (this.muted.has(id)) { this.muted.delete(id); return false; }
    this.muted.add(id);
    this.lines = this.lines.filter((l) => l.msg.from !== id);
    return true;
  }
  /** Stores a line (cleaned again here: this side never trusts markup either). Returns whether it was kept. */
  push(msg: ChatMessage, now: number, selfId: string): boolean {
    if (msg.from !== selfId && this.muted.has(msg.from)) return false;
    const text = sanitiseChat(msg.text).slice(0, CHAT_LIMITS.maxLen);
    if (text === '') return false;
    this.lines = [...this.lines, { msg: { ...msg, text }, at: now }].slice(-CHAT_LIMITS.clientKeep);
    return true;
  }
  /** The lines still on screen as toasts (newest last, at most `max`), each with its fade. */
  toasts(now: number, max = 4): { line: ChatLine; alpha: number }[] {
    return this.lines.filter((l) => now - l.at < TOAST_MS).slice(-max).map((l) => ({ line: l, alpha: Math.min(1, (TOAST_MS - (now - l.at)) / FADE_MS) }));
  }
  recent(max = 6): ChatLine[] { return this.lines.slice(-max); }
  clear(): void { this.lines = []; }
}

// ---------------------------------------------------------------- the panel

export const STATE_TEXT: Readonly<Record<TeamState, string>> = { alive: 'alive', hiding: 'hiding', dead: 'down', spectating: 'spectating', disconnected: 'disconnected' };
export interface PanelRow { id: string; name: string; slot: number; self: boolean; text: string; muted: boolean; canMute: boolean; state: TeamState }
export function panelRows(panel: TeamPanel | null, selfId: string, muted: ReadonlySet<string>): PanelRow[] {
  if (!panel) return [];
  return panel.members.map((m) => ({
    id: m.id, name: m.name, slot: m.slot, self: m.id === selfId, state: m.state,
    text: `${m.name}${m.id === selfId ? ' (you)' : ''}  ${STATE_TEXT[m.state]}${m.carried !== undefined ? `  carrying ${m.carried}` : ''}`,
    muted: muted.has(m.id), canMute: m.id !== selfId,
  }));
}
export function journalLine(panel: TeamPanel | null): string | null {
  const j = panel?.journal;
  return j ? `Journal: ${j.found} piece${j.found === 1 ? '' : 's'} examined, ${j.marked} of ${j.lines} marked` : null;
}
