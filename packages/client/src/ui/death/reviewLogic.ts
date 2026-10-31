import { SERVER_TICK_HZ, type DeathReview, type DeathReviewMsg, type RoomPhase } from '@wb/shared';

/**
 * P4 step 4 and 6: pure text for the wipe banner and the death review (no Phaser, so it is unit-tested). Everything shown was written by the server from its own log; this
 * only puts it in plain words: times as m:ss (never a raw tick), the player's own name as "you", and the ghost's own wording made readable.
 */

/** A tick as m:ss on the stage clock. */
export function fmtTick(tick: number): string {
  const s = Math.max(0, Math.floor(tick / SERVER_TICK_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * One line of the server's log in plain words: `at tick 1304` and `tick 1304` become a time (m:ss), `on appearing` becomes `as it appeared`, the player's own name becomes
 * `you`, and a line that starts with `Heard`, `Saw` or `Opened` says who did it. Nothing is added that the log did not say.
 */
export function plainText(text: string, playerName?: string): string {
  let t = text
    .replace(/\bat tick (\d+)/g, (_m, n: string) => `at ${fmtTick(Number(n))}`)
    .replace(/\btick (\d+)/g, (_m, n: string) => fmtTick(Number(n)))
    .replace(/\bon appearing\b/g, 'as it appeared');
  if (playerName) t = t.replace(new RegExp(`\\b${playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), 'you');
  t = t.replace(/^(Heard|Saw|Opened|Followed|Lost|Caught)\b/, (_m, w: string) => `It ${w.toLowerCase()}`);
  return t.replace(/\s+/g, ' ').trim();
}

const kindName = (k: string | null): string => (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'ghost');

/** What killed you and why: one big line, and one short line of reasons (the last things the ghost noticed, then the touch). */
export function killSummary(r: DeathReview): { headline: string; why: string } {
  const who = r.cause.ghostKind ? `A ${kindName(r.cause.ghostKind)}` : 'A ghost';
  const headline = r.cause.how === 'opened_spot' ? `${who} found you hiding.` : `${who} caught you.`;
  const reasons = r.cause.because.filter((b) => !/^Caught\b/.test(b)).slice(-2).map((b) => plainText(b, r.name));
  const why = reasons.length > 0 ? `${reasons.map((x, i) => (i === 0 ? x : x.charAt(0).toLowerCase() + x.slice(1))).join(', then ')}.` : `It reached you at ${fmtTick(r.tick)}.`;
  return { headline, why: why.charAt(0).toUpperCase() + why.slice(1) };
}

export interface ReviewSection { title: string; lines: string[] }

/** How many lines a section shows: it is a review, not a log. */
export const REVIEW_SHOWN = 3;
const last = <T,>(xs: readonly T[]): T[] => xs.slice(-REVIEW_SHOWN);
const stamped = (tick: number, text: string, name: string): string => `${fmtTick(tick)}  ${plainText(text, name)}`;

/** The short sections under the headline, in the order a person asks: warnings, noise, hiding, what was held, rescues. Empty ones are left out; each shows its last few lines. */
export function reviewSections(r: DeathReview): ReviewSection[] {
  const out: ReviewSection[] = [];
  if (r.warnings.length > 0) out.push({ title: 'Warnings you got', lines: last(r.warnings).map((l) => stamped(l.tick, l.text, r.name)) });
  if (r.noise.length > 0) out.push({ title: 'Noise you made', lines: last(r.noise).map((l) => stamped(l.tick, l.text, r.name)) });
  if (r.hiding.length > 0) out.push({ title: 'Your hiding attempts', lines: last(r.hiding).map((l) => stamped(l.tick, l.text, r.name)) });
  if (r.carried.length > 0) {
    const labels = r.carried.map((c) => c.label).join(', ');
    const drop = r.dropped.length > 0 ? ` It fell where you died${r.dropped.some((d) => d.relocated) ? ' (moved to a floor you can reach)' : ''}.` : '';
    out.push({ title: 'You were carrying', lines: [`${labels}.${drop}`] });
  }
  if (r.rescues.length > 0) out.push({ title: 'Rescue attempts', lines: last(r.rescues).map((l) => stamped(l.tick, l.text, r.name)) });
  return out;
}

/** The line about the team: who died when. */
export function teamLine(m: DeathReviewMsg): string {
  return m.team.map((t) => `${t.name} ${t.diedAt === null ? 'lived' : `died ${fmtTick(t.diedAt)}`}`).join('   ·   ');
}

/** The small title above the headline ('' = show nothing). */
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

/** Is the full-screen panel up? From the wipe until the retry: it hides the HUD, which has nothing to say meanwhile. */
export const coversScreen = (phase: RoomPhase | undefined): boolean => phase === 'team_wiped' || phase === 'death_review';
