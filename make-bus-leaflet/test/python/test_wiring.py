"""Does anything actually RUN this suite, and its harness, in CI?

A written claim about coverage is a claim about a JOIN, and only the JOIN can
check it. This project has paid for that sentence: `test:prove-red-gates` was
described in three documents as running in CI from 2026-08-28, and `git log -S`
over `gates.yml` returned nothing until 2026-09-02 -- the mutation suite that
makes the unit suite's green mean anything had never run anywhere but one laptop,
while three documents said in the same font that it had. `tools/check-wiring.js`
was written to end that, and it asks its question of every script naming a file in
`tools/`.

**`test:python` is outside that filter by construction**, because it names
`test/python/run.py` rather than a tool -- exactly as `npm test` does, and for the
same reason. So the one script whose absence from CI would make this whole folder
decorative is the one `check-wiring.js` cannot see. This file is that join, asked
from the only other place that can ask it.

It reads `gates.yml` at the repository root. `actions/checkout` places the
repository at `skills/` in CI while it IS the root on this laptop, so the path is
resolved relative to the ENGINE folder -- the same two hops `check-wiring.js`
makes -- and is therefore identical in both.
"""
import io
import json
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, "..", ".."))
SKILLS = os.path.abspath(os.path.join(ENGINE, ".."))
WORKFLOW = os.path.join(SKILLS, ".github", "workflows", "gates.yml")


def read(path):
    with io.open(path, encoding="utf-8") as fh:
        return fh.read()


class Wiring(unittest.TestCase):

    def setUp(self):
        self.scripts = json.loads(read(os.path.join(ENGINE, "package.json")))["scripts"]

    def test_the_workflow_is_where_this_file_says_it_is(self):
        """A missing workflow must FAIL, never read as "nothing to check"."""
        self.assertTrue(os.path.isfile(WORKFLOW), "no workflow at %s" % WORKFLOW)

    def test_package_json_declares_both_scripts(self):
        self.assertEqual(self.scripts.get("test:python"), "python3 test/python/run.py")
        self.assertEqual(self.scripts.get("test:prove-red-python"), "python3 tools/prove-red-python.py")

    def test_the_runner_and_the_harness_are_both_on_disk(self):
        self.assertTrue(os.path.isfile(os.path.join(ENGINE, "test", "python", "run.py")))
        self.assertTrue(os.path.isfile(os.path.join(ENGINE, "tools", "prove-red-python.py")))

    def test_CI_runs_the_suite_THROUGH_its_npm_script(self):
        """Through the script, not by rebuilding the command.

        Four python harnesses were once `python` in package.json and `python3` in
        the workflow, so `npm run <name>` and the CI step of that name were
        different commands. A step that rebuilds the command can drift from the
        script it claims to be running, and nothing would say so.
        """
        yml = read(WORKFLOW)
        self.assertRegex(yml, r"npm run test:python(\s|$)")
        self.assertRegex(yml, r"npm run test:prove-red-python(\s|$)")

    def test_the_harness_runs_BEFORE_the_suite(self):
        """A suite that has never been seen to go red is not yet evidence, so the
        falsification is the step that has to fail first."""
        yml = read(WORKFLOW)
        harness = yml.index("npm run test:prove-red-python")
        suite = re.search(r"npm run test:python(\s|$)", yml).start()
        self.assertLess(harness, suite)


if __name__ == "__main__":
    unittest.main()
