import { AuthConfigSchema, AuthSessionSchema, COSMETIC_IDS, type AuthConfig, type AuthSession, type CosmeticId, type Difficulty, type Profile } from '@wb/shared';

/**
 * P6 C: the client side of accounts, as pure functions (docs/PROGRESSION.md). The browser only ever holds the server's own short-lived session token and
 * shows what the server says; it never computes or submits a stage, score, unlock or save.
 */

export interface TokenStore { get(): string | null; set(token: string | null): void }
/** The token lives in sessionStorage (gone when the tab closes), with an in-memory fallback if storage is blocked. */
export function browserTokenStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof sessionStorage !== 'undefined' ? sessionStorage : null): TokenStore {
  let mem: string | null = null;
  const KEY = 'wb_session';
  return {
    get() { try { return storage?.getItem(KEY) ?? mem; } catch { return mem; } },
    set(t) { mem = t; try { if (t === null) storage?.removeItem(KEY); else storage?.setItem(KEY, t); } catch { /* blocked storage: memory only */ } },
  };
}

type Fetch = typeof fetch;
const post = (f: Fetch, path: string, body?: unknown, token?: string | null) => f(path, {
  method: 'POST', credentials: 'include',
  headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

/** What the server offers (`off`: guests only). A network failure counts as `off`: the game never depends on sign-in. */
export async function fetchAuthConfig(f: Fetch = fetch): Promise<AuthConfig> {
  try {
    const r = await f('/auth/config', { credentials: 'include' });
    const p = AuthConfigSchema.safeParse(await r.json());
    return p.success ? p.data : { mode: 'off' };
  } catch { return { mode: 'off' }; }
}
export type SignInResult = { ok: true; session: AuthSession } | { ok: false; error: string };
async function sessionFrom(r: Response): Promise<SignInResult> {
  let body: unknown;
  try { body = await r.json(); } catch { return { ok: false, error: 'The server sent something unexpected.' }; }
  if (r.ok) { const s = AuthSessionSchema.safeParse(body); return s.success ? { ok: true, session: s.data } : { ok: false, error: 'The server sent something unexpected.' }; }
  const e = (body as { error?: unknown } | null)?.error;
  return { ok: false, error: typeof e === 'string' ? e.slice(0, 200) : 'Sign-in failed.' };
}
/** Hand the provider's credential (a Google ID token, or in dev mode a display name) to the server; get the server's own session token back. */
export async function signIn(credential: string, f: Fetch = fetch): Promise<SignInResult> {
  try { return await sessionFrom(await post(f, '/auth/login', { credential })); } catch { return { ok: false, error: 'Could not reach the server.' }; }
}
export async function refreshSession(token: string, f: Fetch = fetch): Promise<SignInResult> {
  try { return await sessionFrom(await post(f, '/auth/refresh', undefined, token)); } catch { return { ok: false, error: 'Could not reach the server.' }; }
}
export async function signOut(f: Fetch = fetch): Promise<void> { try { await post(f, '/auth/logout'); } catch { /* the token is dropped locally anyway */ } }
/** "Delete my account and data". True when the server says it is done. */
export async function deleteAccount(token: string, f: Fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await f('/auth/account', { method: 'DELETE', credentials: 'include', headers: { Authorization: `Bearer ${token}` } });
    return r.ok ? { ok: true } : { ok: false, error: 'Could not delete the account right now.' };
  } catch { return { ok: false, error: 'Could not reach the server.' }; }
}

// ---------------------------------------------------------------- what the lobby shows

const MODE_NAME: Readonly<Record<Difficulty, string>> = { easy: 'Easy', intermediate: 'Intermediate', hardcore: 'Hardcore' };
export const modeName = (d: Difficulty): string => MODE_NAME[d];
export const REWARD_NAMES: Readonly<Record<CosmeticId, string>> = {
  trail_cyan: 'Cyan trail', trail_amber: 'Amber trail', trail_violet: 'Violet trail', halo_ring: 'Ring halo', halo_shard: 'Shard halo', visor_scan: 'Scan visor',
  visor_wide: 'Wide visor', badge_relay: 'Relay badge', badge_breaker: 'Breaker badge', spark_gold: 'Gold sparks', spark_ember: 'Ember sparks', aura_void: 'Void aura',
};
export const rewardName = (id: CosmeticId): string => REWARD_NAMES[id];

/** The next unlock a player is working towards, from the server's own thresholds (never a number of ours). */
export function nextUnlockLine(p: Profile, unlockStages: Readonly<Record<Difficulty, number>>): string | null {
  for (const d of ['intermediate', 'hardcore'] as const) if (!p.unlocked.includes(d)) return `${modeName(d)} unlocks at stage ${unlockStages[d]} (you have reached ${p.highestStage})`;
  return null;
}

/** The text of the profile panel. A guest is invited to sign in; a signed-in player sees their own numbers; a down store is said plainly. */
export function profileLines(p: Profile | null, unlockStages: Readonly<Record<Difficulty, number>>): string[] {
  if (!p) return ['Connecting…'];
  if (!p.signedIn) {
    return [
      p.storage === 'down' ? 'PROGRESS IS NOT BEING SAVED (storage is unavailable). You can still play.' : 'Playing as a guest: nothing is saved.',
      'Sign in to keep your progress and unlock harder modes.',
    ];
  }
  const out = [`${p.name ?? 'Player'}   best stage reached ${p.highestStage}`, `Modes: ${p.unlocked.map(modeName).join(', ')}`];
  const next = nextUnlockLine(p, unlockStages);
  if (next) out.push(next);
  out.push(p.rewards.length > 0 ? `Rewards: ${p.rewards.map(rewardName).join(', ')}` : 'Rewards: none yet (one cosmetic at every 10th stage)');
  if (p.storage === 'down') out.push('PROGRESS IS NOT BEING SAVED right now (storage is unavailable).');
  return out;
}

/** What the host can start. `continueLabel` is null when there is nothing to continue (guest host, no save, or a host who is not you). */
export function continueLabel(p: Profile | null, isHost: boolean): string | null {
  const s = p?.room?.hostSave;
  if (!p || !isHost || !s || !p.room?.hostSignedIn) return null;
  return `Continue stage ${s.stage} (${modeName(s.mode)})`;
}
export function runChoiceLine(p: Profile | null): string {
  const r = p?.room;
  if (!r) return '';
  if (r.choice === 'continue' && r.hostSave) return `Starting from the host's save: stage ${r.hostSave.stage}`;
  return r.hostSignedIn ? 'Starting a new run at stage 1' : 'Host is a guest: nothing will be saved this run';
}
export const allCosmetics = (): readonly CosmeticId[] => COSMETIC_IDS;

/** The one token store of this tab (the session and the lobby share it). */
export const sessionTokens: TokenStore = browserTokenStore();
