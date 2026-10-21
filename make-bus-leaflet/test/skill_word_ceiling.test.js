/*
 * skill_word_ceiling.test.js — `bus-work/SKILL.md` has a word ceiling
 * (buses-data OA-646).
 *
 * The file was 9,571 words on the evening of 18 September 2026 and 16,073 on
 * 21 October, about 210 words a day, most of it reference for single tools, and
 * nothing limited it. Scheduled ticks do not read it; every interactive
 * `/bus-work` session loads all of it. OA-646 moved the per-tool reference into
 * `bus-work/references/tool-reference.md`, leaving a rule sentence and the
 * command for each tool, and set this ceiling about 500 words above the size
 * that left: 7,885 rendered words.
 *
 * The count is the one buses-data's `Documentation/check-doc-coverage.mjs`
 * applies to its CLAUDE.md (RULEBOOK_WORD_CEILING): RENDERED words, so a fenced
 * block, an HTML comment and a link's target cost nothing, and a link costs its
 * text. On a reference-heavy page that matters: the same file was 16,073 words
 * to `wc -w` and 11,734 rendered before the cut, the difference being anchors.
 *
 * Over the ceiling, move the detail to a page under `bus-work/references/` and
 * leave the rule and its command, or raise SKILL_WORD_CEILING here so the
 * decision is in the diff.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SKILL_WORD_CEILING = 8350;
const SKILL = path.resolve(__dirname, '..', '..', 'bus-work', 'SKILL.md');

function renderedWords(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/\s+/).filter(Boolean).length;
}

test('bus-work/SKILL.md is within its word ceiling', () => {
  const words = renderedWords(fs.readFileSync(SKILL, 'utf8'));
  assert.ok(words <= SKILL_WORD_CEILING,
    `bus-work/SKILL.md is ${words} rendered words against a ceiling of ${SKILL_WORD_CEILING}. ` +
    'Move the detail to a page under bus-work/references/ and leave the rule and its command, ' +
    'or raise SKILL_WORD_CEILING in make-bus-leaflet/test/skill_word_ceiling.test.js so the decision is in the diff.');
});

test('the count leaves out fenced blocks, comments and link targets, and counts the rest', () => {
  // Without this a counter that returned 0 would pass the ceiling for ever.
  assert.strictEqual(renderedWords('one two\n```\nthree four\n```\n<!-- five -->\n[six](seven/eight.md#nine)'), 3);
});
