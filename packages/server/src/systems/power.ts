/**
 * Power network routing. Power flows from generators across conduits that are intact AND connected
 * (a conduit with a switch conducts only while its switch is closed). A generator can carry a limited
 * number of consumers at once; exceeding it is an overload.
 */
export interface PowerNodeDef { id: string; kind: 'generator' | 'junction' | 'consumer' }
export interface PowerConduitDef { id: string; from: string; to: string }

export interface PowerEval {
  liveNodes: Set<string>;
  liveConduits: Set<string>;
  poweredConsumers: Set<string>;
  load: number;
  overloaded: boolean;
}

export function evaluatePower(
  nodes: readonly PowerNodeDef[],
  conduits: readonly PowerConduitDef[],
  capacity: number,
  /** true when the conduit currently conducts (intact and, if switched, closed). */
  conducts: (conduitId: string) => boolean,
): PowerEval {
  const live = new Set(nodes.filter((n) => n.kind === 'generator').map((n) => n.id));
  const liveConduits = new Set<string>();
  const usable = conduits.filter((c) => conducts(c.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of usable) {
      for (const [a, b] of [[c.from, c.to], [c.to, c.from]] as const) {
        if (live.has(a)) {
          liveConduits.add(c.id);
          if (!live.has(b)) { live.add(b); grew = true; }
        }
      }
    }
  }
  const poweredConsumers = new Set(nodes.filter((n) => n.kind === 'consumer' && live.has(n.id)).map((n) => n.id));
  return { liveNodes: live, liveConduits, poweredConsumers, load: poweredConsumers.size, overloaded: poweredConsumers.size > capacity };
}
