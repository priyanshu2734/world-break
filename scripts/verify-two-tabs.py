"""
Real-browser multiplayer verification for P1.
Requires: server on :3001 and `vite` dev server on :5173 (debug hook is dev-build only).
Two INDEPENDENT browser contexts (separate storage/sockets) join one room.
Usage: python3 scripts/verify-two-tabs.py [outdir]
"""
import sys, time, json
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5173/"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/p1-shots"
import os; os.makedirs(OUT, exist_ok=True)

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS  " if cond else "FAIL  ") + name + (f"   [{detail}]" if detail else ""))

def state(page):
    return page.evaluate("() => window.__WB_DEBUG__ ? window.__WB_DEBUG__.state() : null")

def wait_for(page, pred_js, timeout=8000, what=""):
    page.wait_for_function(pred_js, timeout=timeout)

def player(st, pid):
    return next((p for p in st["players"] if p["id"] == pid), None)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctxA = browser.new_context(viewport={"width": 1280, "height": 720})
    ctxB = browser.new_context(viewport={"width": 1280, "height": 720})
    A, B = ctxA.new_page(), ctxB.new_page()
    errors = {"A": [], "B": []}
    for tag, pg in (("A", A), ("B", B)):
        pg.on("pageerror", lambda e, t=tag: errors[t].append(str(e)))
        pg.on("console", lambda m, t=tag: errors[t].append(m.text) if m.type == "error" else None)

    # --- lobby: A creates, B joins by URL hash ---
    A.goto(BASE)
    A.wait_for_function("() => /^#[A-Z0-9]{4}$/.test(location.hash)", timeout=10000)
    code = A.evaluate("() => location.hash.slice(1)")
    B.goto(BASE + "#" + code)
    time.sleep(1.2)
    check("B joined A's room code (separate browser contexts)", B.evaluate("() => location.hash.slice(1)") == code, code)
    A.screenshot(path=f"{OUT}/01-lobby-A.png")

    # --- start flow: guest readies, host starts ---
    B.click("canvas"); B.keyboard.press("r")
    time.sleep(0.5)
    A.click("canvas"); A.keyboard.press("Enter")

    for pg in (A, B):
        wait_for(pg, "() => window.__WB_DEBUG__ && window.__WB_DEBUG__.state().phase !== null", 10000)
    a0, b0 = state(A), state(B)
    check("both tabs entered gameplay from the lobby", a0 and b0, f"A={a0['phase']} B={b0['phase']}")
    check("briefing countdown shown before play", a0["phase"] in ("briefing", "playing"))
    A.screenshot(path=f"{OUT}/02-briefing-A.png")
    for pg in (A, B):
        wait_for(pg, "() => window.__WB_DEBUG__.state().phase === 'playing'", 10000)
    a, b = state(A), state(B)
    idA, idB = a["localId"], b["localId"]
    check("two distinct player ids", idA != idB and idA and idB)
    check("each tab sees 2 players", len(a["players"]) == 2 and len(b["players"]) == 2)
    check("local flags are opposite across tabs", player(a, idA)["isLocal"] and not player(a, idB)["isLocal"]
          and player(b, idB)["isLocal"] and not player(b, idA)["isLocal"])
    check("host is tab A", a["hostId"] == idA)
    check("distinct slots / spawns", player(a, idA)["slot"] != player(a, idB)["slot"]
          and player(a, idA)["serverX"] != player(a, idB)["serverX"])
    spawnB_x = player(a, idB)["serverX"]

    # --- synchronized movement: B holds right; A must see B move ---
    B.click("canvas")
    B.keyboard.down("ArrowRight")
    mids = []  # A's RENDERED x of B across many frames while B is moving
    t0 = time.time()
    while time.time() - t0 < 1.6:
        mids.append(player(state(A), idB)["renderX"]); time.sleep(0.1)
    B.keyboard.up("ArrowRight")
    # settle: wait until B's authoritative X has been stable for 1.5s (slow software-rendered tabs need time to draw it)
    stable, last = 0, None
    t0 = time.time()
    while stable < 6 and time.time() - t0 < 12:
        x = player(state(A), idB)["serverX"]
        stable = stable + 1 if x == last else 0
        last = x; time.sleep(0.25)
    a1, b1 = state(A), state(B)
    bx_in_A, bx_in_B = player(a1, idB)["serverX"], player(b1, idB)["serverX"]
    check("B moved right on the authoritative server (seen by A)", bx_in_A > spawnB_x + 120, f"{spawnB_x} -> {bx_in_A}")
    check("A and B agree on B's authoritative position", abs(bx_in_A - bx_in_B) < 0.5, f"A:{bx_in_A} B:{bx_in_B}")
    check("A's RENDERED view of B settles exactly on the server (interpolation)", abs(player(a1, idB)["renderX"] - bx_in_A) < 1,
          f"render {player(a1, idB)['renderX']:.1f} vs server {bx_in_A}")
    check("B's local (predicted) render settles exactly on the server", abs(player(b1, idB)["renderX"] - bx_in_B) < 1,
          f"render {player(b1, idB)['renderX']:.1f} vs server {bx_in_B}")
    check("A did not move (B's input moved only B)", abs(player(a1, idA)["serverX"] - player(a, idA)["serverX"]) < 0.5)
    inter = sorted({round(v) for v in mids if spawnB_x + 5 < v < bx_in_A - 5})
    check("A saw B travel through intermediate positions, monotonically (not a teleport; sandbox renders only 3-4 FPS)",
          len(inter) >= 2 and mids == sorted(mids), f"{len(inter)} distinct intermediate x, first few {inter[:5]}")

    # --- jump: A jumps; B must see A leave the ground ---
    A.click("canvas")
    A.keyboard.down("Space")
    min_y = 1e9
    t0 = time.time()
    while time.time() - t0 < 0.7:
        st = state(B); y = player(st, idA)["serverY"]; min_y = min(min_y, y); time.sleep(0.02)
    A.keyboard.up("Space")
    floor_y = 680
    check("A's jump is visible on B (server Y rose above floor)", min_y < floor_y - 40, f"min Y seen by B: {min_y}")
    time.sleep(1.0)
    B.screenshot(path=f"{OUT}/03-playing-B.png")
    A.screenshot(path=f"{OUT}/04-playing-A.png")

    # --- boundary: A walks left into the wall ---
    A.keyboard.down("ArrowLeft"); time.sleep(1.6); A.keyboard.up("ArrowLeft"); time.sleep(0.4)
    ax = player(state(B), idA)["serverX"]
    check("A is held at the world boundary (x = half player width)", abs(ax - 14) < 0.5, f"x={ax}")

    # --- reset: host holds R ---
    epoch_before = state(A)["epoch"]
    A.keyboard.down("r"); time.sleep(1.4); A.keyboard.up("r")
    for pg in (A, B):
        wait_for(pg, f"() => window.__WB_DEBUG__.state().epoch === {epoch_before + 1}", 6000)
    time.sleep(0.5)
    ra, rb = state(A), state(B)
    for st, name in ((ra, "A"), (rb, "B")):
        ok = all(abs(p["serverX"] - (90 if p["slot"] == 0 else 435)) < 0.5 and abs(p["serverY"] - 680) < 0.5 for p in st["players"])
        check(f"reset restored spawn positions on tab {name}", ok, json.dumps([(p['slot'], p['serverX']) for p in st['players']]))
    A.screenshot(path=f"{OUT}/05-after-reset-A.png")

    # guest cannot reset
    ep = state(B)["epoch"]
    B.click("canvas"); B.keyboard.down("r"); time.sleep(1.4); B.keyboard.up("r"); time.sleep(0.6)
    check("non-host hold-R does NOT reset", state(A)["epoch"] == ep)

    # --- disconnect: close B's context entirely ---
    ctxB.close()
    wait_for(A, f"() => window.__WB_DEBUG__.state().players.some(p => !p.connected)", 8000)
    st = state(A)
    check("A sees B as disconnected (and B still listed)", len(st["players"]) == 2 and not player(st, idB)["connected"])
    A.screenshot(path=f"{OUT}/06-B-disconnected-A.png")

    # reset drops the disconnected player
    A.click("canvas"); A.keyboard.down("r"); time.sleep(1.4); A.keyboard.up("r")
    wait_for(A, "() => window.__WB_DEBUG__.state().players.length === 1", 6000)
    check("reset removes the disconnected player; solo run continues", len(state(A)["players"]) == 1)

    check("no console/page errors on tab A", not errors["A"], "; ".join(errors["A"][:3]))
    check("no console/page errors on tab B", not errors["B"], "; ".join(errors["B"][:3]))
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
