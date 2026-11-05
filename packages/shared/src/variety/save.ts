import { z } from 'zod';
import { GHOST_TYPES } from '../ghost';
import { HISTORY_KEEP, THEME_IDS, type VarietyHistory, type VarietyRecord } from './curriculum';

/**
 * P3F step 6: the run's variety history as something a SAVE (P6) or the scenario generator (P5) can keep and hand back.
 *
 * DETERMINISM NOTE. Before step 4 a stage was a pure function of (stage number, stage seed). Since step 4 a stage ALSO depends on what the last `HISTORY_KEEP` stages used
 * (lock types, room templates, ghost types, theme: `GenerateOptions.history`). The same (stage, seed) with another history can be another stage. So anything that rebuilds a stage
 * later (a save and resume, a replay, a scenario that starts at stage N, a "regenerate this stage" tool) MUST keep the history with the run seed and give it back. An empty history is
 * valid and gives the stage the generator made on its own (what a scenario "stage N on its own" wants). A stage never needs more than `HISTORY_KEEP` records.
 */
export const VarietyRecordSchema = z.object({
  stage: z.number().int().min(1),
  locks: z.array(z.string().max(24)).max(8),
  templates: z.array(z.string().max(24)).max(8),
  ghosts: z.array(z.enum(GHOST_TYPES)).max(2),
  theme: z.enum(THEME_IDS),
}).strict();
export const VarietyHistorySchema = z.array(VarietyRecordSchema).max(16);

/** Sorted oldest first, one record per stage (the last one given wins), and only the newest `HISTORY_KEEP` kept. */
export function normaliseHistory(records: readonly VarietyRecord[]): VarietyHistory {
  const byStage = new Map<number, VarietyRecord>();
  for (const r of records) byStage.set(r.stage, r);
  return [...byStage.values()].sort((a, b) => a.stage - b.stage).slice(-HISTORY_KEEP);
}
