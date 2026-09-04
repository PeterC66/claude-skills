"""Audit the docstamps that are actually COMMITTED, not the ones on disk.

docstamp.py --check hashes the working tree. Nothing gates the commit, so a document
edited and committed before the Stop hook next fires goes into git carrying the
previous version, date and sha — and a stale stamp looks exactly as authoritative as
a correct one to anyone reading the file out of the repo. --check cannot catch this,
because by the time it runs the working tree has already been fixed.

This hashes HEAD's blobs instead and reports any file whose committed stamp does not
describe its committed content. It honours the same exclusions as the stamper, so
_archive and other out-of-policy trees are counted but not judged.

  python check_committed_stamps.py                      # repos from stamp-policy.json
  python check_committed_stamps.py <repo> [<repo>...]   # explicit repo roots
  python check_committed_stamps.py --staged             # the INDEX, for a pre-commit hook

--staged is the same comparison against a different ref, and it is the one that can
STOP the fault instead of reporting it minutes later in CI. It reads the blobs about
to be committed (`:<path>`) rather than HEAD's, and it looks ONLY at the .md files in
this commit, and only those the stamp policy actually maintains — deliberately,
because a document that was already stale before this
change is not this commit's fault, and a hook that refuses an unrelated commit is a
hook that gets `--no-verify`'d within a week. CI still audits everything; this guards
the edit in front of you. Operates on the repository containing the current directory.

A named repo is matched back to its policy root, by path and then by that root's
checkoutDirNames — because a CI checkout lives at $GITHUB_WORKSPACE/<repo> and can
never match a laptop path. Until 2026-08-31 a named repo was audited with NO
exclusions, which was green for exactly as long as nobody edited a file in an
excluded tree. The day a round repointed the links inside nine documents it was
archiving, CI went red about nine files the stamper refuses to stamp: a truthful
finding with no available fix, which is the worst kind. A repo matching no root is
still audited without exclusions and SAYS so — a silent filter is the worse of the
two failures.

Exits 1 if anything is stale, so it can gate a commit or run in CI.
"""
import fnmatch
import importlib.util
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import policy as _shared_policy  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def load_docstamp():
    spec = importlib.util.spec_from_file_location(
        'docstamp', os.path.join(HERE, 'docstamp.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def repos_from_policy():
    """Policy roots that are git repositories, as (path, root_cfg) pairs.

    The config travels with the path so the audit can apply the same exclusions
    the stamper does — see in_scope().
    """
    # Through policy.py so the baseline exclusions reach this audit too. Loading
    # the JSON here would give the stamper and its auditor different scopes, which
    # is the fault OA-235 is about, one level down.
    try:
        data = _shared_policy.load_policy()
    except OSError:
        return []
    out, seen = [], set()
    for root in (data.get('roots') or []):
        cfg = root if isinstance(root, dict) else {'path': root}
        p = cfg.get('path')
        if not p:
            continue
        p = os.path.abspath(os.path.expandvars(os.path.expanduser(p)))
        if os.path.isdir(os.path.join(p, '.git')) and p not in seen:
            seen.add(p)
            out.append((p, cfg))
    return out


def repos_from_policy_all():
    """Every policy root, present on this disk or not.

    repos_from_policy() keeps only roots that exist AND are git repos, which is
    right for "audit everything" and wrong for "which root is this path": in CI
    none of the laptop paths exists, so that list is empty and every named repo
    would fall through to no exclusions at all.
    """
    # Through policy.py so the baseline exclusions reach this audit too. Loading
    # the JSON here would give the stamper and its auditor different scopes, which
    # is the fault OA-235 is about, one level down.
    try:
        data = _shared_policy.load_policy()
    except OSError:
        return []
    out = []
    for root in (data.get('roots') or []):
        cfg = root if isinstance(root, dict) else {'path': root}
        p = cfg.get('path')
        if p:
            out.append((os.path.abspath(os.path.expandvars(os.path.expanduser(p))), cfg))
    return out


def cfg_for(repo):
    """The policy root this path IS, so a named repo gets the same exclusions.

    Absolute path first, then the root's `checkoutDirNames` — the names the same
    repository goes by when it is checked out somewhere else. Returns {} when
    nothing matches, which is the old behaviour, and main() announces it.
    """
    target = os.path.normcase(os.path.abspath(repo))
    base = os.path.basename(os.path.abspath(repo))
    fallback = None
    for path, cfg in repos_from_policy_all():
        if os.path.normcase(path) == target:
            return cfg
        if base in (cfg.get('checkoutDirNames') or []):
            fallback = cfg
    return fallback or {}


def in_scope(rel, cfg):
    """Does this repo-relative path fall inside what docstamp actually maintains?

    git ls-files lists everything tracked, including the _archive and
    .impeccable/critique trees the policy deliberately excludes. Auditing files
    the stamper never touches reports drift that is correct behaviour, so mirror
    discover()'s three exclusion rules here.
    """
    parts = rel.split('/')
    dirs = parts[:-1]
    for name in cfg.get('excludeDirNames', []):
        if name in dirs:
            return False
    for pat in cfg.get('excludeDirPatterns', []):
        if any(fnmatch.fnmatch(d, pat) for d in dirs):
            return False
    return not any(fnmatch.fnmatch(rel, g) for g in cfg.get('excludeGlobs', []))


def git(repo, *args):
    return subprocess.run(['git', *args], cwd=repo, capture_output=True)


def check_staged(ds):
    """Compare each STAGED .md against the stamp in the very blob being committed.

    Why the index and not the working tree: `docstamp.py --check` hashes what is on
    disk, and by the time a pre-commit hook runs the disk copy may already have been
    fixed by the Stop hook while the STAGED copy is still the stale one. The index is
    what git is about to write, so it is the only thing that answers the question the
    commit is actually asking.
    """
    top = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True)
    if top.returncode:
        print('not inside a git repository — nothing to check')
        return 0
    repo = top.stdout.decode('utf-8', 'replace').strip()

    # ACMR and not ACMRD: a file staged for DELETION has no blob to hash, and asking
    # git for one is an error rather than a finding.
    r = git(repo, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '--', '*.md')
    rels = [f for f in r.stdout.decode('utf-8', 'replace').splitlines() if f.strip()]

    # THE SAME EXCLUSIONS THE STAMPER APPLIES, which this path did not until
    # 2026-08-31. The module docstring above has always claimed the audit honours
    # them and the HEAD path did; --staged did not, and nobody noticed because
    # the only way to hit it is to EDIT an archived document, and archiving has
    # always been a pure `git mv` that changes no content. The moment a round
    # repointed nine archived files' links, the hook demanded a stamp for nine
    # documents the stamper refuses to stamp -- an unsatisfiable refusal, which
    # is the exact shape that earns a `--no-verify` and then never comes back.
    rels = [f for f in rels if in_scope(f, cfg_for(repo))]

    if not rels:
        return 0

    stale = []
    for rel in rels:
        blob = git(repo, 'show', ':' + rel).stdout
        try:
            # utf-8-sig, for exactly the reason spelled out in main() — a BOM left in
            # the hashed body reports every BOM'd file as stale.
            text = blob.decode('utf-8-sig')
        except UnicodeDecodeError:
            continue
        stripped, existing = ds.md_strip_stamp(text.split('\n'))
        if not existing:
            continue                  # unstamped is a policy question, not this one
        actual = ds.md_body_hash(stripped, len(existing['sha']))
        if actual != existing['sha']:
            stale.append((rel, existing, actual))

    if not stale:
        return 0
    print('%d staged document(s) carry a stamp that does not describe the content '
          'being committed:' % len(stale))
    for rel, e, actual in stale:
        print('  STALE  v%s.%s  %s  %s' % (e['major'], e['minor'], e['date'], rel))
        print('         staged sha=%s  but staged content hashes to %s' % (e['sha'], actual))
    print('')
    print('The stamp is written by a Stop hook, which runs at the END of a turn, so a')
    print('commit made during that turn carries the new content and the old sha.')
    print('Fix, from the repository root:')
    print('  python "%s" --all' % os.path.join(HERE, 'docstamp.py').replace('\\', '/'))
    print('then `git add` the document AND its stamp, and commit again.')
    return 1


def main():
    ds = load_docstamp()
    if '--staged' in sys.argv[1:]:
        sys.exit(check_staged(ds))
    repos = ([(os.path.abspath(a), cfg_for(a)) for a in sys.argv[1:]]
             or repos_from_policy())
    if not repos:
        sys.exit('no git repositories found — pass them as arguments')

    total_stale = 0
    for repo, cfg in repos:
        r = git(repo, 'ls-files', '*.md')
        if r.returncode:
            print(f'\n=== {os.path.basename(repo)} ===  (not a git repo, skipped)')
            continue
        files = [f for f in r.stdout.decode('utf-8', 'replace').split('\n') if f.strip()]
        files, skipped = [f for f in files if in_scope(f, cfg)], \
            sum(1 for f in files if not in_scope(f, cfg))

        stale, ok, unstamped = [], 0, 0
        for rel in files:
            blob = git(repo, 'show', f'HEAD:{rel}').stdout
            try:
                # utf-8-sig, not utf-8: docstamp's read_text() strips a BOM before
                # hashing, and str.strip() does NOT treat ﻿ as whitespace, so
                # decoding without -sig leaves it in the hashed body and every
                # BOM'd file reports as stale. That misread 16 portal docs as
                # stale on 2026-08-18 — all 16 were fine.
                text = blob.decode('utf-8-sig')
            except UnicodeDecodeError:
                continue
            stripped, existing = ds.md_strip_stamp(text.split('\n'))
            if not existing:
                unstamped += 1
                continue
            actual = ds.md_body_hash(stripped, len(existing['sha']))
            if actual == existing['sha']:
                ok += 1
            else:
                stale.append((rel, existing, actual))

        print(f'\n=== {os.path.basename(repo)} ===')
        print(f'{ok} stamped .md correct in HEAD, {len(stale)} STALE, {unstamped} unstamped'
              + (f', {skipped} out of policy scope' if skipped else ''))
        if not cfg:
            print('  (no policy root matches this path - audited with NO exclusions; add its'
                  ' directory name to that repo root in stamp-policy.json under'
                  ' checkoutDirNames)')
        for rel, e, actual in stale:
            print(f'  STALE  v{e["major"]}.{e["minor"]}  {e["date"]}  {rel}')
            print(f'         committed sha={e["sha"]}  but content hashes to {actual}')
        total_stale += len(stale)

    if total_stale:
        print(f'\n{total_stale} committed stamp(s) do not describe their committed content.')
        print('Fix: docstamp.py --all, then commit the stamp WITH the content.')
    return 1 if total_stale else 0


if __name__ == '__main__':
    sys.exit(main())
