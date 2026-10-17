import { expect } from 'vitest';
import { deriveSeed, type DisasterId } from '@wb/shared';
import { Room } from '../../src/room';
import { getStageDef } from '../../src/systems/registry';
import type { StageDef } from '../../src/systems/stageDef';
import { generateDisasterStage, getDisaster, withDisasterPool } from '../../src/disasters/registry';
import type { RegisteredDisaster } from '../../src/disasters/framework';
import { Lockstep } from './bot';

/** The four disasters added in P3A step 3 (confirmed and promoted to SUPPORTED in step 4); reactor overload has its own test files. */
export const CANDIDATE_IDS = ['gravity_inversion', 'reality_fracture', 'temporal_storm', 'cascading_power_failure'] as const;
export type CandidateId = (typeof CANDIDATE_IDS)[number];

export function candidate(id: DisasterId): RegisteredDisaster {
  const d = getDisaster(id);
  if (!d) throw new Error(`${id} is not a registered disaster`);
  return d;
}

/** Layout key of a generated stage: mirror x first breakpoint spot. */
export function variantKey(params: Record<string, string | number | boolean>): string {
  const spot = params.breakpointSpot ?? String(params.spotOrder).split(',')[0];
  return `${params.mirror ? 'mirrored' : 'normal'}/spot${spot}`;
}

/** One run seed per layout variant (found by asking the generator exactly as the Room will). */
export function variantSeeds(id: CandidateId, stage = 2): [string, number][] {
  const found = new Map<string, number>();
  withDisasterPool([id], () => {
    for (let runSeed = 1; runSeed <= 600 && found.size < 8; runSeed++) {
      const key = variantKey(generateDisasterStage(stage, deriveSeed(runSeed, 'stage', stage)).disaster!.params);
      if (!found.has(key)) found.set(key, runSeed);
    }
  });
  return [...found].sort(([a], [b]) => a.localeCompare(b));
}

export interface Started { room: Room; sim: Lockstep; ids: string[]; def: StageDef }

/** Starts a real Room on a generated `id` stage, with `n` players, and ticks through the briefing. */
export function start(id: CandidateId, runSeed: number, n: number, stage = 2): Started {
  return withDisasterPool([id], () => {
    const room = new Room('ABCD', 2, runSeed);
    room.stage = stage; // begin directly on a generated stage
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    ids.forEach((pid, i) => room.join(pid, `P${i}`));
    ids.slice(1).forEach((pid) => room.setReady(pid, true));
    expect(room.start('p0').ok).toBe(true);
    const sim = new Lockstep(room);
    while (room.phase !== 'playing') sim.tick();
    const rec = room.stageRecord!;
    expect(rec.fallback).toBe(false); // the generator, not the fallback, produced this stage
    expect(rec.defId).toBe(`${id}_${stage}`);
    return { room, sim, ids, def: getStageDef(stage, rec.seed) };
  });
}

/** Ticks an idle room until `pred` holds (fails loudly if it never does). */
export function idleUntil(sim: Lockstep, pred: () => boolean, max = 12_000): void {
  for (let i = 0; i < max && !pred(); i++) sim.tick();
  expect(pred()).toBe(true);
}
