import {
  ABILITY_MIN_GAP_TICKS, ARENA, type AbilityAction, type AbilityId, type StageAction, type StageState, type ToolId,
} from '@wb/shared';
import { StageEngine, type ActionResult } from '../../src/systems/engine';
import { AbilityConfigSchema, type PropDef, type StageDef } from '../../src/systems/stageDef';
import { PhysicsWorld } from '../../src/abilities/world';
import { TUTORIAL_STAGE } from '../../src/systems/tutorial';

export const ALL_ABILITIES: AbilityId[] = ['gravity_well', 'freeze', 'duplicate', 'momentum', 'anchor'];

export const crate = (id: string, x: number, y: number, light = true): PropDef => ({ id, kind: 'crate', x, y, light });

/**
 * Engine + physical world with hand-placed players (no player physics). Props and zones are stepped by the real
 * PhysicsWorld; real-physics runs live in the *.solvability tests. Mirrors Room.tick order: world, then engine.
 */
export function abilityHarness(opts: {
  ids?: string[]; props?: PropDef[]; enabled?: AbilityId[]; energyStart?: number; passiveRegenTicks?: number;
  mutate?: (def: StageDef) => void;
} = {}) {
  const ids = opts.ids ?? ['a'];
  const def: StageDef = structuredClone(TUTORIAL_STAGE);
  def.abilities = AbilityConfigSchema.parse({
    enabled: opts.enabled ?? ALL_ABILITIES, energyStart: opts.energyStart ?? 100, passiveRegenTicks: opts.passiveRegenTicks ?? 0,
  });
  def.props = opts.props ?? [];
  opts.mutate?.(def);
  const where = new Map<string, { x: number; y: number; connected: boolean }>();
  ids.forEach((id) => where.set(id, { x: 300, y: 590, connected: true }));
  const pos = (id: string) => where.get(id);
  const world = new PhysicsWorld(ARENA);
  world.reset((def.props ?? []).map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, light: p.light })));
  const e = new StageEngine(def, ids);
  e.attachWorld(world);

  const h = {
    e, world, def,
    at: (id: string, x: number, y: number) => { where.set(id, { x, y, connected: true }); },
    run: (n: number) => { for (let i = 0; i < n; i++) { world.step(); e.step(pos); } },
    /** Waits out the per-player ability gap, then acts. */
    ab: (id: string, a: AbilityAction): ActionResult => { h.run(ABILITY_MIN_GAP_TICKS); return e.abilityAction(id, a, pos); },
    /** Acts with no waiting (to test the gap itself). */
    abNow: (id: string, a: AbilityAction): ActionResult => e.abilityAction(id, a, pos),
    act: (id: string, a: StageAction): ActionResult => { h.run(3); return e.action(id, a, pos); },
    tool: (id: string, tool: ToolId, targetId?: string) => h.act(id, { kind: 'use_tool', tool, targetId }),
    st: (): StageState => e.state(),
    ab_state: (id: string) => e.state().abilities!.players.find((p) => p.id === id)!,
    energy: (id: string) => e.state().abilities!.players.find((p) => p.id === id)!.energy,
    prop: (id: string) => world.prop(id)!,
  };
  return h;
}

export type AbilityHarness = ReturnType<typeof abilityHarness>;
