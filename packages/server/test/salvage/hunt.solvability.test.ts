import { describe, expect, it, vi } from 'vitest';
import { ARENA, ITEM_LIMITS, StageStateSchema } from '@wb/shared';
import { Room } from '../../src/room';
import { HUNT_REGISTRY, STAGE_REGISTRY, getStageDef } from '../../src/systems/registry';
import { HUNT_STAGE, HUNT_STAGE_ID } from '../../src/systems/stages/hunt';
import { TUTORIAL_STAGE } from '../../src/systems/tutorial';
import { validateStageDef } from '../../src/systems/validate';
import { validateSalvage } from '../../src/salvage/validate';
import { Lockstep, goTo, wait } from '../helpers/bot';
import { huntSegments, itemDo, solveHunt } from '../helpers/huntPlan';

// Genuine real-physics clears take a few seconds of CPU.
vi.setConfig({ testTimeout: 60_000 });

function huntRoom(n: number, seed?: number) {
  const room = new Room('ABCD', 2, seed, { hunt: true });
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  ids.forEach((id, i) => room.join(id, `P${i}`));
  ids.slice(1).forEach((id) => room.setReady(id, true));
  expect(room.start('p0').ok).toBe(true);
  const sim = new Lockstep(room);
  while (room.phase !== 'playing') sim.tick();
  return { room, sim, ids };
}

describe('the hunt stage definition', () => {
  it('passes the stage validator and the salvage validator', () => {
    expect(validateStageDef(HUNT_STAGE, ARENA)).toEqual([]);
    expect(validateSalvage(HUNT_STAGE, ARENA)).toEqual([]);
  });

  it('is additive: the registry maps stage 1 to it only on request, and the tutorial file is untouched in behaviour', () => {
    expect(getStageDef(1).id).toBe(TUTORIAL_STAGE.id);
    expect(getStageDef(1, 0, {}).id).toBe(TUTORIAL_STAGE.id);
    expect(getStageDef(1, 0, { hunt: false }).id).toBe(TUTORIAL_STAGE.id);
    expect(getStageDef(1, 0, { hunt: true }).id).toBe(HUNT_STAGE_ID);
    expect(Object.keys(STAGE_REGISTRY)).toEqual(['1']);
    expect(STAGE_REGISTRY[1]).toBe(TUTORIAL_STAGE);
    expect(Object.keys(HUNT_REGISTRY)).toEqual(['1']);
    expect(TUTORIAL_STAGE.items).toBeUndefined();
    expect(TUTORIAL_STAGE.needs).toBeUndefined();
    // stage 2 and later are generated either way
    expect(getStageDef(2, 7, { hunt: true }).id).toBe(getStageDef(2, 7).id);
  });

  it('is not a checklist: objective text states goals only, and the easy hints name no step, place or number', () => {
    const goalText = HUNT_STAGE.objectives.flatMap((o) => [o.label, o.description, o.lockedMessage]);
    for (const t of goalText) expect(t).not.toMatch(/\b(press|go to|walk|then|first|next|locker|crate|coil|fuse|battery|install|pick|carry|swap|drop)\b|\d/i);
    const hints = (HUNT_STAGE.needs ?? []).map((n) => n.hint ?? '');
    expect(hints.every((h) => h.length > 0)).toBe(true);
    for (const h of hints) {
      expect(h.length).toBeLessThanOrEqual(120);
      expect(h).not.toMatch(/\b(press|go to|walk|then|first|next|install)\b|\d/i);
    }
  });

  it('has the shape the design promises: the coil is hidden, one coil is a visible decoy, and hands are the limit', () => {
    const items = HUNT_STAGE.items ?? [];
    const coils = items.filter((i) => i.kind === 'flux_coil');
    expect(coils).toHaveLength(2);
    expect(coils.filter((c) => c.hidden && !c.decoy)).toHaveLength(1); // the genuine coil is hidden
    expect(coils.filter((c) => !c.hidden && c.decoy && c.tell)).toHaveLength(1); // the cracked one is in plain sight
    expect(HUNT_STAGE.needs?.find((n) => n.targetId === 'bp_coupling')?.items).toEqual(['flux_coil']);
    // more light parts lie in the open than a player can hold
    const open = items.filter((i) => !i.hidden);
    expect(open.length).toBeGreaterThan(ITEM_LIMITS.carrySlots);
    expect(HUNT_STAGE.loadout).not.toContain('flux_coil'); // nobody starts with one (tools are not parts)
  });
});

describe('the hunt is solvable through the real simulation, within the 2-slot limit', () => {
  it.each([1, 2, 3, 4])('one player clears every objective with %i player(s) in the room (teammates idle)', (n) => {
    const { room, sim, ids } = huntRoom(n);
    expect(room.stageRecord?.defId).toBe(HUNT_STAGE_ID);
    solveHunt(sim, ids[0]!);
    expect(room.phase).toBe('stage_complete');
    const s = sim.state();
    expect(StageStateSchema.safeParse(s).success).toBe(true);
    expect(s.status).toBe('stabilized');
    expect(s.objectives.every((o) => o.status === 'complete')).toBe(true);
    expect(s.symptoms.every((x) => x.state === 'resolved')).toBe(true);
    const items = s.items!;
    expect(items.items.filter((i) => i.state === 'installed').map((i) => i.id).sort()).toEqual(['coil_real', 'fuse_a']);
    for (const p of items.players) expect(p.slotsUsed).toBeLessThanOrEqual(ITEM_LIMITS.carrySlots);
    expect(s.score.breakdown.wrong_part).toBeUndefined(); // the bot never installed the cracked coil
  });

  it('the first welder attempt is refused while the coupling still lacks its coil, and the stage cannot be finished without the hunt', () => {
    const { sim } = huntRoom(1);
    const id = 'p0';
    sim.run({ [id]: huntSegments.segSpares(sim, id) });
    // standing at the coupling with the cracked coil in hand and no genuine part installed
    sim.run({ [id]: goTo(() => sim.body(id), 200, 410) });
    const r = sim.room.stageAction(id, { kind: 'use_tool', tool: 'flux_welder', targetId: 'bp_coupling' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toMatch(/Missing: Flux Coil/);
    // breaker 2 refuses without its fuse installed (the fuse is carried, not installed)
    sim.run({ [id]: goTo(() => sim.body(id), 1080, 590) });
    sim.run({ [id]: wait(4) });
    const sw = sim.room.stageAction(id, { kind: 'interact', targetId: 'sw_2' });
    expect(sw.ok).toBe(false);
    expect(sw.ok ? '' : sw.error).toMatch(/Missing: Fuse/);
  });

  it('the carry limit forces a choice: a third part is refused until one is dropped or swapped', () => {
    const { sim } = huntRoom(1);
    const id = 'p0';
    sim.run({ [id]: huntSegments.segSpares(sim, id) });
    sim.run({ [id]: wait(12) });
    const full = sim.room.itemAction(id, { action: 'pickup', itemId: 'battery_a' });
    expect(full).toEqual({ ok: false, error: 'Your hands are full. Drop or swap something.' });
    sim.run({ [id]: wait(5) }); // refused intents also count towards the per-player gap
    // swapping the useless battery in for the cracked coil is a legal choice
    itemDo(sim, id, { action: 'swap', dropId: 'coil_cracked', pickId: 'battery_a' });
    expect(sim.state().items!.players.find((p) => p.id === id)!.carried.sort()).toEqual(['battery_a', 'fuse_a']);
  });

  it('a player who installs the cracked coil pays for it, loses it, and can still finish with the real one', () => {
    const { room, sim } = huntRoom(1);
    const id = 'p0';
    sim.run({ [id]: huntSegments.segSpares(sim, id) });
    sim.run({ [id]: goTo(() => sim.body(id), 200, 410) });
    const bad = itemDo(sim, id, { action: 'install', itemId: 'coil_cracked', targetId: 'bp_coupling' }, false);
    expect(bad).toMatch(/cracked and shattered/);
    expect(sim.state().score.breakdown.wrong_part).toBeLessThan(0);
    expect(sim.state().items!.items.some((i) => i.id === 'coil_cracked')).toBe(false); // destroyed: no longer published
    // fuse is still in hand, so the hunt continues: locker, coupling, then the rest
    sim.run({ [id]: huntSegments.segLockerPick(sim, id) });
    sim.run({ [id]: huntSegments.segCoupling(sim, id) });
    sim.run({ [id]: huntSegments.segPower(sim, id) });
    sim.run({ [id]: huntSegments.segSyncSolo(sim, id) });
    sim.run({ [id]: wait(1) });
    sim.run({ [id]: huntSegments.segFinal(sim, id) });
    expect(room.phase).toBe('stage_complete');
  });

  it('co-op adds speed: a second player fetches the fuse and routes the power while the first hunts for the coil', () => {
    const solo = huntRoom(1);
    const sSim = solo.sim, a0 = sSim.ticks;
    sSim.run({ p0: huntSegments.segSpares(sSim, 'p0') });
    sSim.run({ p0: huntSegments.segLocker(sSim, 'p0') });
    sSim.run({ p0: huntSegments.segCoupling(sSim, 'p0') });
    sSim.run({ p0: huntSegments.segPower(sSim, 'p0') });
    const soloSpan = sSim.ticks - a0;

    const team = huntRoom(2);
    const sim = team.sim, b0 = sim.ticks;
    const fetchFuse = (id: string) => (function* () {
      yield* goTo(() => sim.body(id), 200, 590);
      itemDo(sim, id, { action: 'pickup', itemId: 'fuse_a' });
      yield* wait(5);
      yield* goTo(() => sim.body(id), 990, 590);
      sim.do(id, { kind: 'interact', targetId: 'sw_1' });
      yield* wait(4);
      yield* goTo(() => sim.body(id), 1080, 590);
      itemDo(sim, id, { action: 'install', itemId: 'fuse_a', targetId: 'sw_2' });
      yield* wait(4);
      sim.do(id, { kind: 'interact', targetId: 'sw_2' });
      yield* wait(1);
    })();
    const hunt = (id: string) => (function* () {
      yield* goTo(() => sim.body(id), 200, 590);
      sim.do(id, { kind: 'use_tool', tool: 'phase_scanner' });
      yield* wait(4);
      yield* huntSegments.segLockerPick(sim, id);
      yield* huntSegments.segCoupling(sim, id);
    })();
    sim.run({ p0: hunt('p0'), p1: fetchFuse('p1') });
    const teamSpan = sim.ticks - b0;
    expect(sim.state().breakpoints[0]?.repaired).toBe(true);
    expect(sim.state().items!.items.filter((i) => i.state === 'installed').map((i) => i.id).sort()).toEqual(['coil_real', 'fuse_a']);
    expect(teamSpan).toBeLessThan(soloSpan);
  });
});
