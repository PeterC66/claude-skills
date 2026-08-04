#!/usr/bin/env python3
"""After refreshing the GTFS dataset, report which town leaflets may need updating and why.

For every town listed in `_gtfs/town_prefixes.json` that has a built leaflet, this diffs
the freshly-built dataset for THAT TOWN'S REGION against the town's last shipped
`verified-services.json` (latest S1 run) and classifies each difference.

Multi-region: each town's dataset comes from its `"region"` in town_prefixes.json,
resolved through `_gtfs/regions.json` (see gtfs_regions.py). A town whose dataset
isn't built, or whose ATCO prefixes cannot occur in the region it claims, is
reported as NOT CHECKED rather than diffed against a dataset that cannot contain
it — which would report every one of its routes as withdrawn.

The classifications:

  [ADD?]      a route now serves the town in BODS but isn't in our shipped set
  [RE-EVAL]   a route now serves the town in BODS that we'd previously marked 'does not serve'
  [WITHDRAWN?] a shipped route is gone from BODS (and isn't a community/DRT service) -> verify
  [COMMUNITY]  a shipped route is absent from BODS but is community/pre-book (expected; re-check on bustimes)
  [OPERATOR]  operator changed
  [DAYS]      operating days changed (only when both sides parse cleanly)

Writes `_gtfs/refresh-report_<date>.md` and prints a one-line-per-town summary.
Community/DRT services (Villager, FACT, dial-a-ride, ...) are NOT in BODS by design, so
their absence is reported as expected, not as a withdrawal.

Usage:
  python gtfs_refresh_report.py [--root "<Buses folder>"] [--db <one dataset for every town>]
"""
import os, sys, json, glob, argparse, datetime
import gtfs_query as gq
import gtfs_regions as greg

DOW=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
COMMUNITY_HINTS=["villager","fact","community","minibus","dial","demand","voluntary","cvs","car scheme"]

def parse_days(s):
    """Best-effort: freeform shipped 'days' string -> set of 0..6, or None if not parseable."""
    if not s: return None
    t=s.strip().lower()
    if t in ("daily","every day","mon-sun","mon to sun"): return set(range(7))
    idx={"mon":0,"tue":1,"wed":2,"thu":3,"fri":4,"sat":5,"sun":6}
    import re
    m=re.fullmatch(r"(mon|tue|wed|thu|fri|sat|sun)\s*[-–]\s*(mon|tue|wed|thu|fri|sat|sun)",t)
    if m: a,b=idx[m.group(1)],idx[m.group(2)]; return set(range(a,b+1))
    toks=re.findall(r"mon|tue|wed|thu|fri|sat|sun",t)
    if toks and all(("&" in t or "," in t or len(toks)==1) for _ in [0]):
        return {idx[x] for x in toks}
    return None  # e.g. "Limited (pre-book)" -> not comparable

def is_community(operator, source):
    if (source or "").lower().startswith("bustimes-community"): return True
    op=(operator or "").lower()
    return any(h in op for h in COMMUNITY_HINTS)

def latest_verified(town_dir):
    cands=sorted(glob.glob(os.path.join(town_dir,"S1-services","*","verified-services.json")))
    return cands[-1] if cands else None

def fold_gtfs(services):
    """Fold variant suffixes (301S/V/X -> 301) into the base route."""
    base={}
    for s in services:
        key=s["possibleVariantOf"] or s["route"]
        b=base.setdefault(key,{"route":key,"operators":set(),"flags":[0]*7,"variants":set(),"hasShape":False})
        b["operators"].add(s["operator"])
        for i in range(7): b["flags"][i]|=s["daysFlags"][i]
        if s["possibleVariantOf"]: b["variants"].add(s["route"])
        b["hasShape"]=b["hasShape"] or s["hasGtfsShape"]
    return base

def diff_town(db, name, cfg, town_dir):
    vf=latest_verified(town_dir)
    if not vf: return None
    vs=json.load(open(vf,encoding="utf-8"))
    shipped={s["route"]:s for s in vs.get("services",[]) if s.get("servesTown",True)}
    not_serving={x["route"] for x in vs.get("notOnLeaflet",[]) if x.get("servesTown") is False}
    prefixes=cfg.get("prefixes"); near=None
    if cfg.get("near"): la,lo,km=cfg["near"]; near=(la,lo,km)
    res=gq.query(db, prefixes, near, name)
    gtfs=fold_gtfs(res["services"])
    changes=[]
    # routes in GTFS now
    for r,g in gtfs.items():
        gdays=set(i for i in range(7) if g["flags"][i])
        if r in shipped:
            sh=shipped[r]
            # operator
            gops=g["operators"]
            if not any(o in (sh.get("operator") or "") or (sh.get("operator") or "") in o for o in gops):
                changes.append(("OPERATOR", r, f"shipped '{sh.get('operator')}' vs BODS '{' / '.join(sorted(gops))}'"))
            # days
            sd=parse_days(sh.get("days"))
            if sd is not None and sd!=gdays:
                changes.append(("DAYS", r, f"shipped '{sh.get('days')}' vs BODS '{fmt(gdays)}'"))
        elif r in not_serving:
            changes.append(("RE-EVAL", r, f"BODS now shows it serving the town ({fmt(gdays)}); we'd marked it 'does not serve'"))
        else:
            extra=f" [+ road geometry]" if g["hasShape"] else ""
            changes.append(("ADD?", r, f"new in BODS: {' / '.join(sorted(g['operators']))}, {fmt(gdays)}{extra}"))
    # shipped routes missing from GTFS
    for r,sh in shipped.items():
        if r not in gtfs:
            if is_community(sh.get("operator"), sh.get("source")):
                changes.append(("COMMUNITY", r, f"absent from BODS as expected ({sh.get('operator')}); re-check on bustimes"))
            else:
                changes.append(("WITHDRAWN?", r, f"shipped ({sh.get('operator')}, {sh.get('days')}) but gone from BODS - verify"))
    return {"file":vf,"verifiedOn":vs.get("verifiedOn"),"changes":changes}

def fmt(dayset):
    if not dayset: return "?"
    if dayset==set(range(7)): return "Daily"
    o=sorted(dayset)
    if o==list(range(o[0],o[-1]+1)): return f"{DOW[o[0]]}-{DOW[o[-1]]}" if len(o)>2 else " & ".join(DOW[i] for i in o)
    return " & ".join(DOW[i] for i in o)

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--root", default=r"C:\u3a St Ives\Using AI\Buses")
    ap.add_argument("--db", help="read EVERY town from this one dataset, ignoring regions.json "
                                 "(single-region or testing use)")
    a=ap.parse_args()
    root=a.root; gdir=os.path.join(root,"_gtfs")
    prefixes=json.load(open(os.path.join(gdir,"town_prefixes.json"),encoding="utf-8"))
    groups,skipped=greg.plan(gdir, prefixes, a.db)
    today=datetime.date.today().isoformat()
    lines=[f"# Bus dataset refresh — towns to review",
           f"_Report {today}. Datasets used:_",""]
    for g in groups: lines.append(f"- {greg.feed_line(g)}")
    lines+=["",
           "Diff of the refreshed BODS data against each town's last shipped service list. "
           "Community/pre-book services are expected to be absent from BODS.",""]
    summary=[]; total_actionable=0; towns_to_review=[]
    for g in groups:
        for town,cfg in g["towns"]:
            town_dir=os.path.join(root,"Areas",town)
            if not os.path.isdir(town_dir): continue
            d=diff_town(g["db"],town,cfg,town_dir)
            if d is None:
                summary.append(f"  {town}: no shipped data"); continue
            actionable=[c for c in d["changes"] if c[0] not in ("COMMUNITY",)]
            if actionable: total_actionable+=len(actionable); towns_to_review.append(town)
            verdict = "NO CHANGE" if not d["changes"] else (f"{len(actionable)} to review" if actionable else "only expected community gaps")
            summary.append(f"  {town}: {verdict}")
            lines.append(f"## {town} — {verdict}")
            lines.append(f"_last verified {d['verifiedOn']} · region {g['region']}_")
            if not d["changes"]:
                lines.append("- No differences from the shipped service set.")
            for tag,r,msg in sorted(d["changes"]):
                lines.append(f"- **[{tag}] {r}** — {msg}")
            lines.append("")
    # Towns we deliberately did NOT diff. Reporting these loudly is the point: silently
    # running them against the wrong dataset is what produced a month of false withdrawals.
    if skipped:
        lines.append("## Not checked — dataset unavailable")
        lines.append("_These towns were skipped rather than diffed against a dataset that cannot "
                     "contain them. Build the region's sqlite (see `regions.json`) or fix the town's "
                     "`\"region\"` key in `town_prefixes.json`._")
        for town,reason in skipped:
            lines.append(f"- **{town}** — {reason}")
            summary.append(f"  {town}: NOT CHECKED ({reason})")
        lines.append("")
    out=os.path.join(gdir,f"refresh-report_{today}.md")
    open(out,"w",encoding="utf-8").write("\n".join(lines))
    # one-line summary for the Windows notification
    if total_actionable==0:
        headline="Bus data refreshed - nothing to do."
    else:
        headline=f"Bus data: {total_actionable} item(s) to review in {', '.join(towns_to_review)}."
    if skipped:
        headline+=f" {len(skipped)} town(s) NOT checked ({', '.join(t for t,_ in skipped)})."
    body="\n".join(s.strip() for s in summary)
    with open(os.path.join(gdir,"refresh-summary.txt"),"w",encoding="utf-8") as f:
        f.write(headline+"\n"+body+"\nREPORT="+out+"\n")
    print("Towns reviewed:")
    print("\n".join(summary))
    print("\n"+headline)
    print("Report:",out)
