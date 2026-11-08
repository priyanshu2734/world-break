import { describe, expect, it } from 'vitest';
import { CHAT_LIMITS } from '@wb/shared';
import { ChatBoard, buildPanel, teamState, type ChatSender, type PanelMember } from '../../src/social';

const s = (o: Partial<ChatSender> = {}): ChatSender => ({ id: 'p0', name: 'Ann', slot: 0, dead: false, connected: true, ...o });

describe('P6 A ChatBoard', () => {
  it('cleans the text, queues one message, and keeps nothing once drained', () => {
    const c = new ChatBoard();
    expect(c.send(s(), '  <b>hi</b>\u0000 there ', 1000)).toEqual({ ok: true, message: 'Sent.' });
    const out = c.drain();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: 'p0', name: 'Ann', slot: 0, text: 'hi there', spectator: false });
    expect(c.drain()).toEqual([]); // no history
  });
  it('refuses empty, over-long and disconnected senders', () => {
    const c = new ChatBoard();
    expect(c.send(s(), '<>\u0001', 1000).ok).toBe(false);
    expect(c.send(s(), 'a'.repeat(121), 1000).ok).toBe(false);
    expect(c.send(s({ connected: false }), 'hi', 1000).ok).toBe(false);
    expect(c.drain()).toEqual([]);
  });
  it('one message per 1.5 s per player; another player is not held up', () => {
    const c = new ChatBoard();
    expect(c.send(s(), 'a', 1000).ok).toBe(true);
    expect(c.send(s(), 'b', 1000 + CHAT_LIMITS.gapMs - 1).ok).toBe(false);
    expect(c.send(s({ id: 'p1', name: 'Bo', slot: 1 }), 'c', 1001).ok).toBe(true);
    expect(c.send(s(), 'd', 1000 + CHAT_LIMITS.gapMs).ok).toBe(true);
    expect(c.drain().map((m) => m.text)).toEqual(['a', 'c', 'd']);
  });
  it('a refused message does not reset the clock', () => {
    const c = new ChatBoard();
    c.send(s(), 'a', 1000);
    c.send(s(), 'b', 2000); // too soon: refused
    expect(c.send(s(), 'c', 1000 + CHAT_LIMITS.gapMs).ok).toBe(true);
  });
  it('a dead player may chat, marked as a spectator, at the slower rate', () => {
    const c = new ChatBoard();
    expect(c.send(s({ dead: true }), 'ghost by the door', 1000).ok).toBe(true);
    expect(c.send(s({ dead: true }), 'again', 1000 + CHAT_LIMITS.gapMs).ok).toBe(false);
    expect(c.send(s({ dead: true }), 'again', 1000 + CHAT_LIMITS.spectatorGapMs).ok).toBe(true);
    expect(c.drain().map((m) => m.spectator)).toEqual([true, true]);
  });
  it('the queue is bounded and a clock that goes backwards does not lock a player out for ever', () => {
    const c = new ChatBoard();
    for (let i = 0; i < 100; i++) c.send(s({ id: `q${i}` }), 'x', 1000);
    expect(c.drain().length).toBeLessThanOrEqual(32);
    const d = new ChatBoard();
    d.send(s(), 'a', 10_000);
    expect(d.send(s(), 'b', 5).ok).toBe(true);
  });
  it('clear() forgets the rate limits', () => {
    const c = new ChatBoard();
    c.send(s(), 'a', 1000); c.clear();
    expect(c.send(s(), 'b', 1001).ok).toBe(true);
  });
});

const mem = (o: Partial<PanelMember> = {}): PanelMember => ({ id: 'p0', name: 'Ann', slot: 0, connected: true, life: 'alive', hidden: false, carried: 0, ...o });
describe('P6 A team panel states', () => {
  it('maps alive, hiding, dead (a body), spectating (eliminated) and disconnected', () => {
    expect(teamState(mem())).toBe('alive');
    expect(teamState(mem({ life: undefined }))).toBe('alive');
    expect(teamState(mem({ hidden: true }))).toBe('hiding');
    expect(teamState(mem({ life: 'downed' }))).toBe('dead');
    expect(teamState(mem({ life: 'eliminated' }))).toBe('spectating');
    expect(teamState(mem({ connected: false, life: 'eliminated' }))).toBe('disconnected');
  });
  it('a living viewer gets carried COUNTS and the journal summary; a dead viewer gets names and states only', () => {
    const ms = [mem({ carried: 2 }), mem({ id: 'p1', name: 'Bo', slot: 1, carried: 1, hidden: true })];
    const live = buildPanel(7, ms, true, { found: 2, marked: 1, lines: 2 });
    expect(live.members.map((m) => m.carried)).toEqual([2, 1]);
    expect(live.journal).toEqual({ found: 2, marked: 1, lines: 2 });
    const dead = buildPanel(7, ms, false, { found: 2, marked: 1, lines: 2 });
    expect(dead.journal).toBeUndefined();
    expect(JSON.stringify(dead)).not.toContain('carried');
    expect(dead.members.map((m) => m.state)).toEqual(['alive', 'hiding']);
  });
  it('the count is a clamped number', () => {
    expect(buildPanel(1, [mem({ carried: 999 })], true, null).members[0]!.carried).toBe(32);
    expect(buildPanel(1, [mem({ carried: -4 })], true, null).members[0]!.carried).toBe(0);
  });
});
