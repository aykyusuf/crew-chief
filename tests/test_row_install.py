"""Tests for scripts/install-row.sh (agent panel row installer). Run: python3 tests/test_row_install.py

Every case runs against a scratch HOME under .test-tmp/ (git-ignored); the real ~/.claude is never touched.
"""
import json
import os
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "scripts", "install-row.sh")
SCRATCH = os.path.join(ROOT, ".test-tmp", "row-install")
WANT = '"$HOME/.claude/crew-chief-subagent-row.sh"'
failures = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f": {detail}"))
    if not ok:
        failures.append(name)


def home(name, settings=None, raw=None):
    h = os.path.join(SCRATCH, name)
    os.makedirs(os.path.join(h, ".claude"))
    if raw is not None:
        with open(os.path.join(h, ".claude", "settings.json"), "w") as f:
            f.write(raw)
    elif settings is not None:
        with open(os.path.join(h, ".claude", "settings.json"), "w") as f:
            json.dump(settings, f, indent=2)
    return h


def run(h, env_extra=None, plugin_root=ROOT):
    env = {"PATH": os.environ["PATH"], "HOME": h, "CLAUDE_PLUGIN_ROOT": plugin_root}
    env.update(env_extra or {})
    r = subprocess.run(["sh", HOOK], input="{}", capture_output=True, text=True, env=env)
    if r.returncode != 0:
        check("exit 0", False, f"rc={r.returncode} {r.stderr.strip()}")
    return r.stdout


def load(h):
    with open(os.path.join(h, ".claude", "settings.json")) as f:
        return json.load(f)


def path(h, name):
    return os.path.join(h, ".claude", name)


def main():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    os.makedirs(SCRATCH)
    try:
        # Fresh install into an existing settings.json: other keys survive, backup and marker written.
        h = home("fresh", {"model": "opus", "env": {"A": "1"}})
        out = run(h)
        s = load(h)
        check("fresh: key added", s.get("subagentStatusLine") == {"type": "command", "command": WANT}, str(s))
        check("fresh: other settings kept", s.get("model") == "opus" and s.get("env") == {"A": "1"})
        check("fresh: script copied and executable", os.access(path(h, "crew-chief-subagent-row.sh"), os.X_OK))
        check("fresh: backup written", os.path.exists(path(h, "settings.json.crew-chief-bak")))
        check("fresh: marker written", os.path.exists(path(h, ".crew-chief-row-installed")))
        check("fresh: one notice line", out.startswith("crew-chief: added the agent panel row") and out.count("\n") == 1, out)

        # The copied script really renders a row.
        row = subprocess.run([path(h, "crew-chief-subagent-row.sh")], capture_output=True, text=True,
                             input=json.dumps({"columns": 100, "tasks": [{"id": "a", "name": "x", "model": "claude-haiku-5-5",
                                                                          "effort": "low", "tokenCount": 1200, "description": "d"}]}))
        check("fresh: copied script renders model and effort", "haiku-5.5 · low" in row.stdout, row.stdout + row.stderr)

        # Second run: silent, no change.
        before = open(path(h, "settings.json")).read()
        check("again: silent", run(h) == "")
        check("again: settings unchanged", open(path(h, "settings.json")).read() == before)

        # A stale copy is refreshed when the key is ours.
        with open(path(h, "crew-chief-subagent-row.sh"), "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        run(h)
        with open(os.path.join(ROOT, "scripts", "subagent-row.sh")) as a, open(path(h, "crew-chief-subagent-row.sh")) as b:
            check("stale copy refreshed", a.read() == b.read())

        # The user removes the key: not added back.
        s = load(h)
        del s["subagentStatusLine"]
        with open(path(h, "settings.json"), "w") as f:
            json.dump(s, f)
        check("removed by the user: silent", run(h) == "")
        check("removed by the user: not added back", "subagentStatusLine" not in load(h))

        # The user's own command is never touched.
        mine = {"subagentStatusLine": {"type": "command", "command": "~/my-row.sh"}}
        h = home("own", mine)
        check("own command: silent", run(h) == "")
        check("own command: untouched", load(h) == mine)
        check("own command: nothing copied", not os.path.exists(path(h, "crew-chief-subagent-row.sh")))

        # No settings.json at all: created.
        h = home("none")
        run(h)
        check("no settings.json: created with the key", load(h).get("subagentStatusLine", {}).get("command") == WANT)

        # Invalid or non-object JSON is left alone.
        for label, raw in (("invalid JSON", "{ not json"), ("array", "[1,2]"), ("empty file", "")):
            h = home("bad-" + label.replace(" ", "-"), raw=raw)
            out = run(h)
            check(f"{label}: file untouched", open(path(h, "settings.json")).read() == raw)
            check(f"{label}: silent and nothing copied", out == "" and not os.path.exists(path(h, "crew-chief-subagent-row.sh")))

        # A null key counts as unset; a non-object value counts as someone else's and stays.
        h = home("null-key", {"subagentStatusLine": None})
        run(h)
        check("null key: installed", load(h).get("subagentStatusLine", {}).get("command") == WANT)
        h = home("string-key", {"subagentStatusLine": "weird"})
        run(h)
        check("string value: untouched", load(h) == {"subagentStatusLine": "weird"})

        # Opt-out and other guards.
        h = home("off", {"model": "opus"})
        check("CREW_CHIEF_ROW=off: silent", run(h, {"CREW_CHIEF_ROW": "off"}) == "")
        check("CREW_CHIEF_ROW=off: untouched", load(h) == {"model": "opus"})
        h = home("cfgdir", {"model": "opus"})
        run(h, {"CLAUDE_CONFIG_DIR": os.path.join(h, "elsewhere")})
        check("custom CLAUDE_CONFIG_DIR: untouched", load(h) == {"model": "opus"})
        h = home("noroot", {"model": "opus"})
        run(h, plugin_root=os.path.join(SCRATCH, "missing"))
        check("missing plugin script: untouched", load(h) == {"model": "opus"})

        # A symlinked settings.json (dotfiles) stays a symlink and the target is updated.
        h = home("link")
        target = os.path.join(h, "dotfiles-settings.json")
        with open(target, "w") as f:
            json.dump({"model": "opus"}, f)
        os.symlink(target, path(h, "settings.json"))
        run(h)
        check("symlink: still a symlink", os.path.islink(path(h, "settings.json")))
        with open(target) as f:
            t = json.load(f)
        check("symlink: target updated", t.get("subagentStatusLine", {}).get("command") == WANT and t.get("model") == "opus")
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)
    print(f"{'OK' if not failures else str(len(failures)) + ' failed'}")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
