"""Does every Python file in the engine still IMPORT?

THE CHEAPEST CHECK THERE IS, AND THE ONE THAT WAS MISSING. `gen_external_busway.js`
was selected by no town after 2026-08-03; a refactor on 2026-09-02 gave it a call
to a helper it never declared and it threw before executing a line, for a whole
day, through a re-vendor and a deploy -- with status.js PASS, 98/98 sheet verdicts,
every mutation caught and CI green in all three repositories. Nothing was wrong
with any of those gates: each of them asks *does the output still match*, and each
can only ask it of code some artefact exercises. `test/generator_load.test.js` was
written that day for the JavaScript half. This is the same question asked of the
Python half, where the exposure is worse -- several of these modules run only from
a monthly scheduled refresh or from one stage of one build, so a syntax error or a
renamed import in them would surface weeks later, to nobody.

WHAT A PASS HERE DOES NOT MEAN. That the module works. Only that it parses, that
every name it imports at module level resolves, and that nothing at its top level
raises. That is the floor, not the ceiling -- and the floor is what was absent.

THE POPULATION IS DERIVED, NEVER TYPED. `_engine.module_names()` lists the
directory, for the reason the list exists at all: a typed population cannot notice
the file nobody added to it, which is exactly the file this test is for. The
non-empty assertion is what stops a broken ENGINE_DIR reading as twenty silent
passes -- a test whose population is empty is green by arithmetic.
"""
import os
import unittest

import _engine


class ModuleLoad(unittest.TestCase):

    def test_population_is_not_empty(self):
        """A misdirected ENGINE_DIR must read as a failure, not as nothing to do."""
        names = _engine.module_names()
        self.assertGreater(len(names), 10, "found %d Python modules in %s" % (len(names), _engine.ENGINE_DIR))

    def test_population_matches_the_directory(self):
        """The list and the disk agree -- the assertion generator_load.test.js added fourth."""
        on_disk = sorted(
            f[:-3] for f in os.listdir(_engine.ENGINE_DIR)
            if f.endswith(".py") and not f.startswith("_")
        )
        self.assertEqual(_engine.module_names(), on_disk)

    def test_every_module_imports(self):
        """Each engine module is importable without drawing anything or exiting.

        This is what `if __name__ == "__main__":` buys, and it is why every script
        here has one: requiring a generator used to RUN it, so the question could
        not be asked at all. The four modules with no guard -- cli, gtfs_places,
        gtfs_regions, index_guard -- are libraries with no CLI, and they are held
        to the same standard by construction.
        """
        failures = []
        for name in _engine.module_names():
            try:
                _engine.load(name)
            except Exception as exc:                      # noqa: BLE001 -- the subject IS any exception
                failures.append("%s.py: %s: %s" % (name, type(exc).__name__, exc))
        self.assertEqual(failures, [], "module(s) failed to import:\n  " + "\n  ".join(failures))


if __name__ == "__main__":
    unittest.main()
