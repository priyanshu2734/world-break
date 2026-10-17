import { SERVER_TICK_HZ, TOOL_SPECS, type StageState } from '@wb/shared';

/**
 * Minimal, presentation-only text for the running disaster (P3A). It reads the PUBLIC `StageState.disaster`
 * projection only; nothing here decides an outcome. Visual polish is P7.
 */
export interface HudLine { text: string; color: string }

const PHASE_COLOR: Record<string, string> = {
  warning: '#ffe27a', active: '#ffb02e', escalated: '#ff6b6b', failed: '#ff4d4d', resolved: '#3de8ff', cleanup: '#3de8ff',
};

export const clock = (ticks: number): string => {
  const s = Math.max(0, Math.floor(ticks / SERVER_TICK_HZ));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Lines for the HUD panel: phase, readable message, countdown, and every threat with its countermeasure. */
export function disasterLines(st: Pick<StageState, 'disaster'>, tick: number): HudLine[] {
  const d = st.disaster;
  if (!d) return [];
  const color = PHASE_COLOR[d.phase] ?? '#ffffff';
  const lines: HudLine[] = [
    { text: `DISASTER: ${d.name} [${d.phase.toUpperCase()}]`, color },
    { text: d.message, color: '#d8f6ff' },
  ];
  if (d.escalatesAtTick !== null) lines.push({ text: `Escalates in ${clock(d.escalatesAtTick - tick)}`, color: '#ffe27a' });
  else if (d.failsAtTick !== null) lines.push({ text: `Critical in ${clock(d.failsAtTick - tick)}`, color: '#ff6b6b' });
  if (d.phase !== 'resolved' && d.phase !== 'cleanup') {
    for (const t of d.threats) {
      lines.push({ text: `! ${t.warning}`, color: '#ffb02e' });
      lines.push({ text: `   Counter: ${TOOL_SPECS[t.countermeasure].label}. ${t.repair}`, color: '#9fb6c2' });
    }
  }
  lines.push({ text: ' ', color: '#ffffff' });
  return lines;
}

/** The threat that explains a hazard marker, if the disaster published one. */
export function threatFor(st: Pick<StageState, 'disaster'>, hazardId: string) {
  return st.disaster?.threats.find((t) => t.hazardId === hazardId) ?? null;
}
