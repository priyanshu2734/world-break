import type { RoomGraph } from '@wb/shared';
import type { StageDefInput } from '../systems/stageDef';

export const ESCAPE_SCORING = { timeBonusPerSecond: 1, expiredPenalty: 200, expiredDrainPerSecond: 1, wrongTargetPenalty: 25, overloadPenalty: 100, hazardHitPenalty: 75 };

/** The skeleton of an escape stage: no objectives, failures, power grid or hazards, only rooms, parts and an exit. Dark. */
export function bareEscapeStage(id: string, name: string, graph: RoomGraph, deadlineTicks = 20 * 60 * 20): Omit<StageDefInput, 'items' | 'stashes' | 'escape'> {
  return {
    id, name, arenaId: graph.start, deadlineTicks, loadout: [],
    failures: [], edges: [], breakpoints: [], power: { capacity: 1, nodes: [], conduits: [], faultBindings: [] },
    entities: [], objectives: [], hazards: [], clues: [], scoring: ESCAPE_SCORING, dark: true, rooms: graph,
  };
}
