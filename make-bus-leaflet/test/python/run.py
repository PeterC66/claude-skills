#!/usr/bin/env python3
"""run.py -- the engine's Python unit suite, the sibling of `node --test`.

Run it from the skill root (`make-bus-leaflet`), with no arguments and no
placeholders:

    npm run test:python

WHY THIS EXISTS. Twenty of the engine's files are Python and until 2026-09-11 not
one of them had a unit test or anywhere to put one -- `npm test` is `node --test`
and reaches only the `.js` half, so the Python half was carried entirely by the
byte gates. A byte gate can only ask *does the output still match*, so it says
nothing at all about a file no committed map runs, and nothing about a helper
whose fault does not move a pixel. That is the gap `test/generator_load.test.js`
was written for on the JavaScript side after `gen_external_busway.js` threw at
load for a whole day with every gate green; `test_module_load.py` is the same
question asked of the Python half. OA-001 in buses-data named "the Python half
still needs its own runner" as one of its three remainders.

WHAT IT RUNS. Every `test_*.py` beside this file, through stdlib `unittest` --
no pytest, so it needs nothing installed and CI needs no setup step beyond the
`python3` ubuntu-latest already has. The modules under test are reached through
`_engine.py`'s ENGINE_DIR indirection, which is what lets
`tools/prove-red-python.py` point the same suite at a mutated copy.

Exit 0 when every test passes, 1 when any fails -- the convention in
`references/conventions.md`, and what the CI step reads.
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    suite = unittest.defaultTestLoader.discover(HERE, pattern="test_*.py", top_level_dir=HERE)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
