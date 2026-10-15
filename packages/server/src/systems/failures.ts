/**
 * Failure dependency graph. Edges mean "if `from` is failing, `to` is failing", so a symptom stays
 * active until *every* upstream cause is resolved. A mitigation (e.g. a Power Cell, a cosmetic fix)
 * can mask a node for a while without resolving its cause: the node reads `mitigated`, then relapses.
 */
export type FailureNodeState = 'active' | 'mitigated' | 'resolved';

export interface GraphNode { id: string }
export interface GraphEdge { from: string; to: string }

/** Topological order (causes first). Returns null if the graph has a cycle. */
export function topoOrder(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): string[] | null {
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const e of edges) if (e.from === id) {
      const d = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, d);
      if (d === 0) queue.push(e.to);
    }
  }
  return out.length === nodes.length ? out : null;
}

export interface FailureEval { raw: boolean; effective: boolean; state: FailureNodeState }

/**
 * @param ownDefect  intrinsic defect of a node (unrepaired breakpoint, unpowered consumer, ...)
 * @param suppressed whether a temporary mitigation currently masks the node
 */
export function evaluateFailures(
  order: readonly string[],
  edges: readonly GraphEdge[],
  ownDefect: (id: string) => boolean,
  suppressed: (id: string) => boolean,
): Map<string, FailureEval> {
  const out = new Map<string, FailureEval>();
  for (const id of order) {
    const parents = edges.filter((e) => e.to === id).map((e) => out.get(e.from)!);
    const raw = ownDefect(id) || parents.some((p) => p.raw);
    const effective = !suppressed(id) && (ownDefect(id) || parents.some((p) => p.effective));
    out.set(id, { raw, effective, state: !raw ? 'resolved' : effective ? 'active' : 'mitigated' });
  }
  return out;
}
