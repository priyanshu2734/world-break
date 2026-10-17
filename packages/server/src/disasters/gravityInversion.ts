import { z } from 'zod';
import { ARENA_ID, type Rng } from '@wb/shared';
import { StageDefSchema, type StageDef } from '../systems/stageDef';
import { defineDisaster } from './framework';
import type { DisasterMetaInput } from './meta';
import { CONTROLS_A, SCORING, SPOTS, TimingSchema, cacheEntity, coreOnlyGrid, decoyPanel, deriveTiming, mirrorFn, scheduleOf, syncConsoles, tierFor } from './kit';

/**
 * Gravity inversion (v1).
 *
 * Story: a gravity coil has inverted its field. Loose gear drifts upward and the core deck is wrapped in an
 * unstable gravity field. In P3A this is expressed ONLY with existing mechanics (no movement physics change):
 *   hidden breakpoint (inverted coil, weldable)  -> drift / pull / rattle symptoms
 *   three gravity pylons armed inside one window (timed controls) once the coil is mended
 *   core console held inside a `gravity_flux` field (Gravity Anchor) running on a Power Cell
 * Lifecycle: the flux field is visible from the start; ESCALATED adds a second threat (arc discharges strike the
 * core deck, Shield Projector) and enlarges the displayed field (bounded to 1.2x), plus the bounded heat drain.
 */
export const GRAVITY_INVERSION_VERSION = 1;

export const GravityInversionParamsSchema = TimingSchema.extend({
  mirror: z.boolean(),
  tier: z.number().int().min(1).max(5),
  breakpointSpot: z.number().int().min(0).max(SPOTS.length - 1),
  fluxRadius: z.number().int().min(180).max(240),
  arcPeriodTicks: z.number().int().min(45).max(75),
  arcRadius: z.number().int().min(130).max(190),
  channelTicks: z.number().int().min(80).max(140),
  /** Window (ticks) in which all three pylons must be armed. */
  syncTicks: z.number().int().min(300).max(420),
});
export type GravityInversionParams = z.infer<typeof GravityInversionParamsSchema>;

function deriveParams(stage: number, rng: Rng): GravityInversionParams {
  const tier = tierFor(stage);
  const layout = rng.fork('layout'), timing = rng.fork('timing'), field = rng.fork('field');
  return {
    ...deriveTiming(tier, timing),
    mirror: layout.chance(0.5),
    tier,
    breakpointSpot: layout.int(0, SPOTS.length - 1),
    fluxRadius: field.int(190, 230),
    arcPeriodTicks: field.int(60, 75) - (tier - 1) * 3,
    arcRadius: field.int(150, 180),
    channelTicks: field.int(90, 120),
    syncTicks: 420 - (tier - 1) * 15 - field.int(0, 20),
  };
}

function generate({ stage, seed, params: p }: { stage: number; seed: number; params: GravityInversionParams }): StageDef {
  const mx = mirrorFn(p.mirror);
  const spot = SPOTS[p.breakpointSpot]!;
  const coreX = mx(470);

  const disaster: DisasterMetaInput = {
    id: 'gravity_inversion',
    version: GRAVITY_INVERSION_VERSION,
    name: 'Gravity Inversion',
    seed,
    params: { ...p },
    schedule: scheduleOf(p),
    messages: {
      warning: 'Loose gear is drifting upward and the field around the core deck is unstable. Find out what is bending gravity.',
      active: 'Gravity is inverting around the core. The field must be anchored before anyone can hold the console.',
      escalated: 'The inversion is escalating: the field is wider, arc discharges now strike the core deck, and the heat is costing the team points.',
      resolved: 'Gravity has settled. The field is anchored and the core is stable.',
      failed: 'The inversion ran past its safe limit and is still shaking the deck. Stabilise the core to end it.',
      cleanup: 'Gravity is back to normal. Every inversion effect is cleared.',
    },
    resolveObjectives: ['o_final'],
    threats: [
      {
        hazardId: 'hz_flux',
        warning: 'A gravity field around the core console throws anyone off who tries to hold it.',
        countermeasure: 'gravity_anchor',
        repair: 'Scan the deck to find the fault, arm the three pylons together, then deploy a gravity anchor at the core console and hold it.',
      },
      {
        hazardId: 'hz_arc',
        warning: 'Once the inversion escalates, arc discharges strike the core deck while the console is held.',
        countermeasure: 'shield_projector',
        repair: 'Project a shield at the core console before holding it.',
      },
    ],
    hazardPhases: [
      { hazardId: 'hz_flux', armedFrom: 'active', escalated: { r: Math.round(p.fluxRadius * 1.2) } },
      { hazardId: 'hz_arc', armedFrom: 'escalated', escalated: { periodTicks: p.arcPeriodTicks, r: p.arcRadius } },
    ],
    heat: { perSecond: p.heatPerSecond, cap: p.heatCap },
    failPenalty: p.failPenalty,
  };

  return StageDefSchema.parse({
    id: `gravity_inversion_${stage}`,
    name: 'Gravity Inversion',
    arenaId: ARENA_ID,
    deadlineTicks: p.deadlineTicks,
    disaster,
    failures: [
      { id: 'f_coil', kind: 'breakpoint', label: 'Inverted gravity coil' },
      { id: 's_drift', kind: 'symptom', label: 'Loose gear drifts upward',
        hint: 'Small objects creep toward the ceiling, fastest near the core deck.' },
      { id: 's_pull', kind: 'symptom', label: 'Pylons will not hold phase',
        hint: 'The pylons cannot hold a signal while the field keeps flipping underneath them.' },
      { id: 's_rattle', kind: 'symptom', label: 'Hull rattling',
        hint: 'The plating rattles in time with the flips, and the beat comes from one side of the hall.' },
    ],
    edges: [{ from: 'f_coil', to: 's_drift' }, { from: 'f_coil', to: 's_pull' }, { from: 'f_coil', to: 's_rattle' }],
    breakpoints: [
      { id: 'bp_coil', failureId: 'f_coil', label: 'Inverted gravity coil', x: mx(spot.x), y: spot.y, repairTicks: 80, weldable: true },
    ],
    power: coreOnlyGrid(coreX),
    entities: [
      cacheEntity(),
      decoyPanel('drift_panel', 'Drift gauge G-4', mx(760), 500, 's_drift', 800),
      ...syncConsoles(CONTROLS_A, 'o_sync', mx, 'Pylon'),
      { kind: 'core_console', id: 'core', label: 'Core console', x: coreX, y: 320, objectiveId: 'o_final', consumerId: 'core_feed' },
    ],
    objectives: [
      { id: 'o_root', label: 'Find out why gravity keeps flipping',
        description: 'Follow the symptoms to what is actually broken. Calming a gauge is not the same as fixing the fault.',
        prerequisites: [], lockedMessage: '', bonus: 200,
        params: { kind: 'repair_breakpoint', breakpointId: 'bp_coil' } },
      { id: 'o_sync', label: 'Synchronise the gravity pylons',
        description: 'Arm all three pylons before the first one slips.',
        prerequisites: ['o_root'], lockedMessage: 'The pylons cannot hold phase: the field is still flipping underneath them.', bonus: 250,
        params: { kind: 'timed_controls', controls: CONTROLS_A.map((c) => c.id), armTicks: p.syncTicks } },
      { id: 'o_final', label: 'Stabilise the core',
        description: 'Hold the core console steady. The core has no power feed and sits inside a gravity field.',
        prerequisites: ['o_root', 'o_sync'], lockedMessage: 'The console refuses: other systems are still failing.', bonus: 400,
        params: { kind: 'channel_hold', entityId: 'core', requiredTicks: p.channelTicks, needsStableHazard: 'hz_flux' } },
    ],
    hazards: [
      { id: 'hz_flux', kind: 'gravity_flux', label: 'Gravity field', x: coreX, y: 300, r: p.fluxRadius },
      { id: 'hz_arc', kind: 'arc_discharge', label: 'Arc discharge', x: coreX, y: 300, r: p.arcRadius,
        periodTicks: p.arcPeriodTicks, firstPulseTick: 40, armedWhenObjective: 'o_final' },
    ],
    clues: [
      { id: 'clue_gauge', x: mx(760), y: 500, text: 'Gauge G-4 reads nominal. The drift is being driven from somewhere else in the hall.' },
      { id: 'clue_coil', x: mx(spot.x), y: spot.y, text: 'A coil housing here is warm, and its field is pointing the wrong way in time with the drift.' },
      { id: 'clue_pylon', x: mx(520), y: 500, text: 'The pylons need to be armed together. They only hold phase once the field stops flipping.' },
      { id: 'clue_core', x: coreX, y: 320, text: 'The core console has no feed and sits in the gravity field: something to anchor, something to power it.' },
    ],
    scoring: { ...SCORING },
  });
}

export const GRAVITY_INVERSION = defineDisaster<GravityInversionParams>({
  id: 'gravity_inversion',
  version: GRAVITY_INVERSION_VERSION,
  name: 'Gravity Inversion',
  systems: ['gravity', 'power_grid'],
  requiredTools: ['phase_scanner', 'flux_welder', 'gravity_anchor', 'power_cell', 'shield_projector'],
  compat: { minStage: 2, minPlayers: 1, maxPlayers: 4, arenaIds: [ARENA_ID], combinableWith: [], conflictsWith: [] },
  paramsSchema: GravityInversionParamsSchema,
  deriveParams,
  generate,
});
