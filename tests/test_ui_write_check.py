"""Tests for scripts/ui-write-check.sh (the PreToolUse Write|Edit|MultiEdit gate for UI files). Run: python3 tests/test_ui_write_check.py (needs jq)."""
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "scripts", "ui-write-check.sh")
SCRATCH = os.path.join(ROOT, ".test-tmp", "ui-write-check")
failures = []

if not shutil.which("jq"):
    print("skip: jq not installed")
    sys.exit(0)


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f": {detail}"))
    if not ok:
        failures.append(name)


def world(name, profile=None):
    base = os.path.join(SCRATCH, name)
    home, data, proj = (os.path.join(base, x) for x in ("home", "data", "proj"))
    for d in (home, data, proj):
        os.makedirs(d)
    if profile is not None:
        os.makedirs(os.path.join(proj, ".crew-chief"))
        json.dump(profile, open(os.path.join(proj, ".crew-chief", "ui-profile.json"), "w"))
    return home, data, proj


def call(tool, path, content="<h1>x</h1>"):
    ti = {"file_path": path}
    if tool == "Write":
        ti["content"] = content
    elif tool == "Edit":
        ti.update(old_string="a", new_string=content)
    else:
        ti["edits"] = [{"old_string": "a", "new_string": content}]
    return {"tool_name": tool, "tool_input": ti}


def run(home, data, proj, payload, env_extra=None, raw=None, path=None, with_data=True, extra=None):
    env = {"PATH": path or os.environ["PATH"], "HOME": home, "CLAUDE_PLUGIN_ROOT": ROOT, "GIT_CEILING_DIRECTORIES": SCRATCH}
    if with_data:
        env["CLAUDE_PLUGIN_DATA"] = data
    env.update(env_extra or {})
    body = dict(payload)
    body.update({"session_id": "s1", "cwd": proj})
    body.update(extra or {})
    return subprocess.run(["/bin/sh", HOOK], input=raw if raw is not None else json.dumps(body), capture_output=True, text=True, env=env)


def main():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    os.makedirs(SCRATCH)
    try:
        h, d, p = world("basic")
        page = os.path.join(p, "index.html")
        r = run(h, d, p, call("Write", page))
        check("Write of index.html without a profile: exit 2", r.returncode == 2, f"{r.returncode} {r.stderr!r}")
        check("reason names the profile file, the reference image and ui-implementer",
              "no UI profile yet" in r.stderr and ".crew-chief/ui-profile.json" in r.stderr and "reference image" in r.stderr
              and "crew-chief:ui-implementer" in r.stderr and "retry the same call" in r.stderr, r.stderr)
        check("reason is short", len(r.stderr) < 700, str(len(r.stderr)))
        check("a state file is written in ui-gate", len(os.listdir(os.path.join(d, "ui-gate"))) == 1)
        r = run(h, d, p, call("Write", page, "<h1>other content</h1>"))
        check("the identical retry (same tool and path) passes", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        r = run(h, d, p, call("Edit", page))
        check("same path, other tool: held back separately", r.returncode == 2)
        r = run(h, d, p, call("Write", os.path.join(p, "style.css"), "body{}"))
        check("another UI file: held back separately", r.returncode == 2)

        for tool in ("Write", "Edit", "MultiEdit"):
            for name in ("src/App.tsx", "a/b.jsx", "x.vue", "x.svelte", "x.css", "x.scss", "X.HTML"):
                h2, d2, p2 = world(f"{tool}-{name}".replace("/", "_").replace(".", "_"))
                r = run(h2, d2, p2, call(tool, os.path.join(p2, name)))
                check(f"{tool} {name}: held back", r.returncode == 2, f"{r.returncode}")

        h3, d3, p3 = world("profile", {"profile": "lively", "motion": 3})
        check("profile file present: passes", run(h3, d3, p3, call("Write", os.path.join(p3, "index.html"))).returncode == 0)
        check("profile file present: nothing remembered", not os.path.exists(os.path.join(d3, "ui-gate")))
        h3b, d3b, p3b = world("profile-root")
        sub = os.path.join(p3b, "web", "src")
        os.makedirs(sub)
        os.makedirs(os.path.join(p3b, ".crew-chief"))
        open(os.path.join(p3b, ".crew-chief", "ui-profile.json"), "w").write("{}")
        subprocess.run(["git", "init", "-q", p3b], check=True, env={**os.environ, "GIT_CEILING_DIRECTORIES": SCRATCH})
        check("profile file at the git root, cwd below it: passes", run(h3b, d3b, sub, call("Write", os.path.join(sub, "a.tsx"))).returncode == 0)

        h4, d4, p4 = world("nonui")
        for name in ("src/api/client.ts", "README.md", "server.py", "data.json", "main.dart", "notes.html.txt", "Makefile"):
            r = run(h4, d4, p4, call("Write", os.path.join(p4, name), "print(1)"))
            check(f"non-UI file {name}: passes", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        r = run(h4, d4, p4, call("Write", os.path.join(p4, "lib", "home.dart"), "import 'package:flutter/material.dart';\nclass Home extends StatelessWidget {}"))
        check("a Dart file with a Flutter widget: held back", r.returncode == 2, f"{r.returncode}")
        r = run(h4, d4, p4, call("Write", os.path.join(p4, "lib", "model.dart"), "class User { final String name; }"))
        check("a plain Dart file: passes", r.returncode == 0)
        existing = os.path.join(p4, "lib", "cart.dart")
        os.makedirs(os.path.dirname(existing))
        open(existing, "w").write("class Cart extends StatefulWidget {}\n")
        r = run(h4, d4, p4, call("Edit", existing, "final x = 1;"))
        check("an Edit of an existing Dart widget file: held back", r.returncode == 2, f"{r.returncode}")

        h5, d5, p5 = world("crewchief-path")
        for rel in (".crew-chief/refs/mock.html", ".crew-chief/ui.css"):
            r = run(h5, d5, p5, call("Write", os.path.join(p5, rel)))
            check(f"write into .crew-chief ({rel}) passes", r.returncode == 0 and r.stderr == "", f"{r.returncode}")
        check("a relative .crew-chief path passes", run(h5, d5, p5, call("Write", ".crew-chief/refs/mock.html")).returncode == 0)
        check("a folder only named like it is still checked", run(h5, d5, p5, call("Write", os.path.join(p5, "x.crew-chief", "a.html"))).returncode == 2)

        h6, d6, p6 = world("ui-agent")
        check("ui-implementer's own write passes", run(h6, d6, p6, call("Write", os.path.join(p6, "a.html")), extra={"agent_type": "crew-chief:ui-implementer"}).returncode == 0)
        check("another subagent's write is held back", run(h6, d6, p6, call("Write", os.path.join(p6, "a.html")), extra={"agent_type": "crew-chief:implementer"}).returncode == 2)

        h7, d7, p7 = world("off")
        page7 = os.path.join(p7, "index.html")
        check("CREW_CHIEF_UI_GATE=off", run(h7, d7, p7, call("Write", page7), env_extra={"CREW_CHIEF_UI_GATE": "off"}).returncode == 0)
        for label, raw in (("garbage input", "not json"), ("empty input", ""), ("a JSON array", "[1]")):
            check(f"{label} passes", run(h7, d7, p7, {}, raw=raw).returncode == 0)
        check("an unrelated tool passes", run(h7, d7, p7, {"tool_name": "Bash", "tool_input": {"command": "ls", "file_path": page7}}).returncode == 0)
        check("no file_path passes", run(h7, d7, p7, {"tool_name": "Write", "tool_input": {}}).returncode == 0)
        check("no data folder: passes (it could not remember the retry)", run(h7, d7, p7, call("Write", page7), with_data=False).returncode == 0)

        bindir = os.path.join(SCRATCH, "bin-nojq")
        os.makedirs(bindir)
        for tool in ("cat", "dirname", "sed", "grep", "tr", "find", "cksum", "head"):
            src = shutil.which(tool)
            if src:
                os.symlink(src, os.path.join(bindir, tool))
        r = run(h7, d7, p7, call("Write", page7), path=bindir)
        check("no jq: passes", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        check("no jq: the PATH really has none", subprocess.run(["/bin/sh", "-c", "command -v jq"], env={"PATH": bindir}, capture_output=True).returncode != 0)

        h8, d8, p8 = world("ttl")
        page8 = os.path.join(p8, "index.html")
        run(h8, d8, p8, call("Write", page8))
        gate = os.path.join(d8, "ui-gate")
        f = os.path.join(gate, os.listdir(gate)[0])
        old = time.time() - 5 * 3600
        os.utime(f, (old, old))
        check("a denial older than four hours is forgotten (denied again)", run(h8, d8, p8, call("Write", page8)).returncode == 2)

        # The same data folder as the Agent gate: neither forgets the other's state.
        h9, d9, p9 = world("shared")
        brief = subprocess.run(["/bin/sh", os.path.join(ROOT, "scripts", "ui-brief-check.sh")],
                               input=json.dumps({"cwd": p9, "tool_name": "Agent", "tool_input": {"subagent_type": "implementer", "prompt": "Restyle Hero.tsx"}}),
                               capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": h9, "CLAUDE_PLUGIN_ROOT": ROOT, "CLAUDE_PLUGIN_DATA": d9, "GIT_CEILING_DIRECTORIES": SCRATCH})
        check("the Agent gate denied (setup for the shared-folder check)", brief.returncode == 2)
        check("the Write gate is independent of the Agent gate's state", run(h9, d9, p9, call("Write", os.path.join(p9, "Hero.tsx"))).returncode == 2)
        check("both gates keep their own state files", len(os.listdir(os.path.join(d9, "ui-gate"))) == 2)
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)
    print("FAIL" if failures else "OK", f"({len(failures)} failures)")
    sys.exit(1 if failures else 0)


main()
