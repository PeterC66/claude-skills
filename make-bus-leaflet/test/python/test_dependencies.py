"""Is every third-party import the engine makes DECLARED, and does CI install it?

THE FAULT THIS IS WRITTEN ABOUT. `test_module_load.py` shipped on 2026-09-11 and
was green on the laptop, because the laptop has had python-docx installed on it
for a year. Its first CI run went red: `gen_disagreements.py` and
`gen_verification.py` import `docx`, no runner has it, the control failed and the
whole falsification harness stopped without asking a single mutation. The
dependency was real and undeclared, and `npm ci` cannot see a Python import, so
nothing in three repositories had ever been in a position to notice.

The install alone would have cleared that red and taught nothing. The question
worth asking is the JOIN: **every third-party module the engine imports is named
in `requirements.txt`, and the workflow installs that file before it runs any
Python.** A written claim about coverage is a claim about a join, and only the
join can check it -- which this project has already paid for once, when
`test:prove-red-gates` was described in three documents as running in CI for five
days while `git log -S` over `gates.yml` returned nothing.

WHY `ast` AND NOT A GREP. `gtfs_places.py` has a docstring whose line begins "from
the CI reference mirror says so..." at column 0. A line-based parser reads that as
an import of a package called `the`, and a checker that invents a finding out of
prose is one somebody mutes in its first week. `ast` is the stdlib answer and it
cannot be fooled by a sentence.

WHAT COUNTS AS THIRD-PARTY IS DERIVED, NEVER TYPED. A name is third-party when it
is neither in `sys.stdlib_module_names` nor the basename of a `.py` file sitting
beside the module that imports it. Both halves come from the machine and the
directory, so the file nobody added to a list is exactly the file this notices.
"""
import ast
import io
import os
import re
import sys
import unittest

import _engine

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, "..", ".."))
SKILLS = os.path.abspath(os.path.join(ENGINE, ".."))
REQUIREMENTS = os.path.join(ENGINE, "requirements.txt")
WORKFLOW = os.path.join(SKILLS, ".github", "workflows", "gates.yml")

# `# imported as: docx` on a requirements line. The distribution name is what pip
# installs; the import name is what a traceback says; they are not the same string
# and the gap is where this whole class of fault lives.
DECLARATION = re.compile(r"^\s*([A-Za-z0-9._-]+)\s*[=<>!~]*[^#]*#\s*imported as:\s*([A-Za-z0-9_]+)\s*$")


def read(path):
    with io.open(path, encoding="utf-8") as fh:
        return fh.read()


def imported_names(path):
    """Every top-level package name imported anywhere in one Python file."""
    names = set()
    for node in ast.walk(ast.parse(read(path), filename=path)):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            # A relative import (`from . import x`) has no module to name.
            if node.level == 0 and node.module:
                names.add(node.module.split(".")[0])
    return names


def third_party(directory):
    """{import name: [the files that import it]} for one directory of modules."""
    siblings = {f[:-3] for f in os.listdir(directory) if f.endswith(".py")}
    found = {}
    for filename in sorted(f for f in os.listdir(directory) if f.endswith(".py")):
        for name in imported_names(os.path.join(directory, filename)):
            if name in siblings or name in sys.stdlib_module_names or name == "__future__":
                continue
            found.setdefault(name, []).append(filename)
    return found


def declared():
    """{import name: distribution} as `requirements.txt` states it."""
    out = {}
    for line in read(REQUIREMENTS).splitlines():
        if line.strip().startswith("#") or not line.strip():
            continue
        m = DECLARATION.match(line)
        if m:
            out[m.group(2)] = m.group(1)
    return out


class Declaration(unittest.TestCase):

    def test_the_requirements_file_exists(self):
        """A missing file must FAIL, never read as "nothing to declare"."""
        self.assertTrue(os.path.isfile(REQUIREMENTS), "no requirements.txt at %s" % REQUIREMENTS)

    def test_every_line_is_parseable_as_a_declaration(self):
        """A pin without `# imported as:` is invisible to this test, so it is a failure.

        This is the half that keeps the check honest: without it, the way to make
        the test below pass is to write a line it cannot read.
        """
        bad = []
        for line in read(REQUIREMENTS).splitlines():
            if line.strip() and not line.strip().startswith("#") and not DECLARATION.match(line):
                bad.append(line)
        self.assertEqual(bad, [], "requirement line(s) with no `# imported as: <name>` comment:\n  " + "\n  ".join(bad))

    def test_the_population_is_not_empty(self):
        """A misdirected ENGINE_DIR must read as a failure, not as nothing to do."""
        count = len([f for f in os.listdir(_engine.ENGINE_DIR) if f.endswith(".py")])
        self.assertGreater(count, 10, "found %d Python files in %s" % (count, _engine.ENGINE_DIR))

    def test_every_third_party_import_is_declared(self):
        """The engine imports nothing a fresh machine would not have been given.

        Read through ENGINE_DIR, so `tools/prove-red-python.py` can add an
        undeclared import to a scratch copy and watch this go red.
        """
        undeclared = {}
        names = declared()
        for name, files in sorted(third_party(_engine.ENGINE_DIR).items()):
            if name not in names:
                undeclared[name] = files
        self.assertEqual(
            undeclared, {},
            "third-party import(s) in no requirements.txt line:\n  " + "\n  ".join(
                "%s (imported by %s)" % (n, ", ".join(f)) for n, f in sorted(undeclared.items())))

    def test_nothing_declared_is_unused(self):
        """A pin nobody imports is a cost with no reason, and usually a leftover.

        Read against the REAL engine and its tools rather than ENGINE_DIR: this
        direction is a fact about the repository, and a mutation run pointed at a
        scratch copy of `assets/` alone must not read it as a stale pin.
        """
        used = set(third_party(os.path.join(ENGINE, "assets")))
        used |= set(third_party(os.path.join(ENGINE, "tools")))
        stale = sorted(n for n in declared() if n not in used)
        self.assertEqual(stale, [], "declared but imported nowhere: %s" % ", ".join(stale))


class InstalledByCI(unittest.TestCase):
    """The other half of the join. A declaration nothing installs is a comment."""

    def setUp(self):
        self.assertTrue(os.path.isfile(WORKFLOW), "no workflow at %s" % WORKFLOW)
        self.yml = read(WORKFLOW)

    def test_the_workflow_installs_the_requirements_file(self):
        self.assertRegex(self.yml, r"pip install -r requirements\.txt")

    def test_it_installs_BEFORE_it_runs_any_python(self):
        """Installed after the suite is installed for nobody -- and that IS the red
        this file was written about, one step earlier in the same job."""
        install = self.yml.index("pip install -r requirements.txt")
        harness = self.yml.index("npm run test:prove-red-python")
        self.assertLess(install, harness)


if __name__ == "__main__":
    unittest.main()
