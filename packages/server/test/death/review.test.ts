import { describe, expect, it } from 'vitest';
import { DeathReviewMsgSchema, DeathReviewSchema, WIPE, type GhostCue } from '@wb/shared';
import { REVIEW_KEEP, ReviewLog, buildMessage, buildReview, cueNotes, type DeathEvent, type KillCause } from '../../src/death';
import { Room } from '../../src/room';
import type { GameSim } from '../../src/game';

const CAUSE: KillCause = { how: 'touch', ghost: 'g0', ghostKind: 'wisp', because: ['Heard Ada running at tick 412', 'Caught Ada at tick 466'] };
const killed = (tick: number, player = 'a', name = 'Ada'): DeathEvent => ({ tick, kind: 'killed', player, name, life: 'downed', cause: CAUSE, room: 'r0', x: 100, y: 680, carrying: [{ itemId: 'secret_key_id', kind: 'access_key' }], reviveUntil: tick + 900 });
const dropped = (tick: number, player = 'a'): DeathEvent => ({ tick, kind: 'item_dropped', player, itemId: 'secret_key_id', itemKind: 'access_key', room: 'r0', x: 101.4, y: 680, relocated: true });

describe('P4 step 4: the review log and the builder (pure)', () => {
  it('a review is null when the log holds no death of that player: nothing is invented', () => {
    expect(buildReview({ player: 'a', life: 'alive', events: [], notes: [] })).toBeNull();
    expect(buildReview({ player: 'b', life: 'downed', events: [killed(500)], notes: [] })).toBeNull();
    expect(buildReview({ player: 'a', life: 'downed', events: [dropped(510)], notes: [] })).toBeNull(); // a drop without a death is not a death
  });
  it('words the cause from the ghost’s own reasons, the time of death, what was carried and where it rested, and parses', () => {
    const log = new ReviewLog();
    log.add('a', 'warning', 300, 'The lights flickered.');
    log.add('a', 'noise', 410, 'Heard Ada running at tick 410');
    log.add('a', 'hiding', 450, 'Tried to hide: nothing to hide in here.');
    log.add('a', 'rescue', 520, 'Bo started reviving you.');
    const r = buildReview({ player: 'a', life: 'downed', events: [killed(500), dropped(504)], notes: log.of('a') })!;
    expect(DeathReviewSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ player: 'a', name: 'Ada', tick: 500, life: 'downed', deaths: 1, cause: { how: 'touch', ghost: 'g0', ghostKind: 'wisp', because: CAUSE.because } });
    expect(r.warnings).toEqual([{ tick: 300, text: 'The lights flickered.' }]);
    expect(r.noise).toEqual([{ tick: 410, text: 'Heard Ada running at tick 410' }]);
    expect(r.hiding).toEqual([{ tick: 450, text: 'Tried to hide: nothing to hide in here.' }]);
    expect(r.rescues).toEqual([{ tick: 520, text: 'Bo started reviving you.' }]); // after the death: still told
    expect(r.carried).toEqual([{ label: 'Access Key' }]);
    expect(r.dropped).toEqual([{ tick: 504, label: 'Access Key', room: 'r0', x: 101, y: 680, relocated: true }]);
    expect(JSON.stringify(r)).not.toContain('secret_key_id'); // no item id leaves the server
  });
  it('only what happened up to the death counts as warning, noise and hiding; a later noise is not in the review of that death', () => {
    const log = new ReviewLog();
    log.add('a', 'noise', 400, 'before'); log.add('a', 'noise', 600, 'after');
    const r = buildReview({ player: 'a', life: 'downed', events: [killed(500)], notes: log.of('a') })!;
    expect(r.noise.map((n) => n.text)).toEqual(['before']);
  });
  it('a player who died twice (revived in between) gets the review of the LAST death, and the count', () => {
    const events = [killed(500), dropped(504), { tick: 800, kind: 'revived', player: 'a', name: 'Ada', by: 'b', protectedUntil: 900 } as DeathEvent, killed(1200), dropped(1204)];
    const r = buildReview({ player: 'a', life: 'eliminated', events, notes: [] })!;
    expect(r.tick).toBe(1200);
    expect(r.deaths).toBe(2);
    expect(r.dropped.map((d) => d.tick)).toEqual([1204]);
  });
  it('is bounded: lines are cut to the schema limits, the log is a ring per kind, a repeated fact is noted once', () => {
    const log = new ReviewLog();
    for (let i = 0; i < REVIEW_KEEP + 10; i++) log.add('a', 'noise', i, `n${i}`);
    expect(log.of('a').filter((n) => n.kind === 'noise')).toHaveLength(REVIEW_KEEP);
    log.add('a', 'warning', 5, 'x'.repeat(1000));
    log.add('a', 'warning', 5, 'x'.repeat(1000));
    expect(log.of('a').filter((n) => n.kind === 'warning')).toHaveLength(1);
    expect(log.of('a').find((n) => n.kind === 'warning')!.text.length).toBeLessThanOrEqual(WIPE.maxText);
    const r = buildReview({ player: 'a', life: 'downed', events: [killed(1000)], notes: log.of('a') })!;
    expect(r.noise.length).toBeLessThanOrEqual(WIPE.maxLines);
    expect(r.noise.at(-1)!.text).toBe(`n${REVIEW_KEEP + 9}`); // the latest ones are kept
    expect(DeathReviewSchema.safeParse(r).success).toBe(true);
    log.remove('a');
    expect(log.of('a')).toEqual([]);
  });
  it('the message for a player holds THEIR review only, and for the team only names, lives and times of death', () => {
    const log = new ReviewLog();
    log.add('b', 'noise', 10, 'Bo’s own noise');
    const events = [killed(500, 'a', 'Ada'), killed(700, 'b', 'Bo')];
    const roster = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cy' }];
    const life = (id: string) => (id === 'a' ? 'eliminated' : id === 'b' ? 'downed' : 'alive') as 'alive' | 'downed' | 'eliminated';
    const forA = buildMessage({ stage: 7, attempt: 2, wiped: true, viewer: 'a', roster, lifeOf: life, events, log });
    expect(DeathReviewMsgSchema.safeParse(forA).success).toBe(true);
    expect(forA.yours!.player).toBe('a');
    expect(JSON.stringify(forA)).not.toContain('Bo’s own noise');
    expect(forA.team).toEqual([{ name: 'Ada', life: 'eliminated', diedAt: 500 }, { name: 'Bo', life: 'downed', diedAt: 700 }, { name: 'Cy', life: 'alive', diedAt: null }]);
    const forC = buildMessage({ stage: 7, attempt: 2, wiped: true, viewer: 'c', roster, lifeOf: life, events, log });
    expect(forC.yours).toBeNull(); // Cy did not die: no review, and none of the others' causes
    expect(JSON.stringify(forC)).not.toContain('Heard Ada running');
  });
});

describe('P4 step 4: the cue notes (what the player was told, worded once)', () => {
  const cue = (o: Partial<GhostCue> = {}): GhostCue => ({ tick: 1, warning: false, sounds: [], ...o });
  it('a warning is noted when it starts, not while it lasts; sounds when they appear or come closer; a telegraph once', () => {
    let r = cueNotes(null, cue({ warning: true, warnKinds: ['wisp'] }));
    expect(r.notes).toEqual(['The lights flickered and a whisper warned that a wisp was about to appear.']);
    r = cueNotes(r.sig, cue({ warning: true, warnKinds: ['wisp'] }));
    expect(r.notes).toEqual([]);
    r = cueNotes(r.sig, cue({ sounds: [{ id: 'g0', kind: 'wisp', band: 3, dir: -1, state: 'roaming', moving: true }] }));
    expect(r.notes).toEqual(['A wisp could be heard far off, to your left.']);
    r = cueNotes(r.sig, cue({ sounds: [{ id: 'g0', kind: 'wisp', band: 3, dir: -1, state: 'roaming', moving: true }] }));
    expect(r.notes).toEqual([]);
    r = cueNotes(r.sig, cue({ sounds: [{ id: 'g0', kind: 'wisp', band: 1, dir: 0, state: 'hunting', moving: true, inspecting: true }] }));
    expect(r.notes).toEqual(['A wisp could be heard close by, ahead of you.', 'A wisp stood at a hiding place, about to open it.']);
  });
});

// ---------------------------------------------------------------------------------------------------------------- through the Room
let seq = 0;
function mk(players: number): Room {
  const r = new Room('DETH', 3, 9, { escape: true, ghost: true, startStage: 2 });
  for (let i = 0; i < players; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < players; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
const sim = (r: Room) => (r as unknown as { sim: GameSim }).sim;
const at = (r: Room, id: string, x: number) => sim(r).placeAt(id, x, 680);
const me = (r: Room, id: string) => r.gameSnapshot()!.players.find((p) => p.id === id)!;
const idle = (r: Room, id: string, use = false) => r.submitInput(id, ++seq, { moveX: 0, jump: false }, { use });
const tick = (r: Room, n = 1) => { for (let i = 0; i < n; i++) r.tick(); };
const itemsOf = (r: Room) => r.peekStageState()!.items!.items;
function kill(r: Room, id: string): void {
  for (let i = 0; i < 1500 && !r.deathSystem!.isDead(id); i++) {
    if (i % 100 === 0) { const q = me(r, id); r.ghostSystem!.placeForTest('g0', { room: q.roomId!, x: q.x - 60, y: q.y - 22, angle: 0, state: 'hunting' }); }
    idle(r, id); tick(r);
  }
  expect(r.deathSystem!.isDead(id)).toBe(true);
}
function wipe(r: Room): void {
  for (let i = 0; i < 600 && r.phase !== 'death_review'; i++) tick(r);
  expect(r.phase).toBe('death_review');
}

describe('P4 step 4: the review through the Room is built from recorded events only', () => {
  it('cause, time of death, carried and dropped items, hiding attempts: each equals a recorded server fact; warnings and noise trace to the cue stream and the ghost log', () => {
    const r = mk(1);
    const key = itemsOf(r).find((i) => i.kind === 'access_key')!;
    at(r, 'p0', key.x); tick(r, 25);
    r.itemAction('p0', { action: 'pickup', itemId: key.id }); tick(r, 15);
    at(r, 'p0', 600);
    const tHide = sim(r).tick;
    r.ghostAction('p0', { action: 'hide' }); // nothing to hide in at x=600: a refused attempt, recorded all the same
    kill(r, 'p0');
    wipe(r);
    const msg = r.reviewFor('p0')!;
    expect(DeathReviewMsgSchema.safeParse(msg).success).toBe(true);
    const rev = msg.yours!;
    const d = r.deathSystem!;
    const killedEv = d.events.find((e) => e.kind === 'killed')!;
    const catchEv = r.ghostSystem!.events.find((e) => e.kind === 'catch' && e.player === 'p0')!;
    expect(rev.tick).toBe(killedEv.tick);
    expect(rev.life).toBe('downed');
    expect(rev.cause.because).toEqual(catchEv.kind === 'catch' ? catchEv.because.slice(0, WIPE.maxLines) : []);
    expect(rev.cause.how).toBe('touch');
    expect(rev.cause.ghost).toBe(catchEv.ghost);
    expect(rev.carried).toEqual([{ label: 'Access Key' }]);
    const keyNow = itemsOf(r).find((i) => i.id === key.id)!;
    expect(rev.dropped).toHaveLength(1);
    expect(rev.dropped[0]).toMatchObject({ label: 'Access Key', relocated: false });
    expect(Math.abs(rev.dropped[0]!.x - keyNow.x)).toBeLessThanOrEqual(1);
    expect(rev.dropped[0]!.tick).toBeGreaterThanOrEqual(rev.tick);
    expect(rev.hiding.some((h) => h.tick === tHide && h.text.startsWith('Tried to hide:'))).toBe(true);
    // every line sits at or before the death and carries a tick; every noise line is a logged ghost 'heard' event of this player
    for (const l of [...rev.warnings, ...rev.noise, ...rev.hiding]) { expect(l.tick).toBeGreaterThan(0); expect(l.tick).toBeLessThanOrEqual(rev.tick); }
    for (const n of rev.noise) expect(r.ghostSystem!.events.some((e) => e.kind === 'heard' && e.player === 'p0' && e.tick === n.tick && e.text === n.text)).toBe(true);
    // the player was told of the ghost through the cue stream (a sound near them), and the review says so
    expect(rev.warnings.length).toBeGreaterThan(0);
    expect(rev.warnings.some((w) => w.text.includes('could be heard'))).toBe(true);
  });
  it('a real ghost warning (the lights and the whisper) before the ghost appears is in the review of a later death', () => {
    const r = mk(1);
    at(r, 'p0', 300);
    r.deathSystem!.setLethal(false);
    let warned = false;
    for (let i = 0; i < 4000 && !warned; i++) { idle(r, 'p0'); tick(r); warned = r.ghostSystem!.warning; }
    expect(warned).toBe(true);
    const tWarn = sim(r).tick;
    tick(r, 5);
    r.deathSystem!.setLethal(true);
    at(r, 'p0', 600);
    kill(r, 'p0');
    wipe(r);
    const w = r.reviewFor('p0')!.yours!.warnings.find((x) => x.text.includes('lights flickered'));
    expect(w).toBeDefined();
    expect(w!.tick).toBeGreaterThanOrEqual(tWarn - 1);
    expect(w!.tick).toBeLessThanOrEqual(tWarn + 5);
  });
  it('rescues: a teammate who tried and gave up, then a death, are in the dead player’s review with their ticks', () => {
    const r = mk(3);
    const cell = itemsOf(r).find((i) => i.kind === 'revive_cell')!;
    at(r, 'p1', cell.x); tick(r, 25);
    expect(r.itemAction('p1', { action: 'pickup', itemId: cell.id }).ok).toBe(true);
    tick(r, 15);
    at(r, 'p0', 600); at(r, 'p1', 300); at(r, 'p2', 1500); // the reviver waits well away from the ghost
    kill(r, 'p0');
    r.deathSystem!.setLethal(false);
    at(r, 'p1', 640);
    for (let i = 0; i < 30; i++) { idle(r, 'p1', true); tick(r); }
    idle(r, 'p1', false); tick(r, 3); // let go
    r.deathSystem!.setLethal(true);
    r.deathSystem!.events.length; // (the log keeps going)
    // everyone ends up dead: p1, p2
    for (let i = 0; i < 200; i++) { idle(r, 'p2'); tick(r); }
    kill(r, 'p1'); tick(r, 100); kill(r, 'p2');
    wipe(r);
    const rev = r.reviewFor('p0')!.yours!;
    expect(rev.rescues.map((x) => x.text)).toEqual(['P1 started reviving you.', 'P1 stopped reviving you before it was done.']);
    expect(rev.rescues[0]!.tick).toBeLessThan(rev.rescues[1]!.tick);
    const mine = r.reviewFor('p1')!.yours!;
    expect(mine.rescues.map((x) => x.text)).toEqual(['Started reviving P0.', 'Stopped reviving P0 before it was done.']);
  });
  it('each player gets only their own review; a survivor of a team has none; no code, safe, clue or item id is in any of them', () => {
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 1500);
    kill(r, 'p0'); tick(r, 100); kill(r, 'p1');
    wipe(r);
    const m0 = r.reviewFor('p0')!, m1 = r.reviewFor('p1')!;
    expect(m0.yours!.player).toBe('p0');
    expect(m1.yours!.player).toBe('p1');
    expect(m0.team.map((t) => t.name)).toEqual(['P0', 'P1']);
    const full = r.peekStageState()!;
    const secrets: string[] = [];
    for (const i of full.items?.items ?? []) secrets.push(i.id);
    for (const s of full.items?.stashes ?? []) secrets.push(s.id);
    for (const s of full.escape?.safes ?? []) secrets.push(s.id);
    for (const k of full.escape?.keypads ?? []) secrets.push(k.id);
    for (const d of full.escape?.doors ?? []) secrets.push(d.id);
    for (const c of full.escape?.clues ?? []) { secrets.push(c.id); secrets.push(c.label); }
    expect(secrets.length).toBeGreaterThan(3);
    for (const m of [m0, m1]) for (const s of secrets) expect(JSON.stringify(m), `leaked ${s}`).not.toContain(s);
    expect(r.reviewFor('zzz')).toBeNull();
  });
  it('the review exists only in the review phase and is gone after the retry', () => {
    const r = mk(1);
    at(r, 'p0', 600);
    expect(r.reviewFor('p0')).toBeNull();
    kill(r, 'p0');
    for (let i = 0; i < 400 && r.phase === 'playing'; i++) tick(r);
    expect(r.reviewFor('p0')).toBeNull(); // wiped, review not built yet
    wipe(r);
    expect(r.reviewFor('p0')).not.toBeNull();
    r.retryStage('p0');
    expect(r.reviewFor('p0')).toBeNull();
  });
});
