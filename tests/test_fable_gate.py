"""Tests for scripts/fable-gate.sh (the PreToolUse Agent gate: no Fable subagent unless the user asks). Run: python3 tests/test_fable_gate.py (needs jq)."""
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "scripts", "fable-gate.sh")
SCRATCH = os.path.join(ROOT, ".test-tmp", "fable-gate")
failures = []

if not shutil.which("jq"):
    print("skip: jq not installed")
    sys.exit(0)


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f": {detail}"))
    if not ok:
        failures.append(name)


def world(name):
    base = os.path.join(SCRATCH, name)
    data = os.path.join(base, "data")
    os.makedirs(data)
    return data


def run(data, model, agent="crew-chief:implementer", prompt="Do the thing.", env_extra=None, raw=None, with_data=True):
    env = {"PATH": os.environ["PATH"], "CLAUDE_PLUGIN_ROOT": ROOT}
    if with_data:
        env["CLAUDE_PLUGIN_DATA"] = data
    env.update(env_extra or {})
    tool_input = {"prompt": prompt, "description": "x"}
    if agent is not None:
        tool_input["subagent_type"] = agent
    if model is not None:
        tool_input["model"] = model
    payload = raw if raw is not None else json.dumps({"session_id": "s1", "cwd": ROOT, "tool_name": "Agent", "tool_input": tool_input})
    return subprocess.run(["/bin/sh", HOOK], input=payload, capture_output=True, text=True, env=env)


REASON = "crew-chief: the user's rule is no Fable subagents unless they ask for Fable. If the user explicitly asked for Fable in this conversation, retry the identical call; otherwise use Opus."


def main():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    os.makedirs(SCRATCH)
    try:
        d = world("basic")
        r = run(d, "fable")
        check("a Fable call is denied once: exit 2", r.returncode == 2, f"{r.returncode} {r.stderr!r}")
        check("the reason is the agreed text", r.stderr.strip() == REASON, r.stderr)
        check("a state file is written", len(os.listdir(os.path.join(d, "fable-gate"))) == 1)
        r = run(d, "fable")
        check("the identical retry passes", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        r = run(d, "fable", prompt="Do another thing.")
        check("a different brief is denied again", r.returncode == 2)
        r = run(d, "fable", agent="crew-chief:reviewer")
        check("same brief for another agent type is a different call", r.returncode == 2)
        r = run(d, "Fable", agent="crew-chief:implementer")
        check("a different spelling of the model is a different call (denied)", r.returncode == 2)
        r = run(d, "Fable", agent="crew-chief:implementer")
        check("and its identical retry passes", r.returncode == 0)

        for i, model in enumerate(("FABLE", "Fable", "claude-fable-5-2", "fable[1m]")):
            d2 = world(f"m{i}")
            r = run(d2, model)
            check(f"model {model!r} is denied", r.returncode == 2, f"{r.returncode}")

        for i, model in enumerate(("opus", "sonnet", "haiku", "claude-opus-5-5", None, "")):
            d3 = world(f"ok{i}")
            r = run(d3, model)
            check(f"model {model!r} passes", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        r = run(d3, "opus", agent=None)
        check("a call with no agent type and an Opus model passes", r.returncode == 0)
        d4 = world("any-agent")
        r = run(d4, "fable", agent=None)
        check("it is global: a call with no subagent type is denied too", r.returncode == 2)
        d5 = world("ui")
        r = run(d5, "fable", agent="crew-chief:ui-implementer")
        check("it is global: a UI agent call is denied too", r.returncode == 2)

        d6 = world("off")
        r = run(d6, "fable", env_extra={"CREW_CHIEF_FABLE_GATE": "off"})
        check("CREW_CHIEF_FABLE_GATE=off lets a Fable call through", r.returncode == 0 and r.stderr == "")
        check("and remembers nothing", not os.path.exists(os.path.join(d6, "fable-gate")))
        r = run(d6, "fable", env_extra={"CREW_CHIEF_FABLE_GATE": "on"})
        check("=on still gates", r.returncode == 2)

        d7 = world("old")
        run(d7, "fable")
        f = os.path.join(d7, "fable-gate", os.listdir(os.path.join(d7, "fable-gate"))[0])
        old = time.time() - 5 * 3600
        os.utime(f, (old, old))
        r = run(d7, "fable")
        check("a denial older than four hours is forgotten (denied again)", r.returncode == 2)

        d8 = world("broken")
        for label, raw in (("empty input", ""), ("not JSON", "nope"), ("a JSON list", "[1]"), ("no tool_input", "{}"), ("a numeric model", json.dumps({"tool_input": {"model": 5, "prompt": "x"}}))):
            r = run(d8, "fable", raw=raw)
            check(f"{label}: lets the call through", r.returncode == 0, f"{r.returncode} {r.stderr!r}")
        r = run(d8, "fable", with_data=False)
        check("without CLAUDE_PLUGIN_DATA it lets the call through", r.returncode == 0)
        r = run(d8, "fable", env_extra={"PATH": "/nonexistent"})
        check("without jq it lets the call through", r.returncode == 0)
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)
    print("FAIL" if failures else "OK", f"({len(failures)} failures)")
    sys.exit(1 if failures else 0)


main()
