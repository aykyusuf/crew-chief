"""Tests for scripts/subagent-row.sh. Run: python3 tests/test_subagent_row.py (needs jq)."""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "subagent-row.sh")
ANSI = re.compile(r"\x1b\[[0-9;]*m")

if not shutil.which("jq"):
    print("skip: jq not installed")
    sys.exit(0)


def task(i, **kw):
    base = {"id": i, "type": "local_agent", "status": "running", "description": "Do something",
            "startTime": 1, "tokenCount": 1234, "tokenSamples": [1], "cwd": "/x"}
    base.update(kw)
    return base


def rows(tasks, columns=80, env=None):
    payload = {"columns": columns, "tasks": tasks} if columns is not None else {"tasks": tasks}
    out = subprocess.run([SCRIPT], input=json.dumps(payload), capture_output=True, text=True, check=True,
                         env=env).stdout
    return {r["id"]: r["content"] for r in map(json.loads, out.splitlines())}


def visible(s):
    return ANSI.sub("", s)


checks = []


def check(cond, name, detail=""):
    checks.append((bool(cond), name, detail))


long_name = "my-very-long-custom-agent-name-for-swiftui-and-uniffi-bindings"
long_label = "Inspecting uniffi ObjectTemplate.swift scaffolding and generated bindings " * 3
for cols in (200, 120, 80, 60, 40, 30, 20):
    r = rows([
        task("a", agentType="crew-chief:ui-tester", model="claude-sonnet-5-5", effort="medium", label="Checking the login flow", tokenCount=41234),
        task("b", agentType="some-plugin:" + long_name, model="claude-opus-5-5[1m]", effort="xhigh", description=long_label, tokenCount=63100),
        task("c", name="architect", agentType="architect", model="claude-haiku-4-5-20251001", effort="low", description=long_label),
    ], columns=cols)
    for i in "abc":
        v = visible(r.get(i, ""))
        check(len(v) <= max(cols - 2, 12), f"cols={cols} row {i} fits", f"{len(v)}: {v!r}")
    check("sonnet-5.5" in visible(r["a"]) and "opus-5.5" in visible(r["b"]) and "haiku-4.5" in visible(r["c"]),
          f"cols={cols} model always shown, dated/[1m] ids shortened", r)
    check(visible(r["b"]).startswith("my-v"), f"cols={cols} plugin prefix stripped, name start visible", r["b"])
    if cols >= 60:
        check("sonnet-5.5 · medium · 41.2k" in visible(r["a"]), f"cols={cols} effort and tokens kept", r["a"])
        check(visible(r["a"]).startswith("ui-tester  "), f"cols={cols} short name kept whole", r["a"])

r = rows([
    task("u", model=None, effort=None, tokenCount=812, description="Find files"),
    task("n", name="x\ny\tz", agentType="a:b", model="claude-sonnet-5-5", label="line1\nline2"),
    task("f", agentType="crew-chief:scanner", model="claude-haiku-5-5", effort="low", status="failed"),
    task("k", agentType="crew-chief:scanner", model="claude-haiku-5-5", effort="low", status="killed"),
    task("m", agentType="x", model="claude-opus-5-5", effort=24000, tokenCount=1_250_000),
    {"type": "local_agent", "description": "no id"},
])
check("starting · default · 812" in visible(r.get("u", "")), "unresolved model and no effort")
check("\n" not in r.get("n", "") and "\t" not in r.get("n", ""), "control characters removed", r.get("n"))
check(visible(r.get("f", "")).startswith("✗ "), "failed marker")
check(visible(r.get("k", "")).startswith("■ "), "killed marker")
check("opus-5.5 · 24000 · 1.2M" in visible(r.get("m", "")), "numeric effort and millions", r.get("m"))
check(len(r) == 5, "task without id skipped")
check(rows([task("z", model="claude-sonnet-5-5")], columns=None).get("z"), "missing columns uses a default")
check(subprocess.run([SCRIPT], input="{}", capture_output=True, text=True).stdout == "", "no tasks, no output")
check(subprocess.run([SCRIPT], input="not json", capture_output=True, text=True).stdout == "", "bad input, no output")

# Elapsed time (running tasks only) and progress from the per-agent progress files.
import tempfile, time
scratch = tempfile.mkdtemp(prefix="row-test-")
env = dict(os.environ, TMPDIR=scratch)
now_ms = int(time.time() * 1000)
r = rows([
    task("e1", model="claude-sonnet-5-5", effort="medium", startTime=now_ms - 252_000, label="Checking the login flow"),
    task("e2", model="claude-sonnet-5-5", effort="medium", startTime=now_ms - 3_900_000),
    task("e3", model="claude-sonnet-5-5", effort="medium", startTime=now_ms - 20_000),
    task("e4", model="claude-sonnet-5-5", effort="medium", startTime=now_ms - 252_000, status="completed"),
    task("e5", model="claude-sonnet-5-5", effort="medium", startTime=None),
], columns=120, env=env)
check("4m12s" in visible(r["e1"]) or "4m11s" in visible(r["e1"]), "elapsed minutes and seconds", r["e1"])
check("1h05m" in visible(r["e2"]), "elapsed hours and minutes", r["e2"])
check(re.search(r"· (19|20|21)s", visible(r["e3"])), "elapsed seconds", r["e3"])
check("m" not in visible(r["e4"]).split("  ")[1].replace("sonnet-5.5", "").replace("medium", ""), "no elapsed for a finished task", r["e4"])
check("sonnet-5.5 · medium · 1.2k" in visible(r["e5"]), "no startTime, no elapsed", r["e5"])

pd = os.path.join(scratch, "crew-chief-progress")
os.makedirs(pd)
with open(os.path.join(pd, "p1.json"), "w") as f:
    json.dump({"id": "p1", "pct": 40, "step": "Reading the auth module", "delay": "slow test suite", "slow": "Bash took 61s"}, f)
with open(os.path.join(pd, "p2.json"), "w") as f:
    json.dump({"id": "p2", "slow": "Bash took 61s", "tools": 3}, f)
with open(os.path.join(pd, "broken.json"), "w") as f:
    f.write("{not json")
r = rows([
    task("p1", model="claude-sonnet-5-5", effort="medium", startTime=now_ms - 60_000, label="Checking the login flow"),
    task("p2", model="claude-sonnet-5-5", effort="medium", startTime=now_ms - 60_000, label="Checking the login flow"),
    task("p3", model="claude-sonnet-5-5", effort="medium", startTime=now_ms - 60_000, label="Checking the login flow"),
], columns=160, env=env)
check("~40%" in visible(r["p1"]) and "Reading the auth module ⚠ slow test suite" in visible(r["p1"]),
      "reported percent, step and delay shown; step replaces the label", r["p1"])
check("Checking the login flow ⚠ Bash took 61s" in visible(r["p2"]) and "%" not in visible(r["p2"]),
      "automatic slow note without a percent keeps the label", r["p2"])
check("Checking the login flow" in visible(r["p3"]) and "%" not in visible(r["p3"]) and "⚠" not in visible(r["p3"]),
      "no progress file: plain label", r["p3"])
r = rows([task("p1", model="claude-sonnet-5-5", effort="medium", startTime=now_ms - 60_000)], columns=40, env=env)
check(len(visible(r["p1"])) <= 38 and "~40%" in visible(r["p1"]), "percent survives a narrow panel", r["p1"])
shutil.rmtree(scratch, ignore_errors=True)

failed = [(n, d) for ok, n, d in checks if not ok]
for n, d in failed:
    print("FAIL", n, d)
print(f"{'FAIL' if failed else 'OK'} {len(checks) - len(failed)}/{len(checks)}")
sys.exit(1 if failed else 0)
