"""Tests for scripts/mode-guard.sh (solo mode enforcement). Run: python3 tests/test_mode_guard.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUARD = os.path.join(ROOT, "scripts", "mode-guard.sh")
failures = []
count = 0
NOJQ = False


def env_for(data):
    if NOJQ:
        bindir = tempfile.mkdtemp(prefix="crew-chief-nojq-")
        for tool in ("sh", "cat", "grep", "sed", "tr", "head", "find", "mkdir", "rm"):
            path = shutil.which(tool)
            if path:
                os.symlink(path, os.path.join(bindir, tool))
        env = {"PATH": bindir}
    else:
        env = {"PATH": os.environ["PATH"]}
    if data is not None:
        env["CLAUDE_PLUGIN_DATA"] = data
    return env


def call(action, payload, data):
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run(["sh", GUARD, action], input=raw, capture_output=True, text=True, env=env_for(data))


def check(name, ok, detail=""):
    global count
    count += 1
    if not ok:
        failures.append(f"{name}: {detail}")


def record(prompt, data, sid="s1"):
    return call("record", {"session_id": sid, "hook_event_name": "UserPromptSubmit", "prompt": prompt}, data)


def spawn(data, sid="s1", extra=None):
    payload = {"session_id": sid, "hook_event_name": "PreToolUse", "tool_name": "Agent",
               "tool_input": {"subagent_type": "crew-chief:scanner", "prompt": "x"}}
    payload.update(extra or {})
    return call("check", payload, data).returncode


def suite():
    data = tempfile.mkdtemp(prefix="crew-chief-mode-")
    try:
        check("spawn allowed with no recorded mode", spawn(data) == 0)
        check("record exits 0", record("/crew-chief:crew-mode solo", data).returncode == 0)
        check("spawn blocked in solo", spawn(data) == 2)
        r = call("check", {"session_id": "s1", "tool_name": "Agent", "tool_input": {}}, data)
        check("block message names the way out", "crew-mode auto" in r.stderr, r.stderr)
        check("another session is not affected", spawn(data, sid="s2") == 0)
        check("subagent callers are blocked too", spawn(data, extra={"agent_id": "a1", "agent_type": "crew-chief:implementer"}) == 2)
        record("/crew-chief:crew-mode auto", data)
        check("auto lifts solo", spawn(data) == 0)
        record("/crew-chief:crew-mode solo", data)
        record("/crew-chief:crew-mode delegate", data)
        check("delegate lifts solo", spawn(data) == 0)
        record("  /crew-mode solo extra words", data)
        check("bare /crew-mode with leading space and trailing words", spawn(data) == 2)
        record("/crew-chief:crew-mode auto", data)
        record("/crew-chief:crew-mode solo\nsecond line", data)
        check("multi-line prompt: first line counts (also without jq)", spawn(data) == 2)
        record("/crew-chief:crew-mode auto", data)
        record("/crew-chief:crew-mode\tsolo", data)
        check("tab between command and mode (also without jq)", spawn(data) == 2)
        record("/crew-chief:crew-mode auto", data)
        for name in ("crew-mode", "crew-chief:crew-mode"):
            call("record", {"session_id": "s1", "hook_event_name": "UserPromptExpansion", "command_name": name, "command_args": "solo"}, data)
            check(f"expansion event {name!r} records solo", spawn(data) == 2)
            call("record", {"session_id": "s1", "hook_event_name": "UserPromptExpansion", "command_name": name, "command_args": "auto"}, data)
            check(f"expansion event {name!r} auto lifts it", spawn(data) == 0)
        call("record", {"session_id": "s1", "hook_event_name": "UserPromptExpansion", "command_name": "other-skill", "command_args": "solo"}, data)
        check("expansion of another command is ignored", spawn(data) == 0)
        record("/crew-chief:crew-mode solo", data)
        record("/crew-chief:crew-mode status", data)
        check("status changes nothing", spawn(data) == 2)
        record("/crew-chief:crew-mode banana", data)
        check("unknown mode changes nothing", spawn(data) == 2)
        record("/crew-chief:crew-mode auto", data)
        for prompt in ("please use crew-mode solo", "do it yourself", "hello\n/crew-chief:crew-mode solo", "/crew-chief:crew-modes solo", ""):
            record(prompt, data)
            check(f"prompt {prompt!r} does not switch to solo", spawn(data) == 0)

        for bad in ("../x", "a b", "a/b", ""):
            record("/crew-chief:crew-mode solo", data, sid=bad)
            check(f"odd session id {bad!r} is ignored", spawn(data, sid=bad) == 0)
        check("nothing escaped the modes directory", sorted(os.listdir(data)) == ["modes"], str(os.listdir(data)))

        for raw in ("", "not json", "{}"):
            check(f"record survives input {raw!r}", call("record", raw, data).returncode == 0)
            check(f"check survives input {raw!r}", call("check", raw, data).returncode == 0)
        record("/crew-chief:crew-mode solo", None)
        check("without CLAUDE_PLUGIN_DATA nothing is recorded or blocked", spawn(None) == 0)
        check("unknown action is a no-op", call("bogus", {"session_id": "s1"}, data).returncode == 0)

        record("/crew-chief:crew-mode solo", data, sid="old")
        stale = os.path.join(data, "modes", "old")
        os.utime(stale, (1, 1))
        record("/crew-chief:crew-mode solo", data, sid="fresh")
        check("records older than two weeks are pruned", not os.path.exists(stale))
        check("fresh record is kept", os.path.exists(os.path.join(data, "modes", "fresh")))
    finally:
        shutil.rmtree(data, ignore_errors=True)


def main():
    global NOJQ
    suite()
    if shutil.which("jq"):
        NOJQ = True
        suite()
    if failures:
        print("\n".join("FAIL " + f for f in failures))
        sys.exit(1)
    print(f"OK {count} checks")


if __name__ == "__main__":
    main()
