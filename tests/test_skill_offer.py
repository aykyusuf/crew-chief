"""Tests for scripts/skill-offer.sh (one-time skill offer at session start). Run: python3 tests/test_skill_offer.py (needs jq).

Scratch repositories go under .test-tmp/ (git-ignored): the hook stays quiet in /tmp and other temp directories.
"""
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "scripts", "skill-offer.sh")
SCRATCH = os.path.join(ROOT, ".test-tmp", "skill-offer")
TAG = "<crew-chief-skill-offer>"
failures = []

if not shutil.which("jq"):
    print("skip: jq not installed")
    sys.exit(0)


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f": {detail}"))
    if not ok:
        failures.append(name)


def project(name, files=(), dirs=()):
    path = os.path.join(SCRATCH, name)
    os.makedirs(path)
    subprocess.run(["git", "init", "-q", path], check=True)
    for rel, text in files:
        full = os.path.join(path, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        open(full, "w").write(text)
    for rel in dirs:
        os.makedirs(os.path.join(path, rel), exist_ok=True)
    return path


def home(name, skills=()):
    h = os.path.join(SCRATCH, name + "-home")
    for s in skills:
        os.makedirs(os.path.join(h, ".claude", "skills", s))
        open(os.path.join(h, ".claude", "skills", s, "SKILL.md"), "w").write("x")
    os.makedirs(os.path.join(h, ".claude", "plugins"), exist_ok=True)
    return h


def run(cwd, h, data, source="startup", env_extra=None):
    env = {"PATH": os.environ["PATH"], "HOME": h, "CLAUDE_PLUGIN_ROOT": ROOT, "CLAUDE_PLUGIN_DATA": data}
    env.update(env_extra or {})
    r = subprocess.run(["sh", HOOK], input=json.dumps({"cwd": cwd, "source": source}), capture_output=True, text=True, env=env)
    if r.returncode != 0 or r.stderr:
        check("exit 0, no stderr", False, f"rc={r.returncode} {r.stderr!r}")
    return r.stdout


def main():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    os.makedirs(SCRATCH)
    try:
        data = os.path.join(SCRATCH, "data")
        h = home("a")
        flutter = project("flutter-app", [("pubspec.yaml", "name: x\ndependencies:\n  flutter:\n    sdk: flutter\n")])
        out = run(flutter, h, data)
        check("flutter project without skills gets an offer", TAG in out and "flutter/agent-plugins" in out, out[:200])
        check("offer shows the install command, the date, and the options",
              "claude plugin install dart-flutter@dart-flutter" in out and "checked on 2026-" in out and "Never for this project" in out)
        check("offer says nothing is installed without a yes", "Install nothing without a clear yes" in out)
        check("offer carries the answer-recording commands", "skill-offers.tsv" in out and "flutter" in out)
        check("only on startup", run(flutter, h, data, source="resume") == "" and run(flutter, h, data, source="clear") == "")
        check("off switch", run(flutter, h, data, env_extra={"CREW_CHIEF_SKILL_OFFER": "off"}) == "")
        check("no data dir, no offer", subprocess.run(["sh", HOOK], input=json.dumps({"cwd": flutter, "source": "startup"}),
              capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": h, "CLAUDE_PLUGIN_ROOT": ROOT}).stdout == "")

        h2 = home("b", skills=["flutter"])
        check("a preferred skill is installed: quiet", run(flutter, h2, data) == "")
        h3 = home("c", skills=["flutter-ui"])
        check("any preferred skill counts", run(flutter, h3, data) == "")

        plain = project("plain", [("README.md", "hi")])
        check("project without a known stack: quiet", run(plain, h, data) == "")
        notflutter = project("pubspec-no-flutter", [("pubspec.yaml", "name: x\ndependencies:\n  http: ^1.0.0\n")])
        check("detect pattern must match", run(notflutter, h, data) == "")
        reactless = project("node-only", [("package.json", '{"dependencies": {"express": "4"}}')])
        check("package.json without react/next: no react offer", "react-best-practices" not in run(reactless, h, data))
        nextapp = project("next-app", [("package.json", '{"dependencies": {"next": "15"}}')])
        out = run(nextapp, h, data)
        check("next project is detected", "react-best-practices" in out or "frontend-design" in out, out[:200])
        swift = project("swift-app", dirs=["App.xcodeproj"])
        check("glob detection (*.xcodeproj)", "swiftui-pro" in run(swift, h, data))

        # Answers.
        state = os.path.join(data, "skill-offers.tsv")
        os.makedirs(data, exist_ok=True)
        with open(state, "w") as f:
            f.write(f"{flutter}\tflutter\tnever\n")
        check("never is final", run(flutter, h, data) == "")
        with open(state, "w") as f:
            f.write(f"{flutter}\tflutter\tinstalled\n")
        check("installed is final", run(flutter, h, data) == "")
        with open(state, "w") as f:
            f.write(f"{flutter}\tflutter\tlater\t{int(time.time()) - 3600}\n")
        check("later within a week stays quiet", run(flutter, h, data) == "")
        with open(state, "w") as f:
            f.write(f"{flutter}\tflutter\tlater\t{int(time.time()) - 8 * 86400}\n")
        check("later older than a week offers again", TAG in run(flutter, h, data))
        with open(state, "w") as f:
            f.write(f"{flutter}\tflutter\tnever\n{flutter}\tflutter\tlater\t{int(time.time()) - 9 * 86400}\n")
        check("the last line wins", TAG in run(flutter, h, data))
        with open(state, "w") as f:
            f.write(f"{os.path.join(SCRATCH, 'other')}\tflutter\tnever\n")
        check("an answer for another project does not count", TAG in run(flutter, h, data))
        with open(state, "w") as f:
            f.write(f"{flutter}\tflutter\tlater\tnot-a-number\n")
        check("a garbled timestamp does not break the hook", TAG in run(flutter, h, data))
        os.remove(state)

        # At most two categories per start.
        many = project("many", [("package.json", '{"dependencies": {"next": "15", "@supabase/supabase-js": "2"}}')], dirs=["x.xcodeproj"])
        out = run(many, h, data)
        check("at most two categories per start", out.count("(category id:") == 2, out.count("(category id:"))

        # Where it stays quiet.
        outside = os.path.join(SCRATCH, "not-git")
        os.makedirs(outside)
        open(os.path.join(outside, "pubspec.yaml"), "w").write("flutter")
        check("not a git repository: quiet", run(outside, h, data) == "")
        check("home directory itself: quiet", run(h, h, data) == "")
        spaced = project("with space", [("pubspec.yaml", "flutter")])
        check("path with a space works", TAG in run(spaced, h, data))
        quoted = project("it's", [("pubspec.yaml", "flutter")])
        check("path with a quote is skipped", run(quoted, h, data) == "")
        check("garbage input is harmless", subprocess.run(["sh", HOOK], input="garbage", capture_output=True, text=True,
              env={"PATH": os.environ["PATH"], "HOME": h, "CLAUDE_PLUGIN_ROOT": ROOT, "CLAUDE_PLUGIN_DATA": data}).stdout == "")
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)
    print("FAIL" if failures else "OK", f"({len(failures)} failures)")
    sys.exit(1 if failures else 0)


main()
