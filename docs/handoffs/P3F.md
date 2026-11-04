# P3F handoff: variety and hook (STEPS 1 TO 5 of 6 delivered: room templates and height; the puzzle pool; identify the ghost; curriculum, second ghost, draft pick, loot; themes and look)

Baseline: `p4-complete` plus the step 6 playtest fixes (the uploaded `p5-base.zip`). Step 1: `927d8be`. Step 2: `3c632c0`. Step 3: `48a78f5`. Step 4: `b659d96` (verified by the developer after one fix, which is kept: `usePrompt(u, 0)` and `usePrompt(done, 0)` in `client/test/draftLogic.test.ts`; at that point shared 203, client 206, server 1312 with the gateway files, 1721 in all). Step 6 is not started; this file is rewritten at each step.

**Rule I broke in step 4 and now follow:** when a parameter is added to an exported function, every caller INCLUDING tests is updated. In step 5 I added optional trailing parameters (`calm`) to `ghostShape`, `ghostLook`, `GhostView`, `EscapeView`; all callers were searched (`grep`) and the new parameters have defaults.

## 1. Git branch and commit
Branch `phase/p3f`. Step 5: NOT RUN: developer to run `git rev-parse HEAD`. (No `.git` in my sandbox.)

## 2. Files changed (step 5)
Added: `shared/src/variety/themes.ts`; `client/src/ui/theme/{prims,propArt,themeLogic,evidenceArt,drawPrims,ThemeView,ThemeAudio}.ts`; tests `shared/test/themes.test.ts`, `client/test/{theme,evidenceArt,ghostTiers}.test.ts`, `server/test/rooms/theme.room.test.ts`.
Modified: `shared/src/{protocol.ts,variety/index.ts}` (optional `RoomSnapshot.theme`); `server/src/room.ts` (snapshot adds `theme`); `client/src/ui/ghost/{ghostLook,GhostView}.ts`, `client/src/ui/EscapeView.ts`, `client/src/scenes/GameScene.ts`; `client/test/draftLogic.test.ts` (your `usePrompt(.., 0)` fix kept); `docs/{VARIETY,ARCHITECTURE,polish/VISUAL_ISSUES}.md`; this file.
Not touched: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, shared `sim.ts`, `arena.ts`, client `prediction.ts`, the generator, the validators, any rule.

## 3. Commands run (my sandbox; no registry, so `npm ci` cannot run; stand-in test runner)
* After step 4 (yours): shared 203, client 206, server 1312 (with the 47 gateway tests), 1721 in all.
* Now: shared **212** (+9), client **225** (+19), server **1269** without the gateway files (+4), all 0 failed, run file by file. Expected on your machine: server **1316** (1269 + 47), total about **1753**.
* Typecheck: shared and server 0 errors apart from the stand-in artefacts (TS7006 on `it.each` callbacks, `test/disasters/runtime.test.ts`, gateway/`socket.io`). Client: checked with a temporary config without the Phaser and vite types: no error outside the missing-Phaser ones (the real client typecheck is yours).
* NOT RUN: `npm ci`, `npm run build`, the 8 gateway test files, the real client typecheck, any play in a browser. **None of the step 5 art was seen on a screen.** `git rev-parse HEAD`.

## 4. What is supported, and the tests behind it
| Claim | Tests |
|---|---|
| Four themes (lab, hospital, factory, library) as data: palette, props, hum; chosen by the seed and the newness score (never the previous theme, stage 1 is the lab, all four appear) | `shared/themes`, `server/rooms/theme.room` |
| The theme reaches the client only as the optional `RoomSnapshot.theme`, and is not part of the stage definition: no rule, draw, validator or solver reads it | `server/rooms/theme.room`, `shared/themes` |
| Colour language kept: theme colours are muted or far from red, amber, green and cyan; props at most alpha 0.4, behind everything, 3 to 14 per room, inside the room | `shared/themes`, `client/theme` |
| Props are pure functions of (theme, room, seed, size) with their own seeded stream | `shared/themes`, `client/theme` |
| Hum gain bounded (0.05); reduced motion stops the wobble and all motion; the brightness assist never darkens and strengthens props within the cap | `shared/themes`, `client/theme` |
| Ghost tiers: stage 25 is 1.7 times larger than stage 2 with an aura, scars, spikes, bigger eyes and a redder body, for all four looks; monotone up to stage 1,000,000 | `client/ghostTiers` |
| Unnamed ghost: a veiled figure matching no type, frays with the tier, hem frozen under reduced motion | `client/ghostTiers` |
| Evidence markers: identical smudge with cyan ring before examining (never tells the type), six different glyphs plus a green tick after, inside the glyph box, steady under reduced motion | `client/evidenceArt` |

## 5. Deliberately changed existing assertions
None. (The `calm` parameters are optional additions; `EscapeView` and `GhostView` constructors gained an optional second parameter.)

## 6. Interfaces to preserve
Step 4 list, plus: `THEMES`, `ThemeDef`, `propsFor`, `themeLook`, `themeColourOk`, `HUM_MAX_GAIN`, `PROP_MAX_ALPHA`, `RoomSnapshot.theme`, `lookFlags`, `roomDecor`, `evidencePrims`, `veiledBody`, `AURA_ALPHA`, `SCAR_COUNT`, the `calm` parameters. A theme must stay data: never read by the server's rules.

## 7. Known issues and limits
* Nothing of step 5 has been seen in a browser: the props, the wash, the hum, the aura and scars, the veiled ghost and the glyphs may need tuning for readability, scale and taste.
* The props are background only; they do not follow the room's template (a bench may float where a platform stands). They are at low alpha and behind everything for that reason.
* The theme hum is a simple oscillator; there is no per-theme sound design beyond pitch, wave, a partial and a slow wobble.
* The theme is sent with the room snapshot at each stage start; a client that reconnects mid-stage gets it with the next snapshot.
* Lab and the old demo stages have no theme and keep the old backdrop.
* VISUAL_ISSUES.md: the yellow zigzag is hidden under themes; the ability slot overflow, message log overlap, disaster panel and stacked-label items are NOT fixed (outside P3F's files). Stage 1 container hint belongs to P3G.
* Step 4's limits still stand (stage 2 and 3 exemptions, the cache is not its own room, etc.).

## 8. Env vars, DB changes
None. New URL flag `?reducemotion=1` (client only).

## 9. Files the next step may modify
Step 6 (solver, drills, docs): `server/test/rooms/solver.ts`, `server/test/death/drill.ts`, `server/test/rooms/bot.ts`, the generator only to fix a stage that cannot be solved, `docs/VARIETY.md`, `docs/ARCHITECTURE.md`, this file. Do not touch the frozen files.

## 10. Outstanding acceptance criteria
Step 6. For step 5 the open items are your own `npm ci`, typecheck, test and build run, and a look in the browser at: each of the four themes, the veiled ghost (from stage 7), a stage 25 ghost against a stage 2 one, the evidence markers before and after examining, reduced motion (`?reducemotion=1`) and the brightness assist (B).
