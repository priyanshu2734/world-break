import { z } from 'zod';
import { ARENA, ARENA_ID, type Rng } from '@wb/shared';
import { StageDefSchema, type StageDef } from '../systems/stageDef';
import { defineDisaster } from './framework';
import type { DisasterMetaInput } from './meta';

/**
 * Reactor overload (v1).
 *
 * Story: the reactor's coolant circuit has seized, the generator cannot carry every consumer, and arc
 * discharges build on the core deck. Reuses P2 mechanics only:
 *   hidden breakpoint (seized valve, weldable)  -> reactor temperature, pressure and arc symptoms
 *   coolant pump (needs grid power, generator capacity 1, direct feed melted) -> route power without overloading
 *   core console (no grid feed -> Power Cell) held under `arc_discharge` (Shield Projector)
 * Lifecycle: WARNING -> ACTIVE -> ESCALATED (arcs faster and wider, bounded heat drain) -> RESOLVED | FAILED -> CLEANUP.
 *
 * The layout is the tutorial's geometry (known reachable), optionally mirrored left/right (the arena is mirror
 * symmetric about x = 640), with a seed-chosen breakpoint spot and seed-chosen timings.
 */
export const REACTOR_OVERLOAD_VERSION = 1;

/** Candidate breakpoint spots (feet position on a platform top, un-mirrored coordinates). */
export const BREAKPOINT_SPOTS = [
  { x: 200, y: 410 }, // upper left
  { x: 260, y: 590 }, // low left
  { x: 640, y: 500 }, // centre deck
  { x: 1180, y: 410 }, // upper right
] as const;

export const ReactorOverloadParamsSchema = z.object({
  /** Mirror the whole layout about the arena's vertical axis. */
  mirror: z.boolean(),
  /** Difficulty tier: grows with the stage number but is capped (bounded, fair). */
  tier: z.number().int().min(1).max(5),
  breakpointSpot: z.number().int().min(0).max(BREAKPOINT_SPOTS.length - 1),
  arcPeriodTicks: z.number().int().min(45).max(75),
  arcRadius: z.number().int().min(130).max(190),
  /** Ticks the core console must be held (the Shield Projector lasts 160). */
  channelTicks: z.number().int().min(80).max(140),
  deadlineTicks: z.number().int().min(6000).max(14000),
  warningTicks: z.number().int().min(100).max(300),
  escalateAtTick: z.number().int().min(1200).max(4800),
  failAfterEscalationTicks: z.number().int().min(1200).max(6000),
  heatPerSecond: z.number().int().min(0).max(12),
  heatCap: z.number().int().min(0).max(600),
  failPenalty: z.number().int().min(0).max(300),
});
export type ReactorOverloadParams = z.infer<typeof ReactorOverloadParamsSchema>;

/** floor(log2(stage)) without 32-bit truncation, capped: stage numbers are unbounded. */
function tierFor(stage: number): number {
  let s = stage, t = 0;
  while (s > 1 && t < 4) { s = Math.floor(s / 2); t++; }
  return 1 + t;
}

function deriveParams(stage: number, rng: Rng): ReactorOverloadParams {
  const tier = tierFor(stage);
  const layout = rng.fork('layout'), timing = rng.fork('timing'), arc = rng.fork('arc');
  return {
    mirror: layout.chance(0.5),
    tier,
    breakpointSpot: layout.int(0, BREAKPOINT_SPOTS.length - 1),
    arcPeriodTicks: arc.int(60, 75) - (tier - 1) * 3,
    arcRadius: arc.int(150, 180),
    channelTicks: arc.int(90, 120),
    deadlineTicks: 12000 - timing.int(0, 3) * 500,
    warningTicks: timing.int(120, 200),
    escalateAtTick: 3000 - (tier - 1) * 150 + timing.int(0, 300),
    failAfterEscalationTicks: 4200 - (tier - 1) * 150 + timing.int(0, 600),
    heatPerSecond: 1 + tier,
    heatCap: 60 + 40 * tier,
    failPenalty: 100 + 20 * tier,
  };
}

function generate({ stage, seed, params: p }: { stage: number; seed: number; params: ReactorOverloadParams }): StageDef {
  const mx = (x: number) => (p.mirror ? ARENA.width - x : x);
  const spot = BREAKPOINT_SPOTS[p.breakpointSpot]!;
  const coreX = mx(470);

  const disaster: DisasterMetaInput = {
    id: 'reactor_overload',
    version: REACTOR_OVERLOAD_VERSION,
    name: 'Reactor Overload',
    seed,
    params: { ...p },
    schedule: {
      activateAtTick: p.warningTicks,
      escalateAtTick: p.escalateAtTick,
      failAtTick: p.escalateAtTick + p.failAfterEscalationTicks,
      failedHoldTicks: 600,
    },
    messages: {
      warning: 'Reactor core temperature is rising and arc discharges are building on the core deck. Find out what is feeding the overload.',
      active: 'The reactor is overloading. Arc discharges will strike the core deck while you stabilise it.',
      escalated: 'The overload is escalating: arc discharges are faster and wider, and the heat is costing the team points.',
      resolved: 'The overload is contained. The core is stable.',
      failed: 'The reactor passed its safe limit and is venting hard. Stabilise the core to end it.',
      cleanup: 'The reactor has cooled. Every overload effect is cleared.',
    },
    resolveObjectives: ['o_final'],
    threats: [{
      hazardId: 'hz_arc',
      warning: 'Arc discharges strike the core deck while the core console is being stabilised.',
      countermeasure: 'shield_projector',
      repair: 'Scan the reactor hall to find the fault, restore coolant power without overloading the generator, then project a shield at the core console and hold it.',
    }],
    hazardPhases: [{
      hazardId: 'hz_arc',
      armedFrom: 'active',
      escalated: { periodTicks: Math.round(p.arcPeriodTicks * 0.6), r: Math.round(p.arcRadius * 1.2) },
    }],
    heat: { perSecond: p.heatPerSecond, cap: p.heatCap },
    failPenalty: p.failPenalty,
  };

  return StageDefSchema.parse({
    id: `reactor_overload_${stage}`,
    name: 'Reactor Overload',
    arenaId: ARENA_ID,
    deadlineTicks: p.deadlineTicks,
    disaster,
    failures: [
      { id: 'f_valve', kind: 'breakpoint', label: 'Seized coolant valve' },
      { id: 'f_pump', kind: 'fault', label: 'Coolant pump unpowered' },
      { id: 's_temp', kind: 'symptom', label: 'Core temperature climbing',
        hint: 'The temperature climbs in steps, as if something keeps closing on the coolant circuit.' },
      { id: 's_hammer', kind: 'symptom', label: 'Pressure lines hammering',
        hint: 'The relief lines hammer, and it gets worse whenever the pump stalls.' },
      { id: 's_coolant', kind: 'symptom', label: 'Coolant alarm', hint: 'Coolant flow alarm. The pump is silent.' },
      { id: 's_arcs', kind: 'symptom', label: 'Arc flashes on the core deck',
        hint: 'Flashes jump between the core console and the deck plating.' },
    ],
    edges: [
      { from: 'f_valve', to: 's_temp' }, { from: 'f_valve', to: 's_hammer' }, { from: 'f_valve', to: 's_arcs' },
      { from: 'f_pump', to: 's_hammer' }, { from: 'f_pump', to: 's_coolant' },
    ],
    breakpoints: [
      { id: 'bp_valve', failureId: 'f_valve', label: 'Seized coolant valve', x: mx(spot.x), y: spot.y, repairTicks: 80, weldable: true },
    ],
    power: {
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
    },
    entities: [
      { kind: 'supply_cache', id: 'cache', label: 'Supply cache', x: 640, y: 680, refillPenalty: 50, cooldownTicks: 200 },
      { kind: 'decoy_panel', id: 'temp_panel', label: 'Temperature panel T-2', x: mx(760), y: 500,
        mitigates: 's_temp', mitigateTicks: 800, repairTicks: 40 },
      { kind: 'power_switch', id: 'sw_1', label: 'Breaker 1', x: mx(990), y: 590, conduitId: 'c_gj', initiallyClosed: false },
      { kind: 'power_switch', id: 'sw_2', label: 'Breaker 2', x: mx(1080), y: 590, conduitId: 'c_jp', initiallyClosed: false },
      { kind: 'power_switch', id: 'sw_3', label: 'Breaker 3', x: mx(1050), y: 410, conduitId: 'c_jf', initiallyClosed: false },
      { kind: 'power_switch', id: 'sw_4', label: 'Breaker 4', x: mx(1050), y: 680, conduitId: 'c_gf', initiallyClosed: false },
      { kind: 'core_console', id: 'core', label: 'Reactor console', x: coreX, y: 320, objectiveId: 'o_final', consumerId: 'core_feed' },
    ],
    objectives: [
      { id: 'o_root', label: 'Find out why the reactor keeps heating',
        description: 'Follow the symptoms to what is actually broken. Calming a panel is not the same as fixing the fault.',
        prerequisites: [], lockedMessage: '', bonus: 200,
        params: { kind: 'repair_breakpoint', breakpointId: 'bp_valve' } },
      { id: 'o_power', label: 'Get coolant flowing again',
        description: 'The direct feed to the pump is slagged. Route power through the breakers without overloading the generator.',
        prerequisites: [], lockedMessage: '', bonus: 200,
        params: { kind: 'power_route', consumerId: 'pump', holdTicks: 40, sealSwitches: ['sw_1', 'sw_2', 'sw_3', 'sw_4'] } },
      { id: 'o_final', label: 'Stabilise the reactor core',
        description: 'Hold the reactor console steady. The core has no power feed and arc discharges strike the deck.',
        prerequisites: ['o_root', 'o_power'], lockedMessage: 'The console refuses: other systems are still failing.', bonus: 400,
        params: { kind: 'channel_hold', entityId: 'core', requiredTicks: p.channelTicks } },
    ],
    hazards: [
      { id: 'hz_arc', kind: 'arc_discharge', label: 'Arc discharge', x: coreX, y: 300, r: p.arcRadius,
        periodTicks: p.arcPeriodTicks, firstPulseTick: 40, armedWhenObjective: 'o_final' },
    ],
    clues: [
      { id: 'clue_panel', x: mx(760), y: 500, text: 'Panel T-2 reads nominal. The temperature steps are being driven from somewhere else on the circuit.' },
      { id: 'clue_circuit', x: mx(spot.x), y: spot.y, text: 'A coolant line here is stiff and warm to the touch, and it ticks in time with the temperature steps.' },
      { id: 'clue_grid', x: mx(900), y: 590, text: 'The direct feed to the pump is slagged. Power must go around through the junction, and the generator can carry only one load.' },
      { id: 'clue_core', x: coreX, y: 320, text: 'The reactor console has no feed. Arc discharges jump across the deck here: something to power it, something to shield you.' },
    ],
    scoring: {
      timeBonusPerSecond: 1, expiredPenalty: 200, expiredDrainPerSecond: 1,
      wrongTargetPenalty: 25, overloadPenalty: 100, hazardHitPenalty: 75,
    },
  });
}

export const REACTOR_OVERLOAD = defineDisaster<ReactorOverloadParams>({
  id: 'reactor_overload',
  version: REACTOR_OVERLOAD_VERSION,
  name: 'Reactor Overload',
  systems: ['reactor', 'power_grid'],
  requiredTools: ['phase_scanner', 'flux_welder', 'power_cell', 'shield_projector'],
  compat: { minStage: 2, minPlayers: 1, maxPlayers: 4, arenaIds: [ARENA_ID], combinableWith: [], conflictsWith: [] },
  paramsSchema: ReactorOverloadParamsSchema,
  deriveParams,
  generate,
});
