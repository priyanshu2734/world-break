import { z } from 'zod';
import { ARENA, type Rng } from '@wb/shared';
import type { StageDefInput } from '../systems/stageDef';

/**
 * Shared building blocks for generated disaster stages (P3A step 3). Everything here is pure and uses only the
 * tutorial's known-reachable geometry (optionally mirrored: the arena is mirror symmetric about x = 640), so a
 * generated stage never needs a position that the real physics cannot reach.
 */
export type EntityInput = StageDefInput['entities'][number];

export const mirrorFn = (mirror: boolean) => (x: number): number => (mirror ? ARENA.width - x : x);

/** Candidate breakpoint spots, un-mirrored feet positions on platform tops (same set as reactor overload). */
export const SPOTS = [
  { x: 200, y: 410 }, // upper left
  { x: 260, y: 590 }, // low left
  { x: 640, y: 500 }, // centre deck
  { x: 1180, y: 410 }, // upper right
] as const;

/** floor(log2(stage)) without 32-bit truncation, capped at 4 steps: stage numbers are unbounded, difficulty is not. */
export function tierFor(stage: number): number {
  let s = stage, t = 0;
  while (s > 1 && t < 4) { s = Math.floor(s / 2); t++; }
  return 1 + t;
}

/** Timing / pressure parameters shared by every disaster. Bounds are enforced again by `validateDisasterMeta`. */
export const TimingSchema = z.object({
  deadlineTicks: z.number().int().min(6000).max(14000),
  warningTicks: z.number().int().min(100).max(300),
  escalateAtTick: z.number().int().min(1200).max(4800),
  failAfterEscalationTicks: z.number().int().min(1200).max(6000),
  heatPerSecond: z.number().int().min(0).max(12),
  heatCap: z.number().int().min(0).max(600),
  failPenalty: z.number().int().min(0).max(300),
});
export type Timing = z.infer<typeof TimingSchema>;

export function deriveTiming(tier: number, timing: Rng): Timing {
  return {
    deadlineTicks: 12000 - timing.int(0, 3) * 500,
    warningTicks: timing.int(120, 200),
    escalateAtTick: 3000 - (tier - 1) * 150 + timing.int(0, 300),
    failAfterEscalationTicks: 4200 - (tier - 1) * 150 + timing.int(0, 600),
    heatPerSecond: 1 + tier,
    heatCap: 60 + 40 * tier,
    failPenalty: 100 + 20 * tier,
  };
}

export function scheduleOf(t: Timing) {
  return {
    activateAtTick: t.warningTicks,
    escalateAtTick: t.escalateAtTick,
    failAtTick: t.escalateAtTick + t.failAfterEscalationTicks,
    failedHoldTicks: 600,
  };
}

export const SCORING = {
  timeBonusPerSecond: 1, expiredPenalty: 200, expiredDrainPerSecond: 1,
  wrongTargetPenalty: 25, overloadPenalty: 100, hazardHitPenalty: 75,
} as const;

export const cacheEntity = (): EntityInput => ({
  kind: 'supply_cache', id: 'cache', label: 'Supply cache', x: 640, y: 680, refillPenalty: 50, cooldownTicks: 200,
});

/** The tutorial grid: slagged direct feed to the pump, a junction, four breakers, generator capacity 1. */
export function reactorGrid(mx: (x: number) => number, coreX: number) {
  const power: StageDefInput['power'] = {
    capacity: 1,
    nodes: [
      { id: 'gen', kind: 'generator', label: 'Generator', x: mx(900), y: 590 },
      { id: 'jx', kind: 'junction', label: 'Junction', x: mx(980), y: 410 },
      { id: 'pump', kind: 'consumer', label: 'Coolant pump', x: mx(810), y: 320 },
      { id: 'fan', kind: 'consumer', label: 'Vent fan', x: mx(1190), y: 680 },
      { id: 'core_feed', kind: 'consumer', label: 'Core feed', x: coreX, y: 320 },
    ],
    conduits: [
      { id: 'c_gp', from: 'gen', to: 'pump', condition: 'melted' },
      { id: 'c_gj', from: 'gen', to: 'jx', condition: 'ok', switchEntityId: 'sw_1' },
      { id: 'c_jp', from: 'jx', to: 'pump', condition: 'ok', switchEntityId: 'sw_2' },
      { id: 'c_jf', from: 'jx', to: 'fan', condition: 'ok', switchEntityId: 'sw_3' },
      { id: 'c_gf', from: 'gen', to: 'fan', condition: 'ok', switchEntityId: 'sw_4' },
    ],
    faultBindings: [{ consumerId: 'pump', failureId: 'f_pump' }],
  };
  const switches: EntityInput[] = [
    { kind: 'power_switch', id: 'sw_1', label: 'Breaker 1', x: mx(990), y: 590, conduitId: 'c_gj', initiallyClosed: false },
    { kind: 'power_switch', id: 'sw_2', label: 'Breaker 2', x: mx(1080), y: 590, conduitId: 'c_jp', initiallyClosed: false },
    { kind: 'power_switch', id: 'sw_3', label: 'Breaker 3', x: mx(1050), y: 410, conduitId: 'c_jf', initiallyClosed: false },
    { kind: 'power_switch', id: 'sw_4', label: 'Breaker 4', x: mx(1050), y: 680, conduitId: 'c_gf', initiallyClosed: false },
  ];
  return { power, switches };
}

/** A grid with only the (unfed) core consumer: the core console must run on a Power Cell. */
export function coreOnlyGrid(coreX: number): StageDefInput['power'] {
  return {
    capacity: 1,
    nodes: [{ id: 'core_feed', kind: 'consumer', label: 'Core feed', x: coreX, y: 320 }],
    conduits: [],
    faultBindings: [],
  };
}

export interface Control { id: string; label: string; x: number; y: number }

/** Tutorial phase-lock positions. Walking all three in this order was proven within 300 ticks by the real physics. */
export const CONTROLS_A: readonly Control[] = [
  { id: 'lock_a', label: 'Anchor A', x: 200, y: 590 },
  { id: 'lock_b', label: 'Anchor B', x: 520, y: 500 },
  { id: 'lock_c', label: 'Anchor C', x: 1200, y: 680 },
];
/** A second group on the right-hand side (positions taken from the tutorial's breaker spots). */
export const CONTROLS_B: readonly Control[] = [
  { id: 'lock_d', label: 'Relay D', x: 1050, y: 410 },
  { id: 'lock_e', label: 'Relay E', x: 1080, y: 590 },
  { id: 'lock_f', label: 'Relay F', x: 1050, y: 680 },
];

export function syncConsoles(controls: readonly Control[], objectiveId: string, mx: (x: number) => number, noun: string): EntityInput[] {
  return controls.map((c) => ({ kind: 'sync_console' as const, id: c.id, label: `${noun} ${c.label.split(' ')[1]}`, x: mx(c.x), y: c.y, objectiveId }));
}

export const decoyPanel = (id: string, label: string, x: number, y: number, mitigates: string, mitigateTicks: number): EntityInput =>
  ({ kind: 'decoy_panel', id, label, x, y, mitigates, mitigateTicks, repairTicks: 40 });
