import type { Difficulty, ThemeId, UpgradeId } from '@wb/shared';
import { Room } from '../../src/room';
import type { StageDef } from '../../src/systems/stageDef';
import { solveStage, type SolveExtras } from './solver';

/**
 * P3F step 6: a whole RUN played by the real-physics solver, stage after stage through the real STAGE_CLEAR and NEXT_STAGE transitions, so every stage after the first is
 * generated with the run's variety history (a stage now depends on it) and with the draft's upgrades in force. The ghost is present and cannot kill (the claim here is the
 * stage, not the bot's nerves; whether a bot survives a lethal ghost is the property tested in `death/solve`).
 */
export interface RunOptions {
  runSeed: number;
  players: number;
  /** The first stage and how many stages to play. */
  from: number; count: number;
  difficulty?: Difficulty;
  /** Upgrades the team already owns when the run starts (the draft normally gives them one by one). */
  owned?: Partial<Record<UpgradeId, number>>;
  extras?: SolveExtras;
  /** Which stages get the side visits (default: all). */
  extrasOn?: (stage: number) => boolean;
  /** Called with the Room after the last stage (still in stage_complete), for tests that go on from it. */
  keep?: (room: Room) => void;
}
export interface StageOutcome {
  stage: number; cleared: boolean; error: string; maxSlots: number;
  theme: ThemeId | undefined; locks: string[]; ghosts: number; hasLoot: boolean; lootOutcome: string;
  examined: number; marked: number; looted: string;
  def: StageDef;
}

export function playRun(o: RunOptions): StageOutcome[] {
  const room = new Room('RUNS', 4, o.runSeed, { escape: true, ghost: true, startStage: o.from });
  room.difficulty = o.difficulty ?? 'easy';
  if (o.owned) (room as unknown as { owned: Partial<Record<UpgradeId, number>> }).owned = { ...o.owned };
  const ids = Array.from({ length: o.players }, (_, i) => `p${i}`);
  ids.forEach((id, i) => { room.join(id, `P${i}`); if (i > 0) room.setReady(id, true); });
  if (!room.start('p0').ok) throw new Error('start refused');
  const out: StageOutcome[] = [];
  for (let n = 0; n < o.count; n++) {
    for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
    const def = room.stageDef;
    if (room.phase !== 'playing' || !def) throw new Error(`the room is not playing stage ${o.from + n} (phase ${room.phase})`);
    room.deathSystem?.setLethal(false);
    const stage = room.stage;
    const res: StageOutcome = { stage, cleared: false, error: '', maxSlots: 0, theme: room.snapshot().theme, locks: def.escape?.links.map((l) => l.lock.type) ?? [], ghosts: room.ghostSystem?.snapshotActors().length ?? 0, hasLoot: def.escape?.loot !== undefined, lootOutcome: def.escape?.loot?.outcome ?? '', examined: 0, marked: 0, looted: '', def };
    try {
      const extras = o.extras && (o.extrasOn ? o.extrasOn(stage) : true) ? o.extras : undefined;
      const st = solveStage(room, ids, def, { coop: o.players > 1, ...(extras ? { extras } : {}) });
      res.maxSlots = st.maxSlots; res.examined = st.examined; res.marked = st.marked; res.looted = st.looted;
    } catch (e) { res.error = e instanceof Error ? e.message : String(e); }
    res.cleared = (room.phase as string) === 'stage_complete';
    out.push(res);
    if (!res.cleared) break;
    if (n + 1 < o.count) { const r = room.nextStage('p0'); if (!r.ok) throw new Error(`next stage refused: ${r.error}`); }
  }
  o.keep?.(room);
  return out;
}
