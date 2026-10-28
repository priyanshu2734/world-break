import type { DeathState } from '@wb/shared';
import type { PubItem } from '../itemView';

/** P4 step 3: pure helpers for the revive prompt and bars. No Phaser here, so they are unit-tested. */

/** The same reach as the server's (70 px across, 60 px up or down). The server decides; this only decides when to SHOW the prompt. */
export const REVIVE_REACH = { range: 70, dy: 60 } as const;

export interface TeamLife { id: string; name: string; life?: 'alive' | 'downed' | 'eliminated' }
type Pos = { x: number; y: number };

/** Is this teammate a body one could still bring back? (The team list says downed.) */
export const isBody = (t: TeamLife): boolean => t.life === 'downed';

/** Does the local player carry a Revive Cell? `carried` is what `carriedItems(...)` returns. */
export const carriesCell = (carried: readonly Pick<PubItem, 'kind'>[]): boolean => carried.some((i) => i.kind === 'revive_cell');

/** The nearest body within reach of `me`, using the drawn positions (`where`: only players in this room are in it). */
export function bodyInReach(me: Pos | null | undefined, team: readonly TeamLife[] | undefined, where: ReadonlyMap<string, Pos>): TeamLife | null {
  if (!me) return null;
  let best: TeamLife | null = null, bestD = Infinity;
  for (const t of team ?? []) {
    if (!isBody(t)) continue;
    const p = where.get(t.id);
    if (!p || Math.abs(p.x - me.x) > REVIVE_REACH.range || Math.abs(p.y - me.y) > REVIVE_REACH.dy) continue;
    const d = Math.abs(p.x - me.x);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

const pct = (p: number): string => `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;

/** The line shown for a revive: to the body, to the reviver, or the prompt for a carrier next to a body. '' = nothing. */
export function reviveLine(death: DeathState | null | undefined, near: TeamLife | null, carries: boolean): { text: string; progress: number | null } {
  if (death && death.life === 'downed' && death.beingRevived != null) return { text: `A teammate is bringing you back… ${pct(death.beingRevived)}`, progress: death.beingRevived };
  if (death && death.life === 'alive' && death.reviving) return { text: `Reviving ${death.reviving.name}… ${pct(death.reviving.progress)}  (keep holding E)`, progress: death.reviving.progress };
  if ((!death || death.life === 'alive') && near && carries) return { text: `Hold E to bring ${near.name} back`, progress: null };
  return { text: '', progress: null };
}

/** The look of a teammate in the team list: a body is marked, the living are not. */
export function lifeMark(life: TeamLife['life']): string { return life === 'downed' ? '✝ body' : life === 'eliminated' ? '✝ out' : ''; }
