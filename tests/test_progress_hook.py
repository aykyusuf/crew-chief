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
    check("exit 0, no stderr", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stdout!r} {r.stderr!r}")
    return r.stdout


def bash(agent, cmd, ms=10):
    return fire({"agent_id": agent, "agent_type": "crew-chief:scanner", "tool_name": "Bash", "duration_ms": ms,
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
check("report stores the tool count and time", d["rtools"] == 3 and abs(d["rts"] - __import__("time").time()) < 30, d)
bash("a1", "ls")
bash("a1", ": 'crew-progress 41 | again'")
d = load("a1")
check("a later report moves rtools and rts", d["rtools"] == 4 and d["tools"] == 4, d)
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
bash("a2", ": 'crew-progress 90 | first line'\necho second line")
bash("a2", "echo first line\n: 'crew-progress 90 | second line'")
check("a report on one line of a multi-line command is ignored", "pct" not in load("a2"), load("a2"))
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

# Counting: calls are counted, a report restarts the count, the hook never prints (the mod sends the reminder).
outs = [bash("n1", "ls") for _ in range(10)]
check("never prints, not even at 10 calls", all(o == "" for o in outs), outs)
check("the calls are counted", load("n1")["tools"] == 10, load("n1"))
o = bash("n1", ": 'crew-progress 30 | halfway'")
check("a report call prints nothing and restarts the count", o == "" and load("n1")["rtools"] == 10 and load("n1")["pct"] == 30, load("n1"))
outs = [bash("n1", "ls") for _ in range(12)]
check("still silent after the report", all(o == "" for o in outs), outs)
check("main session input prints nothing", all(fire({"tool_name": "Bash", "tool_input": {"command": "ls"}}) == "" for _ in range(12)))
outs = [fire({"agent_id": "n2", "tool_name": "Read", "tool_input": {"file_path": "/x"}}) for _ in range(10)]
check("non-Bash tools are counted too, silently", all(o == "" for o in outs) and load("n2")["tools"] == 10, outs)
r = subprocess.run(["sh", HOOK], input="garbage", capture_output=True, text=True, env={"PATH": os.environ["PATH"], "TMPDIR": scratch})
check("garbage input prints nothing", r.stdout == "" and r.returncode == 0)

# SubagentStart rule text.
START = os.path.join(ROOT, "scripts", "subagent-start.sh")
for inp in (json.dumps({"agent_id": "z", "agent_type": "crew-chief:scanner"}), "garbage", ""):
    r = subprocess.run(["sh", START], input=inp, capture_output=True, text=True, env={"PATH": os.environ["PATH"], "TMPDIR": scratch})
    out = json.loads(r.stdout)["hookSpecificOutput"] if r.stdout else {}
    check("start hook: valid JSON, rule text, no stderr", r.returncode == 0 and r.stderr == "" and out.get("hookEventName") == "SubagentStart"
          and "crew-progress NN" in out.get("additionalContext", ""), (r.stdout, r.stderr))

shutil.rmtree(scratch, ignore_errors=True)
print("FAIL" if failures else "OK", f"({len(failures)} failures)")
sys.exit(1 if failures else 0)
