import type { PlayerLife, TeamPanel, TeamState } from '@wb/shared';

export interface PanelMember { id: string; name: string; slot: number; connected: boolean; life: PlayerLife | undefined; hidden: boolean; carried: number }

/** A teammate's state for the panel. `downed` is a body that can still be revived (dead); `eliminated` is watching (spectating). */
export function teamState(m: Pick<PanelMember, 'connected' | 'life' | 'hidden'>): TeamState {
  if (!m.connected) return 'disconnected';
  if (m.life === 'downed') return 'dead';
  if (m.life === 'eliminated') return 'spectating';
  return m.hidden ? 'hiding' : 'alive';
}

/**
 * The panel one player is sent. A living viewer gets every teammate's state and carried COUNT plus the journal summary; a dead viewer gets names and
 * states only (their view of the stage is blank, so nothing about what the living carry or have found is sent to them).
 */
export function buildPanel(tick: number, members: readonly PanelMember[], viewerAlive: boolean, journal: { found: number; marked: number; lines: number } | null): TeamPanel {
  return {
    tick,
    members: members.map((m) => ({ id: m.id, name: m.name, slot: m.slot, state: teamState(m), ...(viewerAlive ? { carried: Math.min(32, Math.max(0, m.carried)) } : {}) })),
    ...(viewerAlive && journal ? { journal } : {}),
  };
}
