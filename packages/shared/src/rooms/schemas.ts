import { z } from 'zod';
import { ROOM_LIMITS } from './limits';

const Num = z.number().finite();
export const RoomIdSchema = z.string().regex(/^[a-z][a-z0-9_.]*$/).max(48);

const RectSchema = z.object({ x: Num, y: Num, w: Num.positive(), h: Num.positive() });
const PointSchema = z.object({ x: Num, y: Num });

/** The shape of `Arena` (shared/src/arena.ts) as a bounded schema. A room's arena id IS its room id. */
export const RoomArenaSchema = z.object({
  id: RoomIdSchema,
  name: z.string().max(40),
  width: Num.min(ROOM_LIMITS.minWidth).max(ROOM_LIMITS.maxWidth),
  height: Num.min(ROOM_LIMITS.minHeight).max(ROOM_LIMITS.maxHeight),
  solids: z.array(RectSchema).min(1).max(ROOM_LIMITS.maxSolidsPerRoom),
  spawns: z.array(PointSchema).length(ROOM_LIMITS.spawnsPerRoom),
});

/** A doorway standing on a floor (`y` is the top, `y + h` rests on a solid). Walking into it takes the player to `to`, at `arrive`. */
export const DoorDefSchema = z.object({
  id: RoomIdSchema,
  ...RectSchema.shape,
  to: RoomIdSchema,
  /** Feet-centre in the target room. */
  arrive: PointSchema,
});

export const RoomDefSchema = z.object({
  id: RoomIdSchema,
  arena: RoomArenaSchema,
  doors: z.array(DoorDefSchema).max(ROOM_LIMITS.maxDoorsPerRoom),
});

/** Server-private room graph of a stage. The first room named by `start` is where every player begins. */
export const RoomGraphSchema = z.object({
  start: RoomIdSchema,
  rooms: z.array(RoomDefSchema).min(1).max(ROOM_LIMITS.maxRooms),
});

/**
 * What ONE player is told about the room they are in (event `room:layout`): the walls and the doorways, never where a
 * door leads or what lies behind it, and never any other room.
 */
export const RoomLayoutSchema = z.object({
  roomId: RoomIdSchema,
  arena: RoomArenaSchema,
  doors: z.array(z.object({ id: RoomIdSchema, ...RectSchema.shape })).max(ROOM_LIMITS.maxDoorsPerRoom),
});

export type RoomArena = z.infer<typeof RoomArenaSchema>;
export type DoorDef = z.infer<typeof DoorDefSchema>;
export type RoomDef = z.infer<typeof RoomDefSchema>;
export type RoomGraph = z.infer<typeof RoomGraphSchema>;
export type RoomLayout = z.infer<typeof RoomLayoutSchema>;
