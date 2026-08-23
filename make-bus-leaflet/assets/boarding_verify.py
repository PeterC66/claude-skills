#!/usr/bin/env python3
"""Check a boarding sheet against the sources it claims to quote.

WHY THIS EXISTS. `boarding-plan-product_2026-08-22.md` sec 4: place maps have no S6,
and a boarding plan makes a claim that is both consequential and mechanically
checkable, so it must not inherit that gap. The claim is precise -- "to reach X,
stand at Y" -- and it is wrong in a way that strands a passenger, which no other
sheet we produce can manage.

WHAT IT CHECKS, and every one of these is read from a source the generator cannot
influence:

  S-1  LABEL TRUTH. Every boarding label the sheet prints must be exactly what
       NaPTAN says for that ATCO code -- the stand code for a lettered bay, the
       CommonName for a named stop. A letter we invented is worse than no letter
       (rule 3), so this compares against naptan.sqlite, NOT against stands.json,
       which this same pipeline wrote. Scoring our own output against our own
       output would certify the bug.

  S-2  DEPARTURE TRUTH. Every (destination, stand) pair must be re-derivable from
       GTFS trips: some trip must call at that stand and then, later in the same
       trip, reach a stop whose NaPTAN locality is that destination. Re-derived
       here from stop_times rather than read from boarding_index.json, so a bug in
       the index cannot pass by agreeing with itself.

  S-3  NO NEARER STAND. If a different in-frame stop reaches the same destination
       with a shorter walk, the sheet is sending the reader further than it needs
       to. Not wrong, but worth reporting.

  S-4  SHEET AGREES WITH INDEX. Every boarding label that actually appears in
       boarding.svg must be one NaPTAN sanctions, and every destination in the
       index must appear on the sheet. This is the one check that reads the
       ARTEFACT rather than the data behind it -- a generator that silently drops
       rows (an index too long for its columns) fails here and nowhere else.

EXIT CODES.  0 all checks pass · 1 at least one HARD finding · 2 could not run.
A SOFT finding (S-3) never fails the run on its own.

USAGE. Run from the stage folder holding boarding.svg and its inputs:

    python boarding_verify.py                     check, print a report
    python boarding_verify.py --db <path.sqlite>  name the GTFS region explicitly
    python boarding_verify.py --json report.json  also write the findings

PROVE IT CAN GO RED before trusting it green (the paper's own house rule, and
`feedback_prove_the_check_can_fail`): edit one letter in boarding_index.json and
confirm S-1 reports it. There is a switch for exactly that, so the proof does not
require hand-editing a committed file:

    python boarding_verify.py --self-test
"""
import argparse
import io
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict

SCRIPT_VERSION = "1.1"


def read_json(p):
    with io.open(p, encoding="utf-8") as fh:
        return json.load(fh)


def find_up(start, *rel):
    d = os.path.abspath(start)
    while True:
        c = os.path.join(d, *rel)
        if os.path.exists(c):
            return c
        p = os.path.dirname(d)
        if p == d:
            return None
        d = p


def main():
    ap = argparse.ArgumentParser(description="Verify a boarding sheet against NaPTAN and GTFS.")
    ap.add_argument("--dir", default=".")
    ap.add_argument("--db", default=None)
    ap.add_argument("--naptan", default=None)
    ap.add_argument("--svg", default="boarding.svg")
    ap.add_argument("--json", default=None)
    ap.add_argument("--self-test", action="store_true",
                    help="corrupt one label in memory and confirm S-1 catches it")
    args = ap.parse_args()

    folder = os.path.abspath(args.dir)
    try:
        index = read_json(os.path.join(folder, "boarding_index.json"))
        place = read_json(os.path.join(folder, "place.json"))
    except OSError as exc:
        sys.stderr.write("boarding_verify: %s\n" % exc)
        return 2

    napath = args.naptan or find_up(folder, "_gtfs", "naptan.sqlite")
    if not napath:
        sys.stderr.write("boarding_verify: no naptan.sqlite found\n")
        return 2
    dbpath = args.db
    if not dbpath:
        reg = index.get("region")
        cand = find_up(folder, "_gtfs", reg) if reg else None
        dbpath = cand
    if not dbpath or not os.path.exists(dbpath):
        sys.stderr.write("boarding_verify: GTFS db not found; pass --db explicitly\n")
        return 2

    nap = sqlite3.connect(napath)
    db = sqlite3.connect(dbpath)

    dests = index.get("destinations") or []
    stands = index.get("stands") or []
    by_atco = {s["atco"]: s for s in stands}

    if args.self_test:
        # Flip one printed label to something NaPTAN does not say. If the checker
        # stays green after this, it is not checking anything.
        if not dests:
            sys.stderr.write("boarding_verify: --self-test needs at least one destination\n")
            return 2
        victim = dests[0]
        victim["boardAt"] = "Bay 99"
        print("  [self-test] '%s' relabelled to 'Bay 99' — S-1 must now report a HARD finding.\n"
              % victim["destination"])

    findings = []

    def hard(code, msg):
        findings.append({"severity": "HARD", "check": code, "message": msg})

    def soft(code, msg):
        findings.append({"severity": "SOFT", "check": code, "message": msg})

    # ---------------------------------------------------------------- S-1
    def naptan_label(atco):
        r = nap.execute(
            "SELECT CommonName, Indicator, stand, stand_kind FROM naptan WHERE ATCOCode=?",
            (atco,)).fetchone()
        if not r:
            return None, "no NaPTAN row"
        common, indicator, stand, kind = [(x or "").strip() for x in r]
        if stand:
            word = kind.capitalize() if kind and kind != "bare" else "Stand"
            return ("%s %s" % (word, stand)).strip(), "stand code"
        return common, "name only"

    checked_labels = 0
    for d in dests:
        atco = d.get("boardAtAtco")
        want, why = naptan_label(atco)
        got = d.get("boardAt")
        checked_labels += 1
        if want is None:
            hard("S-1", "%s: boarding stop %s has no NaPTAN row at all" % (d["destination"], atco))
        elif got != want:
            hard("S-1", "%s: sheet prints %r for %s, NaPTAN says %r (%s)"
                 % (d["destination"], got, atco, want, why))

    # ---------------------------------------------------------------- locality, re-derived
    parent_of, ambiguous = {}, set()
    for child, parent in nap.execute(
            "SELECT DISTINCT LocalityName, ParentLocalityName FROM naptan "
            "WHERE LocalityName IS NOT NULL AND TRIM(COALESCE(ParentLocalityName,'')) <> ''"):
        c, p = (child or "").strip(), (parent or "").strip()
        if not c:
            continue
        if c in parent_of and parent_of[c] != p:
            ambiguous.add(c)
        parent_of[c] = p
    for c in ambiguous:
        parent_of.pop(c, None)

    def climb(n):
        seen, cur = set(), n
        while cur and cur not in seen:
            seen.add(cur)
            nxt = parent_of.get(cur)
            if not nxt or nxt == cur:
                break
            cur = nxt
        return cur

    lc = {}

    # A STOP CAN BE HONESTLY NAMED MORE THAN ONE WAY, so this returns the SET of
    # names a sheet is allowed to print for it, not one name.
    #
    # boarding_index.py stops the parent rollup at a joint civil parish, so route
    # 301's Needingworth stops print "Needingworth" rather than the parish name
    # "Holywell-cum-Needingworth" (2026-08-23; the parish name sent a reader
    # looking for a village name that was not in the index). Re-deriving with only
    # the rolled-up name then reported every one of those rows as HARD S-2 — the
    # bus really does reach the place, the two files just disagreed about what to
    # call it.
    #
    # Copying the rollup rule into this file would fix the symptom and cost the
    # independence that makes this check worth running: it would then only ever
    # confirm that the generator agrees with itself. So it stays independent about
    # the thing S-2 actually tests — DOES A BUS LEAVE THIS STAND AND REACH THAT
    # PLACE — and widens what it will ACCEPT as a name for the place, by exactly
    # the one case where NaPTAN itself offers two honest answers.
    #
    # Deliberately NOT "any un-rolled name is acceptable". That would let the sheet
    # print "Kings Hedges" for Cambridge and still pass, because a bus does reach
    # Kings Hedges. The exception is a joint civil parish — a name of the form
    # "A-cum-B" or "A and B", where the child IS one of the halves — and over the
    # whole register that is six names: Bythorn, Keyston, Caldecote, Folksworth,
    # Washingley, Needingworth. Everywhere else the rolled-up name is still the
    # only answer this check will take.
    JOINT_RE = re.compile(r"\s*(?:-cum-|\scum\s|-with-|\swith\s|-and-|\sand\s|\s&\s)\s*",
                          re.IGNORECASE)

    def _norm(v):
        return re.sub(r"[^a-z0-9]", "", (v or "").lower())

    def joint_parish(child, parent):
        parts = JOINT_RE.split(parent or "")
        if len(parts) < 2:
            return False
        c = _norm(child)
        return bool(c) and any(_norm(x) == c for x in parts)

    def locality(atco):
        if atco in lc:
            return lc[atco]
        r = nap.execute("SELECT LocalityName, ParentLocalityName FROM naptan WHERE ATCOCode=?",
                        (atco,)).fetchone()
        v = set()
        if r:
            child, parent = (r[0] or "").strip(), (r[1] or "").strip()
            top = climb(parent or child)
            if top:
                v.add(top)
            if child and parent and joint_parish(child, parent):
                v.add(child)          # a half of a joint parish is its own honest name
        lc[atco] = v
        return v

    # ---------------------------------------------------------------- S-2 / S-3
    # Re-derive, straight from stop_times, which stands reach which localities.
    frame = list(by_atco)
    ph = ",".join("?" * len(frame))
    reach = defaultdict(set)          # locality -> {atco}
    if frame:
        tids = [r[0] for r in db.execute(
            "SELECT DISTINCT trip_id FROM stop_times WHERE stop_id IN (%s)" % ph, frame)]
        for t in tids:
            seq = [r[0] for r in db.execute(
                "SELECT stop_id FROM stop_times WHERE trip_id=? ORDER BY CAST(stop_sequence AS INTEGER)",
                (t,))]
            for i, sid in enumerate(seq):
                if sid not in by_atco:
                    continue
                for nxt in seq[i + 1:]:
                    for l in locality(nxt):
                        reach[l].add(sid)

    for d in dests:
        dest, atco = d["destination"], d.get("boardAtAtco")
        who = reach.get(dest, set())
        if atco not in who:
            hard("S-2", "%s: no trip departs %s (%s) and later reaches %s"
                 % (dest, d.get("boardAt"), atco, dest))
            continue
        nearer = [a for a in who
                  if a in by_atco and by_atco[a]["distM"] < by_atco[atco]["distM"]]
        if nearer:
            n = min(nearer, key=lambda a: by_atco[a]["distM"])
            soft("S-3", "%s: sheet sends the reader to %s (%d m) but %s (%d m) also reaches it"
                 % (dest, d.get("boardAt"), by_atco[atco]["distM"],
                    by_atco[n]["label"], by_atco[n]["distM"]))

    # ---------------------------------------------------------------- S-4
    svg_path = os.path.join(folder, args.svg)
    svg_checked = False
    if os.path.exists(svg_path):
        svg_checked = True
        svg = io.open(svg_path, encoding="utf-8").read()
        texts = re.findall(r"<text[^>]*>(.*?)</text>", svg, re.S)
        texts = [re.sub(r"<[^>]+>", "", t).strip() for t in texts]
        texts = [t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">") for t in texts]
        blob = set(texts)

        # every destination in the index must be on the sheet (possibly abbreviated
        # with a trailing '.', which the generator does when a name will not fit)
        missing = []
        for d in dests:
            name = d["destination"]
            if name in blob:
                continue
            if any(t.endswith(".") and name.startswith(t[:-1]) and len(t) > 4 for t in blob):
                continue
            missing.append(name)
        if missing:
            hard("S-4", "%d destination(s) in the index never reach the sheet: %s"
                 % (len(missing), ", ".join(sorted(missing)[:8])
                    + (" …" if len(missing) > 8 else "")))

        # Every bay glyph drawn must be a stand NaPTAN knows in this frame.
        #
        # Matched on the generator's own class="bstand" marker rather than by
        # pattern. A first cut looked for any 1-3 character <text> and duly
        # reported the north arrow's "N" as an unsanctioned bay -- a checker that
        # cries wolf on the compass gets muted, and then it is not checking the
        # bays either. Tagging the glyph at the point it is drawn makes the
        # question exact: these elements, and only these, claim to be stand codes.
        sanctioned = set()
        for a in by_atco:
            lab, _ = naptan_label(a)
            if not lab:
                continue
            sanctioned.add(lab)
            m = re.match(r"^(?:Bay|Stand|Stop|Gate|Platform|Stance|Berth)\s+(.+)$", lab)
            if m:
                sanctioned.add(m.group(1))
        glyphs = re.findall(r'<text[^>]*class="bstand"[^>]*>(.*?)</text>', svg, re.S)
        glyphs = [re.sub(r"<[^>]+>", "", g).strip() for g in glyphs]
        if not glyphs:
            hard("S-4", "no class=\"bstand\" glyphs found in the sheet — either nothing was "
                        "drawn, or the generator stopped tagging them and this check is blind")
        for t in sorted(set(glyphs)):
            if t not in sanctioned:
                hard("S-4", "sheet draws bay glyph %r, which NaPTAN does not list as a stand "
                            "in this frame (sanctioned: %s)" % (t, ", ".join(sorted(sanctioned))))

    # ---------------------------------------------------------------- report
    hards = [f for f in findings if f["severity"] == "HARD"]
    softs = [f for f in findings if f["severity"] == "SOFT"]

    print("# boarding_verify v%s — %s" % (SCRIPT_VERSION, place.get("name")))
    print("  register: %s   region: %s" % (os.path.basename(napath), os.path.basename(dbpath)))
    print("  %d destination row(s), %d boarding point(s); sheet %s"
          % (len(dests), len(by_atco), "read" if svg_checked else "NOT FOUND (S-4 skipped)"))
    print()
    if not findings:
        print("  all checks pass — %d label(s) matched NaPTAN, %d departure(s) re-derived from GTFS"
              % (checked_labels, len(dests)))
    for f in hards + softs:
        print("  [%s %s] %s" % (f["severity"], f["check"], f["message"]))
    print()
    print("  RESULT: %s" % ("FAIL" if hards else ("PASS with %d note(s)" % len(softs)) if softs else "PASS"))

    if args.json:
        with io.open(os.path.join(folder, args.json), "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"place": place.get("name"), "findings": findings,
                                 "result": "FAIL" if hards else "PASS"}, indent=1, ensure_ascii=False))

    return 1 if hards else 0


if __name__ == "__main__":
    sys.exit(main())
