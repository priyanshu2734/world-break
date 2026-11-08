import { describe, expect, it } from 'vitest';
import { COSMETIC_IDS, DIFFICULTY_UNLOCK_STAGE, guestProfile, type Profile } from '@wb/shared';
import {
  REWARD_NAMES, browserTokenStore, continueLabel, deleteAccount, fetchAuthConfig, nextUnlockLine, profileLines, refreshSession, runChoiceLine, signIn, signOut,
} from '../src/ui/account/accountLogic';

const signed = (o: Partial<Profile> = {}): Profile => ({ signedIn: true, name: 'Ann', highestStage: 12, unlocked: ['easy', 'intermediate'], rewards: ['trail_cyan'], save: { stage: 12, mode: 'easy' }, storage: 'ok', ...o });
const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
const validSession = { token: 'wb1.a.b', expiresAt: 5, profile: signed() };

describe('P6 C token store', () => {
  const fake = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
  it('keeps the token in session storage and forgets it on set(null)', () => {
    const f = fake(); const s = browserTokenStore(f);
    expect(s.get()).toBeNull();
    s.set('tok'); expect(s.get()).toBe('tok'); expect(f.m.get('wb_session')).toBe('tok');
    s.set(null); expect(s.get()).toBeNull(); expect(f.m.has('wb_session')).toBe(false);
  });
  it('falls back to memory when storage is blocked, and never throws', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    const s = browserTokenStore(blocked);
    expect(() => s.set('t')).not.toThrow();
    expect(s.get()).toBe('t');
    s.set(null); expect(s.get()).toBeNull();
    const none = browserTokenStore(null); none.set('x'); expect(none.get()).toBe('x');
  });
});

describe('P6 C talking to the server', () => {
  it('config: reads the mode; any failure means guests only (the game never depends on sign-in)', async () => {
    expect(await fetchAuthConfig(reply(200, { mode: 'google', googleClientId: 'id' }))).toEqual({ mode: 'google', googleClientId: 'id' });
    expect(await fetchAuthConfig(reply(200, { mode: 'weird' }))).toEqual({ mode: 'off' });
    expect(await fetchAuthConfig((async () => { throw new Error('offline'); }) as typeof fetch)).toEqual({ mode: 'off' });
  });
  it('sign-in: returns the validated session, or the server’s short error, or a network message', async () => {
    const ok = await signIn('Ann', reply(200, validSession));
    expect(ok.ok).toBe(true);
    expect(await signIn('x', reply(401, { error: 'Sign-in failed.' }))).toEqual({ ok: false, error: 'Sign-in failed.' });
    expect(await signIn('x', reply(503, { error: 'Progress storage is unavailable right now. You can still play as a guest.' }))).toMatchObject({ ok: false, error: expect.stringMatching(/guest/) });
    expect(await signIn('x', reply(200, { token: 5 }))).toEqual({ ok: false, error: 'The server sent something unexpected.' });
    expect(await signIn('x', (async () => { throw new Error('offline'); }) as typeof fetch)).toEqual({ ok: false, error: 'Could not reach the server.' });
    expect(await signIn('x', (async () => new Response('<html>', { status: 502 })) as typeof fetch)).toEqual({ ok: false, error: 'The server sent something unexpected.' });
  });
  it('sends the credential only in a JSON body to /auth/login, with credentials, and the token only as a Bearer header', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const spy = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify(validSession), { status: 200 }); }) as unknown as typeof fetch;
    await signIn('Ann', spy); await refreshSession('tok', spy); await signOut(spy); await deleteAccount('tok', spy);
    expect(seen.map((s) => [s.init.method, s.url])).toEqual([['POST', '/auth/login'], ['POST', '/auth/refresh'], ['POST', '/auth/logout'], ['DELETE', '/auth/account']]);
    expect(seen[0]!.init.body).toBe(JSON.stringify({ credential: 'Ann' }));
    expect((seen[1]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect((seen[3]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(seen.every((s) => s.init.credentials === 'include' || s.url === '/auth/account')).toBe(true);
  });
  it('delete: true only when the server says so', async () => {
    expect(await deleteAccount('t', reply(200, { ok: true }))).toEqual({ ok: true });
    expect((await deleteAccount('t', reply(401, {}))).ok).toBe(false);
    expect((await deleteAccount('t', (async () => { throw new Error('x'); }) as typeof fetch)).ok).toBe(false);
  });
});

describe('P6 C what the lobby shows', () => {
  const U = DIFFICULTY_UNLOCK_STAGE;
  it('a guest is told nothing is saved and invited to sign in; a down store says progress is not being saved', () => {
    expect(profileLines(guestProfile(), U).join(' ')).toMatch(/guest.*nothing is saved/i);
    expect(profileLines(guestProfile(), U).join(' ')).toMatch(/Sign in/);
    expect(profileLines({ ...guestProfile(), storage: 'down' }, U).join(' ')).toMatch(/NOT BEING SAVED/);
    expect(profileLines(null, U)).toEqual(['Connecting…']);
  });
  it('a signed-in player sees their best stage, their modes, what unlocks next (from the shared thresholds) and their rewards', () => {
    const t = profileLines(signed(), U).join('\n');
    expect(t).toContain('Ann   best stage reached 12');
    expect(t).toContain('Modes: Easy, Intermediate');
    expect(t).toContain(`Hardcore unlocks at stage ${U.hardcore} (you have reached 12)`);
    expect(t).toContain('Rewards: Cyan trail');
    expect(profileLines(signed({ rewards: [], unlocked: ['easy', 'intermediate', 'hardcore'] }), U).join('\n')).toContain('Rewards: none yet');
    expect(nextUnlockLine(signed({ unlocked: ['easy', 'intermediate', 'hardcore'] }), U)).toBeNull();
    expect(profileLines(signed({ storage: 'down' }), U).join('\n')).toMatch(/NOT BEING SAVED/);
  });
  it('every cosmetic has a readable name', () => { for (const id of COSMETIC_IDS) expect(REWARD_NAMES[id].length).toBeGreaterThan(3); });
  it('Continue is offered only to the host, only when the host is signed in and has a save', () => {
    const p = signed({ room: { allowed: ['easy', 'intermediate'], hostSave: { stage: 12, mode: 'intermediate' }, choice: 'new', hostSignedIn: true } });
    expect(continueLabel(p, true)).toBe('Continue stage 12 (Intermediate)');
    expect(continueLabel(p, false)).toBeNull();
    expect(continueLabel(signed({ room: { allowed: ['easy'], hostSave: null, choice: 'new', hostSignedIn: true } }), true)).toBeNull();
    expect(continueLabel(signed({ room: { allowed: ['easy'], hostSave: { stage: 3, mode: 'easy' }, choice: 'new', hostSignedIn: false } }), true)).toBeNull();
    expect(continueLabel(null, true)).toBeNull();
    expect(continueLabel(guestProfile(), true)).toBeNull();
  });
  it('says what the run will start from', () => {
    const base = { allowed: ['easy'] as Profile['unlocked'], hostSave: { stage: 12, mode: 'easy' as const } };
    expect(runChoiceLine(signed({ room: { ...base, choice: 'continue', hostSignedIn: true } }))).toBe("Starting from the host's save: stage 12");
    expect(runChoiceLine(signed({ room: { ...base, choice: 'new', hostSignedIn: true } }))).toBe('Starting a new run at stage 1');
    expect(runChoiceLine(signed({ room: { allowed: ['easy'], hostSave: null, choice: 'new', hostSignedIn: false } }))).toMatch(/guest/);
    expect(runChoiceLine(null)).toBe('');
  });
});
