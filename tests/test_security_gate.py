#!/usr/bin/env python3
"""Tests for scripts/security-map.sh (risk map) and scripts/security-gate.sh (commit gate). Run: python3 tests/test_security_gate.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP = os.path.join(ROOT, "scripts", "security-map.sh")
GATE = os.path.join(ROOT, "scripts", "security-gate.sh")
failures = []
count = 0


def check(label, ok, detail=""):
    global count
    count += 1
    if not ok:
        failures.append(f"{label}: {detail}"[:600])


def git(proj, *args):
    subprocess.run(["git", "-C", proj, *args], check=True, capture_output=True)


def write(proj, rel, text):
    path = os.path.join(proj, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def make_repo(base, name):
    proj = os.path.join(base, name)
    os.makedirs(proj)
    git(proj, "init", "-q")
    git(proj, "config", "user.email", "t@example.com")
    git(proj, "config", "user.name", "t")
    write(proj, "README.md", "hi\n")
    git(proj, "add", "-A")
    git(proj, "commit", "-q", "-m", "init")
    return proj


def gate(proj, command, data, env_extra=None):
    env = dict(os.environ, CLAUDE_PLUGIN_DATA=data, **(env_extra or {}))
    payload = {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": proj}
    r = subprocess.run(["sh", GATE], input=json.dumps(payload), capture_output=True, text=True, env=env)
    return r.returncode, r.stderr


def match(proj, *files):
    r = subprocess.run(["sh", MAP, "match", proj, *files], capture_output=True, text=True)
    return [line.split("\t") for line in r.stdout.splitlines() if line]


def main():
    base = os.path.realpath(tempfile.mkdtemp(prefix="crew-chief-sec-"))
    try:
        proj = make_repo(base, "app")
        write(proj, "src/auth/login.ts", "export function login(u, p) { return bcrypt.compare(p, u.hash) }\n")
        write(proj, "src/ui/Button.tsx", "export const Button = () => null\n")
        write(proj, "src/users.py", 'def find(db, name):\n    return db.execute("SELECT * FROM users WHERE name = \'" + name + "\'")\n')
        write(proj, ".github/workflows/ci.yml", "on: push\n")
        write(proj, "db/migrations/001_init.sql", "create table x(id int);\n")
        write(proj, "package.json", "{}\n")
        write(proj, "src/config.js", 'export const API_KEY = "sk_live_abcdefghijklmnop"\n')
        write(proj, "docs/guide.md", "how to log in\n")

        # match: categories per file
        hits = match(proj, "src/auth/login.ts", "src/ui/Button.tsx", "src/users.py", ".github/workflows/ci.yml", "db/migrations/001_init.sql", "package.json", "src/config.js", "docs/guide.md")
        by = {}
        for cat, f, _ in hits:
            by.setdefault(f, set()).add(cat)
        check("auth path and content", by.get("src/auth/login.ts") == {"auth"}, by)
        check("a plain UI file is not risky", "src/ui/Button.tsx" not in by, by)
        check("SQL built by concatenation is injection", "injection" in by.get("src/users.py", set()), by)
        check("a CI workflow is ci", by.get(".github/workflows/ci.yml") == {"ci"}, by)
        check("a migration is migrations", by.get("db/migrations/001_init.sql") == {"migrations"}, by)
        check("package.json is deps", by.get("package.json") == {"deps"}, by)
        check("a hard-coded key is secrets", "secrets" in by.get("src/config.js", set()), by)
        check("prose is not risky", "docs/guide.md" not in by, by)

        # scan builds the map; a manual entry survives a rescan
        git(proj, "add", "-A")
        subprocess.run(["sh", MAP, "scan", proj], check=True)
        mpath = os.path.join(proj, ".crew-chief", "security-map.json")
        m = json.load(open(mpath))
        paths = {e["path"] for e in m["entries"] if "path" in e}
        check("scan lists the risky files", {"src/auth/login.ts", "src/users.py", ".github/workflows/ci.yml", "package.json"} <= paths, paths)
        check("scan skips the plain UI file", "src/ui/Button.tsx" not in paths, paths)
        check("scan has a date and a version", m.get("version") == 1 and len(m.get("updated", "")) == 10, m)
        m["entries"].append({"glob": "src/billing/**", "category": "payments", "reason": "our billing", "manual": True})
        json.dump(m, open(mpath, "w"))
        subprocess.run(["sh", MAP, "scan", proj], check=True)
        m2 = json.load(open(mpath))
        check("a manual glob entry is kept on rescan", any(e.get("glob") == "src/billing/**" for e in m2["entries"]), m2)
        write(proj, "src/billing/ledger.ts", "export const x = 1\n")
        hits = match(proj, "src/billing/ledger.ts")
        check("a manual glob makes a file risky", any(h[0] == "payments" for h in hits), hits)

        # hook: a written risky file is added to an existing map, a plain one is not
        write(proj, "src/session/store.ts", "export const s = 1\n")
        payload = {"tool_name": "Write", "tool_input": {"file_path": os.path.join(proj, "src/session/store.ts")}, "cwd": proj}
        subprocess.run(["sh", MAP, "hook"], input=json.dumps(payload), text=True, check=True)
        payload2 = {"tool_name": "Write", "tool_input": {"file_path": os.path.join(proj, "src/ui/Card.tsx")}, "cwd": proj}
        write(proj, "src/ui/Card.tsx", "export const Card = 1\n")
        subprocess.run(["sh", MAP, "hook"], input=json.dumps(payload2), text=True, check=True)
        m3 = json.load(open(mpath))
        paths3 = [e.get("path") for e in m3["entries"]]
        check("hook adds a new risky file once", paths3.count("src/session/store.ts") == 1, paths3)
        check("hook ignores a plain file", "src/ui/Card.tsx" not in paths3, paths3)
        subprocess.run(["sh", MAP, "hook"], input=json.dumps(payload), text=True, check=True)
        check("hook does not add twice", [e.get("path") for e in json.load(open(mpath))["entries"]].count("src/session/store.ts") == 1)
        bare = make_repo(base, "bare")
        write(bare, "src/auth/x.ts", "x\n")
        subprocess.run(["sh", MAP, "hook"], input=json.dumps({"tool_name": "Write", "tool_input": {"file_path": os.path.join(bare, "src/auth/x.ts")}, "cwd": bare}), text=True, check=True)
        check("hook never creates a map", not os.path.exists(os.path.join(bare, ".crew-chief")))

        # gate
        data = tempfile.mkdtemp(dir=base)
        code, err = gate(proj, 'git commit -m "x"', data)
        check("gate holds back the first commit of risky files", code == 2 and "security gate" in err and "src/users.py" in err and "xhigh" in err, err)
        check("gate names the categories once per file", err.count("src/auth/login.ts") == 1, err)
        code, _ = gate(proj, 'git commit -m "x"', data)
        check("the identical retry passes", code == 0)
        code, _ = gate(proj, 'git commit -m "other"', data)
        check("a different command is held back again", code == 2)
        check("non-commit commands pass", gate(proj, "git status", data)[0] == 0)
        check("--dry-run passes", gate(proj, "git commit --dry-run -m y", data)[0] == 0)
        check("off switch", gate(proj, 'git commit -m "off"', data, {"CREW_CHIEF_SECURITY_GATE": "off"})[0] == 0)
        check("no data folder: nothing", subprocess.run(["sh", GATE], input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "git commit -m q"}, "cwd": proj}), capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k != "CLAUDE_PLUGIN_DATA"}).returncode == 0)

        git(proj, "reset", "-q")
        git(proj, "add", "src/ui/Button.tsx", "docs/guide.md")
        check("only plain files staged: passes", gate(proj, 'git commit -m "ui"', data)[0] == 0)
        code, err = gate(proj, 'git add src/users.py && git commit -m "add then commit"', data)
        check("git add <risky> && git commit in one command is seen", code == 2 and "src/users.py" in err, err)
        code, err = gate(proj, 'git add -A && git commit -m "all"', data)
        check("git add -A && git commit sees untracked risky files one by one", code == 2 and "src/auth/login.ts" in err and "db/migrations/001_init.sql" in err, err)
        code, err = gate(proj, f'git -C {proj} commit -m "dash C"', data)
        check("git -C <dir> commit is seen", code == 0 or "security gate" in err, err)

        git(proj, "reset", "-q")
        git(proj, "add", ".github/workflows/ci.yml", "package.json")
        code, err = gate(proj, 'git commit -m "ci only"', data)
        check("CI and deps only: Sonnet high is suggested", code == 2 and "model sonnet, effort high" in err and "xhigh" not in err, err)

        tracked = make_repo(base, "tracked")
        write(tracked, "src/payments/charge.ts", "export const a = 1\n")
        git(tracked, "add", "-A")
        git(tracked, "commit", "-q", "-m", "p")
        write(tracked, "src/payments/charge.ts", "export const a = 2\n")
        code, err = gate(tracked, 'git commit -am "edit"', data)
        check("commit -a counts unstaged tracked changes", code == 2 and "src/payments/charge.ts" in err, err)
        check("outside a git repo: nothing", gate(base, "git commit -m x", data)[0] == 0)
    finally:
        shutil.rmtree(base, ignore_errors=True)

    if failures:
        for f in failures:
            print("FAIL", f)
        print(f"FAIL {len(failures)}/{count}")
        sys.exit(1)
    print(f"OK {count}/{count}")


if __name__ == "__main__":
    main()
