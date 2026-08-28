"""Falsification harness for the Ramsey external-spoke fix (public report 2026-08-28).

Runs draft_town.spoke_for_route over Ramsey's REAL committed chains twice:

  OLD  -- the namer as it was: no NaPTAN, one reverse-geocode per 9-char ATCO
          prefix, and an ATCO-prefix "in town" test. It must reproduce the spoke
          lists busmaps.uk ACTUALLY SERVED, or this harness is not measuring the
          thing that was wrong and its verdict on the fix is worthless.
  NEW  -- the namer backed by NaPTAN. It must name what the chains really serve.

The OLD reverse-geocode results are replayed from a table rather than fetched, so
the harness is offline and deterministic. Every value in REPLAY is what Nominatim
returns today at zoom=14 for that locality's stops -- including the wrong ones.

Run from the skill's own folder (C:\\u3a St Ives\\.claude\\skills\\make-bus-leaflet):

    npm run test:prove-red-external-spokes

The optional argument is the Buses repository root; it defaults to
"C:/u3a St Ives/Using AI/Buses" and there are no other placeholders.

It needs two things a fresh clone does NOT have -- Ramsey's committed
ci-reference/ and _gtfs/naptan.sqlite, which is git-ignored and rebuilt by
naptan_build.py. Missing either, it SKIPS with exit 0 and says which. It must
never fail for want of an input, or it gets muted in its first week.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BUSES = (sys.argv[1] if len(sys.argv) > 1 else "C:/u3a St Ives/Using AI/Buses").rstrip("/\\")
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
REF = BUSES + "/Areas/Ramsey/ci-reference/"
NAPTAN = BUSES + "/_gtfs/naptan.sqlite"

for label, path in (("Ramsey ci-reference", REF + "routes.json"),
                    ("NaPTAN register", NAPTAN)):
    if not os.path.exists(path):
        print(f"SKIP -- no {label} at {path}")
        print("       (rebuild NaPTAN with naptan_build.py; see this file's docstring)")
        sys.exit(0)

sys.path.insert(0, ASSETS)
import draft_town as dt  # noqa: E402

chains = json.load(open(REF + "routes_full_atco.json", encoding="utf-8"))
ll = json.load(open(REF + "atco2ll.json", encoding="utf-8"))
cfg = json.load(open(REF + "routes.json", encoding="utf-8"))
# FROZEN, not read from the live config. These are the four spoke lists busmaps.uk
# actually served on 2026-08-28, recovered from buses-data 7930633 -- the commit
# before Ramsey was rebuilt. They are a historical fact about what a member of the
# public read, and the whole design of this harness is that the OLD code must
# reproduce them before its verdict on the fix means anything.
#
# They USED to be read from Ramsey's ci-reference/routes.json, which was correct
# for exactly as long as nobody fixed the map. Ramsey was rebuilt on 2026-08-28
# (v2.0, OA-153): the served spokes are now the CORRECTED ones, so the old code was
# being asked to reproduce the fix and every case failed. A harness whose baseline
# moves when the bug is fixed cannot prove the bug was ever there.
#
# Note what is NOT here: the 303 has one entry, to Huntingdon, because that is what
# was published -- its Chatteris arm did not exist, which was the fourth defect.
PUBLISHED_2026_08_28 = {
    "32":  ["Whittlesey", "March"],
    "301": ["Bury", "Pidley cum Fenton", "Colne", "Bluntisham", "St Ives"],
    "303": ["Bury", "Wistow", "Warboys", "Old Hurst", "Huntingdon"],
    "X31": ["Whittlesey", "Peterborough"],
}
published = PUBLISHED_2026_08_28
anchor = ll[cfg["anchor"]]                      # routes.json anchors on an ATCO code
prefix = cfg["atcoPrefix"]

REPLAY = {
    "0500FWHIY": "Whittlesey",      # the wrong one: also Pondersbridge/Turves/Coates/Eastrea
    "0500FMARC": "March",
    "0500FCHAT": "Chatteris",
    "0500HRAMS": "Ramsey",
    "0500HBURY": "Bury",
    "0500HWIST": "Wistow",
    "0500HUPWO": "Upwood",
    "0500HWARB": "Warboys",
    "0500HOLDH": "Old Hurst",
    "0500HWOOD": "Woodhurst",
    "0500HPIDL": "Pidley cum Fenton",
    "0500HFENT": "Fenton End",
    "0500HSOME": "Somersham",
    "0500HCOLN": "Colne",
    "0500HEARI": "Earith",
    "0500HBLUN": "Bluntisham",
    "0500HNEED": "Needingworth",
    "0500HSTIV": "St Ives",
    "0500HHUNT": "Huntingdon",
    "0500HHART": "Hartford",
    "0500HWYTO": "Wyton Airfield",
    "0590": "Peterborough",         # every Peterborough-area prefix
}


class OldNamer(dt.PlaceNamer):
    """The namer as it was: per-ATCO-prefix reverse geocode, no NaPTAN."""

    def __init__(self):
        dt.PlaceNamer.__init__(self, naptan_db=None)

    def _lookup(self, lat, lon):
        raise AssertionError("OLD namer tried to reach the network")

    def name(self, stop_id, lat, lon):
        for k in sorted(REPLAY, key=len, reverse=True):
            if stop_id.startswith(k):
                return REPLAY[k], True
        return stop_id[:9], False

    def in_town(self, stop_id, town):
        return None                             # forces the old ATCO-prefix test

    def of_town(self, stop_id, town):
        return False


def run(namer, town):
    out = {}
    for r, ch in chains.items():
        sp = dt.spoke_for_route(ch, ll, prefix, anchor, namer, town)
        if sp:
            out[r] = sp
    return out


old = run(OldNamer(), None)
new = run(dt.PlaceNamer(NAPTAN), "Ramsey")
fails = []

print("\n=============== OLD -- must match what busmaps.uk actually served")
for r in sorted(published):
    got, want = old.get(r, {}).get("stops"), published[r]
    ok = got == want
    print(f"  {r:5} {'REPRODUCED' if ok else 'MISMATCH  '}  {got}")
    if not ok:
        print(f"        published: {want}")
        fails.append(f"OLD {r} did not reproduce the published spoke")

print("\n=============== NEW -- NaPTAN-backed")
for r in sorted(new):
    sp = new[r]
    print(f"  {r:5} {sp['stops']}")
    if sp.get("otherEnd"):
        print(f"        + also reaches {sp['otherEnd']} -- no spoke (DRAFT-REVIEW item 15)")

print("\n=============== ASSERTIONS")
x31, r32, r303 = new["X31"]["stops"], new["32"]["stops"], new["303"]["stops"]
checks = [
    # the reported defects
    ("X31 no longer claims Whittlesey", "Whittlesey" not in x31),
    ("X31 names Pondersbridge, which it does serve", "Pondersbridge" in x31),
    ("X31 names Bury (the one-way loop is no longer discarded)", "Bury" in x31),
    ("32 names Bury", "Bury" in r32),
    ("32 still names Whittlesey -- it really goes there", "Whittlesey" in r32),
    # regressions the first attempt at this fix introduced
    ("303 ends at Huntingdon, not the suburb Newtown", r303[-1] == "Huntingdon"),
    ("no spoke ends at a suburb of its own terminus",
     all(sp["stops"][-1] not in ("Newtown", "Hartford", "Sapley", "Fletton",
                                 "Stanground", "Westry") for sp in new.values())),
    # the town's own outskirts are not destinations from it
    ("no spoke lists Ramsey or its outskirts", all(
        not ({"Ramsey", "Ramsey Heights", "Ramsey St Marys", "Ramsey Mereside",
              "Ramsey Forty Foot"} & set(sp["stops"])) for sp in new.values())),
    # Tested as a RULE, not as a sampled output: Ramsey End is legitimately
    # thinned out of the 303's four intermediates, so asserting on the drawn list
    # would pass or fail for reasons that have nothing to do with the rule.
    ("Ramsey End is NOT treated as Ramsey's own outskirt (parent is Warboys)",
     dt.PlaceNamer(NAPTAN).of_town("0500HWARB007", "Ramsey") is False),
    ("Ramsey Heights IS treated as Ramsey's own outskirt",
     dt.PlaceNamer(NAPTAN).of_town("0500HUPWO020", "Ramsey") is True),
    # the destination that had no spoke at all
    ("303 surfaces Chatteris as a second destination",
     new["303"].get("otherEnd") == "Chatteris"),
    # nothing fell back to a raw ATCO code
    ("every place name resolved (no '<check>' anywhere)", all(
        "<check>" not in p for sp in new.values() for p in sp["stops"])),
]
for label, ok in checks:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
    if not ok:
        fails.append(label)

print()
if fails:
    print(f"RED -- {len(fails)} failure(s):")
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print("GREEN -- old behaviour reproduced exactly, new behaviour correct")
