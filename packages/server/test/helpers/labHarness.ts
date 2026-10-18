import { ABILITY_LAB_ARENA, ABILITY_MIN_GAP_TICKS, type AbilityAction, type StageAction, type StageState, type ToolId } from '@wb/shared';
import { StageEngine, type ActionResult } from '../../src/systems/engine';
import { PhysicsWorld } from '../../src/abilities/world';
import { ABILITY_LAB_STAGE } from '../../src/systems/stages/abilityLab';

/**
 * The Ability Lab engine with hand-placed players (no player physics) and the real PhysicsWorld on the Lab arena.
 * For rules (plates, copies, energy). Real-physics play is in lab.solvability.test.ts. Same tick order as Room.tick.
 */
export function labHarness(ids: string[] = ['a']) {
  const def = structuredClone(ABILITY_LAB_STAGE);
  const where = new Map<string, { x: number; y: number; connected: boolean }>();
  ids.forEach((id) => where.set(id, { x: 140, y: 680, connected: true }));
  const pos = (id: string) => where.get(id);
  const world = new PhysicsWorld(ABILITY_LAB_ARENA);
  world.reset((def.props ?? []).map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, light: p.light })));
  const e = new StageEngine(def, ids, { arena: ABILITY_LAB_ARENA });
  e.attachWorld(world);
  const h = {
    e, world, def,
    at: (id: string, x: number, y: number) => { where.set(id, { x, y, connected: true }); },
    run: (n: number) => { for (let i = 0; i < n; i++) { world.step(); e.step(pos); } },
    ab: (id: string, a: AbilityAction): ActionResult => { h.run(ABILITY_MIN_GAP_TICKS); return e.abilityAction(id, a, pos); },
    act: (id: string, a: StageAction): ActionResult => { h.run(4); return e.action(id, a, pos); },
    tool: (id: string, tool: ToolId, targetId?: string): ActionResult => h.act(id, { kind: 'use_tool', tool, ...(targetId ? { targetId } : {}) }),
    st: (): StageState => e.state(),
    obj: (oid: string) => e.state().objectives.find((o) => o.id === oid)!.status,
    plate: (pid: string) => e.state().entities.find((x) => x.id === pid)!.state,
    energy: (id: string) => e.state().abilities!.players.find((p) => p.id === id)!.energy,
    prop: (id: string) => world.prop(id)!,
  };
  return h;
}
export type LabHarness = ReturnType<typeof labHarness>;
