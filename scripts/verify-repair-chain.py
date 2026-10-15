"""
Real-browser verification of the P2 tutorial repair chain.
Needs: server on :3001, `npm run dev:client` on :5173, python playwright + chromium, /tmp/nav.json from
`npx tsx scripts/export-nav.ts > /tmp/nav.json`.
Two INDEPENDENT browser contexts join one room. Player A walks the real arena (scripted movement through the
dev-only __WB_DEBUG__.setInput hook; the game still predicts and sends inputs to the server) and performs every
repair with REAL KEY PRESSES (E, 1-5). Player B only observes, to verify shared state.
Uses ?renderer=canvas (60 FPS headless; software WebGL manages ~10).
"""
import sys, time, json, os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5173/?renderer=canvas"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/p2-shots"
os.makedirs(OUT, exist_ok=True)
NAV = json.load(open("/tmp/nav.json"))
SOLIDS, EDGES = NAV["solids"], NAV["edges"]
HW = 14
results = []

def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS  " if cond else "FAIL  ") + name + (f"   [{detail}]" if detail else ""), flush=True)

# ------------------------------------------------------------------ page helpers
def dbg(pg):
    return pg.evaluate("() => window.__WB_DEBUG__.state()")
def me(pg):
    return next(p for p in dbg(pg)["players"] if p["isLocal"])
def stage(pg):
    return dbg(pg)["stage"]
def set_input(pg, mx, jump=False):
    pg.evaluate("([m,j]) => window.__WB_DEBUG__.setInput({moveX:m, jump:j})", [mx, jump])
def wait_for(pg, fn, timeout=20.0, what=""):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = fn()
        if v: return v
        time.sleep(0.05)
    raise TimeoutError(what or "wait_for timed out")
def press(pg, key, hold=0.14):
    pg.keyboard.down(key); time.sleep(hold); pg.keyboard.up(key); time.sleep(0.08)
def sym(st, i): return next(s["state"] for s in st["symptoms"] if s["id"] == i)
def obj(st, i): return next(o["status"] for o in st["objectives"] if o["id"] == i)
def ent(st, i): return next(e for e in st["entities"] if e["id"] == i)

def platform_under(x, y):
    for i, s in enumerate(SOLIDS):
        if abs(y - s["y"]) < 1e-6 and x + HW > s["x"] and x - HW < s["x"] + s["w"]: return i
    return -1

def hops_to(target):
    d = [1e9] * len(SOLIDS); d[target] = 0
    changed = True
    while changed:
        changed = False
        for e in EDGES:
            if d[e["to"]] + 1 < d[e["from"]]: d[e["from"]] = d[e["to"]] + 1; changed = True
    return d

def walk_to(pg, x, tol=2.0, timeout=8.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        m = me(pg); dx = x - m["renderX"]
        if abs(dx) <= tol: set_input(pg, 0); return True
        set_input(pg, max(-1, min(1, dx / 26.0)))   # proportional: slows down as it nears the mark
        time.sleep(0.03)
    set_input(pg, 0); return False

def go(pg, x, y):
    """Walk the real platforms to (x, y). Closed loop: re-plans from wherever the player actually is."""
    target = next(i for i, s in enumerate(SOLIDS) if s["y"] == y and s["x"] <= x <= s["x"] + s["w"])
    hops = hops_to(target)
    for _ in range(14):
        # plan only from a SETTLED sample: grounded on a known platform, twice in a row
        def settled():
            a = me(pg); time.sleep(0.12); b = me(pg)
            return b if (a["grounded"] and b["grounded"] and platform_under(b["serverX"], b["serverY"]) >= 0) else None
        m = wait_for(pg, settled, 8, "never settled on a platform")
        cur = platform_under(m["serverX"], m["serverY"])
        if cur == target:
            if walk_to(pg, x): return
            continue
        opts = [e for e in EDGES if e["from"] == cur and hops[e["to"]] == hops[cur] - 1]
        if not opts: raise RuntimeError(f"no route from platform {cur} to {target}")
        # Aim for the MIDDLE of each feasible takeoff interval (robust to frame jitter), preferring wide intervals.
        groups = {}
        for o in opts: groups.setdefault((o["to"], o["dir"], o["jump"]), []).append(o)
        def score(g):
            xs = sorted(o["takeoffX"] for o in g); center = xs[len(xs) // 2]
            return abs(center - m["renderX"]) - 3 * len(xs)
        best = min(groups.values(), key=score)
        xs = sorted(o["takeoffX"] for o in best); center = xs[len(xs) // 2]
        e = min(best, key=lambda o: abs(o["takeoffX"] - center))
        if not walk_to(pg, e["takeoffX"], tol=2.5): continue
        set_input(pg, e["dir"], e["jump"])
        time.sleep(e["ticks"] * 0.05 + 0.12)
        set_input(pg, 0)
        time.sleep(0.15)
    raise RuntimeError(f"could not reach ({x},{y})")

# ------------------------------------------------------------------ run
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    cA = browser.new_context(viewport={"width": 1280, "height": 720})
    cB = browser.new_context(viewport={"width": 1280, "height": 720})
    A, B = cA.new_page(), cB.new_page()
    errors = []
    for pg in (A, B):
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    A.goto(BASE); A.wait_for_function("() => /^#[A-Z0-9]{4}$/.test(location.hash)", timeout=10000)
    code = A.evaluate("() => location.hash.slice(1)")
    B.goto(BASE + "#" + code); time.sleep(1.2)
    B.click("canvas"); B.keyboard.press("r"); time.sleep(0.5)
    A.click("canvas"); A.keyboard.press("Enter")
    for pg in (A, B):
        pg.wait_for_function("() => window.__WB_DEBUG__ && window.__WB_DEBUG__.state().phase === 'playing'", timeout=15000)
    wait_for(A, lambda: stage(A) is not None and stage(B) is not None, 5, "no stage state")
    A.click("canvas")

    # ---- 0. initial state ----
    s0 = stage(A)
    check("both tabs received the stage state; objectives listed", len(s0["objectives"]) == 4 and obj(s0, "o_final") == "locked")
    check("hidden breakpoint is not in the state either tab received", s0["breakpoints"] == [] and "bp_coupling" not in json.dumps([s0, stage(B)]))
    check("all four symptoms start active", all(s["state"] == "active" for s in s0["symptoms"]))
    A.screenshot(path=f"{OUT}/01-start.png")

    # ---- 1. server rejects things out of order (real key press, real server verdict) ----
    go(A, 200, 590)
    time.sleep(0.4)
    press(A, "e")  # lock_a while the root cause is still unrepaired
    wait_for(A, lambda: "cannot hold" in (dbg(A)["notice"] or ""), 3, "server did not refuse the locked console")
    check("a locked console is refused by the SERVER with a diagnostic hint (real E key press)", "drift" in dbg(A)["notice"], dbg(A)["notice"])

    # ---- 2. wrong target: the decoy panel only gives temporary relief ----
    go(A, 760, 500)
    press(A, "2")
    wait_for(A, lambda: any(c["playerId"] == me(A)["id"] for c in stage(A)["channels"]), 3, "decoy weld never started")
    wait_for(A, lambda: sym(stage(A), "s_flicker") == "mitigated", 10, "flicker never eased")
    st = stage(A)
    check("welding the decoy mitigates the flicker (temporary relief)", sym(st, "s_flicker") == "mitigated")
    check("...but the root cause is untouched: drift active, objective still open, nothing revealed",
          sym(st, "s_drift") == "active" and obj(st, "o_root") == "active" and st["breakpoints"] == [])
    check("the wrong target cost score", st["score"]["breakdown"].get("wrong_target") == -25, json.dumps(st["score"]["breakdown"]))
    A.screenshot(path=f"{OUT}/02-decoy-mitigated.png")

    # ---- 3. pattern 1: diagnose -> reveal -> repair the hidden root cause ----
    go(A, 200, 590)
    time.sleep(0.4)
    press(A, "1")
    wait_for(A, lambda: len(stage(B)["breakpoints"]) == 1, 5, "breakpoint never revealed on B")
    sa, sb = stage(A), stage(B)
    check("scanner reveals the breakpoint on BOTH tabs (shared state)", sa["breakpoints"] == sb["breakpoints"] and sa["breakpoints"][0]["id"] == "bp_coupling")
    check("scanner clue is shared", any(c["id"] == "clue_coupling" for c in sb["clues"]))
    A.screenshot(path=f"{OUT}/03-revealed.png")
    go(A, 200, 410)
    time.sleep(0.5)
    press(A, "2")
    wait_for(A, lambda: any(c["playerId"] == me(A)["id"] for c in stage(A)["channels"]), 3, "weld never started")
    A.screenshot(path=f"{OUT}/04-welding.png")
    wait_for(A, lambda: obj(stage(A), "o_root") == "complete", 12, "root repair never completed")
    st = stage(A)
    check("root cause repaired: flicker and drift resolved", sym(st, "s_flicker") == "resolved" and sym(st, "s_drift") == "resolved")
    check("failure chain: pressure STILL active (second cause: unpowered pump)", sym(st, "s_pressure") == "active" and sym(st, "s_coolant") == "active")
    check("sync objective unlocked by the repair", obj(st, "o_sync") == "active")

    # ---- 4. pattern 2: reroute power (first a deliberate mistake: overload) ----
    go(A, 1050, 680); press(A, "e"); time.sleep(0.3)          # sw_4 powers the decoy fan
    go(A, 990, 590); press(A, "e"); time.sleep(0.3)           # sw_1 -> junction live
    go(A, 1080, 590); press(A, "e")                           # sw_2 -> pump too: 2 loads on a capacity-1 generator
    wait_for(A, lambda: stage(A)["score"]["breakdown"].get("overload") == -100, 4, "no overload")
    st = stage(A)
    check("overloading the generator trips every breaker and costs score",
          all(ent(st, s)["state"] == "open" for s in ("sw_1", "sw_2", "sw_3", "sw_4")) and st["power"]["load"] == 0)
    A.screenshot(path=f"{OUT}/05-overload.png")
    go(A, 990, 590); press(A, "e"); time.sleep(0.4)           # sw_1 closed (junction live)
    go(A, 1080, 590); press(A, "e")                           # sw_2 closed: pump only, within capacity
    wait_for(A, lambda: obj(stage(A), "o_power") == "complete", 8, "route never completed")
    st = stage(A)
    check("a valid, sustained route completes the objective and seals the breakers",
          ent(st, "sw_2")["state"] == "sealed" and next(n for n in st["power"]["nodes"] if n["id"] == "pump")["source"] == "grid")
    check("pump on the grid resolves pressure and coolant", sym(st, "s_pressure") == "resolved" and sym(st, "s_coolant") == "resolved")
    time.sleep(0.5); press(A, "e"); wait_for(A, lambda: "sealed" in (dbg(A)["notice"] or ""), 3, "sealed breaker not refused")
    check("a sealed breaker is refused by the server", "sealed" in dbg(A)["notice"], dbg(A)["notice"])

    # ---- 5. pattern 3: coordinated timed controls (one player, inside the window) ----
    attempts = 0
    for attempts in range(1, 4):  # a slipped lock just means: try again, faster
        t0 = time.time()
        go(A, 200, 590); press(A, "e")
        go(A, 520, 500); press(A, "e")
        go(A, 1200, 680); press(A, "e")
        took = time.time() - t0
        try:
            wait_for(A, lambda: obj(stage(A), "o_sync") == "complete", 3, "sync never completed")
            break
        except TimeoutError:
            st = stage(A)
            print(f"--- sync attempt {attempts} did not complete after {took:.1f}s of walking/arming ---")
            m = me(A)
            print("locks:", [(e["id"], e["state"], e["armedUntilTick"]) for e in st["entities"] if e["id"].startswith("lock")])
            print("player at:", m["serverX"], m["serverY"], "grounded:", m["grounded"], "| last server verdict:", dbg(A)["notice"])
            for f in st["feed"][-4:]: print("  feed:", f["tick"], f["text"])
    print(f"sync completed on attempt {attempts} ({took:.1f}s to walk and arm all three locks)")
    st = stage(A)
    check("one player arms all three phase locks inside the window", obj(st, "o_sync") == "complete" and obj(st, "o_final") == "active")
    A.screenshot(path=f"{OUT}/06-sync-done.png")

    # ---- 6. final stabilisation: anchor + power cell + shield, then channel ----
    go(A, 470, 320)
    time.sleep(0.4)
    press(A, "e")
    wait_for(A, lambda: dbg(A)["notice"] and ("dead" in dbg(A)["notice"] or "no power" in dbg(A)["notice"]), 3, "core not refused")
    check("core console refuses to start without power", "dead" in dbg(A)["notice"] or "no power" in dbg(A)["notice"], dbg(A)["notice"])
    press(A, "3"); time.sleep(0.3)
    press(A, "e"); wait_for(A, lambda: "dead" in (dbg(A)["notice"] or ""), 3)
    press(A, "4"); time.sleep(0.3)
    wait_for(A, lambda: ent(stage(A), "core")["state"] == "powered", 4, "cell did not power the core")
    check("Gravity Anchor stabilises the flux zone; Power Cell powers the core",
          next(h for h in stage(A)["hazards"] if h["id"] == "hz_flux")["stabilized"] and ent(stage(A), "core")["state"] == "powered")
    press(A, "5"); time.sleep(0.3)
    press(A, "e")
    wait_for(A, lambda: any(c["playerId"] == me(A)["id"] for c in stage(A)["channels"]), 3, "final channel never started")
    A.screenshot(path=f"{OUT}/07-final-channel.png")
    try:
        wait_for(A, lambda: dbg(A)["phase"] == "stage_complete" and stage(A)["status"] == "stabilized", 12, "stage never completed")
    except TimeoutError:
        d = dbg(A); st = d["stage"]
        print("--- DIAGNOSTIC at timeout ---")
        print("client phase:", d["phase"], "| stage.status:", st["status"], "| tick:", st["tick"])
        print("channels:", st["channels"], "| core:", ent(st, "core"))
        print("effects:", [(e["tool"], e["expiresTick"]) for e in st["effects"]])
        print("hazards:", [(h["id"], h["armed"], h["stabilized"], h["nextPulseTick"]) for h in st["hazards"]])
        print("score:", st["score"]["breakdown"])
        for f in st["feed"]: print("  feed:", f["tick"], f["tone"], f["text"])
        raise
    time.sleep(0.6)
    sa, sb = stage(A), stage(B)
    check("stage stabilised: every objective complete, every symptom resolved",
          all(o["status"] == "complete" for o in sa["objectives"]) and all(s["state"] == "resolved" for s in sa["symptoms"]))
    check("room advanced through the real STAGE_CLEAR transition (both tabs)", dbg(A)["phase"] == "stage_complete" and dbg(B)["phase"] == "stage_complete")
    check("final score and breakdown are server-computed and identical on both tabs", sa["score"] == sb["score"] and sa["score"]["total"] > 1000, json.dumps(sa["score"]))
    check("both tabs hold the identical final stage state", sa == sb)
    A.screenshot(path=f"{OUT}/08-result-A.png"); B.screenshot(path=f"{OUT}/09-result-B.png")

    check("no console/page errors", not errors, "; ".join(errors[:3]))
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
