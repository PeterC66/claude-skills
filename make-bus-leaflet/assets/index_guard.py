#!/usr/bin/env python3
"""Build a lookup from a list and REFUSE to lose a row. The Python half of
`index_guard.js`; read that file's header for the reasoning, which is the same.

In short: `{s["route"]: s for s in services}` is not an index, it is an index AND
a silent de-duplication, and nothing distinguishes the two afterwards. Wisbech runs
two route 46s (Stagecoach East to March, Lynx to King's Lynn), so on that one town
the comprehension above turns eleven services into ten entries and the survivor
wears the other's facts. Measured 2026-08-28: `gtfs_refresh_report.py` had been
diffing the LYNX 46 against BODS every month and had never once checked the
Stagecoach one. See OA-134.

The guard is the cheapest possible one -- assert the resulting dict's size equals
the source list's length -- and it is the only thing that tells "indexed" from
"silently deduplicated".
"""


def service_key(s):
    """The identity of a service row: its `key` if the data carries one, else its
    route number. Never the number alone when a key exists.

    `key` is present on 4 of 8 towns and 0 of 12 places (measured 2026-08-28), so
    on most maps this IS the route number and the behaviour is unchanged. The
    fallback is not the protection; `index_unique` is.
    """
    if not isinstance(s, dict):
        return str(s)
    k = s.get("key")
    if k in (None, ""):
        k = s.get("route")
    return str(k)


def index_unique(items, key=service_key, what="list"):
    """-> dict, raising ValueError rather than letting a row overwrite another."""
    rows = list(items or [])
    out, first = {}, {}
    clashes = {}
    for i, row in enumerate(rows):
        k = key(row)
        if k in out:
            clashes.setdefault(k, [first[k]]).append(i)
        out[k] = row
        first.setdefault(k, i)
    if clashes:
        raise ValueError(_message(what, rows, clashes))
    return out


def group_by(items, key=service_key):
    """-> dict of LISTS. The honest answer when a key genuinely is not unique:
    keep every row and let the caller decide which one it meant."""
    out = {}
    for row in (items or []):
        out.setdefault(key(row), []).append(row)
    return out


def assert_no_collision(mapping, items, what):
    """The assertion on its own, for a dict somebody else built."""
    n = len(list(items or []))
    if len(mapping) != n:
        raise ValueError(
            "%s: indexed %d row(s) into %d entries -- %d were silently overwritten. "
            "A route NUMBER is not unique (Wisbech runs two 46s); index on the `key` "
            "field the data carries, not on `route`. See OA-134." %
            (what, n, len(mapping), n - len(mapping)))


def _message(what, rows, clashes):
    parts = []
    for k, idxs in clashes.items():
        who = " vs ".join(
            "#%d %s%s" % (i, (rows[i] or {}).get("route", "?"),
                          (" (%s)" % rows[i]["operator"]) if isinstance(rows[i], dict) and rows[i].get("operator") else "")
            for i in idxs)
        parts.append("'%s' <- %s" % (k, who))
    return ("%s: %d colliding key(s) -- %s. A route NUMBER is not unique (Wisbech runs "
            "two 46s, Stagecoach East and Lynx); index on the `key` field the data "
            "carries, and where there is no key, tell the two apart by OPERATOR -- it is "
            "the only thing that does. See OA-134." % (what, len(clashes), "; ".join(parts)))
