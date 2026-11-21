#!/usr/bin/env python3
"""Tests for scripts/night-stop.sh and scripts/stop-lib.sh (night mode Stop hook). Run: python3 tests/test_night_stop.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
STATE = os.path.join(SCRIPTS, "night-state.sh")
STOP = os.path.join(SCRIPTS, "night-stop.sh")
LIB = os.path.join(SCRIPTS, "stop-lib.sh")
failures = []
count = 0
NOW = 1_800_000_000  # fake clock, TZ=UTC: 2027-01-15 08:00:00
SID = "abcdef12-0000-1111-2222-333333333333"
SID8 = "abcdef12"


def check(label, ok, detail=""):
    global count
    count += 1
    if not ok:
        failures.append(f"{label}: {detail}"[:700])


def git(proj, *args):
    subprocess.run(["git", "-C", proj, *args], check=True, capture_output=True)


def make_repo(base, name):
    proj = os.path.join(base, name)
    os.makedirs(proj)
    git(proj, "init", "-q")
    git(proj, "config", "user.email", "t@example.com")
    git(proj, "config", "user.name", "t")
    with open(os.path.join(proj, "README.md"), "w") as f:
        f.write("hi\n")
    git(proj, "add", "-A")
    git(proj, "commit", "-q", "-m", "init")
    return proj


def env_for(data, fakebin, now, path=None):
    env = dict(os.environ, CLAUDE_PLUGIN_DATA=data, TZ="UTC", PATH=path or (fakebin + os.pathsep + os.environ["PATH"]))
    env.pop("CLAUDE_SESSION_ID", None)
    if now is not None:
        env["CREW_CHIEF_NOW"] = str(now)
    return env


def state_cli(args, proj, data, fb, now=NOW):
    return subprocess.run(["sh", STATE, *args], cwd=proj, capture_output=True, text=True, env=env_for(data, fb, now))


def stop(data, fb, now, payload=None, raw=None, path=None, sid=SID):
    if raw is None:
        payload = dict({"session_id": sid, "hook_event_name": "Stop", "stop_hook_active": False}, **(payload or {}))
        raw = json.dumps(payload)
    r = subprocess.run(["sh", STOP], input=raw, capture_output=True, text=True, env=env_for(data, fb, now, path))
    return r.returncode, r.stdout, r.stderr


def reason_of(out):
    try:
        j = json.loads(out)
    except ValueError:
        return None
    return j.get("reason") if j.get("decision") == "block" else None


def sj(proj):
    return sj_of(proj, SID8)


_bump = [0]


def bump(proj):
    """Make the progress signature change (the work touched tasks.json)."""
    _bump[0] += 1
    p = os.path.join(proj, "tasks.json")
    with open(p, "a") as f:
        f.write("")
    if not os.path.exists(p):
        open(p, "w").write("{}")
    os.utime(p, (NOW + 10000 + _bump[0], NOW + 10000 + _bump[0]))


def arm(proj, data, fb, hours="2", sid=SID, now=NOW):
    r = state_cli(["arm", "--session", sid, "--hours", hours], proj, data, fb, now)
    assert r.returncode == 0, r.stderr
    return sj_of(proj, sid[:8])


def main():
    base = os.path.realpath(tempfile.mkdtemp(prefix="crew-chief-nstop-"))
    pids = []
    try:
        fb = os.path.join(base, "fakebin")
        os.makedirs(fb)
        with open(os.path.join(fb, "caffeinate"), "w") as f:
            f.write("#!/bin/sh\ntrap 'kill $c 2>/dev/null; exit 0' TERM\nsleep 120 &\nc=$!\nwait\n")
        os.chmod(os.path.join(fb, "caffeinate"), 0o755)
        data = os.path.join(base, "data")

        # not a night session: exit 0, silent, and nothing is created
        proj = make_repo(base, "plain")
        r = stop(data, fb, NOW)
        check("no pointer: exit 0, silent", r == (0, "", ""), r)
        check("no pointer: nothing created", not os.path.exists(data))
        check("empty input: exit 0", stop(data, fb, NOW, raw="")[0] == 0)
        check("garbage input: exit 0", stop(data, fb, NOW, raw="{{{ not json")[:2] == (0, ""))

        # opening, no deadline yet: the night is not running
        state_cli(["open", "--session", SID], proj, data, fb)
        r = stop(data, fb, NOW)
        check("status opening: exit 0, silent", r == (0, "", ""), r)

        # armed before the soft wrap: block
        st = arm(proj, data, fb)
        if st["caffeinatePid"]:
            pids.append(st["caffeinatePid"])
        with open(os.path.join(proj, "tasks.json"), "w") as f:
            json.dump({"tasks": [{"id": "A-1", "title": "done thing", "priority": 1, "status": "done"},
                                 {"id": "B-2", "title": "second", "priority": 3, "status": "todo"},
                                 {"id": "C-3", "title": "urgent one", "priority": 1, "status": "todo"}]}, f)
        t = NOW + 600
        rc, out, err = stop(data, fb, t)
        msg = reason_of(out)
        check("armed: exits 0 with a block decision", rc == 0 and msg is not None, (rc, out, err))
        check("block text: time left, deadline, folder, next todo by priority", msg and "110 min" in msg and "10:00" in msg and f"night/{SID8}/QUESTIONS.md" in msg and "C-3: urgent one" in msg, msg)
        check("block text: never push, no Fable, attempts", msg and "Never push" in msg and "Fable" in msg and "3 attempts" in msg, msg)
        s = sj(proj)
        check("state counts the block", s["blocks"] == 1 and s["noProgress"] == 1 and s["lastSig"], s)
        check("events.log gets a stop line", "stop blocked the Stop" in open(os.path.join(proj, "night", SID8, "events.log")).read())
        rc, out2, _ = stop(data, fb, t)
        check("the block text is byte-identical on repeat", reason_of(out2) == msg, (msg, reason_of(out2)))
        check("two identical Stops: both block, count 2", sj(proj)["noProgress"] == 2 and sj(proj)["status"] == "armed", sj(proj))

        # stop_hook_active:true (true on every Stop after the first block) does not end the night
        projA = make_repo(base, "pa")
        SA = "cafe000a-aaaa"
        stA = arm(projA, data, fb, sid=SA)
        if stA["caffeinatePid"]:
            pids.append(stA["caffeinatePid"])
        rc, outa, _ = stop(data, fb, NOW + 60, payload={"stop_hook_active": True}, sid=SA)
        check("stop_hook_active:true still blocks", rc == 0 and reason_of(outa) is not None, outa)
        check("the output is a single json object", json.loads(outa)["decision"] == "block")

        # same signature three times in a row -> stalled
        projB = make_repo(base, "pb")
        SB = "cafe000b-aaaa"
        stB = arm(projB, data, fb, sid=SB)
        pidB = stB["caffeinatePid"]
        if pidB:
            pids.append(pidB)
        r1 = stop(data, fb, NOW + 60, sid=SB)
        r2 = stop(data, fb, NOW + 70, sid=SB, payload={"stop_hook_active": True})
        r3 = stop(data, fb, NOW + 80, sid=SB, payload={"stop_hook_active": True})
        check("stalled: the first two identical Stops block", reason_of(r1[1]) is not None and reason_of(r2[1]) is not None)
        check("stalled: the third identical Stop is allowed (exit 0, silent)", r3 == (0, "", ""), r3)
        s = sj_of(projB, "cafe000b")
        check("stalled: status and reason", s["status"] == "stalled" and s["reason"] == "stalled", s)
        check("stalled: fallback report says stalled", "stalled" in open(os.path.join(projB, "night", "cafe000b", "REPORT.md")).read())
        check("stalled: caffeinate killed", pidB and _wait(pidB))
        check("after stalled the hook is silent", stop(data, fb, NOW + 90, sid=SB) == (0, "", ""))

        # progress resets the counter
        proj2 = make_repo(base, "p2")
        S2 = "cafe0002-aaaa"
        arm(proj2, data, fb, sid=S2)
        t = NOW + 60
        stop(data, fb, t, sid=S2)
        stop(data, fb, t, sid=S2)
        check("two identical Stops: still blocking, count 2", sj_of(proj2, "cafe0002")["noProgress"] == 2 and sj_of(proj2, "cafe0002")["status"] == "armed", sj_of(proj2, "cafe0002"))
        with open(os.path.join(proj2, "DECISIONS.md.new"), "w") as f:
            f.write("x")
        d = os.path.join(proj2, "night", "cafe0002", "DECISIONS.md")
        with open(d, "w") as f:
            f.write("- decided x\n")
        os.utime(d, (NOW + 100, NOW + 100))
        rc, out, _ = stop(data, fb, t, sid=S2)
        check("a changed file resets the count: block, count 1", reason_of(out) is not None and sj_of(proj2, "cafe0002")["noProgress"] == 1, (out, sj_of(proj2, "cafe0002")))
        git(proj2, "commit", "--allow-empty", "-q", "-m", "work")
        rc, out, _ = stop(data, fb, t, sid=S2)
        check("a new commit counts as progress", reason_of(out) is not None and sj_of(proj2, "cafe0002")["noProgress"] == 1, sj_of(proj2, "cafe0002"))
        state_cli(["task", "T-9", "--session", S2], proj2, data, fb, now=NOW + 120)
        rc, out, _ = stop(data, fb, NOW + 130, sid=S2)
        msg = reason_of(out)
        check("a task change counts as progress and the block names the current task", msg and "Current task T-9" in msg and "park it at 48 min" in msg and sj_of(proj2, "cafe0002")["noProgress"] == 1, (msg, sj_of(proj2, "cafe0002")))

        # no todo left: closing checklist
        proj3 = make_repo(base, "p3")
        S3 = "cafe0003-aaaa"
        arm(proj3, data, fb, sid=S3)
        with open(os.path.join(proj3, "tasks.json"), "w") as f:
            json.dump({"tasks": [{"id": "A-1", "title": "t", "status": "done"}]}, f)
        rc, out, _ = stop(data, fb, NOW + 60, sid=S3)
        msg = reason_of(out)
        sha = sj_of(proj3, "cafe0003")["startSha"]
        check("no todo left: closing checklist with the diff range and the done command", msg and "No todo is left" in msg and f"git diff {sha}..HEAD" in msg and "night-state.sh done --session " + S3 in msg, msg)

        # wrap-up phase
        proj4 = make_repo(base, "p4")
        S4 = "cafe0004-aaaa"
        arm(proj4, data, fb, sid=S4)
        rc, out, _ = stop(data, fb, NOW + 7200 - 20 * 60, sid=S4)
        msg = reason_of(out)
        check("after softWrap: WRAP UP text, status wrapup", msg and "WRAP UP" in msg and "REPORT.md" in msg and "night-state.sh done" in msg and sj_of(proj4, "cafe0004")["status"] == "wrapup", (msg, sj_of(proj4, "cafe0004")))
        bump(proj4)
        rc, out, _ = stop(data, fb, NOW + 7200 - 10 * 60, sid=S4)
        check("wrapup keeps blocking", reason_of(out) is not None and "WRAP UP" in reason_of(out) and sj_of(proj4, "cafe0004")["status"] == "wrapup")
        state_cli(["phase", "wrapup", "--reason", "limit", "--session", S4], proj4, data, fb)
        bump(proj4)
        rc, out, _ = stop(data, fb, NOW + 7200 - 9 * 60, sid=S4)
        check("a limit wrap-up says so", "usage limit" in (reason_of(out) or ""), out)
        rc, out, _ = stop(data, fb, NOW + 7200, sid=S4)
        s = sj_of(proj4, "cafe0004")
        check("at the deadline: exit 0, silent, status done, reason deadline", (rc, out) == (0, "") and s["status"] == "done" and s["reason"] == "deadline", (rc, out, s))
        rep = os.path.join(proj4, "night", "cafe0004", "REPORT.md")
        check("at the deadline with no agent report: the fallback is written", os.path.exists(rep) and open(rep).read().startswith("AUTO-GENERATED: the agent wrote no report"))
        check("after done the hook is silent", stop(data, fb, NOW + 7300, sid=S4) == (0, "", ""))

        # at the deadline with an agent report: kept
        proj5 = make_repo(base, "p5")
        S5 = "cafe0005-aaaa"
        arm(proj5, data, fb, sid=S5)
        rep = os.path.join(proj5, "night", "cafe0005", "REPORT.md")
        with open(rep, "w") as f:
            f.write("# agent report\n")
        os.utime(rep, (NOW + 50, NOW + 50))
        rc, out, _ = stop(data, fb, NOW + 8000, sid=S5)
        check("the agent's own report is kept at the deadline", open(rep).read() == "# agent report\n" and sj_of(proj5, "cafe0005")["status"] == "done")
        sd = sj_of(proj5, "cafe0005")
        check("done at the deadline clears caffeinate", sd["caffeinatePid"] == 0)

        # background work, crons, hold
        proj6 = make_repo(base, "p6")
        S6 = "cafe0006-aaaa"
        arm(proj6, data, fb, sid=S6)
        check("a running subagent: exit 0, silent (its notification wakes the session)", stop(data, fb, NOW + 60, payload={"background_tasks": [{"id": "b1", "agent_type": "crew-chief:implementer"}]}, sid=S6) == (0, "", ""))
        check("a cron: exit 0, silent", stop(data, fb, NOW + 60, payload={"session_crons": [{"id": "c1"}]}, sid=S6) == (0, "", ""))
        check("session crons pending: exit 0, silent", stop(data, fb, NOW + 60, payload={"session_crons": [{"id": "c1"}]}, sid=S6) == (0, "", ""))
        check("pending work is not counted as a block", sj_of(proj6, "cafe0006")["blocks"] == 0)
        check("a dev server (a plain background process) does not switch the night off", reason_of(stop(data, fb, NOW + 60, payload={"background_tasks": [{"id": "b2", "command": "npm run dev"}]}, sid=S6)[1]) is not None)
        check("empty background lists still block", reason_of(stop(data, fb, NOW + 60, payload={"background_tasks": [], "session_crons": []}, sid=S6)[1]) is not None)
        hold = os.path.join(proj6, "night", "cafe0006", "hold")
        with open(hold, "w") as f:
            f.write(f"{NOW + 120}\n")
        before = sj_of(proj6, "cafe0006")["blocks"]
        check("a fresh hold (epoch in the future): exit 0, silent", stop(data, fb, NOW + 60, sid=S6) == (0, "", ""))
        check("a hold is not counted", sj_of(proj6, "cafe0006")["blocks"] == before)
        bump(proj6)
        check("an expired hold no longer holds", reason_of(stop(data, fb, NOW + 130, sid=S6)[1]) is not None)
        with open(hold, "w") as f:
            f.write(f"{NOW + 99999}\n")
        bump(proj6)
        check("a hold far in the future is distrusted", reason_of(stop(data, fb, NOW + 140, sid=S6)[1]) is not None)
        with open(hold, "w") as f:
            f.write("garbage\n")
        bump(proj6)
        check("a garbage hold is ignored", reason_of(stop(data, fb, NOW + 150, sid=S6)[1]) is not None)
        with open(hold, "w") as f:
            f.write(f"{NOW + 7400}\n")
        check("a fresh hold wins over the deadline (compaction first), the night ends on the next Stop", stop(data, fb, NOW + 7300, sid=S6) == (0, "", "") and sj_of(proj6, "cafe0006")["status"] == "armed")
        os.remove(hold)
        check("without the hold the deadline ends the night", stop(data, fb, NOW + 7300, sid=S6) == (0, "", "") and sj_of(proj6, "cafe0006")["status"] == "done")

        # other sessions, mismatched owner, broken state, no jq
        proj7 = make_repo(base, "p7")
        S7 = "cafe0007-aaaa"
        arm(proj7, data, fb, sid=S7)
        check("another session id exits 0 at once", stop(data, fb, NOW + 60, sid="zzzzzzzz-other") == (0, "", ""))
        check("input naming the session inside tool data only is not mistaken", stop(data, fb, NOW + 60, raw=json.dumps({"session_id": "zzzzzzzz-other", "note": f'"session_id":"{S7}"'})) == (0, "", ""))
        sp = os.path.join(proj7, "night", "cafe0007", "state.json")
        s = json.load(open(sp))
        s["session"] = "someone-else"
        json.dump(s, open(sp, "w"))
        check("pointer of a session that no longer owns the night: exit 0", stop(data, fb, NOW + 60, sid=S7) == (0, "", ""))
        s["session"] = S7
        json.dump(s, open(sp, "w"))
        check("owner restored: blocks again", reason_of(stop(data, fb, NOW + 60, sid=S7)[1]) is not None)
        open(sp, "w").write("{{{ garbage")
        r = stop(data, fb, NOW + 60, sid=S7)
        check("garbage state.json: exit 0, silent (fail open)", r == (0, "", ""), r)
        open(sp, "w").write("")
        check("empty state.json: exit 0, silent", stop(data, fb, NOW + 60, sid=S7) == (0, "", ""))
        s["blocks"] = "x"
        json.dump(s, open(sp, "w"))
        check("garbage field values: exit 0", stop(data, fb, NOW + 60, sid=S7)[0] == 0)
        s["blocks"] = 0
        json.dump(s, open(sp, "w"))
        nojq = os.path.join(base, "nojq")
        os.makedirs(nojq)
        for tool in ("sh", "cat", "grep", "head", "sed", "dirname", "tr", "cut"):
            p = shutil.which(tool)
            if p:
                os.symlink(p, os.path.join(nojq, tool))
        check("no jq: exit 0, silent", stop(data, fb, NOW + 60, sid=S7, path=nojq) == (0, "", ""))
        check("no CLAUDE_PLUGIN_DATA: exit 0", subprocess.run(["sh", STOP], input=json.dumps({"session_id": S7}), capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k != "CLAUDE_PLUGIN_DATA"}).returncode == 0)

        # stop-lib: counter and block helper
        cf = os.path.join(base, "counter")
        script = f'. "{LIB}"; stop_count_get "{cf}"; stop_count_set "{cf}" 2; stop_count_get "{cf}"; stop_count_reset "{cf}"; stop_count_get "{cf}"; stop_parse \'{{"session_id":"x1","stop_hook_active":true}}\' && echo "$STOP_SID $STOP_ACTIVE"; stop_parse \'[1]\' || echo garbage; emit_block "why \\"q\\""'
        r = subprocess.run(["sh", "-c", script], capture_output=True, text=True, env=dict(os.environ))
        lines = r.stdout.splitlines()
        check("stop-lib: counter, parse and emit_block", lines[:5] == ["0", "2", "0", "x1 true", "garbage"] and json.loads("\n".join(lines[5:])) == {"decision": "block", "reason": 'why "q"'}, r.stdout + r.stderr)
        # review fix: editing a file that is already modified is progress (no stall)
        S8 = "edit0008-0000-0000-0000-000000000008"
        proj8 = make_repo(base, "edits")
        with open(os.path.join(proj8, "app.py"), "w") as f:
            f.write("a = 1\n")
        git(proj8, "add", "-A")
        git(proj8, "commit", "-q", "-m", "app")
        arm(proj8, data, fb, sid=S8)
        ended = False
        for i in range(5):
            with open(os.path.join(proj8, "app.py"), "w") as f:
                f.write(f"a = {i + 2}\n")
            rc, out, err = stop(data, fb, NOW + 60 + i, sid=S8)
            if reason_of(out) is None:
                ended = True
        check("edits to an already-modified file keep the night going", not ended and sj_of(proj8, S8[:8])["status"] == "armed", sj_of(proj8, S8[:8]))
        with open(os.path.join(proj8, "new_untracked.txt"), "w") as f:
            f.write("x")
        check("stop still blocks after a new untracked file", reason_of(stop(data, fb, NOW + 70, sid=S8)[1]) is not None)
    finally:
        for p in pids:
            try:
                os.kill(p, 15)
            except OSError:
                pass
        # Any fake caffeinate still alive (it lives in this test's own temp folder, so nothing else matches).
        subprocess.run(["pkill", "-f", os.path.join(base, "fakebin")], capture_output=True)
        shutil.rmtree(base, ignore_errors=True)

    if failures:
        for f in failures:
            print("FAIL", f)
        print(f"FAIL {len(failures)}/{count}")
        sys.exit(1)
    print(f"OK {count}/{count}")


def sj_of(proj, sid8):
    with open(os.path.join(proj, "night", sid8, "state.json")) as f:
        return json.load(f)


def _alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _wait(pid, secs=3):
    end = time.time() + secs
    while time.time() < end:
        if not _alive(pid):
            return True
        time.sleep(0.05)
    return False


if __name__ == "__main__":
    main()
