"""cli.py -- the Python half of the one estate resolver (OA-224 Tier 3.1).

Six argparse scripts used to declare the laptop's own path as the `--root`
default, so there was no way to say where the estate is on any other machine.
The order is stated in `references/conventions.md` and implemented identically in
`cli.js`: THE FLAG, then the environment variable, then the laptop.

`resolve_buses(value, env)` takes `env` as a parameter and its docstring says why
-- "so a test can put the middle step under a microscope without mutating the
process". That test is this file; it did not exist until 2026-09-11.
"""
import os
import unittest

import _engine

cli = _engine.load("cli")


class ResolveBuses(unittest.TestCase):

    def test_the_flag_wins(self):
        self.assertEqual(cli.resolve_buses("/given/estate", {"BUSES_DIR": "/env/estate"}),
                         os.path.abspath("/given/estate"))

    def test_the_environment_variable_is_next(self):
        self.assertEqual(cli.resolve_buses(None, {"BUSES_DIR": "/env/estate"}),
                         os.path.abspath("/env/estate"))

    def test_the_laptop_is_the_LAST_resort_and_not_the_first(self):
        self.assertEqual(cli.resolve_buses(None, {}), os.path.abspath(cli.LAPTOP_BUSES))

    def test_an_EMPTY_flag_loses_to_the_environment(self):
        """The reason the callers pass `default=None`: a default filled in by
        argparse is indistinguishable from one the caller passed, and would beat
        the environment variable it is meant to lose to. An empty string has to
        fall through for that contract to hold."""
        self.assertEqual(cli.resolve_buses("", {"BUSES_DIR": "/env/estate"}),
                         os.path.abspath("/env/estate"))

    def test_an_empty_environment_variable_falls_through_to_the_laptop(self):
        self.assertEqual(cli.resolve_buses(None, {"BUSES_DIR": ""}), os.path.abspath(cli.LAPTOP_BUSES))

    def test_the_answer_is_always_absolute(self):
        """Callers join paths onto it, so a relative answer would resolve against
        whatever folder a stage script happened to be left in."""
        self.assertTrue(os.path.isabs(cli.resolve_buses("relative/estate", {})))

    def test_env_defaults_to_the_real_environment(self):
        """Omitting `env` must read os.environ rather than {} -- otherwise every
        caller that does not pass it silently skips the middle step."""
        os.environ["BUSES_DIR"] = os.path.abspath("/env/from/os/environ")
        self.addCleanup(os.environ.pop, "BUSES_DIR", None)
        self.assertEqual(cli.resolve_buses(None), os.path.abspath("/env/from/os/environ"))


class ResolvePortal(unittest.TestCase):
    """The same three steps over a DIFFERENT variable -- the two must not share one."""

    def test_the_flag_wins(self):
        self.assertEqual(cli.resolve_portal("/given/portal", {"BUSMAPS_PORTAL": "/env/portal"}),
                         os.path.abspath("/given/portal"))

    def test_it_reads_BUSMAPS_PORTAL_and_not_BUSES_DIR(self):
        self.assertEqual(cli.resolve_portal(None, {"BUSES_DIR": "/env/estate"}),
                         os.path.abspath(cli.LAPTOP_PORTAL))
        self.assertEqual(cli.resolve_portal(None, {"BUSMAPS_PORTAL": "/env/portal"}),
                         os.path.abspath("/env/portal"))

    def test_the_two_laptop_constants_are_different_places(self):
        self.assertNotEqual(os.path.abspath(cli.LAPTOP_BUSES), os.path.abspath(cli.LAPTOP_PORTAL))


if __name__ == "__main__":
    unittest.main()
