import { ITEM_LIMITS, type Difficulty, type ItemAction, type StageAction, type StageState, type ToolId } from '@wb/shared';
import { StageEngine, type ActionResult } from '../../src/systems/engine';
import type { ItemDef, NeedDef, StageDef, StashDef } from '../../src/systems/stageDef';
import { ItemSystem, type ItemResult } from '../../src/salvage/system';
import { TUTORIAL_STAGE } from '../../src/systems/tutorial';

export const part = (id: string, kind: ItemDef['kind'], x: number, y: number, extra: Partial<ItemDef> = {}): ItemDef => ({ id, kind, x, y, ...extra });

/**
 * Items for the P3C tests, all on Relay Platform 01. The low-left platform (x 140..400, top y 590) holds everything a player at (290, 590)
 * can reach (pickup range 70). `hid_1` starts hidden. `far_fuse` lies on the floor.
 */
export const FIXTURE_ITEMS: ItemDef[] = [
  part('core_1', 'power_core', 230, 590), // heavy by default: 2 slots
  part('coil_ok', 'flux_coil', 250, 590),
  part('coil_bad', 'flux_coil', 270, 590, { decoy: true }),
  part('fuse_1', 'fuse', 300, 590),
  part('hid_1', 'fuse', 320, 590, { hidden: { container: 'crate', reveal: 'scan' } }),
  part('bat_1', 'battery', 330, 590),
  part('far_fuse', 'fuse', 700, 680),
];
/** The Flux Coil goes on the (hidden until scanned) cracked coupling; the cache wants a fuse and a battery. */
export const FIXTURE_NEEDS: NeedDef[] = [
  { targetId: 'bp_coupling', items: ['flux_coil'] },
  { targetId: 'cache', items: ['fuse', 'battery'] },
];

type Where = { x: number; y: number; connected: boolean };

/**
 * Engine with hand-placed players (no player physics) and the P3C fixture items. Mirrors the tick order of Room.tick
 * (engine step only: items need no physics). Players start at (290, 590).
 */
export function itemHarness(opts: {
  ids?: string[]; items?: ItemDef[]; needs?: NeedDef[]; stashes?: StashDef[]; difficulty?: Difficulty; mutate?: (def: StageDef) => void;
} = {}) {
  const ids = opts.ids ?? ['a'];
  const def: StageDef = structuredClone(TUTORIAL_STAGE);
  def.items = structuredClone(opts.items ?? FIXTURE_ITEMS);
  def.needs = structuredClone(opts.needs ?? FIXTURE_NEEDS);
  if (opts.stashes) def.stashes = structuredClone(opts.stashes);
  opts.mutate?.(def);
  const where = new Map<string, Where>();
  ids.forEach((id) => where.set(id, { x: 290, y: 590, connected: true }));
  const pos = (id: string): Where | undefined => where.get(id);
  const e = new StageEngine(def, ids, { difficulty: opts.difficulty });

  const h = {
    e, def,
    at: (id: string, x: number, y: number) => { where.set(id, { x, y, connected: true }); },
    /** Socket drop: the player stays in the sim, marked disconnected. */
    drop: (id: string) => { const w = where.get(id)!; where.set(id, { ...w, connected: false }); e.onDisconnect(id); },
    run: (n: number) => { for (let i = 0; i < n; i++) e.step(pos); },
    /** Waits out the per-player item gap, then acts. */
    act: (id: string, a: ItemAction): ItemResult => { h.run(ITEM_LIMITS.minGapTicks); return e.itemAction(id, a, pos); },
    /** Acts with no waiting (to test the gap itself). */
    actNow: (id: string, a: ItemAction): ItemResult => e.itemAction(id, a, pos),
    pickup: (id: string, itemId: string) => h.act(id, { action: 'pickup', itemId }),
    putDown: (id: string, itemId: string) => h.act(id, { action: 'drop', itemId }),
    stage: (id: string, a: StageAction): ActionResult => { h.run(3); return e.action(id, a, pos); },
    tool: (id: string, tool: ToolId, targetId?: string) => h.stage(id, { kind: 'use_tool', tool, targetId }),
    use: (id: string, targetId: string) => h.stage(id, { kind: 'interact', targetId }),
    open: (id: string, stashId: string) => h.act(id, { action: 'open', stashId }),
    /** Scans from (200, 590) so the hidden coupling at (200, 410) is revealed, then walks back to `back`. */
    scan: (id: string) => { h.at(id, 200, 590); return h.tool(id, 'phase_scanner'); },
    st: (): StageState => e.state(),
    items: () => e.state().items!.items,
    item: (id: string) => e.state().items!.items.find((i) => i.id === id),
    mine: (id: string) => e.state().items!.players.find((p) => p.id === id)!,
    breakdown: () => e.state().score.breakdown,
    needs: () => e.state().items!.needs,
    /** Test-only access to the item system. */
    sys: (): ItemSystem => (e as unknown as { items: ItemSystem }).items,
  };
  return h;
}

export type ItemHarness = ReturnType<typeof itemHarness>;

/** A crate that holds a hidden fuse, and an empty crate that looks exactly the same until opened. Both stand on the low-left platform. */
export const FIXTURE_STASHES: StashDef[] = [
  { id: 'crate_a', kind: 'crate', label: 'Dented crate', x: 160, y: 590 },
  { id: 'crate_b', kind: 'crate', label: 'Dented crate', x: 380, y: 590 },
];
export const STASH_ITEM: ItemDef = part('stash_fuse', 'fuse', 170, 590, { hidden: { container: 'crate', reveal: 'interact', stashId: 'crate_a' } });
