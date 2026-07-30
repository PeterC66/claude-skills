#!/usr/bin/env python3
"""P3 helper — solve the EXTERNAL place map's spoke layout (bearings + termini).

`gen_external_places.js` places each destination node where its bearing ray meets an
inner rectangle. That is fine up to ~8 spokes. Beyond that the nodes collide with each
other, with the hardcoded legend, and the r=24 badge rings of adjacent spokes touch —
and nudging bearings by hand turns into an unbounded fiddle (High Wycombe Aldi: 14
spokes, collisions every way round).

This script does it properly. It mirrors gen_external_places.js geometry EXACTLY, then:
  1. keeps the clockwise ORDER of the true geographic bearings, but relaxes them to a
     minimum angular gap (default 19 deg — below that the r=24 badges of two adjacent
     spokes overlap), pulling each back toward its true bearing;
  2. optionally PINS one spoke's bearing (give the longest badge row the longest clear
     ray — an 11-badge row needs ~108 mm, which on A4 means due west or due east);
  3. gives each spoke, longest badge row first, the largest radius whose node box stays
     on the page and clear of the reserved blocks and of every node already placed;
  4. prints (or writes) the result as frozen `terminus:{x,y}` values.

Usage:
  python solve_external_layout.py routes.json [--pin "High Wycombe town centre"]
      [--pin-bearing 270] [--min-gap 19] [--write] [--check-only]

`routes.json` `destinations[]` must already carry `bearing` = the TRUE geographic
bearing from the place (aggregate_destinations.js prints these). `name`, `sub` and
`routes` drive the node size, so finalise the wording FIRST — node width is set by the
longest line, so trimming a `sub` is the cheapest way to break a collision.

--write rewrites routes.json in place, UTF-8, ensure_ascii=False (never let Python open
it with the platform codepage — that mojibakes the en-dashes; see references/gotchas.md).
"""
import argparse, io, json, math, sys

W, H = 297.0, 210.0
HX, HY = 150.0, 118.0          # hub, matching gen_external_places.js
R0, NODE_GAP = 16.0, 9.0       # spoke starts at R0; stops NODE_GAP short of the node
BADGE_R0, BADGE_STEP, BADGE_R = 24.0, 7.2, 3.4
# Blocks gen_external_places.js draws at fixed positions - all no-go for a node.
RESERVED = [("title", 0, 0, 130, 30), ("legend", 6, 34, 106, 54),
            ("footnote", 0, 199, W, H), ("vstamp", 288, 100, W, 200)]
FRAME = {"x0": 8.0, "y0": 32.0, "x1": 289.0, "y1": 198.0}
RMAX, RSTEP, PAD = 128.0, 0.5, 2.0


def wrap(label, mx=13):
    """gen_external_places.js wrap() verbatim."""
    if len(label) <= mx or "\n" in label:
        return label.split("\n")
    a, b = "", ""
    for t in label.split(" "):
        if len((a + " " + t).strip()) <= mx and not b:
            a = (a + " " + t).strip()
        else:
            b = (b + " " + t).strip()
    return [a, b] if b else [a]


def node_box(name, sub, x, y):
    """destNode() geometry verbatim."""
    lines = wrap(name) + ([sub] if sub else [])
    w = max(20.0, max(len(l) for l in lines) * 1.95 + 5)
    h = 5.4 + len(lines) * 3.8
    return [x - w / 2, y - h / 2, x + w / 2, y + h / 2]


def ov(a, b):
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def seg_hits(p, q, box, pad=1.0, n=200):
    bx = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad]
    for i in range(n + 1):
        t = i / n
        x, y = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
        if bx[0] <= x <= bx[2] and bx[1] <= y <= bx[3]:
            return True
    return False


def spread(dests, min_gap, pin_name, pin_brg):
    """Relax bearings to >= min_gap apart, preserving clockwise order, pin one."""
    n = len(dests)
    # rotate so the list starts at the smallest true bearing, then unroll monotonically
    idx = sorted(range(n), key=lambda i: dests[i]["bearing"])
    b = [float(dests[i]["bearing"]) for i in idx]
    for _ in range(4000):
        for k in range(n - 1):
            g = b[k + 1] - b[k]
            if g < min_gap:
                b[k] -= (min_gap - g) / 2
                b[k + 1] += (min_gap - g) / 2
        g = (b[0] + 360) - b[-1]
        if g < min_gap:
            b[-1] -= (min_gap - g) / 2
            b[0] += (min_gap - g) / 2
        for k, i in enumerate(idx):
            b[k] += (dests[i]["bearing"] - b[k]) * 0.02
        if pin_name is not None:
            for k, i in enumerate(idx):
                if dests[i]["name"] == pin_name:
                    b[k] = pin_brg
    return {idx[k]: b[k] % 360 for k in range(n)}


def solve(dests, min_gap, pin_name, pin_brg):
    brg = spread(dests, min_gap, pin_name, pin_brg)
    placed, out = [], {}
    order = sorted(range(len(dests)),
                   key=lambda i: (0 if dests[i]["name"] == pin_name else 1,
                                  -len(dests[i]["routes"])))
    for i in order:
        d = dests[i]
        need = BADGE_R0 + (len(d["routes"]) - 1) * BADGE_STEP + BADGE_R + NODE_GAP
        dx = math.sin(math.radians(brg[i]))
        dy = -math.cos(math.radians(brg[i]))
        chosen = None
        R = RMAX
        while R >= need:
            x, y = HX + dx * R, HY + dy * R
            bx = node_box(d["name"], d.get("sub"), x, y)
            pb = [bx[0] - PAD, bx[1] - PAD, bx[2] + PAD, bx[3] + PAD]
            inside = (bx[0] >= FRAME["x0"] and bx[2] <= FRAME["x1"]
                      and bx[1] >= FRAME["y0"] and bx[3] <= FRAME["y1"])
            if inside and not any(ov(pb, [r[1], r[2], r[3], r[4]]) for r in RESERVED) \
                    and not any(ov(pb, o) for o in placed):
                chosen = (x, y, bx, R)
                break
            R -= RSTEP
        if chosen is None:
            print(f"!! no radius fits {d['name']} (needs {need:.0f}mm) — shorten its "
                  f"name/sub, drop a spoke, or lower --min-gap", file=sys.stderr)
            x, y = HX + dx * need, HY + dy * need
            chosen = (x, y, node_box(d["name"], d.get("sub"), x, y), need)
        placed.append(chosen[2])
        out[i] = chosen
    return brg, out


def check(dests, brg, sol):
    probs = []
    boxes = {i: sol[i][2] for i in sol}
    for i in sol:
        for r in RESERVED:
            if ov(boxes[i], [r[1], r[2], r[3], r[4]]):
                probs.append(f"RESERVED  {dests[i]['name']} hits {r[0]}")
    for i in sol:
        for j in sol:
            if j <= i:
                continue
            if ov(boxes[i], boxes[j]):
                probs.append(f"NODE-NODE {dests[i]['name']} <-> {dests[j]['name']}")
    pts = []
    for i in sol:
        x, y, _, R = sol[i]
        dx, dy = (x - HX) / R, (y - HY) / R
        p = (HX + dx * R0, HY + dy * R0)
        q = (HX + dx * (R - NODE_GAP), HY + dy * (R - NODE_GAP))
        for j in sol:
            if j != i and seg_hits(p, q, boxes[j]):
                probs.append(f"SPOKE-THRU-NODE {dests[i]['name']} crosses {dests[j]['name']}")
        for k, r in enumerate(dests[i]["routes"]):
            rr = BADGE_R0 + k * BADGE_STEP
            pts.append((i, r, HX + dx * rr, HY + dy * rr))
    for a in range(len(pts)):
        for c in range(a + 1, len(pts)):
            if pts[a][0] == pts[c][0]:
                continue
            if math.hypot(pts[a][2] - pts[c][2], pts[a][3] - pts[c][3]) < BADGE_R * 2:
                probs.append(f"BADGE-BADGE {dests[pts[a][0]]['name']}/{pts[a][1]} ~ "
                             f"{dests[pts[c][0]]['name']}/{pts[c][1]}")
    for i in sol:
        x, y, _, R = sol[i]
        dx, dy = (x - HX) / R, (y - HY) / R
        for k in range(len(dests[i]["routes"])):
            rr = BADGE_R0 + k * BADGE_STEP
            bxx, byy = HX + dx * rr, HY + dy * rr
            for j in sol:
                if j == i:
                    continue
                b = boxes[j]
                if b[0] - BADGE_R <= bxx <= b[2] + BADGE_R and b[1] - BADGE_R <= byy <= b[3] + BADGE_R:
                    probs.append(f"BADGE-IN-NODE {dests[i]['name']} in {dests[j]['name']}")
    return sorted(set(probs))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("routes_json")
    ap.add_argument("--pin", default=None, help="destination name to pin (give it the long ray)")
    ap.add_argument("--pin-bearing", type=float, default=270.0)
    ap.add_argument("--min-gap", type=float, default=19.0)
    ap.add_argument("--write", action="store_true", help="write terminus{} back into routes.json")
    ap.add_argument("--check-only", action="store_true", help="just audit the stored termini")
    a = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    RJ = json.load(io.open(a.routes_json, encoding="utf-8"))
    dests = RJ.get("destinations") or []
    if not dests:
        raise SystemExit("routes.json has no destinations[]")

    if a.check_only:
        sol, brg = {}, {}
        for i, d in enumerate(dests):
            t = d.get("terminus")
            if not t:
                raise SystemExit(f"{d['name']} has no terminus — run without --check-only")
            R = math.hypot(t["x"] - HX, t["y"] - HY)
            sol[i] = (t["x"], t["y"], node_box(d["name"], d.get("sub"), t["x"], t["y"]), R)
            brg[i] = (math.degrees(math.atan2(t["x"] - HX, -(t["y"] - HY))) + 360) % 360
    else:
        brg, sol = solve(dests, a.min_gap, a.pin, a.pin_bearing)

    print(f"{'destination':28}{'true':>6}{'shown':>7}{'dev':>6}{'len':>7}  badges")
    for i, d in enumerate(dests):
        x, y, _, R = sol[i]
        shown = (math.degrees(math.atan2(x - HX, -(y - HY))) + 360) % 360
        dev = ((shown - d["bearing"] + 180) % 360) - 180
        print(f"  {d['name'][:26]:26}{d['bearing']:6.0f}{shown:7.0f}{dev:+6.0f}{R:7.1f}  {len(d['routes'])}")
    probs = check(dests, brg, sol)
    print()
    if probs:
        for p in probs:
            print("  " + p)
        print("\n!! layout NOT clean — shorten a sub, merge a spoke, or retry with a "
              "different --pin / --min-gap")
    else:
        print("LAYOUT OK — no collisions")

    for i, d in enumerate(dests):
        x, y, _, _ = sol[i]
        d["terminus"] = {"x": round(x, 1), "y": round(y, 1)}
    if a.write and not a.check_only:
        io.open(a.routes_json, "w", encoding="utf-8").write(
            json.dumps(RJ, ensure_ascii=False, indent=2) + "\n")
        print(f"\nwrote terminus{{}} for {len(dests)} destinations into {a.routes_json}")
    elif not a.check_only:
        print("\ndestinations[] with solved termini (paste into routes.json, or re-run --write):")
        print(json.dumps(dests, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
