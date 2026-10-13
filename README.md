# WORLD//BREAK: THE REALITY RELAY
    npm install
    npm run dev:server   # :3001
    npm run dev:client   # :5173, open in 2+ tabs to test multiplayer (room code is in the URL hash)
    npm run typecheck && npm test
See docs/ARCHITECTURE.md.

## Controls (in game)
A/D or arrows move, W/Space/Up jump, hold R (host only) to reset the arena.

## Browser verification (needs server on :3001, `npm run dev:client` on :5173, Python Playwright + Chromium)
    python3 scripts/verify-two-tabs.py
See docs/P1_HANDOFF.md for the P1 report.
