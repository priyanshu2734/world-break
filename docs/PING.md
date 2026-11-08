# PING.md: ping wheel, team panel and team chat (P6 workstream A)

Keys: **Tab** opens the team panel (states, carried COUNT, journal summary, a ping picker, mute buttons). **Hold Q** (220 ms) opens the ping wheel at the pointer: move toward a slot, release to ping the world point where you opened it. A short Q press is still "cancel". **Enter** opens the chat box (Enter sends, Esc closes). Esc cancels an armed ping.

## Pings (server-authoritative)
- Kinds (enum): key, danger, help, door, ghost, go, hide. Labels are fixed constants; a ping carries no code, safe, evidence or ghost type.
- Anchors: `point` kinds (key, danger, door, go) need a point that passes the pinger's OWN line of sight and light (`makeSeer`, pinned to `restrictedView` by a parity test). `help` and `hide` use the server's own position of the pinger (`hide` only while hiding). `ghost` snaps to the nearest ghost the pinger can SEE; if the ghost is only heard, it marks the pinger's own spot; otherwise refused.
- Limits: 6 s life, 3 live per player (oldest replaced), 12 per team, 1 s cooldown, 6 requests per 2 s (accepted or not), delivery queue bounded.
- Delivery: living, connected teammates only. Same room: position. Other room: room id + name + kind, never a position (client shows a label). The pinger gets an echo.
- Dead players cannot ping and receive no pings. They keep the existing G "ghost here" ping, unchanged. Spectator powers are not widened.
- Not re-sent on reconnect (markers last 6 s); the board clears when a stage starts.

## Chat
- Room scoped, any member in any phase (guests too; every player is a guest until P6 C). Server cleans (control, zero-width, bidi, tags, `<>`, NFKC), refuses empty or over 120 characters, 1 line per 1.5 s per player.
- Nothing is stored: lines are queued, sent and forgotten; only each sender's last-send time is kept, and the client keeps 24 lines in memory.
- **Decision: a dead player may chat**, marked `spectator`, at 1 line per 3 s. They hold no code, safe or solution (their stage view is blank; tested). What they could relay (where a ghost is) is what "ghost here" already tells the team. Accepted trait: free text can relay ghost whereabouts.
- Mute is client-side per player (Tab panel); a muted sender's lines are never stored; you cannot mute yourself.
- The client chat box is a DOM input that stops key events so typing never reaches game keys. Chat is available in GameScene only (no lobby UI yet, the server accepts it).

## Team panel
`team:panel` to one player, when changed (checked every 5 ticks) and at least once a second. States: alive, hiding, dead (downed body), spectating (eliminated), disconnected. Living viewers: carried COUNT per teammate and `journal {found, marked, lines}`. Dead viewers: names and states only.

## Files
shared `src/ping/index.ts`, protocol additions; server `src/social/**`, `room.ts` (`placePing`, `drainPingMarkers`, `chat`, `drainChat`, `teamPanel`), `gateway.ts`; client `ui/team/**`, `net/session.ts`, `GameScene`, `ui/escapeUse.ts`. Changed assertion: `client/test/hud.test.ts` (keys hint).
