/**
 * Dev flag for the Ability Lab (P3B). Open the client with `?lab=1` (for example http://localhost:5173/?lab=1) to CREATE an
 * Ability Lab room. The server must also run with ABILITY_LAB=1, otherwise it answers with an error that the lobby shows.
 * Joining an existing room by code (`#CODE`) never uses the flag: the room already is, or is not, a Lab room.
 */
export function labRequested(search: string): boolean {
  return new URLSearchParams(search).get('lab') === '1';
}
