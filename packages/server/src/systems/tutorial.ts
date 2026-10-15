import { ARENA_ID } from '@wb/shared';
import { StageDefSchema, type StageDef } from './stageDef';

/**
 * Tutorial stage: "Cold Start". Hand-authored for Relay Platform 01.
 *
 * Failure chain (hidden from players until investigated):
 *   cracked flux coupling (hidden breakpoint) -> lights flicker, core pressure swings, phase-lock drift
 *   slagged pump feed (visible) + generator capacity 1 -> pump unpowered -> coolant alarm, core pressure swings
 *   core console has no feed at all -> needs a temporary Power Cell
 * Repair patterns: (1) diagnose + weld the hidden root, (2) reroute power through valid conduits,
 * (3) arm three phase locks inside one window. Final: channel the core console under gravity flux and
 * arc discharge (Gravity Anchor + Shield Projector + Power Cell).
 */
export const TUTORIAL_STAGE: StageDef = StageDefSchema.parse({
  id: 'tutorial_cold_start',
  name: 'Cold Start',
  arenaId: ARENA_ID,
  deadlineTicks: 12000, // 10 minutes, soft deadline (overrun costs score, it does not end the stage)
  failures: [
    { id: 'f_coupling', kind: 'breakpoint', label: 'Cracked flux coupling' },
    { id: 'f_pump', kind: 'fault', label: 'Coolant pump unpowered' },
    { id: 's_flicker', kind: 'symptom', label: 'Deck lights flicker',
      hint: 'A slow pulse runs through the lights, strongest on the upper west deck.' },
    { id: 's_pressure', kind: 'symptom', label: 'Core pressure swings',
      hint: 'Pressure swings in time with the flicker, and worsens when coolant stalls.' },
    { id: 's_coolant', kind: 'symptom', label: 'Coolant alarm',
      hint: 'Coolant flow alarm. The pump is silent.' },
    { id: 's_drift', kind: 'symptom', label: 'Phase-lock drift',
      hint: 'The phase locks cannot hold a signal while something keeps feeding them noise.' },
  ],
  edges: [
    { from: 'f_coupling', to: 's_flicker' }, { from: 'f_coupling', to: 's_pressure' },
    { from: 'f_coupling', to: 's_drift' }, { from: 'f_pump', to: 's_pressure' }, { from: 'f_pump', to: 's_coolant' },
  ],
  breakpoints: [
    { id: 'bp_coupling', failureId: 'f_coupling', label: 'Cracked flux coupling', x: 200, y: 410, repairTicks: 80, weldable: true },
  ],
  power: {
    capacity: 1,
    nodes: [
      { id: 'gen', kind: 'generator', label: 'Generator', x: 900, y: 590 },
      { id: 'jx', kind: 'junction', label: 'Junction', x: 980, y: 410 },
      { id: 'pump', kind: 'consumer', label: 'Coolant pump', x: 810, y: 320 },
      { id: 'fan', kind: 'consumer', label: 'Vent fan', x: 1190, y: 680 },
      { id: 'core_feed', kind: 'consumer', label: 'Core feed', x: 470, y: 320 },
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
    { kind: 'decoy_panel', id: 'flicker_panel', label: 'Light panel L-3', x: 760, y: 500,
      mitigates: 's_flicker', mitigateTicks: 800, repairTicks: 40 },
    { kind: 'power_switch', id: 'sw_1', label: 'Breaker 1', x: 990, y: 590, conduitId: 'c_gj', initiallyClosed: false },
    { kind: 'power_switch', id: 'sw_2', label: 'Breaker 2', x: 1080, y: 590, conduitId: 'c_jp', initiallyClosed: false },
    { kind: 'power_switch', id: 'sw_3', label: 'Breaker 3', x: 1050, y: 410, conduitId: 'c_jf', initiallyClosed: false },
    { kind: 'power_switch', id: 'sw_4', label: 'Breaker 4', x: 1050, y: 680, conduitId: 'c_gf', initiallyClosed: false },
    { kind: 'sync_console', id: 'lock_a', label: 'Phase lock A', x: 200, y: 590, objectiveId: 'o_sync' },
    { kind: 'sync_console', id: 'lock_b', label: 'Phase lock B', x: 520, y: 500, objectiveId: 'o_sync' },
    { kind: 'sync_console', id: 'lock_c', label: 'Phase lock C', x: 1200, y: 680, objectiveId: 'o_sync' },
    { kind: 'core_console', id: 'core', label: 'Core console', x: 470, y: 320, objectiveId: 'o_final', consumerId: 'core_feed' },
  ],
  objectives: [
    { id: 'o_root', label: 'Find out why the lights keep flickering',
      description: 'Follow the symptoms to what is actually broken. Fixing the panel is not the same as fixing the fault.',
      prerequisites: [], lockedMessage: '', bonus: 200,
      params: { kind: 'repair_breakpoint', breakpointId: 'bp_coupling' } },
    { id: 'o_power', label: 'Get coolant flowing again',
      description: 'The direct feed to the pump is gone. Route power through breakers without overloading the generator.',
      prerequisites: [], lockedMessage: '', bonus: 200,
      params: { kind: 'power_route', consumerId: 'pump', holdTicks: 40, sealSwitches: ['sw_1', 'sw_2', 'sw_3', 'sw_4'] } },
    { id: 'o_sync', label: 'Synchronise the phase locks',
      description: 'Arm all three phase locks before the first one slips.',
      prerequisites: ['o_root'], lockedMessage: 'The phase lock cannot hold: the drift is still feeding it noise.', bonus: 250,
      params: { kind: 'timed_controls', controls: ['lock_a', 'lock_b', 'lock_c'], armTicks: 300 } },
    { id: 'o_final', label: 'Stabilise the relay core',
      description: 'Hold the core console steady. The core has no power, bends gravity, and discharges arcs.',
      prerequisites: ['o_root', 'o_power', 'o_sync'],
      lockedMessage: 'The console refuses: other systems are still failing.', bonus: 400,
      params: { kind: 'channel_hold', entityId: 'core', requiredTicks: 100, needsStableHazard: 'hz_flux' } },
  ],
  hazards: [
    { id: 'hz_flux', kind: 'gravity_flux', label: 'Gravity flux', x: 470, y: 300, r: 220 },
    { id: 'hz_arc', kind: 'arc_discharge', label: 'Arc discharge', x: 470, y: 300, r: 170,
      periodTicks: 60, firstPulseTick: 40, armedWhenObjective: 'o_final' },
  ],
  clues: [
    { id: 'clue_panel', x: 760, y: 500, text: 'Panel L-3 reads nominal. The pulse is arriving down a conduit from the west.' },
    { id: 'clue_coupling', x: 200, y: 410, text: 'A flux coupling here is hairline-cracked and hums in time with the flicker.' },
    { id: 'clue_grid', x: 900, y: 590, text: 'The direct feed to the pump is slagged. Power must go around through the junction, and the generator can carry only one load.' },
    { id: 'clue_core', x: 470, y: 320, text: 'The core console has no feed. Gravity flux and arc discharge at the core: something to anchor, something to shield.' },
  ],
  scoring: {
    timeBonusPerSecond: 1, expiredPenalty: 200, expiredDrainPerSecond: 1,
    wrongTargetPenalty: 25, overloadPenalty: 100, hazardHitPenalty: 75,
  },
});
