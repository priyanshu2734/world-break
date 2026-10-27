import type { Arena } from '@wb/shared';
import type { Room } from '../../src/room';
import { Bot, Team } from '../rooms/bot';

interface Spot { id: string; room: string; x: number; y: number }
type Mode = { kind: 'free' } | { kind: 'going'; spot: Spot; since: number } | { kind: 'hidden'; since: number; quiet: number };

/**
 * A team of solver bots with a SURVIVAL REFLEX (P3E step 5): when a player is warned (the lights flicker) or hears a ghost, they walk to the nearest hiding
 * spot of their room, hide, wait until the ghost is gone (no warning and nothing audible for a while) and come out again. The whole detour runs inside ONE
 * call of `tick`, so the solver's own step budgets are not eaten by the waiting. It is real play: real input, the real `ghostAction`, the real ghost.
 */
export class HideTeam extends Team {
  hides = 0;
  catches = 0;
  private readonly modes = new Map<string, Mode>();
  private inDetour = false;
  private returning = false;
  private readonly spots: Spot[];

  constructor(room: Room, arenaOf: (roomId: string) => Arena, spots: readonly Spot[]) {
    super(room, arenaOf);
    this.spots = [...spots];
  }

  private mode(id: string): Mode { return this.modes.get(id) ?? { kind: 'free' }; }
  private threatened(id: string): boolean {
    const cue = this.room.ghostCue(id);
    return !!cue && (cue.warning || cue.sounds.length > 0);
  }
  private captured(id: string): boolean { return this.room.catchSystem?.isCaptured(id) ?? false; }

  override tick(inputs: Readonly<Record<string, import('@wb/shared').InputIntent>> = {}): void {
    if (this.inDetour || this.returning || !this.room.ghostSystem) { super.tick(inputs); return; }
    const ids = (this.room.gameSnapshot()?.players ?? []).map((p) => p.id);
    // a player who is threatened (and not already handled) starts a reaction
    for (const id of ids) {
      if (this.mode(id).kind !== 'free' || this.captured(id) || !this.threatened(id)) continue;
      const p = this.player(id);
      // the nearest spot, but not toward a ghost that can be heard on one side
      const dir = this.room.ghostCue(id)?.sounds[0]?.dir ?? 0;
      const cost = (sp: Spot) => Math.abs(sp.x - p.x) + (dir !== 0 && Math.sign(sp.x - p.x) === dir && Math.abs(sp.x - p.x) > 80 ? 100000 : 0);
      const here = this.spots.filter((s) => s.room === p.roomId).sort((a, b) => cost(a) - cost(b));
      if (here[0]) this.modes.set(id, { kind: 'going', spot: here[0], since: 0 });
    }
    if (ids.every((id) => this.mode(id).kind === 'free' && !this.captured(id))) { super.tick(inputs); return; }
    const before = new Map(ids.map((id) => { const b = this.body(id); return [id, { room: this.roomOf(id), x: b.x, y: b.y, grounded: b.grounded }] as const; }));
    this.detour(ids);
    // back to where each player was, on foot, so the solver carries on from the place it expects
    this.returning = true;
    try {
      for (const id of ids) {
        const was = before.get(id)!;
        const b = this.body(id);
        if (this.room.phase !== 'playing' || this.captured(id) || !was.grounded || this.roomOf(id) !== was.room) continue;
        if (Math.abs(b.x - was.x) > 12 || Math.abs(b.y - was.y) > 2) new Bot(this, id).goTo(was.x, was.y, 12);
      }
    } finally { this.returning = false; }
  }

  /** Everyone not reacting stands still; the reacting ones run their reflex, until nobody is reacting (or caught) any more. */
  private detour(ids: string[]): void {
    this.inDetour = true;
    try {
      for (let n = 0; n < 8000; n++) {
        const inputs: Record<string, import('@wb/shared').InputIntent> = {};
        for (const id of ids) {
          const m = this.mode(id);
          if (m.kind === 'going') {
            const p = this.player(id);
            const dx = m.spot.x - p.x;
            if (Math.abs(dx) <= 30 && p.roomId === m.spot.room) {
              const r = this.room.ghostAction(id, { action: 'hide' });
              if (r.ok) { this.hides++; this.modes.set(id, { kind: 'hidden', since: n, quiet: 0 }); }
              else if (n - m.since > 40) this.modes.set(id, { kind: 'free' });
            } else if (n - m.since > 400) this.modes.set(id, { kind: 'free' });
            inputs[id] = { moveX: Math.abs(dx) <= 30 ? 0 : Math.sign(dx), jump: false };
          } else if (m.kind === 'hidden') {
            this.modes.set(id, { ...m, quiet: this.threatened(id) ? 0 : m.quiet + 1 });
            if (m.quiet > 60 && n - m.since > 30) {
              if (this.room.ghostAction(id, { action: 'leave' }).ok) this.modes.set(id, { kind: 'free' });
            }
          }
        }
        if (this.room.phase !== 'playing') return;
        for (const id of ids) if (this.captured(id) && this.mode(id).kind !== 'free') this.modes.set(id, { kind: 'free' });
        const caughtNow = ids.filter((id) => this.captured(id)).length;
        super.tick(inputs);
        const caughtAfter = ids.filter((id) => this.captured(id)).length;
        if (caughtAfter > caughtNow) this.catches += caughtAfter - caughtNow;
        const busy = ids.some((id) => this.mode(id).kind !== 'free' || this.captured(id));
        if (!busy) return;
      }
      throw new Error('hide detour did not end');
    } finally { this.inDetour = false; }
  }
}
