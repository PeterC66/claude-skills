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
              A variant the town ships in its own right (High Wycombe's 1A, 1B, 32A) is NOT
              gone just because it folded into its base number -- see fold_gtfs, OA-223.
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
import cli   # OA-224 Tier 3.1: --root, then BUSES_DIR, then the laptop
import gtfs_query as gq
import gtfs_regions as greg
import index_guard as ig

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
    """Fold variant suffixes (301S/V/X -> 301) into the base route.

    `opFlags` keeps each operator's own day flags alongside the folded union. It is
    only consulted when a route NUMBER carries more than one shipped service, which
    is the case the union cannot answer: Wisbech's two 46s are Stagecoach East and
    Lynx, and the union of their days describes neither of them. See OA-134.

    `variantFlags` / `variantOps` / `ownFlags` are the same idea one level down, and
    they exist because `variants` did not (OA-223, 2026-09-01). Folding is right --
    it is what stops the report proposing 301S as a new service every month -- but a
    town may SHIP a variant as a displayed service in its own right, with its own
    palette colour, panel row and line: High Wycombe ships 1A, 1B and 32A that way.
    For those the fold is the wrong grain twice over. The shipped entry matches no
    key of the folded dict, so it was reported [WITHDRAWN?] every month while the bus
    ran; and the base's week is the union of services the town separates, so 32
    (Mon-Sat) plus 32A (Daily) read as a [DAYS] change on a route that had not
    changed. `variants` was collected all along and read by nothing.
    """
    base={}
    for s in services:
        key=s["possibleVariantOf"] or s["route"]
        b=base.setdefault(key,{"route":key,"operators":set(),"flags":[0]*7,"variants":set(),
                              "hasShape":False,"opFlags":{},"ownFlags":[0]*7,
                              "variantFlags":{},"variantOps":{}})
        b["operators"].add(s["operator"])
        of=b["opFlags"].setdefault(s["operator"],[0]*7)
        for i in range(7):
            b["flags"][i]|=s["daysFlags"][i]
            of[i]|=s["daysFlags"][i]
        if s["possibleVariantOf"]:
            b["variants"].add(s["route"])
            vf=b["variantFlags"].setdefault(s["route"],[0]*7)
            for i in range(7): vf[i]|=s["daysFlags"][i]
            b["variantOps"].setdefault(s["route"],set()).add(s["operator"])
        else:
            for i in range(7): b["ownFlags"][i]|=s["daysFlags"][i]
        b["hasShape"]=b["hasShape"] or s["hasGtfsShape"]
    return base

def diff_town(db, name, cfg, town_dir):
    vf=latest_verified(town_dir)
    if not vf: return None
    vs=json.load(open(vf,encoding="utf-8"))
    # GROUPED, not indexed. `{s["route"]: s for s in ...}` was here until 2026-08-28 and
    # it silently dropped a service on any town with two same-numbered routes: Wisbech
    # ships eleven and that comprehension built ten, so the Stagecoach East 46 had never
    # once been diffed against BODS -- only the Lynx one, which happened to be last in
    # the file. Every check below therefore runs PER SHIPPED ENTRY and is labelled with
    # the entry's own `key` (46, 46L), which is what tells the two apart. See OA-134.
    shipped=ig.group_by([s for s in vs.get("services",[]) if s.get("servesTown",True)],
                        key=lambda s: str(s["route"]))
    not_serving={x["route"] for x in vs.get("notOnLeaflet",[]) if x.get("servesTown") is False}
    prefixes=cfg.get("prefixes"); near=None
    if cfg.get("near"): la,lo,km=cfg["near"]; near=(la,lo,km)
    res=gq.query(db, prefixes, near, name)
    gtfs=fold_gtfs(res["services"])
    # variant route name -> the base it folded into, with its OWN flags and operators.
    # This is what makes a shipped variant findable at all; see fold_gtfs. OA-223.
    variant_index={}
    for _r,_g in gtfs.items():
        for _v in _g["variants"]:
            variant_index[_v]=(_r,_g["variantFlags"].get(_v,[0]*7),_g["variantOps"].get(_v,set()))
    changes=[]
    # routes in GTFS now
    for r,g in gtfs.items():
        gdays=set(i for i in range(7) if g["flags"][i])
        # A variant this town ships separately is checked on its own row below, so it
        # must not also define the base's week -- otherwise 32 (Mon-Sat) is compared
        # against 32 union 32A and reads Daily. Narrow only when something is left: a
        # base that exists ONLY through variants keeps the union. OA-223.
        unshipped=[v for v in g["variants"] if v not in shipped]
        if len(unshipped)<len(g["variants"]):
            f=list(g["ownFlags"])
            for v in unshipped:
                vf=g["variantFlags"].get(v,[0]*7)
                for i in range(7): f[i]|=vf[i]
            if any(f): gdays=set(i for i in range(7) if f[i])
        if r in shipped:
            rows=shipped[r]
            for sh in rows:
                label=ig.service_key(sh)          # '46' and '46L', not '46' twice
                shop=sh.get("operator") or ""
                # operator
                gops=g["operators"]
                matched=[o for o in gops if o in shop or shop in o]
                if not matched:
                    changes.append(("OPERATOR", label, f"shipped '{sh.get('operator')}' vs BODS '{' / '.join(sorted(gops))}'"))
                # days. With one shipped entry on this number the folded union IS this
                # service. With two it is the union of two different operators' weeks,
                # which describes neither -- so narrow it to the operator that matched.
                gdays_e=gdays
                if len(rows)>1 and matched:
                    f=[0]*7
                    for o in matched:
                        for i in range(7): f[i]|=g["opFlags"].get(o,[0]*7)[i]
                    gdays_e=set(i for i in range(7) if f[i])
                sd=parse_days(sh.get("days"))
                if sd is not None and sd!=gdays_e:
                    changes.append(("DAYS", label, f"shipped '{sh.get('days')}' vs BODS '{fmt(gdays_e)}'"))
        elif r in not_serving:
            changes.append(("RE-EVAL", r, f"BODS now shows it serving the town ({fmt(gdays)}); we'd marked it 'does not serve'"))
        elif g["variants"] and not unshipped and not any(g["ownFlags"]):
            # The base NUMBER does not run: every service under it is a variant, and the
            # town ships all of them. Proposing the base as a new route would invent one.
            pass
        else:
            extra=f" [+ road geometry]" if g["hasShape"] else ""
            changes.append(("ADD?", r, f"new in BODS: {' / '.join(sorted(g['operators']))}, {fmt(gdays)}{extra}"))
    # shipped routes missing from GTFS
    for r,rows in shipped.items():
        if r not in gtfs:
            for sh in rows:
                label=ig.service_key(sh)
                if r in variant_index:
                    # Present in BODS, folded under its base. Check it on its OWN flags
                    # and operators -- the fold's union describes the family, not this
                    # service. OA-223.
                    _base,vflags,vops=variant_index[r]
                    shop=sh.get("operator") or ""
                    matched=[o for o in vops if o in shop or shop in o]
                    if not matched:
                        changes.append(("OPERATOR", label, f"shipped '{sh.get('operator')}' vs BODS '{' / '.join(sorted(vops))}'"))
                    sd=parse_days(sh.get("days")); vd=set(i for i in range(7) if vflags[i])
                    if sd is not None and sd!=vd:
                        changes.append(("DAYS", label, f"shipped '{sh.get('days')}' vs BODS '{fmt(vd)}'"))
                    continue
                if is_community(sh.get("operator"), sh.get("source")):
                    changes.append(("COMMUNITY", label, f"absent from BODS as expected ({sh.get('operator')}); re-check on bustimes"))
                else:
                    changes.append(("WITHDRAWN?", label, f"shipped ({sh.get('operator')}, {sh.get('days')}) but gone from BODS - verify"))
    return {"file":vf,"verifiedOn":vs.get("verifiedOn"),"changes":changes}

def fmt(dayset):
    if not dayset: return "?"
    if dayset==set(range(7)): return "Daily"
    o=sorted(dayset)
    if o==list(range(o[0],o[-1]+1)): return f"{DOW[o[0]]}-{DOW[o[-1]]}" if len(o)>2 else " & ".join(DOW[i] for i in o)
    return " & ".join(DOW[i] for i in o)

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--root", default=None)
    ap.add_argument("--db", help="read EVERY town from this one dataset, ignoring regions.json "
                                 "(single-region or testing use)")
    a=ap.parse_args()
    a.root = cli.resolve_buses(a.root)
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
