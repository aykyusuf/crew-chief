#!/usr/bin/env python3
"""Tests for scripts/model-switch.sh. Run: python3 tests/test_model_switch.py"""
import json, os, subprocess, sys

HOOK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "model-switch.sh")
failures, count = [], 0


def check(label, ok, detail=""):
    global count
    count += 1
    if not ok:
        failures.append(f"{label}: {detail}"[:300])


def run(arg, payload, env=None):
    e = dict(os.environ, **(env or {}))
    r = subprocess.run(["sh", HOOK, arg], input=json.dumps(payload), capture_output=True, text=True, env=e)
    return r.returncode, r.stdout


def sw(f, t, warm=False, usd=0.0, ctx=10000):
    return {"from_model": f, "to_model": t, "prompt_cache_warm": warm, "estimated_cache_write_usd": usd, "context_tokens": ctx}


rc, out = run("pre", sw("claude-fable-5-2", "claude-opus-5-5"))
check("pre: leaving Fable asks", rc == 0 and json.loads(out)["hookSpecificOutput"]["permissionDecision"] == "ask" and "Fable" in out, out)
rc, out = run("pre", sw("claude-sonnet-5-5", "claude-opus-5-5", warm=True, usd=2.4, ctx=310000))
check("pre: a warm cache worth 2.40 USD asks and names the cost", "ask" in out and "2.40 USD" in out and "310k" in out, out)
check("pre: a cheap switch is silent", run("pre", sw("claude-sonnet-5-5", "claude-opus-5-5", warm=True, usd=0.2)) == (0, ""))
check("pre: a cold cache is silent", run("pre", sw("claude-opus-5-5", "claude-sonnet-5-5", warm=False, usd=5)) == (0, ""))
check("pre: Fable to Fable is silent", run("pre", sw("claude-fable-5-2", "claude-fable-5-2")) == (0, ""))
rc, out = run("post", sw("claude-fable-5-2", "claude-sonnet-5-5"))
check("post: after Fable, restate the plan", "restate the current goal" in out and json.loads(out)["hookSpecificOutput"]["hookEventName"] == "PostModelSwitch", out)
rc, out = run("post", sw("claude-sonnet-5-5", "claude-opus-5-5"))
check("post: a more expensive model gets the lean-context note", "more expensive" in out, out)
check("post: a cheaper model is silent", run("post", sw("claude-opus-5-5", "claude-sonnet-5-5")) == (0, ""))
check("off switch", run("pre", sw("claude-fable-5-2", "claude-opus-5-5"), {"CREW_CHIEF_MODEL_SWITCH": "off"}) == (0, ""))
r = subprocess.run(["sh", HOOK, "pre"], input="garbage", capture_output=True, text=True)
check("garbage input is silent", r.returncode == 0 and r.stdout == "", r.stdout)

if failures:
    for f in failures:
        print("FAIL", f)
    print(f"FAIL {len(failures)}/{count}")
    sys.exit(1)
print(f"OK {count}/{count}")
