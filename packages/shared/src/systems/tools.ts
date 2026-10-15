import { z } from 'zod';

/** Tool and hazard vocabulary shared by server rules and client UI hints. The server enforces everything. */
export const ToolIdSchema = z.enum([
  'phase_scanner', 'flux_welder', 'gravity_anchor', 'power_cell', 'shield_projector',
]);
export type ToolId = z.infer<typeof ToolIdSchema>;
export const TOOL_IDS = ToolIdSchema.options;

export const HazardKindSchema = z.enum(['gravity_flux', 'arc_discharge']);
export type HazardKind = z.infer<typeof HazardKindSchema>;

/** What a tool needs as its target. `none` tools act on the player's own (server-known) position. */
export type ToolTarget = 'none' | 'repairable' | 'consumer';

export interface ToolSpec {
  id: ToolId;
  label: string;
  maxCharges: number;
  cooldownTicks: number;
  /** Max distance to a target (target tools only). */
  range: number;
  /** Area radius (area tools only). */
  radius: number;
  /** Effect duration in ticks (0 = instant / channelled). */
  durationTicks: number;
  target: ToolTarget;
  /** Hazard kinds this tool can neutralise. */
  stabilizes: readonly HazardKind[];
  protectsFrom: readonly HazardKind[];
}

export const TOOL_SPECS: Record<ToolId, ToolSpec> = {
  phase_scanner: {
    id: 'phase_scanner', label: 'Phase Scanner', maxCharges: 5, cooldownTicks: 60, range: 0, radius: 260,
    durationTicks: 0, target: 'none', stabilizes: [], protectsFrom: [],
  },
  flux_welder: {
    id: 'flux_welder', label: 'Flux Welder', maxCharges: 3, cooldownTicks: 20, range: 90, radius: 0,
    durationTicks: 0, target: 'repairable', stabilizes: [], protectsFrom: [],
  },
  gravity_anchor: {
    id: 'gravity_anchor', label: 'Gravity Anchor', maxCharges: 2, cooldownTicks: 100, range: 0, radius: 140,
    durationTicks: 400, target: 'none', stabilizes: ['gravity_flux'], protectsFrom: [],
  },
  power_cell: {
    id: 'power_cell', label: 'Power Cell', maxCharges: 2, cooldownTicks: 100, range: 90, radius: 0,
    durationTicks: 600, target: 'consumer', stabilizes: [], protectsFrom: [],
  },
  shield_projector: {
    id: 'shield_projector', label: 'Shield Projector', maxCharges: 2, cooldownTicks: 100, range: 0, radius: 120,
    durationTicks: 160, target: 'none', stabilizes: [], protectsFrom: ['arc_discharge'],
  },
};

/** Horizontal reach for `interact`, and the allowed vertical offset (feet vs. entity base) for any action. */
export const INTERACT_RANGE = 80;
export const RANGE_DY = 60;
/** A running channel may drift this far beyond its start range before it is interrupted. */
export const CHANNEL_RANGE_SLACK = 30;
/** Minimum ticks between two actions from the same player. */
export const ACTION_MIN_GAP_TICKS = 3;
