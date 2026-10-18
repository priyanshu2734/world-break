import { ABILITY_LAB_ARENA_ID } from '@wb/shared';
import { StageDefSchema, type StageDef } from '../stageDef';

export const ABILITY_LAB_STAGE_ID = 'ability_lab';

/**
 * "Reality Calibration": the hand-authored Ability Lab. NOT in the endless rotation: a Room only plays it as stage 1 when the
 * server runs with ABILITY_LAB=1 and the room was created from `?lab=1` (see docs/ABILITIES.md). Six independent stations,
 * every reality ability REQUIRED by at least one of them:
 *
 *   o_anchor    Gravity Anchor  Core console under a gravity flux (needs an anchor planted with solid footing).
 *   o_freeze    Freeze          Core console under an arc discharge that pulses every 30 ticks; the channel takes 45 and there
 *                               is no shield in the loadout. Freeze holds the arc for 60 ticks.
 *   o_well      Gravity Well    A plate on a ledge 360 px above its take-off platform. A jump reaches 124 px; a jump plus a
 *                               Momentum impulse about 325 px. A flipped well lifts you over it.
 *   o_momentum  Momentum        A HEAVY plate (objects only) on an island across a gap. Only a thrown crate can get there.
 *   o_dup       Duplicate       Two HEAVY plates that must be pressed at the same moment, and one crate. Needs a copy.
 *   o_charge    (repairs)       Two capacitors. Repairs refill Reality Energy; the stations together cost more than 100.
 *
 * Energy budget for one player: well 30 + momentum 20 + duplicate 30 + freeze 25 = 105 > 100, so at least one repair is
 * required (each gives +30). Nothing regenerates otherwise (passiveRegenTicks 0).
 * Physical solvability for 1-4 players is proven by driving the real simulation (server/test/abilities/lab.solvability.test.ts).
 */
export const ABILITY_LAB_STAGE: StageDef = StageDefSchema.parse({
  id: ABILITY_LAB_STAGE_ID,
  name: 'Reality Calibration',
  arenaId: ABILITY_LAB_ARENA_ID,
  deadlineTicks: 12000,
  // No Shield Projector and no Power Cell: the arc is answered by Freeze, power comes from the grid.
  loadout: ['phase_scanner', 'flux_welder', 'gravity_anchor'],
  abilities: { enabled: ['gravity_well', 'freeze', 'duplicate', 'momentum', 'anchor'], energyMax: 100, energyStart: 100, passiveRegenTicks: 0 },
  props: [
    { id: 'crate_m', kind: 'crate', x: 360, y: 400, light: true },
    { id: 'crate_d', kind: 'crate', x: 880, y: 590, light: true },
  ],
  failures: [
    { id: 'f_cap_a', kind: 'breakpoint', label: 'Drained capacitor A' },
    { id: 'f_cap_b', kind: 'breakpoint', label: 'Drained capacitor B' },
    { id: 's_sag', kind: 'symptom', label: 'Reality Energy sags',
      hint: 'The calibration rig draws on the capacitor banks every time reality is bent.' },
  ],
  edges: [{ from: 'f_cap_a', to: 's_sag' }, { from: 'f_cap_b', to: 's_sag' }],
  breakpoints: [
    { id: 'bp_cap_a', failureId: 'f_cap_a', label: 'Drained capacitor A', x: 350, y: 590, repairTicks: 50, weldable: true },
    { id: 'bp_cap_b', failureId: 'f_cap_b', label: 'Drained capacitor B', x: 260, y: 680, repairTicks: 50, weldable: true },
  ],
  power: {
    capacity: 2,
    nodes: [
      { id: 'gen', kind: 'generator', label: 'Lab generator', x: 600, y: 680 },
      { id: 'feed_anchor', kind: 'consumer', label: 'Anchor console feed', x: 420, y: 590 },
      { id: 'feed_freeze', kind: 'consumer', label: 'Freeze console feed', x: 720, y: 680 },
    ],
    conduits: [
      { id: 'c_ga', from: 'gen', to: 'feed_anchor', condition: 'ok' },
      { id: 'c_gf', from: 'gen', to: 'feed_freeze', condition: 'ok' },
    ],
    faultBindings: [],
  },
  entities: [
    { kind: 'core_console', id: 'core_anchor', label: 'Anchor console', x: 420, y: 590, objectiveId: 'o_anchor', consumerId: 'feed_anchor' },
    { kind: 'core_console', id: 'core_freeze', label: 'Freeze console', x: 720, y: 680, objectiveId: 'o_freeze', consumerId: 'feed_freeze' },
    { kind: 'pressure_plate', id: 'plate_well', label: 'Ledge plate', x: 1080, y: 140, objectiveId: 'o_well', activatedBy: 'any' },
    { kind: 'pressure_plate', id: 'plate_m', label: 'Heavy plate (island)', x: 32, y: 600, objectiveId: 'o_momentum', activatedBy: 'object' },
    { kind: 'pressure_plate', id: 'plate_d1', label: 'Heavy plate 1', x: 880, y: 590, objectiveId: 'o_dup', activatedBy: 'object' },
    { kind: 'pressure_plate', id: 'plate_d2', label: 'Heavy plate 2', x: 1060, y: 590, objectiveId: 'o_dup', activatedBy: 'object' },
  ],
  objectives: [
    { id: 'o_charge', label: 'Recharge the capacitor bank',
      description: 'Bending reality drains Reality Energy. Repairs give it back to everyone.',
      prerequisites: [], lockedMessage: '', bonus: 100,
      params: { kind: 'repair_breakpoint', breakpointId: 'bp_cap_a' } },
    { id: 'o_anchor', label: 'Hold the anchor console steady',
      description: 'The console sits in a gravity flux. Something must hold gravity still while you channel.',
      prerequisites: [], lockedMessage: '', bonus: 150,
      params: { kind: 'channel_hold', entityId: 'core_anchor', requiredTicks: 60, needsStableHazard: 'hz_flux' } },
    { id: 'o_freeze', label: 'Calibrate the console inside the arc storm',
      description: 'Arc discharges land far faster than the channel takes, and there is no shield here.',
      prerequisites: [], lockedMessage: '', bonus: 150,
      params: { kind: 'channel_hold', entityId: 'core_freeze', requiredTicks: 45 } },
    { id: 'o_well', label: 'Reach the ledge plate',
      description: 'The ledge is far out of jump range.',
      prerequisites: [], lockedMessage: '', bonus: 150,
      params: { kind: 'timed_controls', controls: ['plate_well'], armTicks: 1 } },
    { id: 'o_momentum', label: 'Weigh down the island plate',
      description: 'The plate across the gap only reacts to something heavy resting on it.',
      prerequisites: [], lockedMessage: '', bonus: 150,
      params: { kind: 'timed_controls', controls: ['plate_m'], armTicks: 1 } },
    { id: 'o_dup', label: 'Hold both heavy plates at once',
      description: 'Two plates, one crate. They count only while both are pressed at the same moment.',
      prerequisites: [], lockedMessage: '', bonus: 150,
      params: { kind: 'timed_controls', controls: ['plate_d1', 'plate_d2'], armTicks: 1 } },
  ],
  hazards: [
    { id: 'hz_flux', kind: 'gravity_flux', label: 'Gravity flux', x: 420, y: 570, r: 150 },
    { id: 'hz_arc', kind: 'arc_discharge', label: 'Arc discharge', x: 720, y: 660, r: 130,
      periodTicks: 30, firstPulseTick: 30, armedWhenObjective: 'o_freeze' },
  ],
  clues: [
    { id: 'clue_cap', x: 350, y: 590, text: 'Drained capacitor banks hum here. Each repair recharges everyone\'s Reality Energy.' },
    { id: 'clue_flux', x: 420, y: 590, text: 'Gravity flux at the console. Plant a Gravity Anchor on solid ground nearby, then channel.' },
    { id: 'clue_arc', x: 720, y: 680, text: 'Arc discharges land every half second. Nothing here shields you, but something can stop the storm for a while.' },
    { id: 'clue_ledge', x: 1170, y: 500, text: 'The ledge above is far out of jump range, and a shove from yourself will not do it either. Gravity can be bent.' },
    { id: 'clue_island', x: 360, y: 400, text: 'The island plate is heavy: it reacts to objects, not to you. The gap is too wide to cross, so send the crate.' },
    { id: 'clue_dup', x: 950, y: 590, text: 'Two heavy plates, one crate, and the plates must both be pressed at the same moment.' },
  ],
  scoring: {
    timeBonusPerSecond: 1, expiredPenalty: 200, expiredDrainPerSecond: 1,
    wrongTargetPenalty: 25, overloadPenalty: 100, hazardHitPenalty: 75,
  },
});
