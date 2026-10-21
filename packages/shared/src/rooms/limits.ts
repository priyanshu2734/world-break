/**
 * P3D step 2: bounded room limits (documented in docs/ROOMS.md). A stage is a chain of at most MAX_ROOMS rooms.
 * Every room is LARGER than the 1280x720 screen: the camera follows the player and there is no minimap.
 */
export const ROOM_LIMITS = {
  /** Hard cap on rooms per stage (GAMEPLAY.md section 4: stage 40+ is capped at 6). */
  maxRooms: 6,
  minWidth: 1600, maxWidth: 3200,
  minHeight: 720, maxHeight: 1440,
  maxSolidsPerRoom: 40,
  maxDoorsPerRoom: 3,
  /** Doors are standing rectangles on a floor. */
  doorMinW: 24, doorMaxW: 80, doorMinH: 80, doorMaxH: 140,
  /** Arrival points keep at least this many px between the body and the door they came out of (no instant bounce). */
  doorClearance: 60,
  /**
   * After a transition a player cannot use a door again for this many ticks. Deliberately short (0.2 s): the arrival clearance above
   * is what prevents a bounce; a long cooldown would let a running player (13 px per tick) skip a door near the arrival point.
   */
  doorCooldownTicks: 4,
  /** One spawn per player slot, as in every arena. */
  spawnsPerRoom: 4,
} as const;

/** The reference screen the camera shows (the Phaser game is 1280x720). */
export const VIEW_WIDTH = 1280;
export const VIEW_HEIGHT = 720;
