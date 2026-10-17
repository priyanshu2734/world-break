import { z } from 'zod';
import { ARENA_ID, type Rng } from '@wb/shared';
import { StageDefSchema, type StageDef, type StageDefInput } from '../systems/stageDef';
import { defineDisaster } from './framework';
import type { DisasterMetaInput } from './meta';
import { SCORING, SPOTS, TimingSchema, cacheEntity, decoyPanel, deriveTiming, mirrorFn, reactorGrid, scheduleOf, tierFor } from './kit';

/**
 * Cascading power failure (v1).
 *
 * Story: one tripped relay took the next one down, and that one the next. The grid fails in a chain. Existing
 * mechanics only:
 *   a CHAIN of 2..4 hidden breakpoints (tripped relays): the scanner can find each one only after the previous
 *   relay is mended (`scanRequires`), so the team must work the cascade in order
 *   the tutorial grid: slagged pump feed, generator capacity 1, route power through the breakers
 *   core console (Power Cell) held under `arc_discharge` (Shield Projector)
 * Lifecycle: the arcs are armed from ACTIVE; ESCALATED makes them faster and wider (bounded), plus the heat drain.
 * The chain length grows with the tier: 2 (tiers 1-2), 3 (tiers 3-4), 4 (tier 5). Bounded.
 */
export const CASCADING_POWER_FAILURE_VERSION = 1;

export const CascadingPowerFailureParamsSchema = TimingSchema.extend({
  mirror: z.boolean(),
  tier: z.number().int().min(1).max(5),
  /** Number of relays in the chain. */
  chain: z.number().int().min(2).max(4),
  /** Order in which the four breakpoint spots are used: a permutation of 0..3, e.g. "2,0,3,1". */
  spotOrder: z.string().regex(/^(?!.*(\d).*\1)[0-3](,[0-3]){3}$/),
  arcPeriodTicks: z.number().int().min(45).max(75),
  arcRadius: z.number().int().min(130).max(190),
  channelTicks: z.number().int().min(80).max(140),
  decoyTicks: z.number().int().min(400).max(900),
});
export type CascadingPowerFailureParams = z.infer<typeof CascadingPowerFailureParamsSchema>;

export const chainLengthFor = (tier: number): number => 2 + (tier >= 3 ? 1 : 0) + (tier >= 5 ? 1 : 0);

function deriveParams(stage: number, rng: Rng): CascadingPowerFailureParams {
  const tier = tierFor(stage);
  const layout = rng.fork('layout'), timing = rng.fork('timing'), field = rng.fork('field');
  return {
    ...deriveTiming(tier, timing),
    mirror: layout.chance(0.5),
    tier,
    chain: chainLengthFor(tier),
    spotOrder: layout.shuffle([0, 1, 2, 3]).join(','),
    arcPeriodTicks: field.int(60, 75) - (tier - 1) * 3,
    arcRadius: field.int(150, 180),
    channelTicks: field.int(90, 120),
    decoyTicks: 800 - (tier - 1) * 50 - field.int(0, 50),
  };
}

const RELAY_NAMES = ['A', 'B', 'C', 'D'] as const;

function generate({ stage, seed, params: p }: { stage: number; seed: number; params: CascadingPowerFailureParams }): StageDef {
  const mx = mirrorFn(p.mirror);
  const coreX = mx(470);
  const order = p.spotOrder.split(',').map(Number).slice(0, p.chain);
  const relays = order.map((spotIndex, i) => ({ i, id: `bp_relay_${i + 1}`, failure: `f_relay_${i + 1}`, objective: `o_root_${i + 1}`, spot: SPOTS[spotIndex]!, name: RELAY_NAMES[i]! }));
  const grid = reactorGrid(mx, coreX);

  const disaster: DisasterMetaInput = {
    id: 'cascading_power_failure',
    version: CASCADING_POWER_FAILURE_VERSION,
    name: 'Cascading Power Failure',
    seed,
    params: { ...p },
    schedule: scheduleOf(p),
    messages: {
      warning: 'Breakers are tripping one after another. The grid is failing in a chain.',
      active: 'The grid is cascading. Work the chain in order: each fault can only be found once the one before it is mended.',
      escalated: 'The cascade is escalating: arc discharges are faster and wider, and the heat is costing the team points.',
      resolved: 'The chain is broken. The grid is stable.',
      failed: 'The cascade ran past its safe limit and the grid is still shedding load. Stabilise the core to end it.',
      cleanup: 'The grid has settled. Every cascade effect is cleared.',
    },
    resolveObjectives: ['o_final'],
    threats: [{
      hazardId: 'hz_arc',
      warning: 'Arc discharges strike the core deck while the console is being held.',
      countermeasure: 'shield_projector',
      repair: 'Scan, mend each fault in the chain in order, restore coolant power without overloading the generator, then project a shield at the core console and hold it.',
    }],
    hazardPhases: [{
      hazardId: 'hz_arc',
      armedFrom: 'active',
      escalated: { periodTicks: Math.round(p.arcPeriodTicks * 0.6), r: Math.round(p.arcRadius * 1.2) },
    }],
    heat: { perSecond: p.heatPerSecond, cap: p.heatCap },
    failPenalty: p.failPenalty,
  };

  const symptoms: StageDefInput['failures'] = [];
  const edges: StageDefInput['edges'] = [];
  for (let i = 0; i <= relays.length; i++) {
    symptoms.push({ id: `s_${i + 1}`, kind: 'symptom', label: `Brownout in sector ${i + 1}`,
      hint: `Sector ${i + 1} dims and surges in time with a trip somewhere upstream.` });
  }
  relays.forEach((r) => { edges.push({ from: r.failure, to: `s_${r.i + 1}` }, { from: r.failure, to: `s_${r.i + 2}` }); });
  edges.push({ from: 'f_pump', to: `s_${relays.length + 1}` }, { from: 'f_pump', to: 's_coolant' });

  const objectives: StageDefInput['objectives'] = relays.map((r) => ({
    id: r.objective, label: r.i === 0 ? 'Find the first tripped relay' : `Follow the cascade to the next relay (${r.i + 1} of ${relays.length})`,
    description: r.i === 0
      ? 'Follow the brownouts upstream to what is actually broken. Resetting a panel only hides it for a while.'
      : 'Mending a relay re-energises the line, and the next fault shows up on the scanner only then.',
    prerequisites: r.i === 0 ? [] : [relays[r.i - 1]!.objective], lockedMessage: '', bonus: 150,
    params: { kind: 'repair_breakpoint' as const, breakpointId: r.id },
  }));
  objectives.push(
    { id: 'o_power', label: 'Get coolant flowing again',
      description: 'The direct feed to the pump is slagged. Route power through the breakers without overloading the generator.',
      prerequisites: [], lockedMessage: '', bonus: 200,
      params: { kind: 'power_route', consumerId: 'pump', holdTicks: 40, sealSwitches: ['sw_1', 'sw_2', 'sw_3', 'sw_4'] } },
    { id: 'o_final', label: 'Stabilise the grid core',
      description: 'Hold the core console steady. The core has no power feed and arc discharges strike the deck.',
      prerequisites: [relays[relays.length - 1]!.objective, 'o_power'], lockedMessage: 'The console refuses: other systems are still failing.', bonus: 400,
      params: { kind: 'channel_hold', entityId: 'core', requiredTicks: p.channelTicks } },
  );

  return StageDefSchema.parse({
    id: `cascading_power_failure_${stage}`,
    name: 'Cascading Power Failure',
    arenaId: ARENA_ID,
    deadlineTicks: p.deadlineTicks,
    disaster,
    failures: [
      ...relays.map((r) => ({ id: r.failure, kind: 'breakpoint' as const, label: `Tripped relay ${r.name}` })),
      { id: 'f_pump', kind: 'fault', label: 'Coolant pump unpowered' },
      ...symptoms,
      { id: 's_coolant', kind: 'symptom', label: 'Coolant alarm', hint: 'Coolant flow alarm. The pump is silent.' },
    ],
    edges,
    breakpoints: relays.map((r) => ({
      id: r.id, failureId: r.failure, label: `Tripped relay ${r.name}`, x: mx(r.spot.x), y: r.spot.y, repairTicks: 80, weldable: true,
      scanRequires: r.i === 0 ? [] : [relays[r.i - 1]!.objective],
    })),
    power: grid.power,
    entities: [
      cacheEntity(),
      decoyPanel('sector_panel', 'Sector panel S-1', mx(760), 500, 's_1', p.decoyTicks),
      ...grid.switches,
      { kind: 'core_console', id: 'core', label: 'Core console', x: coreX, y: 320, objectiveId: 'o_final', consumerId: 'core_feed' },
    ],
    objectives,
    hazards: [
      { id: 'hz_arc', kind: 'arc_discharge', label: 'Arc discharge', x: coreX, y: 300, r: p.arcRadius,
        periodTicks: p.arcPeriodTicks, firstPulseTick: 40, armedWhenObjective: 'o_final' },
    ],
    clues: [
      { id: 'clue_panel', x: mx(760), y: 500, text: 'Panel S-1 reads nominal. The surges are arriving down the line from somewhere upstream.' },
      { id: 'clue_chain', x: mx(relays[0]!.spot.x), y: relays[0]!.spot.y, text: 'A relay here has tripped, and the line beyond it is dead. It is the first of a chain.' },
      { id: 'clue_grid', x: mx(900), y: 590, text: 'The direct feed to the pump is slagged. Power must go around through the junction, and the generator can carry only one load.' },
      { id: 'clue_core', x: coreX, y: 320, text: 'The core console has no feed. Arc discharges strike the deck here: something to power it, something to shield you.' },
    ],
    scoring: { ...SCORING },
  });
}

export const CASCADING_POWER_FAILURE = defineDisaster<CascadingPowerFailureParams>({
  id: 'cascading_power_failure',
  version: CASCADING_POWER_FAILURE_VERSION,
  name: 'Cascading Power Failure',
  systems: ['power_grid'],
  requiredTools: ['phase_scanner', 'flux_welder', 'power_cell', 'shield_projector'],
  compat: { minStage: 2, minPlayers: 1, maxPlayers: 4, arenaIds: [ARENA_ID], combinableWith: [], conflictsWith: [] },
  paramsSchema: CascadingPowerFailureParamsSchema,
  deriveParams,
  generate,
});
