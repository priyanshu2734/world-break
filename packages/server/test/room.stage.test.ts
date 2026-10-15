import { describe, expect, it } from 'vitest';
import { Room } from '../src/room';

const run = (n: number) => {
  const r = new Room('ABCD', 2);
  for (let i = 0; i < n; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < n; i++) r.setReady(`p${i}`, true);
  r.start('p0');
  while (r.phase !== 'playing') r.tick();
  return r;
};
const scan = { kind: 'use_tool', tool: 'phase_scanner' } as const;

describe('Room + stage engine lifecycle', () => {
  it('has stage state from the briefing on, and every player gets a tool kit', () => {
    const r = new Room('ABCD', 5);
    r.join('p0', 'P0'); r.start('p0');
    const s = r.consumeStageState()!;
    expect(s.stageId).toBe('tutorial_cold_start');
    expect(s.players[0]!.tools).toHaveLength(5);
    expect(r.consumeStageState()).toBeNull();
  });
  it('rejects stage actions outside play and from non-members', () => {
    const lobby = new Room('ABCD'); lobby.join('p0', 'P0');
    expect(lobby.stageAction('p0', scan)).toEqual({ ok: false, error: 'No stage is running.' });
    const r = run(1);
    expect(r.stageAction('ghost', scan)).toEqual({ ok: false, error: 'You are not part of this run.' });
    expect(r.stageAction('p0', scan).ok).toBe(true);
  });
  it('a disconnect interrupts that player\'s channel; the run continues for the rest', () => {
    const r = run(2);
    // Move p0 next to the decoy panel is impossible without physics; use the cache instead to prove state flows.
    r.disconnect('p1');
    expect(r.stageAction('p1', scan)).toEqual({ ok: false, error: 'You are not part of this run.' });
    expect(r.peekStageState()!.players).toHaveLength(2); // still listed until reset
  });
  it('reset builds a fresh engine for the remaining players with a higher revision', () => {
    const r = run(3);
    r.stageAction('p0', scan);
    const before = r.consumeStageState()!;
    r.disconnect('p2');
    expect(r.resetArena('p0').ok).toBe(true);
    const after = r.consumeStageState()!;
    expect(after.rev).toBeGreaterThan(before.rev);
    expect(after.players.map((p) => p.id)).toEqual(['p0', 'p1']);
    expect(after.players[0]!.tools.find((t) => t.tool === 'phase_scanner')!.charges).toBe(5);
    expect(after.feed).toHaveLength(1); // fresh attempt
  });
  it('remains playable after the run starts with 1, 2, 3 or 4 players', () => {
    for (const n of [1, 2, 3, 4]) expect(run(n).peekStageState()!.players).toHaveLength(n);
  });
});
