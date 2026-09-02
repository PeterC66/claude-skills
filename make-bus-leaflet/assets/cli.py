"""cli.py -- the Python half of the one estate resolver.

OA-224 Tier 3.1, and the sibling of `cli.js`. Six argparse scripts here declared
`default=r"C:\\u3a St Ives\\Using AI\\Buses"` on `--root` or `--buses-root`, which
is the laptop as the hard fallback with no way to say where the estate is on any
other machine. The order is the one `references/conventions.md` states under
"Flags" and the one `cli.js` implements: the flag, then `BUSES_DIR`, then the
laptop.

Deliberately tiny and dependency-free. `argparse` already does the parsing well;
what was duplicated was the DEFAULT, not the parser, so this fixes the default and
leaves argparse alone. Use it as:

    import cli
    ap.add_argument("--root", default=None)
    ...
    root = cli.resolve_buses(a.root)

with `default=None` rather than the laptop string, because a default filled in by
argparse is indistinguishable from one the caller passed and would beat the
environment variable it is meant to lose to.
"""
import os

# The laptop, named once. Kept in the forward-slash form `cli.js` uses; os.path
# handles both on Windows and nothing here is compared as a string.
LAPTOP_BUSES = "C:/u3a St Ives/Using AI/Buses"
LAPTOP_PORTAL = "C:/Claude/community-bus-maps"


def resolve_buses(value=None, env=None):
    """Where the map estate is: the flag, then BUSES_DIR, then the laptop.

    `env` is a parameter rather than a read of os.environ so a test can put the
    middle step under a microscope without mutating the process.
    """
    env = os.environ if env is None else env
    return os.path.abspath(value or env.get("BUSES_DIR") or LAPTOP_BUSES)


def resolve_portal(value=None, env=None):
    """The portal checkout: the flag, then BUSMAPS_PORTAL, then the laptop."""
    env = os.environ if env is None else env
    return os.path.abspath(value or env.get("BUSMAPS_PORTAL") or LAPTOP_PORTAL)
