import { z } from 'zod';
import { createRng, deriveSeed } from '../disasters/rng';

/**
 * P3F step 4: the DRAFT PICK. After every cleared stage the team picks 1 of 3 upgrades; the pick lasts for the run. Everything here is data and pure functions:
 * the offer is a function of (run seed, stage, what the team owns), the effects are bounded by the caps below, and the server applies them (the client only shows them).
 */
export const UPGRADE_IDS = ['wide_beam', 'soft_steps', 'extra_hand', 'quick_rescue', 'quick_charge', 'hair_trigger', 'loud_lamp'] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];

export interface UpgradeSpec {
  id: UpgradeId;
  name: string;
  /** What it does, in numbers. */
  text: string;
  /** The price, in words, for an upgrade that has one. */
  tradeoff?: string;
  /** How many times it may be taken in one run. */
  max: number;
}

export const UPGRADES: Readonly<Record<UpgradeId, UpgradeSpec>> = {
  wide_beam: { id: 'wide_beam', name: 'Wide beam', text: 'Your light reaches 10 percent further.', max: 2 },
  soft_steps: { id: 'soft_steps', name: 'Soft steps', text: 'Ghosts hear your noise from 15 percent closer.', max: 2 },
  extra_hand: { id: 'extra_hand', name: 'Extra hand', text: 'Everyone can carry one more slot.', max: 1 },
  quick_rescue: { id: 'quick_rescue', name: 'Quick rescue', text: 'Reviving a teammate takes a quarter less time.', max: 1 },
  quick_charge: { id: 'quick_charge', name: 'Quick charge', text: 'The Pulse Gun recharges 20 percent quicker.', max: 2 },
  hair_trigger: { id: 'hair_trigger', name: 'Hair trigger', text: 'The Pulse Gun recharges 35 percent quicker.', tradeoff: 'Every ghost warning is 1 second shorter.', max: 1 },
  loud_lamp: { id: 'loud_lamp', name: 'Loud lamp', text: 'Your light reaches 20 percent further.', tradeoff: 'Ghosts hear your noise from 15 percent further.', max: 1 },
};

/** The hard bounds of every effect, whatever the team owns. */
export const UPGRADE_BOUNDS = {
  visionMul: { min: 1, max: 1.3 },
  hearingMul: { min: 0.7, max: 1.3 },
  gunMul: { min: 0.45, max: 1 },
  rescueMul: { min: 0.75, max: 1 },
  extraSlots: { min: 0, max: 1 },
  /** Ticks added to every ghost warning (never below -20: with the 80-tick warning the 60-tick minimum always holds). */
  warningShift: { min: -20, max: 0 },
} as const;

export type Owned = Readonly<Partial<Record<UpgradeId, number>>>;
export interface UpgradeEffects { visionMul: number; hearingMul: number; gunMul: number; rescueMul: number; extraSlots: number; warningShift: number }
export const NO_EFFECTS: UpgradeEffects = { visionMul: 1, hearingMul: 1, gunMul: 1, rescueMul: 1, extraSlots: 0, warningShift: 0 };

const clamp = (v: number, b: { min: number; max: number }): number => Math.min(b.max, Math.max(b.min, v)) + 0; // + 0: never a negative zero
const n = (o: Owned, id: UpgradeId): number => Math.min(UPGRADES[id].max, Math.max(0, Math.floor(o[id] ?? 0)));

/** What a set of upgrades does, with every effect clamped to `UPGRADE_BOUNDS`. */
export function effectsOf(owned: Owned): UpgradeEffects {
  const B = UPGRADE_BOUNDS;
  return {
    visionMul: clamp((1 + 0.1 * n(owned, 'wide_beam')) * (1 + 0.2 * n(owned, 'loud_lamp')), B.visionMul),
    hearingMul: clamp(0.85 ** n(owned, 'soft_steps') * (1 + 0.15 * n(owned, 'loud_lamp')), B.hearingMul),
    gunMul: clamp(0.8 ** n(owned, 'quick_charge') * (1 - 0.35 * n(owned, 'hair_trigger')), B.gunMul),
    rescueMul: clamp(1 - 0.25 * n(owned, 'quick_rescue'), B.rescueMul),
    extraSlots: clamp(n(owned, 'extra_hand'), B.extraSlots),
    warningShift: clamp(-20 * n(owned, 'hair_trigger'), B.warningShift),
  };
}

/** Can another copy of this upgrade be taken? */
export function canTake(owned: Owned, id: UpgradeId): boolean { return n(owned, id) < UPGRADES[id].max; }

/** Every upgrade offered at this stage is new to the offer rule below. A stage-10 breach always offers the wide beam (docs/HOOK.md: "draft pick plus new flashlight"). */
export const DRAFT_SIZE = 3;

/**
 * The 3 upgrades offered after clearing `stage`: distinct, none at its cap, the ones the team owns least first (a newness rule), a seeded shuffle inside each group.
 * Fewer than 3 only when fewer than 3 can still be taken; an empty offer means the team has everything.
 */
export function draftOffer(runSeed: number, stage: number, owned: Owned): UpgradeId[] {
  const free = UPGRADE_IDS.filter((id) => canTake(owned, id));
  const order = createRng(deriveSeed(runSeed, 'draft', stage)).shuffle(free);
  const byOwned = order.map((id, i) => ({ id, i, c: n(owned, id) })).sort((a, b) => a.c - b.c || a.i - b.i).map((e) => e.id);
  const offer = byOwned.slice(0, DRAFT_SIZE);
  if (stage % 10 === 0 && canTake(owned, 'wide_beam') && !offer.includes('wide_beam')) offer[offer.length - 1] = 'wide_beam';
  return offer;
}

/** What the clients are told about the draft (in the room snapshot, to everyone). */
export const DraftPublicSchema = z.object({
  stage: z.number().int().min(1),
  options: z.array(z.object({ id: z.enum(UPGRADE_IDS), name: z.string().max(40), text: z.string().max(120), tradeoff: z.string().max(120).optional(), votes: z.number().int().min(0).max(8) })).max(DRAFT_SIZE),
  /** Set once the pick is made (everyone voted, or the host went on). */
  picked: z.enum(UPGRADE_IDS).optional(),
});
export type DraftPublic = z.infer<typeof DraftPublicSchema>;
export const OwnedUpgradesSchema = z.array(z.object({ id: z.enum(UPGRADE_IDS), count: z.number().int().min(1).max(2) })).max(UPGRADE_IDS.length);

/** The client's intent: vote for option `index` of the offer. */
export const DraftVoteSchema = z.object({ index: z.number().int().min(0).max(DRAFT_SIZE - 1) }).strict();
export type DraftVote = z.infer<typeof DraftVoteSchema>;

/** A tally: the option with most votes; a tie goes to the lowest index; no vote at all goes to option 0. */
export function tally(votes: readonly number[]): number {
  let best = 0;
  votes.forEach((v, i) => { if (v > (votes[best] ?? 0)) best = i; });
  return best;
}
