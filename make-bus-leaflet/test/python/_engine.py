"""_engine.py -- how every Python test in this folder finds the code under test.

The sibling of `test/_engine.js`, and for the same reason: a suite is only worth
having if it has been SEEN to go red, and the honest way to see that is to break
the engine rather than to break the test. Every module is imported through
ENGINE_DIR, so a mutation run is

    npm run test:prove-red-python        (tools/prove-red-python.py)

which copies assets/ to a scratch directory, makes one deliberate edit per case,
and asserts which tests object. Nothing under assets/ is touched: every file
there is vendored into the portal and drift-checked by status.js, so an edit in
place would surface as portal drift the next morning.

Unset, ENGINE_DIR is the real engine, which is what CI and `npm run test:python`
run.

WHY `load()` RATHER THAN A BARE `import`. ENGINE_DIR is a directory chosen at run
time, so the module has to be imported BY PATH; `importlib` is the stdlib way to
do that and it keeps the engine copy under a private name, which is what stops a
test importing the real `assets/` copy by accident while a mutated one is under
test. The mutation harness runs each case in its own process, so nothing here
has to defeat `sys.modules`.
"""
import importlib.util
import os
import sys

ENGINE_DIR = os.path.abspath(
    os.environ.get("ENGINE_DIR")
    or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets")
)


def module_names():
    """Every Python module in the engine, DERIVED from the directory.

    Derived rather than typed, for the reason `test/generator_load.test.js`
    exists: a hand-kept list cannot notice the file nobody listed, which is the
    only file an import test is there to protect.
    """
    return sorted(
        f[:-3] for f in os.listdir(ENGINE_DIR)
        if f.endswith(".py") and not f.startswith("_")
    )


def load(name):
    """Import `<ENGINE_DIR>/<name>.py` under a private name, fresh every time."""
    path = os.path.join(ENGINE_DIR, name + ".py")
    spec = importlib.util.spec_from_file_location("engine_under_test_" + name, path)
    mod = importlib.util.module_from_spec(spec)
    # Registered before exec so a module that imports itself, or that another
    # engine module imports, resolves rather than re-entering.
    sys.modules[spec.name] = mod
    saved = sys.path[:]
    # A few engine modules import their siblings (`import cli`, `import
    # gtfs_query as gq`). Those have to resolve against the copy under test, not
    # against the real assets/, or a mutation run would half-load each.
    sys.path.insert(0, ENGINE_DIR)
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.path[:] = saved
    return mod
