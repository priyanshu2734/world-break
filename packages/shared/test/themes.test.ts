import { describe, expect, it } from 'vitest';
import { HUM_MAX_GAIN, PROPS_PER_ROOM_MAX, PROP_MAX_ALPHA, RoomSnapshotSchema, THEMES, THEME_IDS, hueChroma, propsFor, themeColourOk, themeLook, themeOrLab, themeForStage, type ThemeDef, type ThemeId } from '../src';

/** P3F step 5: the themes are data, keep the colour language, and never touch a rule. */
const colours = (d: ThemeDef): number[] => [d.wash, d.slab, d.edge, d.line, d.prop, d.propDark, d.propLight];

describe('P3F step 5: the theme data', () => {
  it('there are at least four themes: lab, hospital, factory, library, each with props and a hum', () => {
    expect([...THEME_IDS]).toEqual(['lab', 'hospital', 'factory', 'library']);
    for (const id of THEME_IDS) {
      const d = THEMES[id];
      expect(d.id).toBe(id);
      expect(d.props.length).toBeGreaterThanOrEqual(4);
      expect(d.hum.hz).toBeGreaterThan(20);
      expect(d.hum.gain).toBeGreaterThan(0);
      expect(d.hum.gain).toBeLessThanOrEqual(HUM_MAX_GAIN);
    }
    expect(new Set(THEME_IDS.map((id) => THEMES[id].hum.hz)).size).toBe(4); // four different hums
    expect(new Set(THEME_IDS.map((id) => THEMES[id].prop)).size).toBe(4);   // four different palettes
  });
  it('every colour of every theme is muted or far from red, amber, green and cyan (the colour language is kept)', () => {
    for (const id of THEME_IDS) for (const c of colours(THEMES[id])) expect(themeColourOk(c), `${id} ${c.toString(16)}`).toBe(true);
    expect(themeColourOk(0xff4d4d)).toBe(false); // danger red
    expect(themeColourOk(0x3de8ff)).toBe(false); // interactive cyan
    expect(themeColourOk(0xffb02e)).toBe(false); // clue amber
    expect(themeColourOk(0x6dffb0)).toBe(false); // done green
    expect(hueChroma(0x000000)).toEqual({ hue: 0, chroma: 0 });
  });
  it('an unknown or missing theme is the lab', () => {
    expect(themeOrLab(undefined).id).toBe('lab');
    expect(themeOrLab('swamp').id).toBe('lab');
    expect(themeOrLab('library').id).toBe('library');
  });
});

describe('P3F step 5: procedural props', () => {
  const W = 2240, H = 720, FLOOR = 680;
  it('are a pure function of (theme, room, seed, size)', () => {
    for (const id of THEME_IDS) expect(propsFor(id, 'r0', 7, W, H, FLOOR)).toEqual(propsFor(id, 'r0', 7, W, H, FLOOR));
    expect(propsFor('lab', 'r0', 7, W, H, FLOOR)).not.toEqual(propsFor('lab', 'r1', 7, W, H, FLOOR));
    expect(propsFor('lab', 'r0', 7, W, H, FLOOR)).not.toEqual(propsFor('lab', 'r0', 8, W, H, FLOOR));
  });
  it('are bounded: 3 to 14 per room, all inside the room, only the theme\'s own kinds, alpha never above the cap', () => {
    for (const id of THEME_IDS) for (const width of [1920, 2240, 2560, 1000]) for (let seed = 1; seed <= 20; seed++) {
      const ps = propsFor(id, `room${seed}`, seed, width, H, FLOOR);
      expect(ps.length).toBeGreaterThanOrEqual(3);
      expect(ps.length).toBeLessThanOrEqual(PROPS_PER_ROOM_MAX);
      for (const p of ps) {
        expect(THEMES[id].props).toContain(p.kind);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + p.w).toBeLessThanOrEqual(width);
        expect(p.y).toBeLessThanOrEqual(FLOOR);
        expect(p.y - p.h).toBeGreaterThanOrEqual(0);
        expect(p.alpha).toBeGreaterThan(0);
        expect(p.alpha).toBeLessThanOrEqual(PROP_MAX_ALPHA);
      }
    }
  });
  it('work for a stage seed of stage 1,000,000 and never throw on odd input', () => {
    expect(propsFor('factory', 'e1000000.r0', 1_000_000, W, H, FLOOR).length).toBeGreaterThanOrEqual(3);
    expect(() => propsFor('library', '', 0, 100, 100, 90)).not.toThrow();
  });
});

describe('P3F step 5: the look under the player\'s settings', () => {
  it('reduced motion stops the hum wobble and all motion; the brightness assist never makes a room darker and strengthens props', () => {
    for (const id of THEME_IDS) {
      const base = themeLook(id, { reducedMotion: false, assist: false });
      const calm = themeLook(id, { reducedMotion: true, assist: false });
      const bright = themeLook(id, { reducedMotion: false, assist: true });
      expect(calm.motion).toBe(false);
      expect(calm.humWobble).toBe(0);
      expect(base.motion).toBe(true);
      expect(bright.washAlpha).toBeLessThanOrEqual(base.washAlpha);
      expect(bright.propAlphaMul).toBeGreaterThanOrEqual(base.propAlphaMul);
      expect(bright.humGain).toBe(base.humGain);
      expect(base.humGain).toBeLessThanOrEqual(HUM_MAX_GAIN);
    }
  });
});

describe('P3F step 5: the theme in the room snapshot', () => {
  const snap = { code: 'ABCD', phase: 'playing', difficulty: 'easy', stage: 3, highestStage: 3, hostId: 'p0', maxPlayers: 4, players: [] };
  it('is optional, additive, and only one of the four ids', () => {
    expect(RoomSnapshotSchema.safeParse(snap).success).toBe(true);
    for (const id of THEME_IDS) expect(RoomSnapshotSchema.safeParse({ ...snap, theme: id }).success).toBe(true);
    expect(RoomSnapshotSchema.safeParse({ ...snap, theme: 'swamp' }).success).toBe(false);
  });
  it('the stage\'s theme is the newness pick: never the previous one, stage 1 is the lab', () => {
    expect(themeForStage(1, 5)).toBe('lab');
    let prev: ThemeId = 'lab';
    const history: { stage: number; locks: string[]; templates: string[]; ghosts: never[]; theme: ThemeId }[] = [];
    for (let s = 2; s <= 40; s++) {
      const t = themeForStage(s, 11, history);
      expect(t).not.toBe(prev);
      history.push({ stage: s, locks: [], templates: [], ghosts: [], theme: t });
      prev = t;
    }
    expect(new Set(history.map((h) => h.theme)).size).toBe(4);
  });
});
