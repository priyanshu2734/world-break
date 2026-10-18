import { describe, expect, it } from 'vitest';
import {
  ABILITY_LAB_ARENA, ABILITY_SPECS, MAX_IMPULSES_LISTED, MAX_PROPS_TOTAL, MAX_ZONES_LISTED, PLAYER_HEIGHT, PLAYER_WIDTH, TERMINAL_VELOCITY,
  type AbilityAction,
} from '@wb/shared';
import { ABILITY_LAB_STAGE } from '../../src/systems/stages/abilityLab';
import { Lockstep, type Intent } from '../helpers/bot';
import { labRoom } from '../helpers/labBot';

const rng = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const HW = PLAYER_WIDTH / 2;

/**
 * Four players in the Lab hammer every ability with random (often invalid) targets while walking and jumping at random.
 * After EVERY tick: no NaN, nobody out of bounds or inside a solid, props inside the arena and outside solids, and every
 * documented cap holds. The server must also never throw, and every intent must get an ok or an error.
 */
function fuzz(seed: number): Map<string, number> {
  {
    const r = rng(seed);
    const { room, ids } = labRoom(4);
    const sim = new Lockstep(room);
    let accepted = 0, refused = 0;
    const kinds = new Map<string, number>();
    const targets = ['crate_m', 'crate_d', 'hz_arc', 'hz_flux', 'self', 'nope', 'clone_3', 'clone_9', 'p1'];
    const dirs = ['up', 'down', 'left', 'right', 'cancel'] as const;
    for (let t = 0; t < 3000; t++) {
      const inputs = new Map<string, Intent | null>();
      for (const id of ids) inputs.set(id, { moveX: r() < 0.3 ? 0 : r() * 2 - 1, jump: r() < 0.12 });
      sim.tick(inputs);

      for (const id of ids) if (r() < 0.07) {
        const b = sim.body(id), k = r();
        const near = () => ({ x: b.x + (r() - 0.5) * 500, y: b.y - 20 + (r() - 0.5) * 500 });
        const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)]!;
        let a: AbilityAction;
        if (k < 0.3) { const p = near(); a = { ability: 'gravity_well', x: Math.round(p.x), y: Math.round(p.y), mode: r() < 0.5 ? 'flip' : 'reduce' }; }
        else if (k < 0.5) a = { ability: 'freeze', targetId: pick(targets.filter((x) => x !== 'self' && x !== 'p1')) };
        else if (k < 0.75) { const p = near(); a = { ability: 'duplicate', targetId: pick(['crate_m', 'crate_d', 'nope', 'clone_3']), x: Math.round(p.x), y: Math.round(p.y) }; }
        else a = { ability: 'momentum', targetId: pick(targets.filter((x) => x !== 'hz_arc' && x !== 'hz_flux' && x !== 'p1')), dir: pick(dirs) };
        const res = room.abilityAction(id, a);
        expect(typeof res.ok).toBe('boolean');
        if (res.ok) { accepted++; kinds.set(a.ability, (kinds.get(a.ability) ?? 0) + 1); } else { refused++; expect(res.error.length).toBeGreaterThan(0); }
      }

      const g = room.gameSnapshot()!;
      for (const p of g.players) {
        for (const v of [p.x, p.y, p.vx, p.vy]) expect(Number.isFinite(v)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(HW - 0.01); expect(p.x).toBeLessThanOrEqual(ABILITY_LAB_ARENA.width - HW + 0.01);
        expect(p.y).toBeGreaterThanOrEqual(PLAYER_HEIGHT - 0.01); expect(p.y).toBeLessThanOrEqual(ABILITY_LAB_ARENA.height + 0.01);
        expect(Math.abs(p.vy)).toBeLessThanOrEqual(TERMINAL_VELOCITY + 0.01);
        const inSolid = ABILITY_LAB_ARENA.solids.some((s) => p.x + HW > s.x + 0.05 && p.x - HW < s.x + s.w - 0.05 && p.y > s.y + 0.05 && p.y - PLAYER_HEIGHT < s.y + s.h - 0.05);
        if (inSolid) throw new Error(`player ${p.id} stuck in a solid at tick ${t}: ${p.x},${p.y}`);
      }
      const w = g.world;
      if (w) {
        expect(w.props.length).toBeLessThanOrEqual(MAX_PROPS_TOTAL);
        expect(w.zones.length).toBeLessThanOrEqual(MAX_ZONES_LISTED);
        expect(w.impulses.length).toBeLessThanOrEqual(MAX_IMPULSES_LISTED);
        for (const p of w.props) {
          for (const v of [p.x, p.y, p.vx, p.vy]) expect(Number.isFinite(v)).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(p.w / 2 - 0.01); expect(p.x).toBeLessThanOrEqual(ABILITY_LAB_ARENA.width - p.w / 2 + 0.01);
          expect(p.y).toBeGreaterThanOrEqual(p.h - 0.01); expect(p.y).toBeLessThanOrEqual(ABILITY_LAB_ARENA.height + 0.01);
          const inSolid = ABILITY_LAB_ARENA.solids.some((s) => p.x + p.w / 2 > s.x + 0.05 && p.x - p.w / 2 < s.x + s.w - 0.05 && p.y > s.y + 0.05 && p.y - p.h < s.y + s.h - 0.05);
          if (inSolid) throw new Error(`prop ${p.id} inside a solid at tick ${t}`);
        }
        for (const z of w.zones) { expect(z.expiresTick - z.startTick).toBeLessThanOrEqual(ABILITY_SPECS.gravity_well.durationTicks); expect(z.x).toBeGreaterThanOrEqual(0); expect(z.x + z.w).toBeLessThanOrEqual(ABILITY_LAB_ARENA.width); }
      }
      const ab = room.peekStageState()!.abilities!;
      expect(ab.active.wells).toBeLessThanOrEqual(ABILITY_SPECS.gravity_well.perRoomCap);
      expect(ab.active.freezes).toBeLessThanOrEqual(ABILITY_SPECS.freeze.perRoomCap);
      expect(ab.active.clones).toBeLessThanOrEqual(ABILITY_SPECS.duplicate.perRoomCap);
      for (const p of ab.players) {
        expect(p.energy).toBeGreaterThanOrEqual(0); expect(p.energy).toBeLessThanOrEqual(100);
        expect(p.clones).toBeLessThanOrEqual(ABILITY_SPECS.duplicate.perPlayerCap);
      }
    }
    expect(accepted).toBeGreaterThan(5); // the fuzz really did use abilities...
    expect(refused).toBeGreaterThan(20); // ...and the server really did refuse many
    return kinds;
  }
}

describe('ability fuzz in the Ability Lab (4 players, real physics)', () => {
  it.each([11, 22, 33])('seed %i: 3000 ticks of random abilities keep every invariant', (seed) => { fuzz(seed); });

  it.each([44, 55])('seed %i with abundant energy (opt-in regeneration): every ability is used at least once, every invariant still holds', (seed) => {
    const cfg = ABILITY_LAB_STAGE.abilities!, before = cfg.passiveRegenTicks;
    cfg.passiveRegenTicks = 6; // test-only: refill quickly so all four abilities fire many times
    try {
      const kinds = fuzz(seed);
      for (const a of ['gravity_well', 'freeze', 'duplicate', 'momentum']) expect(kinds.get(a) ?? 0).toBeGreaterThanOrEqual(1);
    } finally { cfg.passiveRegenTicks = before; }
  });
});
