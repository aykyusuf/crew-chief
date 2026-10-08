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


def rows(tasks, columns=80):
    payload = {"columns": columns, "tasks": tasks} if columns is not None else {"tasks": tasks}
    out = subprocess.run([SCRIPT], input=json.dumps(payload), capture_output=True, text=True, check=True).stdout
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

failed = [(n, d) for ok, n, d in checks if not ok]
for n, d in failed:
    print("FAIL", n, d)
print(f"{'FAIL' if failed else 'OK'} {len(checks) - len(failed)}/{len(checks)}")
sys.exit(1 if failed else 0)
