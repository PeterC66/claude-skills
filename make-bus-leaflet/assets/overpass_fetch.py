"""overpass_fetch.py -- ask Overpass one question, try hard, and never invent the answer.

THE FAULT THIS REPLACES (OA-339). `draft_town.py`'s `overpass()` tried two hosts
once each, a second apart, and when both failed it wrote `{"elements": []}` to the
destination file and returned it. On disk that is the same file as a town with no
landmarks, no river and no railway, and nothing downstream asks: a sheet without
its river looks like a sheet of a town without a river. `bootstrap_town.py`'s
`overpass_features()` had the same two tries; it at least reports the refusal as a
refusal (`osm_note`), but two tries is too few to reach an answer on a bad day.

THE RATE IS THE POINT. On the afternoon of 2026-09-13 Overpass answered HTTP 504 on
roughly every other request, on all three public hosts below. Eight small queries
written against the two-try pattern succeeded for one town and silently recorded
seven empty answers; re-run with twelve tries and a backoff across three hosts,
all eight came back. So the defaults here are that measurement, not a guess.

THREE RULES, and each is a line of `fetch()`:

  * RETRY PROPERLY -- `tries` attempts, cycling the hosts, sleeping a little longer
    after each failure. `draft_town.py`'s road-skeleton block already says why:
    "Unattended, a single blip would otherwise strand a half-built town."
  * RAISE, DO NOT SUBSTITUTE -- when every try fails, `OverpassUnreachable` is
    raised and nothing is returned. What the caller does with that is the caller's
    decision; making up a plausible answer is the one decision this module refuses.
  * SAY WHAT IT GOT -- one line on stderr per answer, with the element count,
    because the number a person reads is the number that looks wrong.

A REPLY IS NOT AN ANSWER UNTIL IT SAYS IT FINISHED. Overpass can answer 200 with a
`remark` of "runtime error: Query timed out ..." and whatever elements it had
collected by then -- often none. That is a failure wearing a success's status
code, and it is retried like one.

A REPLY IS NOT CURRENT UNTIL ITS DATA DATE SAYS SO (buses-data OA-528). Every
Overpass reply carries `osm3s.timestamp_osm_base`, the date of the OSM data it was
answered from, and the mirrors lag. On 2026-09-29 overpass.kumi.systems answered
March's landmark pull with 159 elements and no Budgens while overpass-api.de had
160; only an eye caught it. So `fetch()` can be told `not_before`, the oldest data
date the caller will accept: a reply from older data -- or one that does not say --
is retried like a failure, which moves the question on to the next host. Pass a
`source` dict to learn which host answered and its data date, and
`main_host_base()` asks the main host alone what date its data is, so a caller
answered by a mirror can tell whether it was told the current answer.

`urlopen` and `sleep` are looked up at call time, so a test that replaces
`urllib.request.urlopen` or `time.sleep` for its duration reaches this module too.
"""
import json
import sys
import time
import urllib.parse
import urllib.request

HOSTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
TRIES = 12
BACKOFF_S = 2          # sleep BACKOFF_S * n after the n-th failure: 132 s at worst
UA = {"User-Agent": "make-bus-leaflet/1.0 (overpass_fetch)"}


class OverpassUnreachable(RuntimeError):
    """Every try failed. The question was not answered -- which is not `no`."""


def _failed_remark(d):
    """The `remark` of a reply that stopped before it finished, else None."""
    remark = d.get("remark") if isinstance(d, dict) else None
    if remark and ("runtime error" in remark or "timed out" in remark):
        return remark
    return None


def osm_base(d):
    """The reply's `osm3s.timestamp_osm_base` -- the date of the data it answers from -- or None."""
    base = ((d.get("osm3s") or {}) if isinstance(d, dict) else {}).get("timestamp_osm_base")
    return base if isinstance(base, str) and base else None


def fetch(query, timeout=90, tries=TRIES, hosts=HOSTS, sleep=None, label="overpass", log=None,
          not_before=None, source=None):
    """POST `query` to Overpass and return the parsed reply, or raise OverpassUnreachable.

    `label` names the answer in the stderr line (a destination file's name reads
    best). `sleep` and `log` default to `time.sleep` and `sys.stderr`, resolved at
    call time. `not_before` is the oldest `timestamp_osm_base` accepted (ISO, Z --
    Overpass's own format, so the strings order as the dates do); an older or
    undated reply is retried. `source`, if a dict, is filled with `host` and
    `osmBase` of the reply returned.
    """
    sleep = sleep or time.sleep
    log = log or sys.stderr
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for n in range(1, tries + 1):
        host = hosts[(n - 1) % len(hosts)]
        try:
            req = urllib.request.Request(host, data=body, headers=UA)
            d = json.load(urllib.request.urlopen(req, timeout=timeout))
            if not isinstance(d, dict) or not isinstance(d.get("elements"), list):
                raise ValueError("reply has no elements list")
            remark = _failed_remark(d)
            if remark:
                raise ValueError("incomplete reply: " + remark)
            base = osm_base(d)
            if not_before and (base is None or base < not_before):
                raise ValueError("stale reply: data of %s, older than %s" % (base or "no stated date", not_before))
        except Exception as exc:                  # noqa: BLE001 -- any failure is a retry
            last = "%s: %s" % (type(exc).__name__, exc)
            log.write("%s: try %d/%d failed at %s (%s)\n" % (label, n, tries, host, last))
            if n < tries:
                sleep(BACKOFF_S * n)
            continue
        log.write("%s: %d elements (try %d/%d, %s, data of %s)\n"
                  % (label, len(d["elements"]), n, tries, host, base or "no stated date"))
        if isinstance(source, dict):
            source.update(host=host, osmBase=base)
        return d
    raise OverpassUnreachable("%s: no Overpass host answered in %d tries; last: %s" % (label, tries, last))


def main_host_base(tries=3, sleep=None, log=None):
    """The data date of the MAIN host (HOSTS[0]) alone, asked with a query that returns
    nothing, or raise OverpassUnreachable. Never falls to a mirror: the point is to
    learn what the host the mirrors copy from has."""
    d = fetch("[out:json][timeout:25];node(1);out ids;", timeout=30, tries=tries, hosts=HOSTS[:1],
              sleep=sleep, label="main host data date", log=log)
    base = osm_base(d)
    if base is None:
        raise OverpassUnreachable("main host data date: %s answered without a timestamp_osm_base" % HOSTS[0])
    return base
