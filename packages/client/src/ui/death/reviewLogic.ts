import { SERVER_TICK_HZ, type DeathReview, type DeathReviewMsg, type ReviewLine, type RoomPhase } from '@wb/shared';

/** P4 step 4: pure text for the wipe banner and the death review. No Phaser here, so it is unit-tested. Everything shown was written by the server from its own log. */

/** A tick as m:ss on the stage clock. */
export function fmtTick(tick: number): string {
  const s = Math.max(0, Math.floor(tick / SERVER_TICK_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface ReviewSection { title: string; lines: string[] }

const stamped = (l: ReviewLine): string => `${fmtTick(l.tick)}  ${l.text}`;

/** The sections of one review, in the order a person asks the questions: what got me, what warned me, what I did, what I held, who tried to help. Empty sections are left out. */
export function reviewSections(r: DeathReview): ReviewSection[] {
  const out: ReviewSection[] = [];
  const how = r.cause.how === 'opened_spot' ? 'The ghost opened your hiding place.' : 'A ghost touched you.';
  out.push({ title: `You died at ${fmtTick(r.tick)}`, lines: [how, ...r.cause.because] });
  if (r.warnings.length > 0) out.push({ title: 'Warnings you got', lines: r.warnings.map(stamped) });
  if (r.noise.length > 0) out.push({ title: 'Noise you made', lines: r.noise.map(stamped) });
  if (r.hiding.length > 0) out.push({ title: 'Your hiding attempts', lines: r.hiding.map(stamped) });
  if (r.carried.length > 0) out.push({ title: 'You were carrying', lines: r.carried.map((c) => c.label) });
  if (r.dropped.length > 0) out.push({ title: 'Dropped where you fell', lines: r.dropped.map((d) => `${fmtTick(d.tick)}  ${d.label}${d.relocated ? ' (moved to the nearest floor you can reach)' : ''}`) });
  if (r.rescues.length > 0) out.push({ title: 'Rescue attempts', lines: r.rescues.map(stamped) });
  return out;
}

/** The line about the team: who died when. */
export function teamLine(m: DeathReviewMsg): string {
  return m.team.map((t) => `${t.name} ${t.diedAt === null ? 'lived' : `died ${fmtTick(t.diedAt)}`}`).join('   ·   ');
}

/** The headline of the wipe banner and the review ('' = show nothing). */
export function wipeHeadline(phase: RoomPhase | undefined, m: DeathReviewMsg | null): string {
  if (phase === 'team_wiped') return 'THE TEAM IS WIPED';
  if (phase === 'death_review') return m ? `STAGE ${m.stage} — ATTEMPT ${m.attempt + 1}: WIPED` : 'THE TEAM IS WIPED';
  return '';
}

/** What to press: the host retries; the others wait. */
export function retryHint(phase: RoomPhase | undefined, isHost: boolean, stage: number | undefined): string {
  if (phase !== 'death_review') return '';
  return isHost ? `N  try stage ${stage ?? ''} again on a new layout` : 'Waiting for the host to try again…';
}

/** Is the review panel on screen? Only in the review phase (the wipe beat before it shows the banner alone). */
export const showReview = (phase: RoomPhase | undefined): boolean => phase === 'death_review';
