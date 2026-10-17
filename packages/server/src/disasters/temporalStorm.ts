import { z } from 'zod';
import { ARENA_ID, type Rng } from '@wb/shared';
import { StageDefSchema, type StageDef } from '../systems/stageDef';
import { defineDisaster } from './framework';
import type { DisasterMetaInput } from './meta';
import { CONTROLS_A, CONTROLS_B, SCORING, SPOTS, TimingSchema, cacheEntity, coreOnlyGrid, decoyPanel, deriveTiming, mirrorFn, scheduleOf, syncConsoles, tierFor } from './kit';

/**
 * Temporal storm (v1).
 *
 * Story: time is stuttering. Clocks skip and events repeat. Everything is a race against the clock, expressed with
 * existing mechanics only:
 *   hidden breakpoint (desynchronised chronometer, weldable)
 *   TWO timed-control objectives back to back: three clocks across the hall, then three relays, the second window shorter
 *   a decoy panel that calms a symptom only briefly (it relapses)
 *   core console (Power Cell) held under `arc_discharge` (Shield Projector)
 * Lifecycle: the arcs are armed from ACTIVE; ESCALATED makes them faster and wider (bounded), plus the heat drain.
 */
export const TEMPORAL_STORM_VERSION = 1;

export const TemporalStormParamsSchema = TimingSchema.extend({
  mirror: z.boolean(),
  tier: z.number().int().min(1).max(5),
  breakpointSpot: z.number().int().min(0).max(SPOTS.length - 1),
  arcPeriodTicks: z.number().int().min(45).max(75),
  arcRadius: z.number().int().min(130).max(190),
  channelTicks: z.number().int().min(80).max(140),
  /** Window for the first group (three clocks across the whole hall). */
  clockTicks: z.number().int().min(300).max(420),
  /** Window for the second group (three relays on the right-hand side): shorter. */
  relayTicks: z.number().int().min(140).max(260),
  decoyTicks: z.number().int().min(300).max(700),
});
export type TemporalStormParams = z.infer<typeof TemporalStormParamsSchema>;

function deriveParams(stage: number, rng: Rng): TemporalStormParams {
  const tier = tierFor(stage);
  const layout = rng.fork('layout'), timing = rng.fork('timing'), field = rng.fork('field');
  return {
    ...deriveTiming(tier, timing),
    mirror: layout.chance(0.5),
    tier,
    breakpointSpot: layout.int(0, SPOTS.length - 1),
    arcPeriodTicks: field.int(60, 75) - (tier - 1) * 3,
    arcRadius: field.int(150, 180),
    channelTicks: field.int(90, 120),
    clockTicks: 420 - (tier - 1) * 15 - field.int(0, 20),
    relayTicks: 260 - (tier - 1) * 10 - field.int(0, 20),
    decoyTicks: 600 - (tier - 1) * 40 - field.int(0, 40),
  };
}

function generate({ stage, seed, params: p }: { stage: number; seed: number; params: TemporalStormParams }): StageDef {
  const mx = mirrorFn(p.mirror);
  const spot = SPOTS[p.breakpointSpot]!;
  const coreX = mx(470);

  const disaster: DisasterMetaInput = {
    id: 'temporal_storm',
    version: TEMPORAL_STORM_VERSION,
    name: 'Temporal Storm',
    seed,
    params: { ...p },
    schedule: scheduleOf(p),
    messages: {
      warning: 'Clocks are skipping and events are repeating. Time is stuttering across the hall.',
      active: 'The storm is rolling through. Everything that needs timing must be done inside a window, so move together and move fast.',
      escalated: 'The storm is escalating: arc discharges are faster and wider, and the heat is costing the team points.',
      resolved: 'Time has settled. The clocks agree again.',
      failed: 'The storm ran past its safe limit and time is still stuttering. Stabilise the core to end it.',
      cleanup: 'Time is flowing normally. Every storm effect is cleared.',
    },
    resolveObjectives: ['o_final'],
    threats: [{
      hazardId: 'hz_arc',
      warning: 'Arc discharges strike the core deck in stuttering bursts while the console is being held.',
      countermeasure: 'shield_projector',
      repair: 'Find and mend the fault, arm the three clocks and then the three relays inside their windows, then project a shield at the core console and hold it.',
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
    id: `temporal_storm_${stage}`,
    name: 'Temporal Storm',
    arenaId: ARENA_ID,
    deadlineTicks: p.deadlineTicks,
    disaster,
    failures: [
      { id: 'f_chrono', kind: 'breakpoint', label: 'Desynchronised chronometer' },
      { id: 's_skip', kind: 'symptom', label: 'Clocks skip',
        hint: 'Every clock jumps forward a few seconds, then back, at the same irregular beat.' },
      { id: 's_echo', kind: 'symptom', label: 'Events repeat',
        hint: 'Alarms ring twice. The second ring always comes from the same side of the hall.' },
      { id: 's_lag', kind: 'symptom', label: 'Controls lag',
        hint: 'The controls answer a moment late, and the delay grows while the storm builds.' },
    ],
    edges: [{ from: 'f_chrono', to: 's_skip' }, { from: 'f_chrono', to: 's_echo' }, { from: 'f_chrono', to: 's_lag' }],
    breakpoints: [
      { id: 'bp_chrono', failureId: 'f_chrono', label: 'Desynchronised chronometer', x: mx(spot.x), y: spot.y, repairTicks: 80, weldable: true },
    ],
    power: coreOnlyGrid(coreX),
    entities: [
      cacheEntity(),
      decoyPanel('skip_panel', 'Clock panel T-5', mx(760), 500, 's_skip', p.decoyTicks),
      ...syncConsoles(CONTROLS_A, 'o_clocks', mx, 'Clock'),
      ...syncConsoles(CONTROLS_B, 'o_relays', mx, 'Relay'),
      { kind: 'core_console', id: 'core', label: 'Core console', x: coreX, y: 320, objectiveId: 'o_final', consumerId: 'core_feed' },
    ],
    objectives: [
      { id: 'o_root', label: 'Find out why time keeps skipping',
        description: 'Follow the symptoms to what is actually broken. Resetting a clock panel only hides it for a while.',
        prerequisites: [], lockedMessage: '', bonus: 200,
        params: { kind: 'repair_breakpoint', breakpointId: 'bp_chrono' } },
      { id: 'o_clocks', label: 'Align the three clocks',
        description: 'Arm all three clocks before the first one slips.',
        prerequisites: ['o_root'], lockedMessage: 'The clocks cannot hold: time is still skipping underneath them.', bonus: 250,
        params: { kind: 'timed_controls', controls: CONTROLS_A.map((c) => c.id), armTicks: p.clockTicks } },
      { id: 'o_relays', label: 'Align the three relays',
        description: 'Arm all three relays before the first one slips. This window is shorter.',
        prerequisites: ['o_clocks'], lockedMessage: 'The relays cannot hold until the clocks are aligned.', bonus: 250,
        params: { kind: 'timed_controls', controls: CONTROLS_B.map((c) => c.id), armTicks: p.relayTicks } },
      { id: 'o_final', label: 'Stabilise the core',
        description: 'Hold the core console steady. The core has no power feed and arc discharges strike the deck.',
        prerequisites: ['o_relays'], lockedMessage: 'The console refuses: other systems are still failing.', bonus: 400,
        params: { kind: 'channel_hold', entityId: 'core', requiredTicks: p.channelTicks } },
    ],
    hazards: [
      { id: 'hz_arc', kind: 'arc_discharge', label: 'Arc discharge', x: coreX, y: 300, r: p.arcRadius,
        periodTicks: p.arcPeriodTicks, firstPulseTick: 40, armedWhenObjective: 'o_final' },
    ],
    clues: [
      { id: 'clue_panel', x: mx(760), y: 500, text: 'Panel T-5 reads nominal. The skipping is being driven from somewhere else in the hall.' },
      { id: 'clue_chrono', x: mx(spot.x), y: spot.y, text: 'A timing unit here ticks out of step with every clock, and the storm follows its beat.' },
      { id: 'clue_window', x: mx(520), y: 500, text: 'Clocks and relays hold only if all of a group are armed inside one window. The relay window is shorter.' },
      { id: 'clue_core', x: coreX, y: 320, text: 'The core console has no feed. Arc discharges strike the deck here: something to power it, something to shield you.' },
    ],
    scoring: { ...SCORING },
  });
}

export const TEMPORAL_STORM = defineDisaster<TemporalStormParams>({
  id: 'temporal_storm',
  version: TEMPORAL_STORM_VERSION,
  name: 'Temporal Storm',
  systems: ['time', 'power_grid'],
  requiredTools: ['phase_scanner', 'flux_welder', 'power_cell', 'shield_projector'],
  compat: { minStage: 2, minPlayers: 1, maxPlayers: 4, arenaIds: [ARENA_ID], combinableWith: [], conflictsWith: [] },
  paramsSchema: TemporalStormParamsSchema,
  deriveParams,
  generate,
});
