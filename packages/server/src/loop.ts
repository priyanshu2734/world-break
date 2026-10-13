/**
 * Drift-correcting fixed-rate loop. Runs `onTick` exactly `hz` times per second on average,
 * catching up after stalls (bounded) rather than letting simulation time slip.
 */
export function startFixedLoop(
  hz: number,
  onTick: () => void,
  now: () => number = () => Date.now(),
): () => void {
  const stepMs = 1000 / hz;
  const MAX_CATCHUP = 5;
  let last = now();
  let acc = 0;
  const timer = setInterval(() => {
    const t = now();
    acc += t - last;
    last = t;
    let n = 0;
    while (acc >= stepMs && n < MAX_CATCHUP) { onTick(); acc -= stepMs; n++; }
    if (acc >= stepMs) acc = 0; // hit the catch-up cap: drop the backlog instead of spiralling
  }, Math.max(1, Math.floor(stepMs / 5)));
  return () => clearInterval(timer);
}
