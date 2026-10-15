# WORLD//BREAK: THE REALITY RELAY
    npm install
    npm run dev:server   # :3001
    npm run dev:client   # :5173, open in 2+ tabs to test multiplayer (room code is in the URL hash)
    npm run typecheck && npm test
See docs/ARCHITECTURE.md.

## Controls (in game)
A/D or arrows move, W/Space/Up jump, hold R (host only) to reset the arena.
E interact with the nearest console/breaker/cache, 1-5 use Scanner/Welder/Anchor/Cell/Projector, Q cancel a repair.

## Browser verification (needs server on :3001, `npm run dev:client` on :5173, Python Playwright + Chromium)
    python3 scripts/verify-two-tabs.py
See docs/P1_HANDOFF.md for the P1 report.

## Repair-chain browser verification (P2)
    npx tsx scripts/export-nav.ts > /tmp/nav.json      # navigation edges from the real physics
    # start the server (:3001) and `npm run dev:client` (:5173), make sure no STALE server holds the port, then:
    python3 scripts/verify-repair-chain.py
Uses `?renderer=canvas` (headless Chromium runs ~60 FPS with it versus ~10 FPS with software WebGL).
