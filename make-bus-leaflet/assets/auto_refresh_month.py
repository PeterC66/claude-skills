#!/usr/bin/env python3
"""Tier-1 automation — process-efficiency plan item 7 (2026-08-04).

`gtfs_refresh_report.py` already flags which towns changed and why (ADD?/WITHDRAWN?/
RE-EVAL/OPERATOR/DAYS/COMMUNITY). This is the "missing link" the plan named: classify
each changed town SAFE (a mechanical operator-name or operating-days sync — nothing a
human needs to see before it ships) or ESCALATE (a new route that needs a colour/config
decision, or a shipped route that's vanished from BODS while still drawn — a human call),
then for SAFE towns run S1(data-only)->S3(patch)->S4->S5 and stage the result as a
BusMaps.uk portal "proposed update" for customer accept/decline (propose-update.mjs,
already built in P5 — this just calls it instead of a human running it by hand).

ESCALATE towns are NOT touched — they're already visible in gtfs_refresh_report.py's own
report; this script just also says so under one auto-refresh-shaped summary so "what did
the automation do this month" is one report, not two.

Usage:
  python auto_refresh_month.py [--root "<Buses dir>"] [--db <sqlite, single-region>]
                                [--portal "<portal repo dir>"] [--apply] [--no-propose]

Dry-run by default: classifies every town and writes the report, applies nothing.
--apply performs the SAFE towns' S1/S3/S4/S5 refresh and commits it for real.
--no-propose skips the portal propose-update call even under --apply (e.g. a town that
isn't imported into the portal, or when testing the S1-S5 chain in isolation).

Zero third-party dependencies — stdlib + the sibling gtfs_*.py modules already in assets/.
"""
import os, sys, json, glob, argparse, datetime, subprocess, shutil, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gtfs_query as gq
import gtfs_regions as greg
import gtfs_refresh_report as rr  # reuse diff_town / fold_gtfs / fmt / latest_verified — don't re-derive the diff logic

SK = os.path.dirname(os.path.abspath(__file__))


def classify(changes):
    """SAFE = only OPERATOR/DAYS actionable changes (mechanical, no human call needed).
    ESCALATE = at least one ADD?/WITHDRAWN?/RE-EVAL (a route set or serves-town change).
    NOTHING = no actionable changes at all (COMMUNITY-only or none)."""
    actionable = [c for c in changes if c[0] != "COMMUNITY"]
    if not actionable:
        return "NOTHING", []
    blocking = [c for c in actionable if c[0] in ("ADD?", "WITHDRAWN?", "RE-EVAL")]
    if blocking:
        return "ESCALATE", blocking
    return "SAFE", actionable


def stage(town_dir, *args):
    """Run stage.js in town_dir, return trimmed stdout. Raises on non-zero exit."""
    res = subprocess.run(["node", os.path.join(SK, "stage.js"), *args], cwd=town_dir,
                          capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"stage.js {' '.join(args)} failed:\n{res.stderr or res.stdout}")
    return res.stdout.strip()


def run_node(script, cwd, extra_env=None):
    env = dict(os.environ)
    env.pop("LEAFLET_DIR", None)
    if extra_env:
        env.update(extra_env)
    res = subprocess.run(["node", script], cwd=cwd, capture_output=True, text=True, env=env)
    return res.returncode == 0, res.stdout, res.stderr


def gtfs_operator_and_days(db, cfg, town_name):
    """Fresh GTFS pull for one town -> {route: (operator_str, days_str)}, same fold/format
    logic diff_town uses internally, exposed here so the SAFE-apply path can compute the
    NEW values (diff_town only returns human-readable message strings)."""
    prefixes = cfg.get("prefixes")
    near = tuple(cfg["near"]) if cfg.get("near") else None
    res = gq.query(db, prefixes, near, town_name)
    gtfs = rr.fold_gtfs(res["services"])
    out = {}
    for r, g in gtfs.items():
        gdays = set(i for i in range(7) if g["flags"][i])
        out[r] = (" / ".join(sorted(g["operators"])), rr.fmt(gdays))
    return out


def patch_verified_services(vf_path, safe_routes, new_values):
    """Copy verified-services.json, patch operator/days ONLY for routes in safe_routes,
    leave everything else (including community entries) byte-identical in content."""
    vs = json.load(open(vf_path, encoding="utf-8"))
    touched = []
    for svc in vs.get("services", []):
        r = svc.get("route")
        if r in safe_routes and r in new_values:
            newop, newdays = new_values[r]
            if svc.get("operator") != newop:
                svc["operator"] = newop
                touched.append((r, "operator"))
            if svc.get("days") != newdays:
                svc["days"] = newdays
                touched.append((r, "days"))
    return vs, touched


def patch_routes_json(routes, safe_routes, new_values):
    """Reassign operators[].routes entries and external[].days for routes whose GTFS
    operator/days changed. Mechanical only — never touches palette/layout/geometry keys,
    so this can't move a line, add a colour, or change what's drawn."""
    touched = []
    ops = routes.get("operators")
    if isinstance(ops, list):
        for r in safe_routes:
            if r not in new_values:
                continue
            newop = new_values[r][0]
            cur = None
            for o in ops:
                if r in (o.get("routes") or []):
                    cur = o
                    break
            if cur and cur.get("name") == newop:
                continue  # already correct
            if cur:
                cur["routes"] = [x for x in cur["routes"] if x != r]
            target = next((o for o in ops if o.get("name") == newop), None)
            if not target:
                target = {"name": newop, "routes": []}
                ops.append(target)
            target["routes"].append(r)
            touched.append((r, "operators[]", newop))
        routes["operators"] = [o for o in ops if o.get("routes")]  # drop emptied entries
    ext = routes.get("external")
    if isinstance(ext, list):
        for e in ext:
            r = e.get("route")
            if r in safe_routes and r in new_values:
                newdays = new_values[r][1]
                if e.get("days") != newdays:
                    e["days"] = newdays
                    touched.append((r, "external[].days", newdays))
    return touched


def slugify(name):
    return "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-").replace("--", "-")


def refresh_one_safe_town(town, cfg, db, town_dir, safe_changes, note, portal, propose):
    """Run S1(data-only)->S3(patch)->S4->S5 for one SAFE town, then (if propose) stage a
    portal proposed-update. Returns a result dict for the report."""
    safe_routes = {c[1] for c in safe_changes}
    new_values = gtfs_operator_and_days(db, cfg, town)

    vf = rr.latest_verified(town_dir)
    if not vf:
        return {"status": "SKIP", "detail": "no verified-services.json to refresh from"}
    vs, vs_touched = patch_verified_services(vf, safe_routes, new_values)
    if not vs_touched:
        return {"status": "NOTHING-TO-PATCH", "detail": "GTFS values already match — nothing to apply"}

    prevS3 = stage(town_dir, "latest", "S3")
    routes = json.load(open(os.path.join(prevS3, "routes.json"), encoding="utf-8"))
    ov_touched = patch_routes_json(routes, safe_routes, new_values)

    # ---- S1 (data-only): commit the patched verified-services.json ----
    s1dir = stage(town_dir, "new", "S1")
    shutil.copy(vf, os.path.join(s1dir, "verified-services.json"))
    with open(os.path.join(s1dir, "verified-services.json"), "w", encoding="utf-8") as f:
        json.dump(vs, f, indent=2)
    # carry the previous disagreements audit forward unchanged — this is a data-only
    # sync, not a re-verification pass, so there's nothing new to audit against.
    for name in ("disagreements.docx", "disagreements.json", "disagreements.pdf"):
        p = os.path.join(os.path.dirname(vf), name)
        if os.path.exists(p):
            shutil.copy(p, os.path.join(s1dir, name))
    stage(town_dir, "commit", "S1", s1dir, "--outputs",
          "verified-services.json,disagreements.docx,disagreements.json,disagreements.pdf",
          "--note", f"{note} (data-only sync: {', '.join(f'{r} {f}' for r, f in vs_touched)})")

    # ---- S3 (patch): routes.json only, no generator copy (item 3) ----
    s3dir = stage(town_dir, "new", "S3")
    with open(os.path.join(s3dir, "routes.json"), "w", encoding="utf-8") as f:
        json.dump(routes, f, indent=2)
    ov = os.path.join(prevS3, "overrides.json")
    outputs = ["routes.json"]
    if os.path.exists(ov):
        shutil.copy(ov, os.path.join(s3dir, "overrides.json"))
        outputs.append("overrides.json")
    stage(town_dir, "commit", "S3", s3dir, "--outputs", ",".join(outputs), "--note",
          f"{note} (mechanical patch: {', '.join(f'{r} {k}->{v}' for r, k, v in ov_touched) or 'no routes.json change needed'})")

    # ---- S4 (minor bump): current engine, per item 3 ----
    s4dir = stage(town_dir, "new", "S4", "--bump", "minor")
    stage(town_dir, "pull", "S2", s4dir)
    stage(town_dir, "pull", "S3", s4dir)
    shutil.copy(os.path.join(SK, "gen_internal.js"), s4dir)
    style = routes.get("externalLayout", "radial")
    shutil.copy(os.path.join(SK, f"gen_external_{style}.js"), os.path.join(s4dir, "gen_external.js"))
    subprocess.run(["node", os.path.join(SK, "engine_version.js"), "--stamp", os.path.join(s4dir, "routes.json")],
                    capture_output=True, text=True)  # item 3: stamp which engine build drew this
    ok, out, err = run_node(os.path.join(s4dir, "gen_internal.js"), s4dir)
    if not ok:
        return {"status": "FAIL", "detail": f"gen_internal.js: {err.splitlines()[0] if err else out}"}
    ok, out, err = run_node(os.path.join(s4dir, "gen_external.js"), s4dir)
    if not ok:
        return {"status": "FAIL", "detail": f"gen_external.js: {err.splitlines()[0] if err else out}"}
    stage(town_dir, "commit", "S4", s4dir, "--outputs", "internal.svg,external.svg", "--note", note)

    # ---- S5: render ----
    s5dir = stage(town_dir, "new", "S5")
    stage(town_dir, "pull", "S4", s5dir)
    for svg, jpg in (("internal.svg", "internal.jpg"), ("external.svg", "external.jpg")):
        subprocess.run(["node", os.path.join(SK, "render.js"), os.path.join(s5dir, svg), os.path.join(s5dir, jpg)],
                        capture_output=True, text=True)
    stage(town_dir, "commit", "S5", s5dir, "--outputs", "internal.jpg,external.jpg", "--note", note)
    subprocess.run(["node", os.path.join(SK, "refresh_latest.js"), town_dir], capture_output=True, text=True)

    result = {"status": "APPLIED", "s5dir": s5dir, "vsTouched": vs_touched, "routesTouched": ov_touched}

    if propose and portal and os.path.isdir(portal):
        slug = slugify(town)
        pres = subprocess.run(
            ["node", os.path.join(portal, "scripts", "propose-update.mjs"),
             "--map", slug, "--src", s5dir, "--note", f"Tier-1 auto-refresh: {note}"],
            cwd=portal, capture_output=True, text=True)
        result["proposeOk"] = pres.returncode == 0
        result["proposeOut"] = (pres.stdout or pres.stderr).strip()
    else:
        result["proposeOk"] = None
        result["proposeOut"] = "skipped (--no-propose or no portal dir)"
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=r"C:\u3a St Ives\Using AI\Buses")
    ap.add_argument("--db", help="read every town from this one dataset, ignoring regions.json")
    ap.add_argument("--portal", default=r"C:\Claude\community-bus-maps")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--no-propose", action="store_true")
    a = ap.parse_args()

    root = a.root
    gdir = os.path.join(root, "_gtfs")
    prefixes = json.load(open(os.path.join(gdir, "town_prefixes.json"), encoding="utf-8"))
    groups, skipped = greg.plan(gdir, prefixes, a.db)
    today = datetime.date.today().isoformat()

    lines = [f"# Tier-1 auto-refresh — {today}", "",
             "SAFE = mechanical operator/day sync, auto-applied. ESCALATE = a new or "
             "vanished route — needs a human. NOTHING = no actionable change.", ""]
    safe_list, escalate_list = [], []

    for g in groups:
        for town, cfg in g["towns"]:
            town_dir = os.path.join(root, "Areas", town)
            if not os.path.isdir(town_dir):
                continue
            d = rr.diff_town(g["db"], town, cfg, town_dir)
            if d is None:
                continue
            verdict, reasons = classify(d["changes"])
            lines.append(f"## {town} — {verdict}")
            if verdict == "ESCALATE":
                escalate_list.append(town)
                blocking_routes = {r for _, r, _ in reasons}
                for tag, r, msg in [c for c in d["changes"] if c[0] != "COMMUNITY"]:
                    flag = " **<- blocking**" if r in blocking_routes else ""
                    lines.append(f"- **[{tag}] {r}** — {msg}{flag}")
                lines.append("- _Not touched — needs a human (new route needs a colour, or a "
                              "shipped route may need removing from routeOrder)._")
            elif verdict == "SAFE":
                safe_list.append(town)
                for tag, r, msg in reasons:
                    lines.append(f"- **[{tag}] {r}** — {msg}")
                if a.apply:
                    note = f"BODS refresh {today}"
                    res = refresh_one_safe_town(town, cfg, g["db"], town_dir, reasons, note,
                                                 a.portal, not a.no_propose)
                    lines.append(f"- **{res['status']}**" + (f" — {res.get('detail')}" if res.get('detail') else ""))
                    if res["status"] == "APPLIED":
                        lines.append(f"  - S1/S3/S4/S5 committed; propose-update: "
                                      f"{'staged' if res['proposeOk'] else 'not applicable'} — {res['proposeOut']}")
                else:
                    lines.append("- _Dry run — nothing applied. Re-run with --apply to auto-refresh and propose it._")
            else:
                lines.append("- No actionable change (community-only gaps or nothing new).")
            lines.append("")

    if skipped:
        lines.append("## Not checked — dataset unavailable")
        for town, reason in skipped:
            lines.append(f"- **{town}** — {reason}")
        lines.append("")

    out = os.path.join(gdir, f"auto-refresh-report_{today}.md")
    open(out, "w", encoding="utf-8").write("\n".join(lines))
    print(f"SAFE: {', '.join(safe_list) or '(none)'}")
    print(f"ESCALATE: {', '.join(escalate_list) or '(none)'}")
    print(f"{'APPLIED' if a.apply else 'DRY RUN'} — report: {out}")
