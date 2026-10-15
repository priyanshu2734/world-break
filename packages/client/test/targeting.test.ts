import { describe, expect, it } from 'vitest';
import type { StageState } from '@wb/shared';
import { interactPrompt, nearestInteractable, targetForTool } from '../src/ui/targeting';

const base: StageState = {
  rev: 1, stageId: 't', name: 't', status: 'running', tick: 0, deadlineTick: 100, expired: false,
  score: { total: 0, breakdown: {} }, objectives: [], symptoms: [], clues: [], feed: [], effects: [], channels: [], players: [], hazards: [],
  breakpoints: [
    { id: 'bp', label: 'Crack', x: 200, y: 410, repaired: false, progress: 0 },
    { id: 'bp_done', label: 'Fixed', x: 300, y: 410, repaired: true, progress: 1 },
  ],
  entities: [
    { id: 'near', kind: 'power_switch', label: 'Near', x: 100, y: 590, state: 'open', armedUntilTick: null, locked: false },
    { id: 'nearer', kind: 'power_switch', label: 'Nearer', x: 130, y: 590, state: 'open', armedUntilTick: null, locked: false },
    { id: 'decoy', kind: 'decoy_panel', label: 'Panel', x: 500, y: 590, state: 'flickering', armedUntilTick: null, locked: false },
    { id: 'other_deck', kind: 'supply_cache', label: 'Cache', x: 100, y: 680, state: 'ready', armedUntilTick: null, locked: false },
  ],
  power: {
    capacity: 1, load: 0,
    nodes: [
      { id: 'gen', kind: 'generator', label: 'Gen', x: 700, y: 590, powered: true, source: 'grid' },
      { id: 'pump', kind: 'consumer', label: 'Pump', x: 900, y: 590, powered: false, source: null },
      { id: 'fan', kind: 'consumer', label: 'Fan', x: 1100, y: 590, powered: true, source: 'grid' },
    ],
    conduits: [
      { id: 'c_bad', from: 'gen', to: 'pump', condition: 'damaged', switchEntityId: null, closed: true, live: false },
      { id: 'c_ok', from: 'gen', to: 'fan', condition: 'ok', switchEntityId: null, closed: true, live: true },
    ],
  },
};

describe('client targeting helpers (convenience only; the server re-validates)', () => {
  it('picks the nearest entity within reach on the same deck', () => {
    expect(nearestInteractable(base, { x: 125, y: 590 })).toBe('nearer');
    expect(nearestInteractable(base, { x: 60, y: 590 })).toBe('near');
  });
  it('ignores things on another deck or out of range', () => {
    expect(nearestInteractable(base, { x: 100, y: 590 })).not.toBe('other_deck'); // 90px below
    expect(nearestInteractable(base, { x: 800, y: 590 })).toBeNull();
  });
  it('welder: revealed unrepaired breakpoints, decoys and damaged conduits only', () => {
    expect(targetForTool(base, { x: 205, y: 410 }, 'flux_welder')).toBe('bp');
    expect(targetForTool(base, { x: 300, y: 410 }, 'flux_welder')).toBeUndefined(); // already repaired
    expect(targetForTool(base, { x: 500, y: 590 }, 'flux_welder')).toBe('decoy');
    expect(targetForTool(base, { x: 800, y: 590 }, 'flux_welder')).toBe('c_bad'); // midpoint of gen-pump
    expect(targetForTool(base, { x: 900, y: 590 }, 'flux_welder')).toBeUndefined(); // healthy conduit is never a target
  });
  it('power cell: only unpowered consumers', () => {
    expect(targetForTool(base, { x: 900, y: 590 }, 'power_cell')).toBe('pump');
    expect(targetForTool(base, { x: 1100, y: 590 }, 'power_cell')).toBeUndefined(); // already powered
    expect(targetForTool(base, { x: 700, y: 590 }, 'power_cell')).toBeUndefined(); // generator
  });
  it('area tools need no target', () => {
    for (const t of ['phase_scanner', 'gravity_anchor', 'shield_projector'] as const) expect(targetForTool(base, { x: 200, y: 410 }, t)).toBeUndefined();
  });
  it('builds an on-screen prompt for the nearest interactable', () => {
    expect(interactPrompt(base, { x: 125, y: 590 })).toEqual({ id: 'nearer', label: 'Nearer', state: 'open' });
    expect(interactPrompt(base, { x: 800, y: 590 })).toBeNull();
  });
});
