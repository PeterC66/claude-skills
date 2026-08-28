/*
 * line_endings.js — normalise CRLF to LF, on the BYTES, in one place.
 *
 * WHY THIS IS ITS OWN FILE. Three separate places in this engine need the same
 * eight lines, and on 2026-08-28 two of them were written independently, hours
 * apart, WITH THE SAME BUG — the second copied from the first. That is the shape
 * this project already has a backlog row for (OA-135, four implementations of
 * colour luminance that are not the same function), caught early enough here to
 * be worth collapsing rather than cataloguing.
 *
 * WHY ON THE BYTES, AND NOT THROUGH A STRING. The obvious spelling is
 *
 *     buf.toString('utf8').replace(<CRLF regex>, <LF>)
 *
 * and it SILENTLY REWRITES every byte that is not legal UTF-8: the decode turns
 * each one into U+FFFD and the re-encode writes that replacement character back.
 * Written that way in sync_ci_reference.js, it corrupted a tracked byte fixture
 * on its first run — March's atco2name_all.json carries a raw 0x92, the CP1252
 * right single quote in "Ramsey St Mary's", and ten lines came back mangled.
 * That data is exactly where such bytes live: stop names, operator strings,
 * anything exported from a Windows tool. A newline fix that quietly edits the
 * TEXT is worse than the newlines it was fixing.
 *
 * The same spelling was in engine_version.js too, where it would have damaged no
 * file — it only hashes — but would have left the engine hash blind to every
 * change inside a mangled run, which is the same fault wearing a quieter coat.
 *
 * WHY ONLY A PAIR. A CR is dropped only when the next byte is LF. A lone CR is
 * content, not a line ending, and treating it as one lets a real difference
 * vanish. test/line_endings.test.js pins both halves, and tools/prove-red.js
 * carries a mutation for each.
 *
 * Zero dependencies, matching the rest of assets/.
 */
'use strict';

const CR = 0x0d;
const LF = 0x0a;

/** CRLF -> LF over a Buffer, byte for byte. Returns a Buffer; input untouched. */
function lfBytes(buf) {
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === CR && buf[i + 1] === LF) continue;
    out[n++] = buf[i];
  }
  return out.subarray(0, n);
}

/** True when two Buffers differ only in CRLF-vs-LF line endings. */
function sameBytesIgnoringLineEndings(a, b) {
  return lfBytes(a).equals(lfBytes(b));
}

module.exports = { lfBytes, sameBytesIgnoringLineEndings };
