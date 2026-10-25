import {
  EYE_HEIGHT, POINT_HEIGHT, inLitRegion, pointVisible, roomById,
  type GameSnapshot, type GhostPublic, type Pt, type RoomDef, type RoomGraph, type StageState,
} from '@wb/shared';

/**
 * P3D step 4: the restricted view. Everything a client is told on an escape stage goes through `restrictedView`: the game snapshot and the
 * stage state are cut down to what the viewer can see. Nothing hidden is merely "not drawn": it is not sent.
 *
 * It takes a `Viewer` rather than a player, so a spectator (P4) is the same call with another pair of eyes: `eyes` is whose position and
 * line of sight the view is cut from, `self` is whose inventory is shown (null = nobody's, as for a spectator).
 */
export interface ViewSource {
  /** The full game snapshot (every player, every room). */
  snapshot: GameSnapshot;
  /** The full public stage state (every object of every room). */
  stage: StageState;
  graph: RoomGraph;
  /** Vision reach in px (`visionRadius(difficulty, stage)`). */
  radius: number;
  /**
   * P3E: the ghosts that are PRESENT (every one, in every room). A ghost is just another entity of the view: it is in a player's snapshot only while
   * it is in their room, inside their reach, in line of sight and (once their aim is known) in their lit region. Absent = no ghost system.
   */
  ghosts?: readonly GhostPublic[];
}
/**
 * `eyes` is whose position and line of sight the view is cut from, `self` whose hands are shown. P3E: `aim` (radians) is where the eyes' owner points the
 * flashlight; when given, everything is also cut down to the lit region (the small light plus the cone). Absent (null or omitted) = the whole radius, as in P3D.
 */
export interface Viewer { eyes: string; self: string | null; aim?: number | null }
export interface RestrictedView { snapshot: GameSnapshot; stage: StageState }

const doorCentre = (d: { x: number; y: number; w: number; h: number }): Pt => ({ x: d.x + d.w / 2, y: d.y + d.h / 2 });

export function restrictedView(src: ViewSource, viewer: Viewer): RestrictedView {
  const { snapshot, stage, graph, radius } = src;
  const eyesAt = snapshot.players.find((p) => p.id === viewer.eyes);
  const room: RoomDef | undefined = eyesAt?.roomId ? roomById(graph, eyesAt.roomId) : undefined;
  const team = snapshot.players.map((p) => ({ id: p.id, name: p.name, slot: p.slot, connected: p.connected }));
  const showSelf = (id: string) => id === viewer.self;

  // No eyes (an unknown viewer, or one outside every room): the viewer sees nothing at all, only the team list.
  if (!eyesAt || !room) {
    const bare: StageState = { ...stage, players: stage.players.filter((p) => showSelf(p.id)), feed: stage.feed.filter((f) => f.room === undefined) };
    delete bare.items; delete bare.escape;
    return { snapshot: { ...snapshot, players: snapshot.players.filter((p) => showSelf(p.id)), team }, stage: bare };
  }

  const eye: Pt = { x: eyesAt.x, y: eyesAt.y - EYE_HEIGHT };
  const open = new Set((stage.escape?.doors ?? []).filter((d) => d.open).map((d) => d.id));
  const aim = viewer.aim ?? null;
  const see = (x: number, y: number, ignoreDoor?: string): boolean =>
    pointVisible(room, eye, { x, y }, open, radius, ignoreDoor) && (aim === null || inLitRegion(eye, aim, { x, y }, radius));
  const here = (r: string | undefined): boolean => r === room.id;

  // ---- the game snapshot: yourself, your eyes' owner, and teammates in view (their positions, never their inventories)
  const players = snapshot.players.filter((p) =>
    p.id === viewer.eyes || showSelf(p.id) || (here(p.roomId) && see(p.x, p.y - POINT_HEIGHT.player)));

  // ---- the stage state
  const out: StageState = {
    ...stage,
    players: stage.players.filter((p) => showSelf(p.id)),
    feed: stage.feed.filter((f) => f.room === undefined || here(f.room)),
  };
  if (stage.items) {
    out.items = {
      ...stage.items,
      // a part is shown if you carry it, or it lies in view in your room; a teammate's carried parts are their inventory
      items: stage.items.items.filter((i) => (i.state === 'carried' ? showSelf(i.carrierId ?? '') : here(i.roomId) && see(i.x, i.y - POINT_HEIGHT.item))),
      players: stage.items.players.filter((p) => showSelf(p.id)),
      ...(stage.items.stashes ? { stashes: stage.items.stashes.filter((s) => here(s.roomId) && see(s.x, s.y - POINT_HEIGHT.stash)) } : {}),
    };
  }
  if (stage.escape) {
    const es = stage.escape;
    const rect = (id: string) => room.doors.find((d) => d.id === id);
    out.escape = {
      doors: es.doors.filter((d) => { const r = here(d.room) ? rect(d.id) : undefined; const c = r ? doorCentre(r) : null; return c !== null && see(c.x, c.y, d.id); }),
      keypads: es.keypads.filter((k) => here(k.room) && see(k.x, k.y - POINT_HEIGHT.keypad)),
      safes: es.safes.filter((s) => here(s.room) && see(s.x, s.y - POINT_HEIGHT.safe)),
      clues: es.clues.filter((c) => here(c.room) && see(c.x, c.y - POINT_HEIGHT.clue)),
      switches: es.switches.filter((s) => here(s.room) && see(s.x, s.y - POINT_HEIGHT.switch)),
      ...(es.exit && here(es.exit.room) && see(es.exit.x, es.exit.y - POINT_HEIGHT.exit) ? { exit: es.exit } : {}),
    };
  }
  // P3E: the ghost, like everything else, only when it is in view
  const ghosts = (src.ghosts ?? []).filter((g) => here(g.room) && see(g.x, g.y - POINT_HEIGHT.ghost));
  return { snapshot: { ...snapshot, players, team, ...(ghosts.length > 0 ? { ghosts } : {}) }, stage: out };
}
