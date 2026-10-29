import { SERVER_TICK_HZ, SPECTATE, type DeathState, type GhostPing } from '@wb/shared';

/** P4 step 2: pure helpers for the spectator view. No Phaser here, so they are unit-tested. */

/** A dead player (a body or eliminated) is a spectator. Null (no death state yet, or a stage without death) = not. */
export function isSpectating(d: DeathState | null | undefined): boolean { return !!d && d.life !== 'alive'; }

/** Whose eyes the dead player watches through (null: nobody to watch). */
export function eyesId(d: DeathState | null | undefined): string | null { return isSpectating(d) ? d!.following?.id ?? null : null; }

/** Seconds of the revive window left, counted down from the moment the state arrived (the server sends it about once a second). */
export function reviveSeconds(d: DeathState, nowMs: number, arrivedMs: number): number {
  const leftMs = d.reviveLeft * (1000 / SERVER_TICK_HZ) - Math.max(0, nowMs - arrivedMs);
  return Math.max(0, Math.ceil(leftMs / 1000));
}

/** The big line at the top of a spectator's screen ('' = none). */
export function headline(d: DeathState | null | undefined, nowMs: number, arrivedMs: number): string {
  if (!d || d.life === 'alive') return '';
  if (d.life === 'downed') {
    const s = reviveSeconds(d, nowMs, arrivedMs);
    return s > 0 ? `YOU ARE DEAD. A teammate with a Revive Cell could still bring you back (${s} s).` : 'YOU ARE DEAD.';
  }
  return 'YOU ARE OUT. Watch your team.';
}

/** Ticks until the next ping, counted down from the moment the state arrived. */
export function pingWaitMs(d: DeathState, nowMs: number, arrivedMs: number): number {
  return Math.max(0, d.pingReadyIn * (1000 / SERVER_TICK_HZ) - Math.max(0, nowMs - arrivedMs));
}

/** The second line: whom they watch and the keys. */
export function watchLine(d: DeathState | null | undefined, nowMs: number, arrivedMs: number): string {
  if (!isSpectating(d)) return '';
  const dd = d!;
  if (!dd.following) return 'Nobody is left to watch.';
  const wait = pingWaitMs(dd, nowMs, arrivedMs);
  const ping = wait > 0 ? `G  ghost here (${Math.ceil(wait / 1000)} s)` : 'G  ghost here';
  const sw = dd.watchable.length > 1 ? '   ◀ ▶  switch' : '';
  return `Watching ${dd.following.name}${sw}   ${ping}`;
}

/** A left or right key press asks for the previous or next teammate (left wins a tie: nothing happens when both are pressed). */
export function switchKey(left: boolean, right: boolean): 'prev' | 'next' | null {
  if (left === right) return null;
  return left ? 'prev' : 'next';
}

/** A ping is shown for its time to live (5 s). */
export const PING_TTL_MS = (SPECTATE.pingTtlTicks * 1000) / SERVER_TICK_HZ;

/** The pings still on screen, in the room being drawn, newest last. */
export function activePings(pings: readonly { ping: GhostPing; at: number }[], room: string | undefined, nowMs: number): { ping: GhostPing; age: number }[] {
  return pings
    .map((p) => ({ ping: p.ping, age: nowMs - p.at }))
    .filter((p) => p.age >= 0 && p.age < PING_TTL_MS && (room === undefined || p.ping.room === room));
}

/** Fade: 1 for the first second, then down to 0 when its time is up. */
export function pingAlpha(age: number): number { return age <= 1000 ? 1 : Math.max(0, 1 - (age - 1000) / (PING_TTL_MS - 1000)); }

/** Which keys a spectator uses (kept here so the hint line and the scene agree). */
export const SPECTATE_HINT = '◀ ▶  switch teammate   G  ghost here';
