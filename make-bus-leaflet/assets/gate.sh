#!/usr/bin/env bash
# Byte-identical gate harness for make-bus-leaflet generators.
# Usage: gate.sh <genfile> <datadir> <map> <committed_svg>
#   runs <genfile> in a temp copy of <datadir>, writes <map>.svg, diffs vs <committed_svg>.
set -u
GEN="$1"; DATA="$2"; MAP="$3"; REF="$4"
SK="C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets"
TMP="$(mktemp -d)"
cp "$DATA"/*.json "$TMP"/ 2>/dev/null
cp "$SK/icons.js" "$TMP"/icons.js
cp "$GEN" "$TMP/gen_$MAP.js"
( cd "$TMP" && node "gen_$MAP.js" >/dev/null 2>"$TMP/err.txt" )
if [ ! -f "$TMP/$MAP.svg" ]; then echo "FAIL(no svg): $(basename "$GEN") -> $REF"; sed 's/^/   /' "$TMP/err.txt"; rm -rf "$TMP"; exit 2; fi
if diff -q "$TMP/$MAP.svg" "$REF" >/dev/null; then
  echo "PASS: $(basename "$GEN") + $(basename "$DATA") == $(basename "$REF")  ($(wc -c <"$TMP/$MAP.svg") bytes)"
  rm -rf "$TMP"; exit 0
else
  echo "DIFF: $(basename "$GEN") + $(basename "$DATA") != $(basename "$REF")"
  diff "$TMP/$MAP.svg" "$REF" | head -20
  echo "  (temp kept: $TMP)"
  exit 1
fi
