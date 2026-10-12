"""Tests for scripts/progress-hook.sh (per-subagent progress files). Run: python3 tests/test_progress_hook.py (needs jq)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "scripts", "progress-hook.sh")
failures = []

if not shutil.which("jq"):
    print("skip: jq not installed")
    sys.exit(0)


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f": {detail}"))
    if not ok:
        failures.append(name)


scratch = tempfile.mkdtemp(prefix="progress-test-")
pdir = os.path.join(scratch, "crew-chief-progress")


def fire(payload, tmpdir=scratch):
    r = subprocess.run(["sh", HOOK], input=json.dumps(payload), capture_output=True, text=True,
                       env={"PATH": os.environ["PATH"], "TMPDIR": tmpdir})
    check("exit 0, silent", r.returncode == 0 and r.stdout == "" and r.stderr == "", f"{r.returncode} {r.stdout!r} {r.stderr!r}")


def bash(agent, cmd, ms=10):
    fire({"agent_id": agent, "agent_type": "crew-chief:scanner", "tool_name": "Bash", "duration_ms": ms,
          "tool_input": {"command": cmd}})


def load(agent):
    with open(os.path.join(pdir, agent + ".json")) as f:
        return json.load(f)


bash("a1", "ls")
bash("a1", "sleep 61", ms=61000)
d = load("a1")
check("tools counted, slow note set", d["tools"] == 2 and d["slow"] == "Bash took 61s" and d["id"] == "a1", d)
bash("a1", "pwd", ms=20)
check("slow note clears on the next fast call", load("a1")["slow"] == "", load("a1"))

bash("a1", ": 'crew-progress 40 | reading the auth module | slow test suite'")
d = load("a1")
check("report parsed", d["pct"] == 40 and d["step"] == "reading the auth module" and d["delay"] == "slow test suite", d)
check("report does not count as a tool call", d["tools"] == 3, d)
bash("a1", ": 'crew-progress 55%|next step|'")
d = load("a1")
check("percent sign tolerated, delay cleared", d["pct"] == 55 and d["step"] == "next step" and d["delay"] == "", d)
bash("a1", ": 'crew-progress 250 | over'")
check("percent capped at 100", load("a1")["pct"] == 100, load("a1"))
bash("a1", ": 'crew-progress soon | still going'")
d = load("a1")
check("non-numeric percent keeps the old one", d["pct"] == 100 and d["step"] == "still going", d)
bash("a1", ": 'crew-progress 20 | a\u0001b\tc'")
check("control characters removed", load("a1")["step"] == "a b c", load("a1"))

bash("a2", "echo hi && : 'crew-progress 90 | sneaky'")
check("report must be the whole command", "pct" not in load("a2"), load("a2"))
fire({"tool_name": "Bash", "tool_input": {"command": "ls"}})
fire({"agent_id": "../escape", "tool_name": "Bash", "tool_input": {"command": "ls"}})
fire({"agent_id": "", "tool_name": "Bash", "tool_input": {"command": "ls"}})
check("main session and odd ids write nothing", sorted(os.listdir(pdir)) == ["a1.json", "a2.json"], os.listdir(pdir))

fire({"agent_id": "a3", "tool_name": "Read", "duration_ms": 5, "tool_input": {"file_path": "/x"}})
check("non-Bash tool counted", load("a3")["tools"] == 1 and load("a3")["last"] == "Read", load("a3"))

old = os.path.join(pdir, "old.json")
with open(old, "w") as f:
    f.write("{}")
os.utime(old, (1, 1))
bash("a1", "ls")
check("files older than 12 h pruned", not os.path.exists(old))
with open(os.path.join(pdir, "a1.json"), "w") as f:
    f.write("not json")
bash("a1", "ls")
check("corrupt file replaced", load("a1")["tools"] == 1, load("a1"))
r = subprocess.run(["sh", HOOK], input="garbage", capture_output=True, text=True, env={"PATH": os.environ["PATH"], "TMPDIR": scratch})
check("garbage input is harmless", r.returncode == 0 and r.stdout == "", r)

shutil.rmtree(scratch, ignore_errors=True)
print("FAIL" if failures else "OK", f"({len(failures)} failures)")
sys.exit(1 if failures else 0)
