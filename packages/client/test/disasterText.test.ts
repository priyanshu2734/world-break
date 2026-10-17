import { describe, expect, it } from 'vitest';
import type { DisasterPublic } from '@wb/shared';
import { clock, disasterLines, threatFor } from '../src/ui/disasterText';

const base: DisasterPublic = {
  id: 'reactor_overload', name: 'Reactor Overload', version: 1, phase: 'warning', message: 'Core temperature is rising.',
  escalatesAtTick: 2400, failsAtTick: 7000,
  threats: [{ hazardId: 'hz_arc', warning: 'Arc discharges strike the core deck.', countermeasure: 'shield_projector', repair: 'Scan, restore power, shield, hold.' }],
};
const text = (d: DisasterPublic | undefined, tick = 0) => disasterLines({ disaster: d }, tick).map((l) => l.text);

describe('disaster HUD text', () => {
  it('formats ticks as mm:ss at 20 Hz and clamps at zero', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(1200)).toBe('01:00');
    expect(clock(2400 - 100)).toBe('01:55');
    expect(clock(-50)).toBe('00:00');
  });

  it('shows nothing for hand-authored stages', () => {
    expect(disasterLines({ disaster: undefined }, 0)).toEqual([]);
    expect(threatFor({ disaster: undefined }, 'hz_arc')).toBeNull();
  });

  it('WARNING: title, readable message, escalation countdown, the threat, its countermeasure and the repair path', () => {
    const lines = text(base, 400);
    expect(lines[0]).toBe('DISASTER: Reactor Overload [WARNING]');
    expect(lines[1]).toBe('Core temperature is rising.');
    expect(lines[2]).toBe('Escalates in 01:40');
    expect(lines).toContain('! Arc discharges strike the core deck.');
    expect(lines.some((l) => l.includes('Shield Projector') && l.includes('Scan, restore power, shield, hold.'))).toBe(true);
  });

  it('ESCALATED: switches to a critical countdown', () => {
    const lines = text({ ...base, phase: 'escalated', escalatesAtTick: null }, 3000);
    expect(lines[0]).toContain('[ESCALATED]');
    expect(lines[2]).toBe('Critical in 03:20');
  });

  it('RESOLVED and CLEANUP: no threats and no countdown are shown any more', () => {
    for (const phase of ['resolved', 'cleanup'] as const) {
      const lines = text({ ...base, phase, escalatesAtTick: null, failsAtTick: null }, 5000);
      expect(lines[0]).toContain(phase.toUpperCase());
      expect(lines.some((l) => l.startsWith('!'))).toBe(false);
      expect(lines.some((l) => l.includes('Escalates') || l.includes('Critical'))).toBe(false);
    }
  });

  it('finds the threat that belongs to a hazard marker', () => {
    expect(threatFor({ disaster: base }, 'hz_arc')?.countermeasure).toBe('shield_projector');
    expect(threatFor({ disaster: base }, 'hz_other')).toBeNull();
  });
});
