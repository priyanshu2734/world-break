import { z } from 'zod';
import { ARENA_ID, type Rng } from '@wb/shared';
import { StageDefSchema, type StageDef } from '../systems/stageDef';
import { defineDisaster } from './framework';
import type { DisasterMetaInput } from './meta';
import { CONTROLS_A, SCORING, SPOTS, TimingSchema, cacheEntity, coreOnlyGrid, decoyPanel, deriveTiming, mirrorFn, scheduleOf, syncConsoles, tierFor } from './kit';

/**
 * Reality fracture (v1).
 *
 * Story: the hall is shimmering between two states. Readings contradict each other and the Phase Scanner cannot
 * lock onto the real fault while the hall is unanchored. Existing mechanics only:
 *   three reality anchors armed inside one window (timed controls)  -> the scanner can now find the hidden seam
 *   hidden breakpoint (scan-gated: `scanRequires: ['o_sync']`) mended with the Flux Welder
 *   two decoy panels that calm a symptom for a while and then relapse
 *   core console (Power Cell) held under `arc_discharge` (Shield Projector)
 * Lifecycle: the arcs are armed from ACTIVE; ESCALATED makes them faster and wider (bounded), plus the heat drain.
 */
export const REALITY_FRACTURE_VERSION = 1;

export const RealityFractureParamsSchema = TimingSchema.extend({
  mirror: z.boolean(),
  tier: z.number().int().min(1).max(5),
  breakpointSpot: z.number().int().min(0).max(SPOTS.length - 1),
  arcPeriodTicks: z.number().int().min(45).max(75),
  arcRadius: z.number().int().min(130).max(190),
  channelTicks: z.number().int().min(80).max(140),
  syncTicks: z.number().int().min(300).max(420),
  /** How long a decoy panel calms its symptom before it relapses. */
  decoyTicks: z.number().int().min(400).max(900),
});
export type RealityFractureParams = z.infer<typeof RealityFractureParamsSchema>;

function deriveParams(stage: number, rng: Rng): RealityFractureParams {
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
    syncTicks: 420 - (tier - 1) * 15 - field.int(0, 20),
    decoyTicks: 800 - (tier - 1) * 50 - field.int(0, 50),
  };
}

function generate({ stage, seed, params: p }: { stage: number; seed: number; params: RealityFractureParams }): StageDef {
  const mx = mirrorFn(p.mirror);
  const spot = SPOTS[p.breakpointSpot]!;
  const coreX = mx(470);

  const disaster: DisasterMetaInput = {
    id: 'reality_fracture',
    version: REALITY_FRACTURE_VERSION,
    name: 'Reality Fracture',
    seed,
    params: { ...p },
    schedule: scheduleOf(p),
    messages: {
      warning: 'The hall is shimmering and instruments disagree with each other. Nothing here can be trusted until it is anchored.',
      active: 'Reality is fracturing. Anchor the hall first; only then can the real fault be found.',
      escalated: 'The fracture is escalating: arc discharges are faster and wider, and the heat is costing the team points.',
      resolved: 'The hall has stopped shifting. Readings agree again.',
      failed: 'The fracture ran past its safe limit and the hall is still shifting. Stabilise the core to end it.',
      cleanup: 'The hall is solid again. Every fracture effect is cleared.',
    },
    resolveObjectives: ['o_final'],
    threats: [{
      hazardId: 'hz_arc',
      warning: 'Arc discharges leap across the shifting core deck while the console is being held.',
      countermeasure: 'shield_projector',
      repair: 'Arm the three anchors together so the hall stops shifting, scan for the real fault and mend it, then project a shield at the core console and hold it.',
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
    id: `reality_fracture_${stage}`,
    name: 'Reality Fracture',
    arenaId: ARENA_ID,
    deadlineTicks: p.deadlineTicks,
    disaster,
    failures: [
      { id: 'f_seam', kind: 'breakpoint', label: 'Fractured phase seam' },
      { id: 's_ghost', kind: 'symptom', label: 'Duplicate readings',
        hint: 'Every gauge shows two values, and the second one lags a moment behind.' },
      { id: 's_shimmer', kind: 'symptom', label: 'Walls shimmer',
        hint: 'The plating flickers between two textures. The scanner cannot settle while it does.' },
      { id: 's_instr', kind: 'symptom', label: 'Instruments disagree',
        hint: 'No two instruments agree. The disagreement is strongest on one side of the hall.' },
    ],
    edges: [{ from: 'f_seam', to: 's_ghost' }, { from: 'f_seam', to: 's_shimmer' }, { from: 'f_seam', to: 's_instr' }],
    breakpoints: [
      // the scanner cannot find it until the anchors hold the hall still
      { id: 'bp_seam', failureId: 'f_seam', label: 'Fractured phase seam', x: mx(spot.x), y: spot.y, repairTicks: 80, weldable: true, scanRequires: ['o_sync'] },
    ],
    power: coreOnlyGrid(coreX),
    entities: [
      cacheEntity(),
      decoyPanel('ghost_panel', 'Readout panel R-1', mx(760), 500, 's_ghost', p.decoyTicks),
      decoyPanel('shimmer_panel', 'Plating monitor R-2', mx(1050), 410, 's_shimmer', p.decoyTicks),
      ...syncConsoles(CONTROLS_A, 'o_sync', mx, 'Anchor'),
      { kind: 'core_console', id: 'core', label: 'Core console', x: coreX, y: 320, objectiveId: 'o_final', consumerId: 'core_feed' },
    ],
    objectives: [
      { id: 'o_sync', label: 'Anchor the hall',
        description: 'Arm all three anchors before the first one slips. The scanner cannot find the real fault until the hall holds still.',
        prerequisites: [], lockedMessage: '', bonus: 250,
        params: { kind: 'timed_controls', controls: CONTROLS_A.map((c) => c.id), armTicks: p.syncTicks } },
      { id: 'o_root', label: 'Find the real fault',
        description: 'Scan once the hall is anchored and follow the contradictions to what is actually broken. Calming a panel only hides it for a while.',
        prerequisites: ['o_sync'], lockedMessage: '', bonus: 200,
        params: { kind: 'repair_breakpoint', breakpointId: 'bp_seam' } },
      { id: 'o_final', label: 'Stabilise the core',
        description: 'Hold the core console steady. The core has no power feed and arc discharges strike the deck.',
        prerequisites: ['o_root'], lockedMessage: 'The console refuses: other systems are still failing.', bonus: 400,
        params: { kind: 'channel_hold', entityId: 'core', requiredTicks: p.channelTicks } },
    ],
    hazards: [
      { id: 'hz_arc', kind: 'arc_discharge', label: 'Arc discharge', x: coreX, y: 300, r: p.arcRadius,
        periodTicks: p.arcPeriodTicks, firstPulseTick: 40, armedWhenObjective: 'o_final' },
    ],
    clues: [
      { id: 'clue_ghost', x: mx(760), y: 500, text: 'Panel R-1 shows a value, then its echo. Resetting it only hides the echo for a while.' },
      { id: 'clue_anchor', x: mx(520), y: 500, text: 'The anchors hold the hall still only if all three are armed together.' },
      { id: 'clue_seam', x: mx(spot.x), y: spot.y, text: 'The air here shears in two. Whatever is broken, this is where the readings disagree most.' },
      { id: 'clue_core', x: coreX, y: 320, text: 'The core console has no feed. Arc discharges leap across the deck here: something to power it, something to shield you.' },
    ],
    scoring: { ...SCORING },
  });
}

export const REALITY_FRACTURE = defineDisaster<RealityFractureParams>({
  id: 'reality_fracture',
  version: REALITY_FRACTURE_VERSION,
  name: 'Reality Fracture',
  systems: ['reality', 'power_grid'],
  requiredTools: ['phase_scanner', 'flux_welder', 'power_cell', 'shield_projector'],
  compat: { minStage: 2, minPlayers: 1, maxPlayers: 4, arenaIds: [ARENA_ID], combinableWith: [], conflictsWith: [] },
  paramsSchema: RealityFractureParamsSchema,
  deriveParams,
  generate,
});
