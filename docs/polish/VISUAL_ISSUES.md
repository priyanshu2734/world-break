# Visual issues observed in playtests (for P3E / P7A)
- Ability slot text overflows its box (cost and "no energy" collide with the next slot).
- Message log overlaps world labels and player name; too many lines at once.
- Yellow zigzag background line (P1 decoration) competes with real conduits and hazards.
- Disaster panel can cover world labels (arc discharge label hidden).
- Labels for stacked objects overlap.
- Everything uses the same font weight and colour; need clear hierarchy (danger red, interactive cyan, hidden amber, repaired green).
- Escape stage 1 (?rooms=1): new player took the visible cracked decoy key and was stuck; the real key is in an unmarked locker. Stage 1 should teach "containers hold things" first (faint glow or prompt on containers) and the failure message should hint at the next step. Decoys belong after the first lesson. (for P3G onboarding)

## Status after P3F step 5
* **Yellow zigzag background line:** FIXED for escape stages. A stage with a theme hides the P1 shards and the amber fracture; the theme draws its own faint wash and props behind everything. The lab and the old demo stages keep the old backdrop. (Not seen in a browser.)
* **Same weight and colour for everything / hierarchy:** the colour language is kept and enforced for the new art: theme colours are muted (`THEME_MAX_CHROMA`) or far from the red, amber, green and cyan hues; props are capped at alpha 0.4 and sit behind the platforms, world objects, hazards and players. Evidence markers use cyan for "not examined yet" and green for "done". (Tested; not seen in a browser.)
* **Ability slot text overflow, message log overlapping world labels, disaster panel covering labels, labels of stacked objects overlapping:** NOT FIXED in P3F (they belong to the ability HUD and the disaster panel, which P3F does not touch). Evidence labels moved up so they do not sit on the trace itself.
* **Stage 1 containers (P3G onboarding):** untouched.
