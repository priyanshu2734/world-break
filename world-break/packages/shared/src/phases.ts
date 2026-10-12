/**
 * Explicit state machines. The server is the only place transitions are applied;
 * clients receive the resulting state.
 */
export type RoomPhase = 'lobby' | 'briefing' | 'playing' | 'stage_complete' | 'team_wiped' | 'death_review';

export type RoomEvent =
  | 'START'
  | 'BEGIN'
  | 'STAGE_CLEAR'
  | 'TEAM_WIPE'
  | 'NEXT_STAGE'
  | 'REVIEW'
  | 'RETRY'
  | 'RETURN_LOBBY';

const ROOM_TABLE: Record<RoomPhase, Partial<Record<RoomEvent, RoomPhase>>> = {
  lobby: { START: 'briefing' },
  briefing: { BEGIN: 'playing', RETURN_LOBBY: 'lobby' },
  playing: { STAGE_CLEAR: 'stage_complete', TEAM_WIPE: 'team_wiped' },
  stage_complete: { NEXT_STAGE: 'briefing', RETURN_LOBBY: 'lobby' },
  team_wiped: { REVIEW: 'death_review' },
  death_review: { RETRY: 'briefing', RETURN_LOBBY: 'lobby' },
};

export class InvalidTransitionError extends Error {
  constructor(machine: string, from: string, event: string) {
    super(`Invalid ${machine} transition: ${from} --${event}-->`);
  }
}

export function nextRoomPhase(from: RoomPhase, event: RoomEvent): RoomPhase {
  const to = ROOM_TABLE[from][event];
  if (!to) throw new InvalidTransitionError('room', from, event);
  return to;
}

export type PlayerLife = 'alive' | 'downed' | 'eliminated';
export type PlayerLifeEvent = 'DOWN' | 'REVIVE' | 'BLEED_OUT';

const LIFE_TABLE: Record<PlayerLife, Partial<Record<PlayerLifeEvent, PlayerLife>>> = {
  alive: { DOWN: 'downed' },
  downed: { REVIVE: 'alive', BLEED_OUT: 'eliminated' },
  eliminated: {}, // terminal for the attempt; spectates until the attempt ends
};

export function nextPlayerLife(from: PlayerLife, event: PlayerLifeEvent): PlayerLife {
  const to = LIFE_TABLE[from][event];
  if (!to) throw new InvalidTransitionError('player', from, event);
  return to;
}

/** A team wipe = nobody is alive. Downed-only teams are wiped once all bleed out or none can revive. */
export function isTeamWiped(lives: readonly PlayerLife[]): boolean {
  return lives.length > 0 && lives.every((l) => l === 'eliminated');
}
