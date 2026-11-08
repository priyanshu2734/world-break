import { describe, expect, it } from 'vitest';
import {
  CHAT_LIMITS, ChatMessageSchema, ChatSendSchema, GHOST_TYPES, PING_ANCHOR, PING_KINDS, PING_LABELS, PING_LIMITS, PingMarkerSchema, PingRequestSchema,
  SERVER_TICK_HZ, TEAM_STATES, TeamPanelSchema, checkChat, sanitiseChat,
} from '../src';

describe('P6 A ping kinds, labels and schemas', () => {
  it('has the seven kinds of the wheel in order, each with a fixed label and an anchor', () => {
    expect([...PING_KINDS]).toEqual(['key', 'danger', 'help', 'door', 'ghost', 'go', 'hide']);
    for (const k of PING_KINDS) { expect(PING_LABELS[k].length).toBeGreaterThan(2); expect(['point', 'self', 'ghost']).toContain(PING_ANCHOR[k]); }
  });
  it('labels are constants: no digit, and no ghost type or hidden-information word, so a label can never leak', () => {
    for (const k of PING_KINDS) {
      const l = PING_LABELS[k].toLowerCase();
      expect(l).not.toMatch(/\d/);
      for (const g of GHOST_TYPES) expect(l).not.toContain(g);
      for (const w of ['code', 'safe', 'evidence', 'solution', 'wisp', 'shade', 'howler']) expect(l).not.toContain(w);
    }
  });
  it('limits are bounded and sensible at 20 Hz', () => {
    expect(SERVER_TICK_HZ).toBe(20);
    expect(PING_LIMITS.ttlTicks).toBe(120);
    expect(PING_LIMITS.perPlayer).toBeLessThanOrEqual(3);
    expect(PING_LIMITS.perTeam).toBeLessThanOrEqual(12);
    expect(PING_LIMITS.cooldownTicks).toBeGreaterThanOrEqual(SERVER_TICK_HZ / 2);
  });
  it('a request is a strict enum plus bounded finite coordinates', () => {
    expect(PingRequestSchema.safeParse({ kind: 'key', x: 10, y: 20 }).success).toBe(true);
    expect(PingRequestSchema.safeParse({ kind: 'help' }).success).toBe(true);
    for (const bad of [{ kind: 'nuke' }, { kind: 'key', x: Infinity, y: 0 }, { kind: 'key', x: NaN, y: 0 }, { kind: 'key', x: 1e9, y: 0 }, { kind: 'key', x: '3', y: 0 }, { kind: 'key', extra: 1 }, {}, null, 'key'])
      expect(PingRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it('a marker without a position is valid (a teammate in another room), and its ttl is bounded', () => {
    const base = { id: 1, kind: 'danger', from: 'p0', name: 'A', slot: 0, room: 'r1', ttl: PING_LIMITS.ttlTicks };
    expect(PingMarkerSchema.safeParse(base).success).toBe(true);
    expect(PingMarkerSchema.safeParse({ ...base, x: 1, y: 2 }).success).toBe(true);
    expect(PingMarkerSchema.safeParse({ ...base, ttl: PING_LIMITS.ttlTicks + 1 }).success).toBe(false);
    expect(PingMarkerSchema.safeParse({ ...base, kind: 'banana' }).success).toBe(false);
  });
});

describe('P6 A chat cleaning and limits', () => {
  it('strips control characters, markup, zero-width and bidi overrides, and collapses white space', () => {
    expect(sanitiseChat('  hello\u0000\u0007 world \n\t again ')).toBe('hello world again');
    expect(sanitiseChat('<b>bold</b> <script>alert(1)</script>x')).toBe('bold alert(1) x');
    expect(sanitiseChat('a<b')).toBe('ab');
    expect(sanitiseChat('x\u202Ey\u200Bz\uFEFF')).toBe('x y z');
    expect(sanitiseChat('\u0001\u0002')).toBe('');
    expect(sanitiseChat('ｈｅｌｌｏ')).toBe('hello'); // NFKC folds look-alike full-width letters
  });
  it('never throws and is idempotent', () => {
    for (const s of ['', '<', '>>><<<', '\u0000'.repeat(500), 'a'.repeat(5000), '😀'.repeat(300), '<<script>>']) {
      const once = sanitiseChat(s);
      expect(sanitiseChat(once)).toBe(once);
      expect(once).not.toMatch(/[<>]/);
    }
  });
  it('an empty message is refused; 120 characters pass; 121 are refused (counted in characters, not code units)', () => {
    expect(checkChat('   ').ok).toBe(false);
    expect(checkChat('a'.repeat(CHAT_LIMITS.maxLen))).toEqual({ ok: true, text: 'a'.repeat(120) });
    expect(checkChat('a'.repeat(121)).ok).toBe(false);
    expect(checkChat('😀'.repeat(120)).ok).toBe(true);
    expect(checkChat('😀'.repeat(121)).ok).toBe(false);
  });
  it('the payload is strict and bounded', () => {
    expect(ChatSendSchema.safeParse({ text: 'hi' }).success).toBe(true);
    expect(ChatSendSchema.safeParse({ text: 'hi', to: 'p1' }).success).toBe(false);
    expect(ChatSendSchema.safeParse({ text: 'a'.repeat(1001) }).success).toBe(false);
    expect(ChatSendSchema.safeParse({ text: 5 }).success).toBe(false);
  });
  it('a message carries who and what, and nothing else', () => {
    expect(ChatMessageSchema.safeParse({ id: 1, from: 'p0', name: 'A', slot: 0, text: 'hi', spectator: false }).success).toBe(true);
    expect(ChatMessageSchema.safeParse({ id: 1, from: 'p0', name: 'A', slot: 0, text: '', spectator: false }).success).toBe(false);
    expect(ChatMessageSchema.safeParse({ id: 1, from: 'p0', name: 'A', slot: 0, text: 'a'.repeat(121), spectator: false }).success).toBe(false);
  });
  it('chat timing: living 1.5 s, dead 3 s', () => { expect(CHAT_LIMITS.gapMs).toBe(1500); expect(CHAT_LIMITS.spectatorGapMs).toBe(3000); });
});

describe('P6 A team panel schema', () => {
  it('has five states and a carried COUNT (a number, never a list)', () => {
    expect([...TEAM_STATES]).toEqual(['alive', 'hiding', 'dead', 'spectating', 'disconnected']);
    const ok = { tick: 3, members: [{ id: 'p0', name: 'A', slot: 0, state: 'alive', carried: 2 }], journal: { found: 2, marked: 1, lines: 2 } };
    expect(TeamPanelSchema.safeParse(ok).success).toBe(true);
    expect(TeamPanelSchema.safeParse({ ...ok, members: [{ id: 'p0', name: 'A', slot: 0, state: 'alive', carried: ['key'] }] }).success).toBe(false);
    expect(TeamPanelSchema.safeParse({ ...ok, members: [{ id: 'p0', name: 'A', slot: 0, state: 'zombie' }] }).success).toBe(false);
  });
});

describe('P6 A ids are real player ids (UUID length)', () => {
  it('markers, messages and panels accept a 36-character id', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(PingMarkerSchema.safeParse({ id: 1, kind: 'go', from: id, name: 'A', slot: 0, room: 'r', ttl: 10 }).success).toBe(true);
    expect(ChatMessageSchema.safeParse({ id: 1, from: id, name: 'A', slot: 0, text: 'x', spectator: false }).success).toBe(true);
    expect(TeamPanelSchema.safeParse({ tick: 0, members: [{ id, name: 'A', slot: 0, state: 'alive' }] }).success).toBe(true);
  });
});
