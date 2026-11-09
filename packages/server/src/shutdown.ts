export interface ShutdownDeps {
  server: { drain(): void; close(): Promise<void> };
  progress: { close(): Promise<void> };
  log: (message: string) => void;
  exit: (code: number) => void;
  /** After this long the process exits with code 1 even if something hangs. */
  timeoutMs: number;
}

/**
 * Graceful shutdown (SIGTERM from the host, SIGINT from a terminal). In order: stop taking new players (`/healthz` turns 503 so the host stops routing
 * here), stop the simulation and close the sockets, let queued progress writes finish and close the database, then exit 0. A hard timer ends the
 * process with 1 if any step hangs, so a deploy is never stuck. Calling it twice runs it once.
 */
export function createShutdown(d: ShutdownDeps): (reason: string) => Promise<void> {
  let started: Promise<void> | null = null;
  return (reason) => {
    if (started) return started;
    started = (async () => {
      d.log(`shutting down (${reason})`);
      const timer = setTimeout(() => { d.log('shutdown timed out; exiting'); d.exit(1); }, d.timeoutMs);
      timer.unref();
      try {
        d.server.drain();
        await d.server.close();
        await d.progress.close(); // waits for queued writes, then closes the database
        clearTimeout(timer);
        d.log('shutdown complete');
        d.exit(0);
      } catch (e) {
        clearTimeout(timer);
        d.log(`shutdown failed: ${e instanceof Error ? e.message : 'error'}`);
        d.exit(1);
      }
    })();
    return started;
  };
}
