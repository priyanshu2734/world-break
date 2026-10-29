import type { Difficulty } from '@wb/shared';
import { Room } from '../../src/room';
import { generateEscapeStage } from '../../src/rooms/generate';
import { DEATH_TABLE, type KillCause } from '../../src/death';
import type { GameSim } from '../../src/game';
import { Team } from '../rooms/bot';
import { solveStage } from '../rooms/solver';
import { HideTeam } from '../ghost/hideTeam';

/**
 * P4 step 5: the solvability drills. A real ghost run is started at `stage` and solved by the real-physics solver through the public Room API. Two ways of
 * adding death to it:
 *
 *   - `lethal`: the ghost really kills (the solver hides when warned). Whether a bot SURVIVES is a property of the bot, not of the stage.
 *   - `plan`: scripted deaths. The ghost is present but cannot kill; right after the solver fetches a part that is needed later, the drill kills the carrier on
 *     the spot (on their feet, or `air`: high above where they stand, so the part falls and must be moved to a floor a player can reach). The solver must
 *     then recover the part and finish. This is DETERMINISTIC: whether a stage can still be finished after any one death is a property of the stage.
 */
export type DrillPlan = 'none' | 'first' | 'last' | 'every';
export interface DrillOptions {
  difficulty?: Difficulty;
  /** The ghost really kills (default false: present, but unable to kill). */
  lethal?: boolean;
  /** The solver hides when warned (the P3E survival reflex). */
  hide?: boolean;
  plan?: DrillPlan;
  /** Where the carrier is when the part drops: on their feet, or `air`, high above where they stand (the part falls to the floor below). */
  where?: 'feet' | 'air';
  /** For plan 'last': the index of the last fetch of the stage (a dry run tells it). */
  lastIndex?: number;
  runSeed?: number;
}
export interface DrillResult {
  cleared: boolean;
  /** Somebody died during the run (a scripted death, or the ghost's). */
  died: boolean;
  /** '' when cleared; otherwise the error that stopped the solver. */
  error: string;
  maxSlots: number;
  fetches: number;
  kills: number;
  recovered: number;
  leadChanges: number;
  /** Dropped parts the item system had to move to a floor a player can reach. */
  relocated: number;
  /** Deaths by the ghost (not scripted). */
  ghostKills: number;
}

const SCRIPTED: KillCause = { how: 'touch', ghost: 'g0', ghostKind: null, because: ['scripted death (solver drill)'] };

export function drill(stage: number, seed: number, players: number, o: DrillOptions = {}): DrillResult {
  const difficulty = o.difficulty ?? 'easy';
  const room = new Room('GSLV', 4, seed, { escape: true, ghost: true, startStage: stage });
  room.difficulty = difficulty;
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  ids.forEach((id, i) => { room.join(id, `P${i}`); if (i > 0) room.setReady(id, true); });
  if (!room.start('p0').ok) throw new Error('start refused');
  for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
  const death = room.deathSystem;
  if (!death) throw new Error(`stage ${stage} has no death system (no ghost)`);
  const lethal = o.lethal === true;
  death.setLethal(lethal);
  const rec = room.stageRecord!;
  const def = generateEscapeStage(rec.stage, rec.seed, { ghost: true, difficulty });
  if (def.id !== rec.defId) throw new Error('room and generator disagree');
  const plan = o.plan ?? 'none';
  const sim = (room as unknown as { sim: GameSim }).sim;
  const alive = (): string[] => ids.filter((id) => !death.isDead(id));
  let kills = 0;
  if (plan !== 'none') for (let i = 0; i < DEATH_TABLE.spawnGraceS * 20 + 5; i++) room.tick(); // the spawn grace must be over for a kill to be allowed
  const result: DrillResult = { cleared: false, died: false, error: '', maxSlots: 0, fetches: 0, kills: 0, recovered: 0, leadChanges: 0, relocated: 0, ghostKills: 0 };
  try {
    const stats = solveStage(room, ids, def, {
      coop: players > 1,
      ...(o.hide ? { team: (r: Room, arenaOf: (id: string) => import('@wb/shared').Arena) => new HideTeam(r, arenaOf, def.escape!.hidingSpots ?? []) } : {}),
      onFetched: (e) => {
        result.fetches = Math.max(result.fetches, e.index + 1);
        const want = plan === 'every' ? true : plan === 'first' ? e.index === 0 : plan === 'last' ? e.index === o.lastIndex : false;
        if (!want || alive().length < 2 || death.isDead(e.who)) return; // somebody must be left to recover it
        if (o.where === 'air') {
          const p = room.gameSnapshot()!.players.find((x) => x.id === e.who)!;
          sim.placeAt(e.who, p.x, 100);
        }
        death.setLethal(true);
        const r = death.kill(e.who, SCRIPTED);
        death.setLethal(lethal);
        if (!r.ok) throw new Error(`the scripted kill was refused: ${r.reason}`);
        kills++;
      },
    });
    result.maxSlots = stats.maxSlots; result.recovered = stats.recovered; result.leadChanges = stats.leadChanges;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  // cleared = the room says so (a teammate may reach the exit while the solver is still walking its lead about: that is a clear)
  result.cleared = room.phase === 'stage_complete';
  result.kills = kills;
  result.died = death.deaths > 0;
  result.ghostKills = death.events.filter((e) => e.kind === 'killed' && e.cause.because[0] !== SCRIPTED.because[0]).length;
  result.relocated = death.events.filter((e) => e.kind === 'item_dropped' && e.relocated).length;
  return result;
}
