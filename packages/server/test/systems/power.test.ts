import { describe, expect, it } from 'vitest';
import { evaluatePower } from '../../src/systems/power';

const nodes = [
  { id: 'gen', kind: 'generator' as const }, { id: 'j', kind: 'junction' as const },
  { id: 'a', kind: 'consumer' as const }, { id: 'b', kind: 'consumer' as const },
];
const conduits = [
  { id: 'g_j', from: 'gen', to: 'j' }, { id: 'j_a', from: 'j', to: 'a' }, { id: 'j_b', from: 'j', to: 'b' },
];
const ev = (closed: string[], cap = 1) => evaluatePower(nodes, conduits, cap, (c) => closed.includes(c));

describe('power routing', () => {
  it('nothing is powered with every conduit open', () => {
    expect(ev([]).poweredConsumers.size).toBe(0);
  });
  it('power flows only along a continuous chain of conducting conduits', () => {
    expect(ev(['j_a']).poweredConsumers.size).toBe(0); // not connected to the generator
    expect([...ev(['g_j', 'j_a']).poweredConsumers]).toEqual(['a']);
  });
  it('flows in either direction along a conduit', () => {
    const r = evaluatePower(nodes, [{ id: 'x', from: 'a', to: 'gen' }], 1, () => true);
    expect(r.poweredConsumers.has('a')).toBe(true);
  });
  it('detects overload when more consumers are live than the generator can carry', () => {
    const r = ev(['g_j', 'j_a', 'j_b']);
    expect(r.load).toBe(2);
    expect(r.overloaded).toBe(true);
    expect(ev(['g_j', 'j_a', 'j_b'], 2).overloaded).toBe(false);
  });
  it('reports live conduits for rendering', () => {
    expect([...ev(['g_j', 'j_a']).liveConduits].sort()).toEqual(['g_j', 'j_a']);
  });
});
