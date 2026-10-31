import type { DeathState, GhostPublic, SpectateMove, SpectatorCam } from '@wb/shared';

/** P4 step 6: pure helpers for the free-fly spectator camera (no Phaser, so they are unit-tested). The server bounds everything; this decides what to SHOW and when to SEND. */

export const FLY_HINT = 'WASD / arrows fly   Q E room   Z X teammate   F follow   G ghost here';

/** The keys held now as an intent: -1, 0 or 1 on each axis (opposite keys cancel). Screen y grows downward, so up is -1. */
export function intentFromKeys(k: { left: boolean; right: boolean; up: boolean; down: boolean }): SpectateMove {
  const ax = (neg: boolean, pos: boolean): -1 | 0 | 1 => (neg === pos ? 0 : neg ? -1 : 1);
  return { x: ax(k.left, k.right), y: ax(k.up, k.down) };
}

export const sameIntent = (a: SpectateMove, b: SpectateMove): boolean => a.x === b.x && a.y === b.y;

/** Send an intent when it changes, and again every 250 ms while a key is held (the server lets one lapse after half a second, so a held key keeps moving the camera). */
export function shouldSendIntent(last: { move: SpectateMove; atMs: number } | null, now: SpectateMove, nowMs: number, keepaliveMs = 250): boolean {
  if (!last) return now.x !== 0 || now.y !== 0;
  if (!sameIntent(last.move, now)) return true;
  return (now.x !== 0 || now.y !== 0) && nowMs - last.atMs >= keepaliveMs;
}

/**
 * The camera the client draws: its own prediction while it flies (so it moves at once), snapped to the server's when the room differs or they have drifted apart by more
 * than `snap` pixels (a lost message, a room switch). In follow mode the client does not need a camera at all (it sits on the teammate in the snapshot).
 */
export function reconcileCam(local: SpectatorCam | null, server: SpectatorCam | undefined, snap = 160): SpectatorCam | null {
  if (!server) return local;
  if (!local || local.room !== server.room || !server.free) return server;
  return Math.hypot(local.x - server.x, local.y - server.y) > snap ? server : local;
}

export interface Focus { room: string | undefined; x: number; y: number; free: boolean }

/** What the camera looks at this frame: where it flies, else the followed teammate (from the snapshot), else the server's camera. Null: nothing to look at yet. */
export function focusFor(o: { death: DeathState | null; players: readonly { id: string; roomId?: string; x: number; y: number }[]; cam: SpectatorCam | null }): Focus | null {
  if (o.cam?.free) return { room: o.cam.room, x: o.cam.x, y: o.cam.y, free: true };
  const t = o.death?.following ? o.players.find((p) => p.id === o.death!.following!.id) : undefined;
  if (t) return { room: t.roomId, x: t.x, y: t.y, free: false };
  return o.cam ? { room: o.cam.room, x: o.cam.x, y: o.cam.y, free: o.cam.free } : null;
}

/** "Room 2 of 5" for the room the camera is in ('' when the stage has one room or the room is unknown). */
export function roomText(rooms: readonly string[] | undefined, room: string | undefined): string {
  if (!rooms || rooms.length < 2 || !room) return '';
  const i = rooms.indexOf(room);
  return i < 0 ? '' : `Room ${i + 1} of ${rooms.length}`;
}

const kindName = (k: string): string => k.charAt(0).toUpperCase() + k.slice(1);

/** Where everybody is, so a spectator knows which room to fly to: teammates and ghosts, each with their room, the ones in the camera's room marked. At most `max` lines. */
export function whereLines(o: {
  selfId: string; players: readonly { id: string; name: string; roomId?: string }[]; ghosts: readonly Pick<GhostPublic, 'id' | 'kind' | 'room'>[];
  rooms: readonly string[] | undefined; camRoom: string | undefined; max?: number;
}): string[] {
  const rooms = o.rooms ?? [];
  const at = (room: string | undefined): string => {
    const i = room ? rooms.indexOf(room) : -1;
    const label = i >= 0 && rooms.length > 1 ? `room ${i + 1}` : 'here';
    return room && room === o.camRoom && rooms.length > 1 ? `${label} (in view)` : label;
  };
  const lines = [
    ...o.players.filter((p) => p.id !== o.selfId).map((p) => `${p.name} · ${at(p.roomId)}`),
    ...o.ghosts.map((g) => `${kindName(g.kind)} · ${at(g.room)}`),
  ];
  return lines.slice(0, o.max ?? 8);
}
