import { describe, expect, it } from 'vitest';
import { evaluateFailures, topoOrder } from '../../src/systems/failures';

const nodes = ['root', 'mid', 'sym_a', 'sym_b', 'other_root'].map((id) => ({ id }));
const edges = [
  { from: 'root', to: 'mid' }, { from: 'mid', to: 'sym_a' }, { from: 'root', to: 'sym_b' }, { from: 'other_root', to: 'sym_b' },
];

describe('failure dependency graph', () => {
  it('orders causes before effects and rejects cycles', () => {
    const order = topoOrder(nodes, edges)!;
    expect(order.indexOf('root')).toBeLessThan(order.indexOf('mid'));
    expect(order.indexOf('mid')).toBeLessThan(order.indexOf('sym_a'));
    expect(topoOrder([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).toBeNull();
  });

  const run = (defects: string[], suppressed: string[] = []) =>
    evaluateFailures(topoOrder(nodes, edges)!, edges, (id) => defects.includes(id), (id) => suppressed.includes(id));

  it('a symptom is active while ANY upstream cause is active (propagates through the chain)', () => {
    const r = run(['root']);
    expect(r.get('sym_a')!.state).toBe('active'); // root -> mid -> sym_a
    expect(r.get('sym_b')!.state).toBe('active');
  });
  it('a symptom with two causes only resolves when both are fixed', () => {
    expect(run(['other_root']).get('sym_b')!.state).toBe('active');
    expect(run(['root']).get('sym_b')!.state).toBe('active');
    expect(run([]).get('sym_b')!.state).toBe('resolved');
  });
  it('masking a symptom reads "mitigated" but the cause is still raw-active (no real fix)', () => {
    const r = run(['root'], ['sym_a']);
    expect(r.get('sym_a')).toMatchObject({ raw: true, effective: false, state: 'mitigated' });
    expect(r.get('root')!.state).toBe('active');
    expect(r.get('sym_b')!.state).toBe('active'); // siblings are unaffected
  });
  it('masking a root cause mitigates its children only when no other cause remains', () => {
    expect(run(['root'], ['root']).get('sym_a')!.state).toBe('mitigated');
    expect(run(['root', 'other_root'], ['root']).get('sym_b')!.state).toBe('active');
  });
  it('relapses when the mitigation ends', () => {
    expect(run(['root'], ['sym_a']).get('sym_a')!.state).toBe('mitigated');
    expect(run(['root'], []).get('sym_a')!.state).toBe('active');
  });
  it('a mitigation never counts as resolved', () => {
    expect(run([], []).get('root')!.state).toBe('resolved');
    expect(run(['root'], ['root']).get('root')!.state).toBe('mitigated');
  });
});
