import { ACTION_MIN_GAP_TICKS, type StageAction, type StageState, type ToolId } from '@wb/shared';
import { StageEngine, type ActionResult } from '../../src/systems/engine';
import { TUTORIAL_STAGE } from '../../src/systems/tutorial';
import type { StageDef } from '../../src/systems/stageDef';

export const cloneStage = (): StageDef => structuredClone(TUTORIAL_STAGE);

/** Engine harness with hand-placed players (no physics). Real-physics runs live in tutorial.solvability.test.ts. */
export function harness(opts: { def?: StageDef; ids?: string[] } = {}) {
  const ids = opts.ids ?? ['a'];
  const where = new Map<string, { x: number; y: number; connected: boolean }>();
  ids.forEach((id) => where.set(id, { x: 90, y: 680, connected: true }));
  const pos = (id: string) => where.get(id);
  const e = new StageEngine(opts.def ?? TUTORIAL_STAGE, ids);
  const h = {
    e,
    at: (id: string, x: number, y: number) => { where.set(id, { x, y, connected: true }); },
    drop: (id: string) => { where.set(id, { ...where.get(id)!, connected: false }); e.onDisconnect(id); },
    run: (n: number) => { for (let i = 0; i < n; i++) e.step(pos); },
    /** Waits out the per-player action gap, then acts. */
    act: (id: string, a: StageAction): ActionResult => { h.run(ACTION_MIN_GAP_TICKS); return e.action(id, a, pos); },
    /** Acts with no waiting (to test the gap itself). */
    actNow: (id: string, a: StageAction): ActionResult => e.action(id, a, pos),
    tool: (id: string, tool: ToolId, targetId?: string) => h.act(id, { kind: 'use_tool', tool, targetId }),
    use: (id: string, targetId: string) => h.act(id, { kind: 'interact', targetId }),
    st: (): StageState => e.state(),
    sym: (id: string) => e.state().symptoms.find((s) => s.id === id)!.state,
    obj: (id: string) => e.state().objectives.find((o) => o.id === id)!.status,
    ent: (id: string) => e.state().entities.find((x) => x.id === id)!,
    tools: (id: string) => e.state().players.find((p) => p.id === id)!.tools,
    // ---- scripted solutions (teleporting; the engine still enforces range/prereqs) ----
    fixRoot(id = 'a') {
      h.at(id, 200, 590); h.tool(id, 'phase_scanner');
      h.at(id, 200, 410); h.tool(id, 'flux_welder', 'bp_coupling'); h.run(85);
    },
    routePower(id = 'a') {
      h.at(id, 990, 590); h.use(id, 'sw_1');
      h.at(id, 1080, 590); h.use(id, 'sw_2');
      h.run(45);
    },
    sync(id = 'a') {
      h.at(id, 200, 590); h.use(id, 'lock_a');
      h.at(id, 520, 500); h.use(id, 'lock_b');
      h.at(id, 1200, 680); h.use(id, 'lock_c');
      h.run(1); // objectives are evaluated on the next tick
    },
    prepCore(id = 'a', withShield = true) {
      h.at(id, 470, 320);
      h.tool(id, 'gravity_anchor'); h.tool(id, 'power_cell', 'core_feed');
      if (withShield) h.tool(id, 'shield_projector');
    },
  };
  return h;
}
