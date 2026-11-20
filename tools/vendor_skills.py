#!/usr/bin/env python3
"""Maintain the third-party skills vendored under skills/ (see skills/VENDORED.lock.json).

Each vendored skill is a pinned copy of a folder of an upstream GitHub repo. The lock file
records where it came from (repo, path, commit, license) and a content hash of the vendored
folder, so local edits and upstream changes are both visible.

    python3 tools/vendor_skills.py                        list the lock (offline)
    python3 tools/vendor_skills.py --check --offline      verify vendored folders against the lock hashes
    python3 tools/vendor_skills.py --check                same, plus ask GitHub whether upstream moved (network)
    python3 tools/vendor_skills.py --diff NAME [COMMIT]   fetch NAME at COMMIT (default: upstream HEAD) into a
                                                          temp dir and print a unified diff vs the vendored copy
    python3 tools/vendor_skills.py --update NAME COMMIT   same fetch, print what would change (dry run);
                                                          add --apply to rewrite skills/NAME and the lock
    python3 tools/vendor_skills.py --rehash NAME          re-record the hash of a hand-merged copy (offline)

Nothing here commits, and nothing touches the network unless --check (without --offline), --diff or
--update is given. Fetched content is untrusted: it is only copied, never executed, symlinks and
oversized files are refused, and git runs with hooks and LFS smudging off. After --apply, read the diff
(license, injected instructions, scripts) with the user before committing.

Lock entry fields: repo, path (upstream folder), commit, license, fetched, modified, sha256 (hash of the
vendored folder). Optional: exclude (fnmatch patterns of upstream files not vendored), patches (text
replacements applied after fetching: file/from/to), update ("manual": --apply refuses, the copy was
merged by hand), also (extra upstream sources merged into a manual copy), hold (reason the pin stays
behind upstream on purpose), notes.
"""
import argparse
import datetime
import difflib
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS = os.path.join(ROOT, "skills")
LOCK = os.path.join(SKILLS, "VENDORED.lock.json")
MAX_FILE = 5 * 1024 * 1024
MAX_TOTAL = 40 * 1024 * 1024
SHA40 = re.compile(r"^[0-9a-f]{40}$")
REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
GIT = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.symlinks=false", "-c", "protocol.allow=never",
       "-c", "protocol.https.allow=always", "-c", "core.fsmonitor=false"]


def load_lock():
    with open(LOCK, encoding="utf-8") as f:
        return json.load(f)


def save_lock(lock):
    with open(LOCK, "w", encoding="utf-8") as f:
        json.dump(lock, f, indent=2, ensure_ascii=False)
        f.write("\n")


def list_files(folder):
    """Relative posix paths of all files under folder (symlinks included so they can be refused)."""
    out = []
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")  # bytecode from running a script is not part of the skill
        for fn in sorted(filenames):
            if fn == ".DS_Store":  # Finder litter, not part of the skill
                continue
            full = os.path.join(dirpath, fn)
            out.append(os.path.relpath(full, folder).replace(os.sep, "/"))
    return sorted(out)


def tree_hash(folder):
    """sha256 over sorted (relative path, file sha256) pairs: a stable fingerprint of a folder."""
    h = hashlib.sha256()
    for rel in list_files(folder):
        with open(os.path.join(folder, rel), "rb") as f:
            fh = hashlib.sha256(f.read()).hexdigest()
        h.update(f"{rel}\0{fh}\n".encode("utf-8"))
    return h.hexdigest()


def run_git(args, cwd=None, timeout=300):
    env = dict(os.environ, GIT_LFS_SKIP_SMUDGE="1", GIT_TERMINAL_PROMPT="0")
    return subprocess.run(GIT + args, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)


def repo_url(repo):
    if not REPO.match(repo):
        raise SystemExit(f"refusing odd repo name: {repo!r}")
    return f"https://github.com/{repo}.git"


def resolve_ref(repo, ref):
    """40-hex passes through; HEAD or a branch/tag name is resolved with git ls-remote."""
    if SHA40.match(ref):
        return ref
    if not re.match(r"^[A-Za-z0-9._/-]+$", ref):
        raise SystemExit(f"refusing odd ref: {ref!r}")
    r = run_git(["ls-remote", repo_url(repo), ref], timeout=60)
    first = r.stdout.split("\n", 1)[0].split()
    if r.returncode != 0 or not first or not SHA40.match(first[0]):
        raise SystemExit(f"cannot resolve {ref} in {repo}: {r.stderr.strip() or 'not found'}")
    return first[0]


def fetch_upstream(repo, commit, path, dest):
    """Sparse, blobless fetch of one folder at one commit into dest (an empty temp dir). Returns the folder path."""
    if not SHA40.match(commit):
        raise SystemExit(f"commit must be the full 40-hex sha, got {commit!r}")
    if path.startswith("/") or ".." in path.split("/"):
        raise SystemExit(f"refusing odd path: {path!r}")
    steps = [
        ["init", "-q", "."],
        ["remote", "add", "origin", repo_url(repo)],
        ["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit],
        ["sparse-checkout", "init", "--no-cone"],
        ["sparse-checkout", "set", f"/{path}/"],
        ["-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"],
    ]
    for s in steps:
        r = run_git(s, cwd=dest)
        if r.returncode != 0:
            raise SystemExit(f"git {' '.join(s)} failed in {repo}@{commit[:7]}: {r.stderr.strip()[:400]}")
    # core.symlinks=false makes git write a symlink as a plain file, so look at the tree modes (no blobs needed).
    modes = run_git(["ls-tree", "-r", "HEAD", "--", path], cwd=dest)
    if modes.returncode != 0:
        raise SystemExit(f"git ls-tree failed in {repo}@{commit[:7]}: {modes.stderr.strip()[:300]}")
    odd = [ln.split("\t", 1)[-1] for ln in modes.stdout.splitlines() if ln.split(" ", 1)[0] in ("120000", "160000")]
    if odd:
        raise SystemExit(f"refusing symlink/submodule entries in upstream {repo}: {', '.join(odd[:5])}")
    head = run_git(["rev-parse", "HEAD"], cwd=dest).stdout.strip()
    if head != commit:
        raise SystemExit(f"fetched {head}, expected {commit}")
    folder = os.path.join(dest, *path.split("/"))
    if not os.path.isdir(folder):
        raise SystemExit(f"{path} does not exist in {repo}@{commit[:7]}")
    return folder


def build_copy(src, entry, out):
    """Copy src into out applying the entry's excludes and patches. Refuses symlinks and big files."""
    total = 0
    for rel in list_files(src):
        full = os.path.join(src, rel)
        if os.path.islink(full) or not os.path.isfile(full):
            raise SystemExit(f"refusing non-regular file in upstream: {rel}")
        if any(fnmatch.fnmatch(rel, pat) for pat in entry.get("exclude", [])):
            continue
        size = os.path.getsize(full)
        total += size
        if size > MAX_FILE or total > MAX_TOTAL:
            raise SystemExit(f"upstream copy too large ({rel}, {size} bytes); raise the cap on purpose if wanted")
        dst = os.path.join(out, *rel.split("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(full, dst)
    for p in entry.get("patches", []):
        target = os.path.join(out, *p["file"].split("/"))
        with open(target, encoding="utf-8") as f:
            text = f.read()
        if p["from"] not in text:
            print(f"warning: patch for {p['file']} no longer matches upstream text; check by hand", file=sys.stderr)
            continue
        with open(target, "w", encoding="utf-8") as f:
            f.write(text.replace(p["from"], p["to"]))


def fetch_copy(entry, commit, work):
    """Fetch entry's upstream folder at commit and return a processed copy folder inside work."""
    repo_dir = os.path.join(work, "git")
    out = os.path.join(work, "copy")
    os.makedirs(repo_dir)
    os.makedirs(out)
    folder = fetch_upstream(entry["repo"], commit, entry["path"], repo_dir)
    build_copy(folder, entry, out)
    return out


def compare(vendored, fresh):
    va, fa = set(list_files(vendored)), set(list_files(fresh))
    rows = [("removed", r) for r in sorted(va - fa)] + [("added", r) for r in sorted(fa - va)]
    for r in sorted(va & fa):
        with open(os.path.join(vendored, r), "rb") as a, open(os.path.join(fresh, r), "rb") as b:
            if a.read() != b.read():
                rows.append(("changed", r))
    return rows


def unified(vendored, fresh, rel, limit=200):
    def lines(base):
        p = os.path.join(base, rel)
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8", errors="replace") as f:
            return f.read().splitlines()
    d = list(difflib.unified_diff(lines(vendored), lines(fresh), f"vendored/{rel}", f"upstream/{rel}", lineterm="", n=2))
    return d[:limit] + ([f"... {len(d) - limit} more diff lines"] if len(d) > limit else [])


def pick(lock, name):
    if name not in lock:
        raise SystemExit(f"unknown skill {name!r}; vendored: {', '.join(sorted(lock))}")
    return lock[name]


def cmd_list(lock):
    for name in sorted(lock):
        e = lock[name]
        print(f"{name:34} {e['commit'][:7]}  {e['license']:11} {'modified' if e['modified'] else 'pinned  '}  {e['repo']}/{e['path']}")


def check_integrity(lock):
    bad = 0
    for name in sorted(lock):
        folder = os.path.join(SKILLS, name)
        if not os.path.isdir(folder):
            print(f"MISSING  {name}: skills/{name} is not there")
            bad += 1
        elif tree_hash(folder) != lock[name].get("sha256"):
            print(f"CHANGED  {name}: skills/{name} differs from the hash in the lock (edited by hand? run --update ... --apply to re-record)")
            bad += 1
        else:
            print(f"ok       {name}: matches the lock")
    return bad


def gh_json(endpoint, jq):
    try:
        r = subprocess.run(["gh", "api", endpoint, "--jq", jq], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def upstream_status(source):
    """(head sha, changed) where changed is False/True, or None when unknown.

    Takes the last commit that touched the folder and asks GitHub how the pinned commit relates to it
    (compare status, not the file list, which GitHub caps at 300 files). Needs gh; without it only the repo HEAD is known.
    """
    head = gh_json(f"repos/{source['repo']}/commits/HEAD", ".sha")
    if not head or not SHA40.match(head):
        head = resolve_ref(source["repo"], "HEAD")
    if head == source["commit"]:
        return head, False
    last = gh_json(f"repos/{source['repo']}/commits?path={source['path']}&sha={head}&per_page=1", ".[0].sha")
    if not last or not SHA40.match(last):
        return head, None
    if last == source["commit"]:
        return head, False
    status = gh_json(f"repos/{source['repo']}/compare/{source['commit']}...{last}", ".status")
    if status in ("identical", "behind"):
        return head, False
    if status in ("ahead", "diverged"):
        return head, True
    return head, None


def cmd_check(lock, offline, names):
    bad = check_integrity({n: lock[n] for n in names})
    if offline:
        return bad
    print()
    for name in names:
        e = lock[name]
        for src in [e] + e.get("also", []):
            try:
                head, changed = upstream_status(src)
            except SystemExit as ex:
                print(f"ERROR    {name} ({src['repo']}): {ex}")
                bad += 1
                continue
            cmd = f"python3 tools/vendor_skills.py --diff {name} {head}"
            if changed is False:
                print(f"current  {name} ({src['repo']}): nothing newer under {src['path']}")
                if head != src["commit"]:
                    print(f"         (repo moved to {head[:7]}, this folder did not)")
            elif changed is None:
                print(f"MOVED    {name} ({src['repo']}): repo is at {head[:7]}, pinned {src['commit'][:7]}; folder changes unknown (no gh or API error)  -> {cmd}")
            else:
                hold = f" [held on purpose: {e['hold']}]" if e.get("hold") else ""
                print(f"NEWER    {name} ({src['repo']}): {src['path']} changed upstream since {src['commit'][:7]} (repo at {head[:7]}){hold}  -> {cmd}")
    return bad


def cmd_diff(lock, name, ref, update=False, apply=False):
    e = pick(lock, name)
    commit = resolve_ref(e["repo"], ref or "HEAD")
    work = tempfile.mkdtemp(prefix="vendor-skills-")
    keep = False
    try:
        fresh = fetch_copy(e, commit, work)
        vendored = os.path.join(SKILLS, name)
        rows = compare(vendored, fresh)
        print(f"{name}: vendored {e['commit'][:7]} vs upstream {commit[:7]} ({e['repo']}/{e['path']})")
        if not rows:
            print("  identical")
        for status, rel in rows:
            print(f"  {status:8} {rel}")
            if not update and status == "changed":
                print("\n".join("    " + l for l in unified(vendored, fresh, rel)))
        if not update:
            return 0
        if not apply:
            print("\ndry run: nothing written. Add --apply to rewrite skills/%s and the lock (no commit is made)." % name)
            return 0
        if e.get("update") == "manual":
            keep = True
            print(f"\n{name} is a hand-merged copy: not overwritten. The fresh upstream copy is in {fresh}; merge it by hand,")
            print(f"then run: python3 tools/vendor_skills.py --rehash {name}")
            return 1
        shutil.rmtree(vendored)
        shutil.copytree(fresh, vendored)
        e["commit"], e["fetched"], e["sha256"] = commit, datetime.date.today().isoformat(), tree_hash(vendored)
        save_lock(lock)
        print(f"\nupdated skills/{name} to {commit[:7]} and rewrote the lock. Review the diff, then commit yourself.")
        return 0
    finally:
        if not keep:
            shutil.rmtree(work, ignore_errors=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="verify vendored folders vs the lock, then ask GitHub for newer upstream commits")
    ap.add_argument("--offline", action="store_true", help="with --check: skip the network part")
    ap.add_argument("--diff", metavar="NAME", help="fetch NAME (at COMMIT, default upstream HEAD) and print a unified diff")
    ap.add_argument("--update", metavar="NAME", help="fetch NAME at COMMIT and show what would change")
    ap.add_argument("--rehash", metavar="NAME", help="re-record the folder hash of a hand-merged copy in the lock")
    ap.add_argument("--apply", action="store_true", help="with --update: write the new copy and the lock")
    ap.add_argument("ref", nargs="?", help="commit (full sha, or HEAD/branch for --diff)")
    ap.add_argument("only", nargs="*", help="with --check: limit to these skill names")
    a = ap.parse_args(argv)
    lock = load_lock()
    if a.rehash:
        pick(lock, a.rehash)["sha256"] = tree_hash(os.path.join(SKILLS, a.rehash))
        save_lock(lock)
        print(f"re-recorded the hash of skills/{a.rehash}")
        return 0
    if a.diff:
        return cmd_diff(lock, a.diff, a.ref)
    if a.update:
        if not a.ref:
            ap.error("--update NAME needs a COMMIT")
        return cmd_diff(lock, a.update, a.ref, update=True, apply=a.apply)
    if a.check:
        names = ([a.ref] if a.ref else []) + a.only
        names = names or sorted(lock)
        for n in names:
            pick(lock, n)
        return 1 if cmd_check(lock, a.offline, names) else 0
    cmd_list(lock)
    return 0


if __name__ == "__main__":
    sys.exit(main())
