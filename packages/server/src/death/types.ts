import type { GhostType, ItemKind, PlayerLife } from '@wb/shared';

/** Where one player is, as the death rules need it. Feet-centre like every body. */
export interface DeathWho { id: string; name: string; slot: number; room: string; x: number; y: number; connected: boolean }

/** A part a player carries (what the review will say they held). */
export interface CarriedItem { itemId: string; kind: ItemKind }

/** A part that has just been put down where a player died, with the spot it came to rest on. */
export interface DroppedItem extends CarriedItem { x: number; y: number; room: string | null }

/** What the death rules may ask of their host (the Room). A narrow seam, so they are unit-testable without a Room. */
export interface DeathHost {
  readonly tick: number;
  /** Every player of the run, in slot order. */
  who(): DeathWho[];
  /** Freeze (a body or a spectator: no movement) or free a player. */
  freeze(id: string, on: boolean): void;
  /** The parts a player carries right now. */
  carried(id: string): CarriedItem[];
  /** Put ONE carried part down where the player stands (the item system rate-limits this: one per few ticks). `left` = parts still carried. */
  dropOne(id: string): { left: number; dropped: DroppedItem | null };
  /** Last resort when `dropOne` keeps failing: put everything down at once (the same path a lost connection takes). */
  dropAll(id: string): void;
  /** Take the player out of the hiding spot they are in, if any. */
  leaveHiding(id: string): void;
  say(text: string, tone: 'info' | 'good' | 'warn' | 'bad', room?: string): void;
}

/** What killed a player, from the ghost's own catch event (never invented). */
export interface KillCause {
  how: 'touch' | 'opened_spot';
  /** The ghost's id on this stage ("g0") and its type. */
  ghost: string;
  ghostKind: GhostType | null;
  /** The ghost's own reasons, in order ("Heard Ada running at tick 412", "Saw Ada at tick 440", "Caught Ada at tick 466"). */
  because: string[];
}

export type KillRefusal = 'unknown_player' | 'not_alive' | 'spawn_grace' | 'protected';
export type KillResult = { ok: true; life: PlayerLife } | { ok: false; reason: KillRefusal };

interface Ev { tick: number }
/** Everything the death system records. Plain data, bounded ring, every entry carries the tick it happened at. */
export type DeathEvent =
  | (Ev & { kind: 'killed'; player: string; name: string; life: PlayerLife; cause: KillCause; room: string; x: number; y: number; carrying: CarriedItem[]; reviveUntil: number | null })
  | (Ev & { kind: 'kill_refused'; player: string; reason: KillRefusal; ghost: string })
  | (Ev & { kind: 'item_dropped'; player: string; itemId: string; itemKind: ItemKind; room: string | null; x: number; y: number; relocated: boolean })
  | (Ev & { kind: 'drops_forced'; player: string; left: number })
  | (Ev & { kind: 'window_expired'; player: string; name: string })
  | (Ev & { kind: 'revived'; player: string; name: string; by: string | null; protectedUntil: number })
  | (Ev & { kind: 'disconnected'; player: string; life: PlayerLife });

/** A body lying where a player died (a downed player), as the rest of the game may ask about it. */
export interface BodyInfo { id: string; name: string; room: string; x: number; y: number; reviveUntil: number }
