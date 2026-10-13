import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFixedLoop } from '../src/loop';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('startFixedLoop', () => {
  it('ticks 20 times per second', () => {
    let n = 0;
    const stop = startFixedLoop(20, () => n++, () => Date.now());
    vi.advanceTimersByTime(1000);
    expect(n).toBe(20);
    stop();
  });
  it('catches up (bounded) after a stall and drops the rest', () => {
    let clock = 0, n = 0;
    const stop = startFixedLoop(20, () => n++, () => clock);
    clock += 10_000; // 10 s stall
    vi.advanceTimersByTime(10);
    expect(n).toBe(5); // MAX_CATCHUP, no spiral of death
    clock += 50; vi.advanceTimersByTime(10);
    expect(n).toBe(6); // resumes normally
    stop();
  });
  it('stops ticking after stop()', () => {
    let n = 0;
    const stop = startFixedLoop(20, () => n++, () => Date.now());
    vi.advanceTimersByTime(200); stop(); const at = n;
    vi.advanceTimersByTime(1000);
    expect(n).toBe(at);
  });
});
