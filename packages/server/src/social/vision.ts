import { EYE_HEIGHT, inLitRegion, pointVisible, type Pt, type RoomDef } from '@wb/shared';

/**
 * P6 A: "can this player see the point (x, y)?", with EXACTLY the rule `restrictedView` applies to a ghost (a point at floor height): inside the
 * radius, in line of sight past solids and closed doors and, once the player's aim is known, inside the lit region. A ping is accepted only
 * where this says yes, so a ping can never show a teammate what the pinger could not see. `test/social/vision.parity.test.ts` pins it to `restrictedView`.
 */
export function makeSeer(room: RoomDef, feet: Pt, openDoorIds: ReadonlySet<string>, radius: number, aim: number | null): (x: number, y: number) => boolean {
  const eye: Pt = { x: feet.x, y: feet.y - EYE_HEIGHT };
  return (x, y) => pointVisible(room, eye, { x, y }, openDoorIds, radius) && (aim === null || inLitRegion(eye, aim, { x, y }, radius));
}
