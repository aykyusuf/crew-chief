#!/usr/bin/env python3
"""Tests for scripts/verify-gate.sh. Run: python3 tests/test_verify_gate.py"""
import json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GATE = os.path.join(ROOT, "scripts", "verify-gate.sh")
failures, count = [], 0
SID = "verify-sess-1"


def check(label, ok, detail=""):
    global count
    count += 1
    if not ok:
        failures.append(f"{label}: {detail}"[:400])


def run(arg, payload, data, env_extra=None):
    env = dict(os.environ, CLAUDE_PLUGIN_DATA=data, **(env_extra or {}))
    env.pop("CREW_CHIEF_VERIFY_GATE", None) if not (env_extra or {}).get("CREW_CHIEF_VERIFY_GATE") else None
    r = subprocess.run(["sh", GATE, arg], input=json.dumps(payload), capture_output=True, text=True, env=env)
    return r.returncode, r.stdout, r.stderr


def bash(cmd, cwd, sid=SID):
    return {"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": cwd, "session_id": sid}


def main():
    base = os.path.realpath(tempfile.mkdtemp(prefix="crew-chief-verify-"))
    try:
        proj = os.path.join(base, "p")
        os.makedirs(proj)
        g = lambda *a: subprocess.run(["git", "-C", proj, *a], check=True, capture_output=True)
        g("init", "-q"); g("config", "user.email", "t@e.com"); g("config", "user.name", "t")
        open(os.path.join(proj, "a.txt"), "w").write("a")
        g("add", "-A"); g("commit", "-q", "-m", "init")
        os.utime(proj, None)
        data = os.path.join(base, "data")
        os.makedirs(data)
        time.sleep(1.1)  # the commit time is in seconds; the marks below must be later

        rc, out, err = run("gate", bash('git commit -m "x"', proj), data)
        check("observe: no check yet -> runs with a note", rc == 0 and "verification gate" in out and "Verified:" in out, (rc, out, err))
        check("not a commit: silent", run("gate", bash("git status", proj), data) == (0, "", ""))
        check("a Verified: line in the message: silent", run("gate", bash('git commit -m "x" -m "Verified: npm test"', proj), data)[1] == "")
        for c in ["npm test", "pnpm run test", "pytest -q", "python3 tests/test_x.py", "node --test tests/*.mjs", "go test ./...", "cargo test", "flutter test", "claude plugin test", "make check", "npx tsc --noEmit"]:
            mark = os.path.join(data, "verify", SID)
            if os.path.exists(mark):
                os.remove(mark)
            run("record", bash(c, proj), data)
            check(f"recorded as verification: {c}", os.path.exists(mark))
        for c in ["cat package.json", "npm install", "ls tests", "grep test x"]:
            mark = os.path.join(data, "verify", SID)
            if os.path.exists(mark):
                os.remove(mark)
            run("record", bash(c, proj), data)
            check(f"not verification: {c}", not os.path.exists(mark))
        run("record", {"tool_name": "Agent", "tool_input": {"subagent_type": "crew-chief:verifier"}, "session_id": SID}, data)
        check("a verifier agent counts", os.path.exists(os.path.join(data, "verify", SID)))
        check("after a check: the commit is silent", run("gate", bash('git commit -m "y"', proj), data) == (0, "", ""))
        check("another session has its own mark", "verification gate" in run("gate", bash('git commit -m "z"', proj, sid="other-sess"), data)[1])

        # enforce: two holds, then it passes
        e = {"CREW_CHIEF_VERIFY_GATE": "enforce"}
        s2 = "enforce-sess"
        r1 = run("gate", bash('git commit -m "e"', proj, sid=s2), data, e)
        r2 = run("gate", bash('git commit -m "e"', proj, sid=s2), data, e)
        r3 = run("gate", bash('git commit -m "e"', proj, sid=s2), data, e)
        check("enforce: first hold", r1[0] == 2 and "held 1 of 2" in r1[2], r1)
        check("enforce: second hold", r2[0] == 2 and "held 2 of 2" in r2[2], r2)
        check("enforce: third attempt passes", r3[0] == 0, r3)
        check("off: nothing", run("gate", bash('git commit -m "o"', proj, sid="off-sess"), data, {"CREW_CHIEF_VERIFY_GATE": "off"}) == (0, "", ""))
        # project file mode
        os.makedirs(os.path.join(proj, ".claude"))
        json.dump({"verify.gate": "enforce"}, open(os.path.join(proj, ".claude", "crew-chief.json"), "w"))
        check("project file enforce", run("gate", bash('git commit -m "p"', proj, sid="proj-sess"), data)[0] == 2)
        check("outside a repo: nothing", run("gate", bash('git commit -m "q"', base), data) == (0, "", ""))
    finally:
        shutil.rmtree(base, ignore_errors=True)
    if failures:
        for f in failures:
            print("FAIL", f)
        print(f"FAIL {len(failures)}/{count}")
        sys.exit(1)
    print(f"OK {count}/{count}")


main()
