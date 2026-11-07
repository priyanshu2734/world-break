import { describe, expect, it } from 'vitest';
import { PING_ANCHOR, PING_KINDS, PING_LABELS, PING_LIMITS, type ChatMessage, type PingMarker, type TeamPanel } from '@wb/shared';
import {
  ChatLog, FADE_MS, MARKER_MS, QGesture, TOAST_MS, WHEEL, addMarker, journalLine, markerAlpha, needsPoint, panelRows, pingRequest, placeMarker, pruneMarkers, slotAngle, wheelSlot,
} from '../src/ui/team/teamLogic';
import { ESCAPE_KEYS_HINT } from '../src/ui/escapeUse';

const mk = (o: Partial<PingMarker> = {}): PingMarker => ({ id: 1, kind: 'danger', from: 'p1', name: 'Bo', slot: 1, room: 'r1', ttl: PING_LIMITS.ttlTicks, x: 100, y: 100, ...o });
const msg = (o: Partial<ChatMessage> = {}): ChatMessage => ({ id: 1, from: 'p1', name: 'Bo', slot: 1, text: 'hi', spectator: false, ...o });
const view = { x: 0, y: 0, w: 1000, h: 600 };

describe('the ping wheel', () => {
  it('seven slots, slot 0 straight up, clockwise, each reachable at its own angle', () => {
    expect(PING_KINDS.length).toBe(7);
    PING_KINDS.forEach((k, i) => {
      const a = slotAngle(i);
      expect(wheelSlot(Math.cos(a) * 80, Math.sin(a) * 80), k).toBe(k);
    });
    expect(wheelSlot(0, -80)).toBe('key');
  });
  it('the dead zone and a non-finite offset select nothing', () => {
    expect(wheelSlot(0, 0)).toBeNull();
    expect(wheelSlot(WHEEL.deadzone - 1, 0)).toBeNull();
    expect(wheelSlot(NaN, 50)).toBeNull();
    expect(wheelSlot(Infinity, 0)).toBeNull();
  });
  it('every direction maps to some slot (no gaps) outside the dead zone', () => {
    for (let d = 0; d < 360; d += 3) { const r = (d * Math.PI) / 180; expect(wheelSlot(Math.cos(r) * 60, Math.sin(r) * 60), `${d}`).not.toBeNull(); }
  });
  it('Q: a short press is a tap (cancel); a hold opens the wheel and releasing selects', () => {
    const q = new QGesture();
    expect(q.step(false, 0)).toBe('none');
    expect(q.step(true, 100)).toBe('none');
    expect(q.step(true, 100 + WHEEL.holdMs - 1)).toBe('none');
    expect(q.step(false, 100 + 100)).toBe('tap');
    expect(q.step(true, 1000)).toBe('none');
    expect(q.step(true, 1000 + WHEEL.holdMs)).toBe('open');
    expect(q.isOpen).toBe(true);
    expect(q.step(true, 1500)).toBe('none');
    expect(q.step(false, 1600)).toBe('select');
    expect(q.isOpen).toBe(false);
    expect(q.step(false, 1700)).toBe('none');
  });
  it('reset forgets a half-made gesture', () => {
    const q = new QGesture();
    q.step(true, 0); q.step(true, 1000); q.reset();
    expect(q.isOpen).toBe(false);
    expect(q.step(false, 1100)).toBe('none');
  });
  it('a request carries a point only for the kinds the server reads one for', () => {
    for (const k of PING_KINDS) {
      const r = pingRequest(k, { x: 10.4, y: 20.6 });
      if (needsPoint(k)) expect(r).toEqual({ kind: k, x: 10, y: 21 });
      else expect(r).toEqual({ kind: k });
      expect(needsPoint(k)).toBe(PING_ANCHOR[k] === 'point');
    }
    expect(pingRequest('key', null)).toBeNull();
    expect(pingRequest('key', { x: NaN, y: 1 })).toBeNull();
    expect(pingRequest('help', null)).toEqual({ kind: 'help' });
  });
});

describe('ping markers', () => {
  it('fade over the last second and expire at the server’s ttl', () => {
    expect(MARKER_MS).toBe(6000);
    expect(markerAlpha(0)).toBe(1);
    expect(markerAlpha(MARKER_MS - FADE_MS)).toBe(1);
    expect(markerAlpha(MARKER_MS - FADE_MS / 2)).toBeCloseTo(0.5);
    expect(markerAlpha(MARKER_MS)).toBe(0);
    expect(pruneMarkers([{ marker: mk(), at: 0 }], MARKER_MS - 1)).toHaveLength(1);
    expect(pruneMarkers([{ marker: mk(), at: 0 }], MARKER_MS)).toHaveLength(0);
  });
  it('a list is bounded to a team’s worth and a repeated id replaces', () => {
    let l: ReturnType<typeof addMarker> = [];
    for (let i = 1; i <= 30; i++) l = addMarker(l, mk({ id: i }), 0);
    expect(l.length).toBe(PING_LIMITS.perTeam);
    l = addMarker(l, mk({ id: 30, kind: 'go' }), 5);
    expect(l.filter((x) => x.marker.id === 30)).toHaveLength(1);
  });
  it('on screen it is drawn in the world; off screen it is an arrow clamped to the edge, pointing at it', () => {
    const w = placeMarker({ marker: mk({ x: 500, y: 300 }), at: 0 }, 10, view)!;
    expect(w.mode).toBe('world'); expect([w.x, w.y]).toEqual([500, 300]);
    const e = placeMarker({ marker: mk({ x: 3000, y: 300 }), at: 0 }, 10, view)!;
    expect(e.mode).toBe('edge');
    expect(e.x).toBeLessThanOrEqual(view.w); expect(e.x).toBeGreaterThan(view.w - 60);
    expect(e.y).toBeCloseTo(300);
    expect(e.angle).toBeCloseTo(0);
    const up = placeMarker({ marker: mk({ x: 500, y: -4000 }), at: 0 }, 10, view)!;
    expect(up.y).toBeLessThan(60); expect(up.angle).toBeCloseTo(-Math.PI / 2);
    const diag = placeMarker({ marker: mk({ x: 5000, y: 5000 }), at: 0 }, 10, view)!;
    expect(diag.x).toBeLessThanOrEqual(view.w); expect(diag.y).toBeLessThanOrEqual(view.h);
  });
  it('a marker without a position (another room) is only ever a label, and a dead one is not drawn', () => {
    const { x: _x, y: _y, ...far } = mk(); void _x; void _y;
    const d = placeMarker({ marker: far, at: 0 }, 10, view)!;
    expect(d.mode).toBe('room'); expect(d.label).toContain('another room'); expect(d.label).toContain(PING_LABELS.danger);
    expect(placeMarker({ marker: mk(), at: 0 }, MARKER_MS + 1, view)).toBeNull();
  });
});

describe('team chat on the client', () => {
  it('keeps a bounded, cleaned, in-memory list and shows recent lines as fading toasts', () => {
    const c = new ChatLog();
    for (let i = 0; i < 60; i++) c.push(msg({ id: i + 1, text: `m${i}` }), 0, 'me');
    expect(c.recent(100).length).toBeLessThanOrEqual(24);
    expect(c.toasts(0).length).toBe(4);
    expect(c.toasts(TOAST_MS - FADE_MS / 2)[0]!.alpha).toBeCloseTo(0.5);
    expect(c.toasts(TOAST_MS)).toEqual([]);
    c.clear(); expect(c.recent()).toEqual([]);
  });
  it('cleans markup and control characters again, and drops an empty line', () => {
    const c = new ChatLog();
    expect(c.push(msg({ text: '<img src=x onerror=alert(1)>hi\u0000' }), 0, 'me')).toBe(true);
    expect(c.recent()[0]!.msg.text).toBe('hi');
    expect(c.push(msg({ text: '<br>' }), 0, 'me')).toBe(false);
  });
  it('mute: a muted sender’s lines vanish and stay out; unmuting lets new ones in; yourself cannot be muted', () => {
    const c = new ChatLog();
    c.push(msg({ from: 'p1', text: 'a' }), 0, 'me'); c.push(msg({ from: 'p2', name: 'Cy', text: 'b' }), 0, 'me');
    expect(c.toggleMute('p1', 'me')).toBe(true);
    expect(c.recent().map((l) => l.msg.from)).toEqual(['p2']);
    expect(c.push(msg({ from: 'p1', text: 'c' }), 1, 'me')).toBe(false);
    expect(c.toggleMute('p1', 'me')).toBe(false);
    expect(c.push(msg({ from: 'p1', text: 'd' }), 2, 'me')).toBe(true);
    expect(c.toggleMute('me', 'me')).toBeNull();
    expect(c.isMuted('me')).toBe(false);
  });
});

describe('the team panel text', () => {
  const panel: TeamPanel = {
    tick: 1,
    members: [{ id: 'me', name: 'Ann', slot: 0, state: 'alive', carried: 2 }, { id: 'p1', name: 'Bo', slot: 1, state: 'hiding', carried: 0 }, { id: 'p2', name: 'Cy', slot: 2, state: 'disconnected', carried: 1 }],
    journal: { found: 2, marked: 1, lines: 2 },
  };
  it('one row per teammate: name, state and a carried COUNT; yourself cannot be muted', () => {
    const rows = panelRows(panel, 'me', new Set(['p1']));
    expect(rows.map((r) => r.text)).toEqual(['Ann (you)  alive  carrying 2', 'Bo  hiding  carrying 0', 'Cy  disconnected  carrying 1']);
    expect(rows.map((r) => r.canMute)).toEqual([false, true, true]);
    expect(rows.map((r) => r.muted)).toEqual([false, true, false]);
  });
  it('a dead viewer’s panel has no counts, and the journal line is the summary only', () => {
    const rows = panelRows({ tick: 1, members: [{ id: 'me', name: 'Ann', slot: 0, state: 'spectating' }] }, 'me', new Set());
    expect(rows[0]!.text).toBe('Ann (you)  spectating');
    expect(journalLine(panel)).toBe('Journal: 2 pieces examined, 1 of 2 marked');
    expect(journalLine({ ...panel, journal: undefined })).toBeNull();
    expect(journalLine(null)).toBeNull();
    expect(panelRows(null, 'me', new Set())).toEqual([]);
  });
});

describe('the keys line', () => {
  it('names the real ping, team and chat keys; the placeholders are gone', () => {
    for (const k of ['Hold Q ping', 'Tab team', 'Enter chat']) expect(ESCAPE_KEYS_HINT).toContain(k);
    expect(ESCAPE_KEYS_HINT).not.toContain('(soon)');
  });
});
