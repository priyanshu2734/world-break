import { StageDefSchema, type StageDef } from '../stageDef';
import { TUTORIAL_STAGE } from '../tutorial';

export const HUNT_STAGE_ID = 'salvage_hunt';

/**
 * "Cold Start: Salvage" (P3C): stage 1 rebuilt as a real hunt. It keeps the proven geometry and failure chain of the
 * tutorial (copied by value from `TUTORIAL_STAGE`, which is NOT edited) and adds the salvage layer:
 *
 *   - The Welder will not finish the cracked flux coupling until a genuine Flux Coil is installed on it. Nobody starts with one.
 *   - The only genuine coil is hidden: it lies in the maintenance locker on the top deck (opened with E). A second, visibly
 *     cracked coil lies on the first platform. Installing it destroys it and costs score.
 *   - Breaker 2 (the pump route) will not close without a Fuse. One Fuse lies on the first platform, next to a spare Battery that
 *     nothing needs. Every part is one slot and a player has TWO hands, so grabbing the whole pile is impossible and a bad pick
 *     (cracked coil, battery) has to be dropped or swapped before the real part can be carried.
 *   - Objectives state goals only. Easy mode shows one hint line per requirement (the `needs[].hint`), never coordinates.
 *
 * Solvable by ONE player (validator + server/test/salvage/hunt.solvability.test.ts through the real simulation, 1 to 4 players).
 * It is used as stage 1 only when a room is created with the hunt option (see registry.ts); stage 2 and later are generated.
 */
export const HUNT_STAGE: StageDef = StageDefSchema.parse({
  ...structuredClone(TUTORIAL_STAGE),
  id: HUNT_STAGE_ID,
  name: 'Cold Start: Salvage',
  objectives: [
    { id: 'o_root', label: 'Stop the deck lights flickering', description: 'Find what is really wrong and repair it.',
      prerequisites: [], lockedMessage: '', bonus: 200,
      params: { kind: 'repair_breakpoint', breakpointId: 'bp_coupling' } },
    { id: 'o_power', label: 'Get coolant flowing again', description: 'The pump has no power.',
      prerequisites: [], lockedMessage: '', bonus: 200,
      params: { kind: 'power_route', consumerId: 'pump', holdTicks: 40, sealSwitches: ['sw_1', 'sw_2', 'sw_3', 'sw_4'] } },
    { id: 'o_sync', label: 'Synchronise the phase locks', description: 'All three must hold a signal at once.',
      prerequisites: ['o_root'], lockedMessage: 'The phase lock cannot hold: the drift is still feeding it noise.', bonus: 250,
      params: { kind: 'timed_controls', controls: ['lock_a', 'lock_b', 'lock_c'], armTicks: 300 } },
    { id: 'o_final', label: 'Stabilise the relay core', description: 'The core has no power, bends gravity and discharges arcs.',
      prerequisites: ['o_root', 'o_power', 'o_sync'],
      lockedMessage: 'The console refuses: other systems are still failing.', bonus: 400,
      params: { kind: 'channel_hold', entityId: 'core', requiredTicks: 100, needsStableHazard: 'hz_flux' } },
  ],
  clues: [
    ...structuredClone(TUTORIAL_STAGE.clues),
    { id: 'clue_locker', x: 850, y: 320, text: 'The maintenance locker on this deck rattles when you walk past. Something loose is inside.' },
    { id: 'clue_spares', x: 215, y: 590, text: 'A spares pile. Some of it is cracked, some of it is not what it looks like.' },
  ],
  stashes: [
    { id: 'locker_top', kind: 'locker', label: 'Maintenance locker', x: 850, y: 320 },
    { id: 'crate_dock', kind: 'crate', label: 'Dented crate', x: 1050, y: 590 },
  ],
  items: [
    { id: 'coil_cracked', kind: 'flux_coil', x: 240, y: 590, decoy: true, tell: true },
    { id: 'fuse_a', kind: 'fuse', x: 190, y: 590 },
    { id: 'battery_a', kind: 'battery', x: 215, y: 590 },
    { id: 'coil_real', kind: 'flux_coil', x: 860, y: 320, hidden: { container: 'locker', reveal: 'interact', stashId: 'locker_top' } },
  ],
  needs: [
    { targetId: 'bp_coupling', items: ['flux_coil'], hint: 'Spare parts are racked in lockers on the upper decks.' },
    { targetId: 'sw_2', items: ['fuse'], hint: 'The breaker has lost its fuse. A spare is lying around.' },
  ],
});
