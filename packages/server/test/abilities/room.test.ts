import { describe, expect, it } from 'vitest';
import { ABILITY_SPECS } from '@wb/shared';
import { Room } from '../../src/room';
import { DEFAULT_ABILITY_CONFIG, withDefaultAbilities } from '../../src/abilities/defaults';
import { TUTORIAL_STAGE } from '../../src/systems/tutorial';

const playing = (n = 1) => {
  const r = new Room('ABCD', 2);
  for (let i = 0; i < n; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < n; i++) r.setReady(`p${i}`, true);
  r.start('p0');
  for (let i = 0; i < 5 && r.phase !== 'playing'; i++) r.tick();
  return r;
};
const toStage2 = (r: Room) => {
  // force the stage to completion through the public API is covered elsewhere; here we only need the Room at stage 2
  (r as unknown as { phase: string }).phase = 'stage_complete';
  expect(r.nextStage('p0').ok).toBe(true);
  for (let i = 0; i < 5 && r.phase !== 'playing'; i++) r.tick();
};

describe('abilities in the Room', () => {
  it('stage 1 (tutorial) has none: public state has no `abilities`, intents are refused', () => {
    const r = playing();
    expect(r.peekStageState()!.abilities).toBeUndefined();
    expect(r.abilityAction('p0', { ability: 'momentum', targetId: 'self', dir: 'up' })).toEqual({ ok: false, error: 'Reality abilities are not available in this stage.' });
  });
  it('generated stages (N >= 2) offer the default abilities with full energy', () => {
    const r = playing(2);
    toStage2(r);
    const a = r.peekStageState()!.abilities!;
    expect(a.enabled).toEqual(DEFAULT_ABILITY_CONFIG.enabled);
    expect(a.players.map((p) => p.energy)).toEqual([100, 100]);
  });
  it('spends energy through the Room, and a new stage starts with full energy again', () => {
    const r = playing(); toStage2(r);
    for (let i = 0; i < 8; i++) r.tick();
    expect(r.abilityAction('p0', { ability: 'momentum', targetId: 'self', dir: 'up' }).ok).toBe(true);
    expect(r.peekStageState()!.abilities!.players[0]!.energy).toBe(100 - ABILITY_SPECS.momentum.energyCost);
    expect(r.resetArena('p0').ok).toBe(true);
    expect(r.peekStageState()!.abilities!.players[0]!.energy).toBe(100);
  });
  it('is refused outside play, and for non-members', () => {
    const r = new Room('ABCD', 2); r.join('p0', 'P0');
    expect(r.abilityAction('p0', { ability: 'momentum', targetId: 'self', dir: 'up' })).toEqual({ ok: false, error: 'No stage is running.' });
    const p = playing();
    expect(p.abilityAction('ghost', { ability: 'momentum', targetId: 'self', dir: 'up' })).toEqual({ ok: false, error: 'You are not part of this run.' });
  });
  it('a stage that declares its own abilities keeps them; the tutorial never gets defaults', () => {
    expect(withDefaultAbilities(TUTORIAL_STAGE, 1)).toBe(TUTORIAL_STAGE);
    const own = { ...TUTORIAL_STAGE, abilities: { ...DEFAULT_ABILITY_CONFIG, energyStart: 10 } };
    expect(withDefaultAbilities(own, 5).abilities!.energyStart).toBe(10);
    expect(withDefaultAbilities(TUTORIAL_STAGE, 2).abilities).toEqual(DEFAULT_ABILITY_CONFIG);
  });
});
