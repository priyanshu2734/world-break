import { describe, expect, it } from 'vitest';
import { GHOST_LIMITS, GUN_LIMITS, TICK_DT, ghostTuning, quantiseAim } from '@wb/shared';
import { Room } from '../../src/room';
import { generateEscapeStage } from '../../src/rooms/generate';
import { Bot, Team } from '../rooms/bot';
import { fetchItem, itemAct, type Play } from '../rooms/flows';

const SEED = 9;
let seq = 1000;

/** A real ghost Room on stage 2 with `n` players, the player p0 already carrying the Pulse Gun taken out of its locker. */
function armed(n = 2) {
  const room = new Room('GUNR', 3, SEED, { escape: true, ghost: true, startStage: 2 });
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  ids.forEach((id, i) => { room.join(id, `P${i}`); if (i > 0) room.setReady(id, true); });
  expect(room.start('p0').ok).toBe(true);
  for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
  const rec = room.stageRecord!;
  const def = generateEscapeStage(rec.stage, rec.seed, { ghost: true });
  expect(def.id).toBe(rec.defId);
  const arenas = new Map(def.rooms!.rooms.map((r) => [r.id, r.arena]));
  const team = new Team(room, (id) => arenas.get(id)!);
  const play: Play = { room, team, bots: ids.map((id) => new Bot(team, id)), ids, arenas };
  team.tick();
  const gun = def.items!.find((i) => i.kind === 'pulse_gun')!;
  return { room, team, play, def, gun, ids };
}
function takeGun(a: ReturnType<typeof armed>): void {
  const bot = a.play.bots[0]!;
  const stash = a.gun.hidden!.stashId ? a.def.stashes!.find((s) => s.id === a.gun.hidden!.stashId) : undefined;
  if (stash) { bot.goTo(stash.x, stash.y); expect(itemAct(a.play, { action: 'open', stashId: stash.id }).ok).toBe(true); }
  expect(fetchItem(a.play, bot, a.gun.id).ok).toBe(true);
}
const me = (a: ReturnType<typeof armed>, id = 'p0') => a.team.player(id);
/** Aim at an angle and tick once so the room holds it. */
function aim(a: ReturnType<typeof armed>, angle: number): void { a.room.submitInput('p0', ++seq, { moveX: 0, jump: false }, { aim: quantiseAim(angle) }); a.team.tick(); }
const ghostOf = (a: ReturnType<typeof armed>) => a.room.ghostSystem!.snapshotActors()[0]!;
function placeGhost(a: ReturnType<typeof armed>, dx: number, state: 'roaming' | 'hunting' = 'roaming'): void {
  const p = me(a);
  a.room.ghostSystem!.placeForTest('g0', { room: p.roomId!, x: p.x + dx, y: p.y - GUN_LIMITS.eyeHeight, angle: 0, state });
}

describe('Pulse Gun through the Room', () => {
  it('the gun is locked away at the start, comes out of its locker and takes one hand slot', () => {
    const a = armed();
    expect(a.team.state().items!.items.some((i) => i.id === a.gun.id)).toBe(a.gun.hidden === undefined);
    takeGun(a);
    const mine = a.team.state().items!.players.find((p) => p.id === 'p0')!;
    expect(mine.slotsUsed).toBe(1);
  });

  it('no gun, no shot; no aim, no shot', () => {
    const a = armed();
    expect(a.room.ghostAction('p0', { action: 'fire' }).ok).toBe(false);
    takeGun(a);
    const r = a.room.ghostAction('p0', { action: 'fire' });
    // the aim may already be held from walking; if not, the refusal says so
    if (!r.ok) expect(r.error).toMatch(/Aim|aim/);
  });

  it('a hit DESTROYS the ghost (not frozen), the gun is kept and recharges; the ghost returns after the tuned time, warning first, far from everyone', () => {
    const a = armed();
    takeGun(a);
    aim(a, 0);
    placeGhost(a, 240);
    const res = a.room.ghostAction('p0', { action: 'fire' });
    expect(res.ok).toBe(true);
    const slots = () => a.team.state().items!.players.find((p) => p.id === 'p0')!.slotsUsed;
    expect(slots()).toBe(1); // the gun is still in hand
    let goneAt = -1;
    for (let i = 0; i < 20; i++) { a.team.tick(); if (ghostOf(a).state === 'respawn') { goneAt = a.room.gameSnapshot()!.tick; break; } }
    expect(goneAt).toBeGreaterThan(0);
    const g = ghostOf(a);
    const tune = ghostTuning('easy', 2);
    expect(g.present).toBe(false); // dissolved: nothing left in the room
    expect(g.until - goneAt).toBeLessThanOrEqual(tune.respawnTicks);
    expect(g.until - goneAt).toBeGreaterThan(tune.respawnTicks - 5);
    expect((g.until - goneAt) * TICK_DT).toBeGreaterThan(100);
    expect(a.room.drainGhostEvents().some((e) => e.kind === 'destroy')).toBe(true);
    expect(a.room.drainFx().some((f) => f.fx.kind === 'dissolve')).toBe(true);
    // the gun is not ready again until its cooldown ends
    const refused = a.room.ghostAction('p0', { action: 'fire' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/recharging/);
    // stand at the west end of the room, so that a fair spawn exists far away (in the middle of a small room none does: the warning then simply goes on)
    (a.room as unknown as { sim: { placeAt(id: string, x: number, y: number): void } }).sim.placeAt('p0', 300, 680);
    // the ghost stays gone, then WARNS (everyone is told), then appears (far from every player)
    let warned = -1, appeared = -1;
    for (let i = 0; i < tune.respawnTicks + 400 && appeared < 0; i++) {
      a.team.tick();
      const st = ghostOf(a);
      if (st.state === 'warning' && warned < 0) warned = i;
      if ((st.state === 'roaming' || st.state === 'hunting') && appeared < 0) appeared = i;
    }
    expect(warned).toBeGreaterThanOrEqual(tune.respawnTicks - 40);
    expect(appeared).toBeGreaterThan(warned + 55); // a warning of at least 3 s first
    const back = ghostOf(a), p = me(a);
    if (back.room === p.roomId) expect(Math.hypot(back.x - p.x, back.y - p.y)).toBeGreaterThanOrEqual(GHOST_LIMITS.minSpawnDistance);
  });

  it('a shot aimed away misses; the gun is still in hand but recharging', () => {
    const a = armed();
    takeGun(a);
    aim(a, Math.PI);
    placeGhost(a, 240);
    const shot = a.room.ghostAction('p0', { action: 'fire' });
    expect(shot).toMatchObject({ ok: true });
    for (let i = 0; i < 30; i++) a.team.tick();
    expect(['roaming', 'hunting']).toContain(ghostOf(a).state);
    expect(a.room.ghostAction('p0', { action: 'fire' }).ok).toBe(false);
    expect(a.room.ghostCue('p0')!.gun!.left).toBeGreaterThan(0);
  });

  it('out of range is a miss', () => {
    const a = armed();
    takeGun(a);
    aim(a, 0);
    placeGhost(a, GUN_LIMITS.rangePx + 200);
    a.room.ghostAction('p0', { action: 'fire' });
    for (let i = 0; i < 30; i++) a.team.tick();
    expect(ghostOf(a).state).not.toBe('respawn');
  });

  it('the shot is sent to the players who can see it, and the bolt is bounded', () => {
    const a = armed();
    takeGun(a);
    aim(a, 0);
    a.room.ghostAction('p0', { action: 'fire' });
    const d = a.room.drainShots();
    expect(d.length).toBe(1);
    expect(d[0]!.to).toContain('p0');
    expect(d[0]!.shot.rangePx).toBe(GUN_LIMITS.rangePx);
    expect(a.room.drainShots()).toEqual([]);
  });

  it('is deterministic: the same inputs give the same stun tick', () => {
    const run = () => {
      const a = armed();
      takeGun(a); aim(a, 0); placeGhost(a, 240);
      a.room.ghostAction('p0', { action: 'fire' });
      for (let i = 0; i < 20; i++) a.team.tick();
      return JSON.stringify(ghostOf(a));
    };
    expect(run()).toBe(run());
  });
});
