import { ghostLineupForStage, ghostPickWith, ghostPresentOnStage, ghostSeedFor, roomCountForStage, templatesForStage, themeForStage, type VarietyHistory, type VarietyRecord } from '@wb/shared';
import type { StageDef } from '../systems/stageDef';

/**
 * P3F step 4: what a generated stage USED, as the record the newness rule reads. A pure function of the stage, its seed, the option and the history the stage was
 * generated with, so the Room and the tests build the same record from the same stage.
 */
export function varietyRecordOf(stage: number, seed: number, def: StageDef, ghostOn: boolean, history: VarietyHistory): VarietyRecord {
  return {
    stage,
    locks: (def.escape?.links ?? []).map((l) => l.lock.type),
    templates: def.rooms ? templatesForStage(stage, seed, roomCountForStage(stage), history) : [],
    ghosts: ghostOn && ghostPresentOnStage(stage) ? ghostLineupForStage(stage, ghostPickWith(stage, ghostSeedFor(seed, stage), history)) : [],
    theme: themeForStage(stage, seed, history),
  };
}
