#!/usr/bin/env python3
"""Tests for scripts/night-state.sh (night mode state, files, clean-up). Run: python3 tests/test_night_state.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, "scripts", "night-state.sh")
failures = []
count = 0
NOW = 1_800_000_000  # a fixed fake clock (CREW_CHIEF_NOW); TZ=UTC below, so 1_800_000_000 is 2027-01-15 08:00:00


def check(label, ok, detail=""):
    global count
    count += 1
    if not ok:
        failures.append(f"{label}: {detail}"[:600])


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


def fake_caffeinate(base):
    """A caffeinate that only sleeps (and dies on TERM), first on PATH, so the real one never starts."""
    d = os.path.join(base, "fakebin")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "caffeinate")
    with open(path, "w") as f:
        f.write("#!/bin/sh\ntrap 'kill $c 2>/dev/null; exit 0' TERM\nsleep 120 &\nc=$!\nwait\n")
    os.chmod(path, 0o755)
    return d


def run(args, cwd, data, fakebin, now=NOW, extra=None, path=None):
    env = dict(os.environ, CLAUDE_PLUGIN_DATA=data, TZ="UTC", PATH=path or (fakebin + os.pathsep + os.environ["PATH"]))
    env.pop("CLAUDE_SESSION_ID", None)
    if now is not None:
        env["CREW_CHIEF_NOW"] = str(now)
    env.update(extra or {})
    r = subprocess.run(["sh", STATE, *args], cwd=cwd, capture_output=True, text=True, env=env)
    return r.returncode, r.stdout, r.stderr


def state_of(proj, sid8):
    with open(os.path.join(proj, "night", sid8, "state.json")) as f:
        return json.load(f)


def alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    # a zombie child of ours would still answer; ours are grandchildren, reaped by init
    return True


def wait_dead(pid, secs=3):
    end = time.time() + secs
    while time.time() < end:
        if not alive(pid):
            return True
        time.sleep(0.05)
    return not alive(pid)


def main():
    base = os.path.realpath(tempfile.mkdtemp(prefix="crew-chief-night-"))
    spawned = []
    try:
        fb = fake_caffeinate(base)
        data = os.path.join(base, "data")
        proj = make_repo(base, "app")
        S1, S2 = "aaaaaaaa-1111-2222-3333-444444444444", "bbbbbbbb-1111-2222-3333-444444444444"

        # open: folder, pointer, minimal state, exclude line
        rc, out, err = run(["open", "--session", S1], proj, data, fb)
        st = state_of(proj, "aaaaaaaa") if rc == 0 else {}
        check("open succeeds", rc == 0, err)
        check("open: status opening, no deadline", st.get("status") == "opening" and st.get("deadline") == 0 and st.get("softWrap") == 0, st)
        check("open: started is the clock", st.get("started") == NOW, st)
        check("open: session, sid8, root, dir", st.get("session") == S1 and st.get("sid8") == "aaaaaaaa" and st.get("root") == proj and st.get("dir") == os.path.join(proj, "night", "aaaaaaaa"), st)
        check("open: all contract fields", all(k in st for k in ("status", "session", "sid8", "root", "dir", "started", "deadline", "softWrap", "git", "forbidden", "blocks", "noProgress", "lastSig", "current", "spawned", "reason", "caffeinatePid", "startSha", "reportDone", "dryRun")), sorted(st))
        ptr = os.path.join(data, "night", S1)
        check("open: pointer holds the folder", os.path.isfile(ptr) and open(ptr).read().strip() == os.path.join(proj, "night", "aaaaaaaa"))
        exclude = os.path.join(proj, ".git", "info", "exclude")
        check("open: exclude line written", "night/" in open(exclude).read().split("\n"))
        check("open: .gitignore untouched", not os.path.exists(os.path.join(proj, ".gitignore")))
        check("open: git status ignores night/", "night" not in subprocess.run(["git", "-C", proj, "status", "--porcelain"], capture_output=True, text=True).stdout)
        check("open twice is harmless", run(["open", "--session", S1], proj, data, fb)[0] == 0)

        # arm upgrades the opening state
        rc, out, err = run(["arm", "--session", S1, "--hours", "2", "--git", "none", "--forbid", "kubectl apply", "--forbid", "terraform destroy"], proj, data, fb)
        st = state_of(proj, "aaaaaaaa")
        check("arm after open succeeds", rc == 0, err)
        check("arm: armed with deadline now+2h", st["status"] == "armed" and st["deadline"] == NOW + 7200, st)
        check("arm: softWrap is deadline - wrapMin", st["softWrap"] == NOW + 7200 - 30 * 60, st)
        check("arm: git policy and forbidden list", st["git"] == "none" and st["forbidden"] == ["kubectl apply", "terraform destroy"], st)
        sha = subprocess.run(["git", "-C", proj, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        check("arm: startSha is HEAD", st["startSha"] == sha, st)
        check("arm: counters zero, not a dry run", st["blocks"] == 0 and st["spawned"] == 0 and st["dryRun"] is False and st["reportDone"] is False, st)
        check("arm: echoes the deadline with a zone and the epoch", "2027-01-15 10:00 UTC" in out and str(NOW + 7200) in out, out)
        pid = st["caffeinatePid"]
        check("arm: caffeinate pid saved and running", isinstance(pid, int) and pid > 0 and alive(pid), st)
        if pid:
            spawned.append(pid)
        check("exclude line is not duplicated by arm", open(exclude).read().split("\n").count("night/") == 1)
        check("arm on a running night is refused (deadline is never extended)", run(["arm", "--session", S1, "--hours", "5"], proj, data, fb)[0] != 0)
        check("the refused arm changed nothing", state_of(proj, "aaaaaaaa")["deadline"] == NOW + 7200)
        check("no temp files left behind", not [f for f in os.listdir(os.path.join(proj, "night", "aaaaaaaa")) if f.startswith("state.json.") or f == ".lock"], os.listdir(os.path.join(proj, "night", "aaaaaaaa")))

        # get / task / phase
        check("get prints one field", run(["get", "status", "--session", S1], proj, data, fb)[1].strip() == "armed")
        check("get prints nested and list fields", run(["get", "forbidden", "--session", S1], proj, data, fb)[1].strip() == '["kubectl apply","terraform destroy"]')
        check("get without a night is empty and exits 0", run(["get", "status", "--session", "zzzzzzzz-9"], proj, data, fb)[:2] == (0, ""))
        check("get whole state is json", json.loads(run(["get", "--session", S1], proj, data, fb)[1])["session"] == S1)
        run(["task", "NIGHT-1", "--session", S1], proj, data, fb, now=NOW + 60)
        cur = state_of(proj, "aaaaaaaa")["current"]
        check("task sets current {id, since}", cur == {"id": "NIGHT-1", "since": NOW + 60}, cur)
        run(["task", "NIGHT-1", "--session", S1], proj, data, fb, now=NOW + 120)
        check("the same task keeps its start time", state_of(proj, "aaaaaaaa")["current"]["since"] == NOW + 60)
        run(["task", "NIGHT-2", "--session", S1], proj, data, fb, now=NOW + 180)
        check("a new task restarts the clock", state_of(proj, "aaaaaaaa")["current"] == {"id": "NIGHT-2", "since": NOW + 180})
        check("phase wrapup with a reason", run(["phase", "wrapup", "--reason", "limit", "--session", S1], proj, data, fb)[0] == 0 and state_of(proj, "aaaaaaaa")["status"] == "wrapup" and state_of(proj, "aaaaaaaa")["reason"] == "limit")
        check("phase armed again", run(["phase", "armed", "--session", S1], proj, data, fb)[0] == 0 and state_of(proj, "aaaaaaaa")["status"] == "armed")
        check("phase opening after arming is refused", run(["phase", "opening", "--session", S1], proj, data, fb)[0] != 0)
        check("phase with nonsense is refused", run(["phase", "sleeping", "--session", S1], proj, data, fb)[0] != 0)

        # events
        run(["event", "guard", "git push denied", "--session", S1], proj, data, fb)
        log = open(os.path.join(proj, "night", "aaaaaaaa", "events.log")).read().splitlines()
        check("event appends '<ISO time> <source> <text>'", log[-1] == "2027-01-15T08:00:00Z guard git push denied", log[-1])
        rc, out, err = run(["event", "guard", "x", "--session", "ffffffff-0"], proj, data, fb)
        check("an event of a session without a night exits 0 and prints nothing", (rc, out, err) == (0, "", ""), (rc, out, err))

        # done: early finish, fallback report, summary, caffeinate killed
        report = os.path.join(proj, "night", "aaaaaaaa", "REPORT.md")
        with open(os.path.join(proj, "night", "aaaaaaaa", "QUESTIONS.md"), "w") as f:
            f.write("Q: which db?\n")
        rc, out, err = run(["done", "--session", S1], proj, data, fb, now=NOW + 600)
        st = state_of(proj, "aaaaaaaa")
        check("done before the deadline keeps the reason set by phase (limit)", rc == 0 and st["status"] == "done" and st["reason"] == "limit", (rc, st, err))
        check("done: reportDone, ended, caffeinate cleared", st["reportDone"] is True and st["ended"] == NOW + 600 and st["caffeinatePid"] == 0, st)
        body = open(report).read() if os.path.exists(report) else ""
        check("done without an agent report writes the fallback, first line says so", body.startswith("AUTO-GENERATED: the agent wrote no report\n"), body[:80])
        check("fallback has the report sections and the parked question", all(h in body for h in ("## NEEDS YOU", "## Done", "## Decided without asking", "## Not done and why", "## How to undo")) and "which db?" in body, body)
        check("done kills the caffeinate it started", pid and wait_dead(pid))
        summary = open(os.path.join(proj, "night", "SUMMARY.md")).read()
        check("SUMMARY.md lists the night", "aaaaaaaa" in summary and "done" in summary, summary)
        check("done twice is harmless", run(["done", "--session", S1], proj, data, fb)[0] == 0)

        # an agent-written REPORT.md is kept; a stale one is replaced
        rc, _, _ = run(["arm", "--session", S1, "--hours", "1"], proj, data, fb, now=NOW + 1000)
        check("a finished night can be armed again", rc == 0 and state_of(proj, "aaaaaaaa")["status"] == "armed")
        st = state_of(proj, "aaaaaaaa")
        if st["caffeinatePid"]:
            spawned.append(st["caffeinatePid"])
        with open(report, "w") as f:
            f.write("# my own report\n")
        os.utime(report, (NOW + 1500, NOW + 1500))
        run(["done", "--session", S1], proj, data, fb, now=NOW + 4700)
        check("an agent report newer than the start is kept", open(report).read() == "# my own report\n")
        check("done after the deadline: reason deadline", state_of(proj, "aaaaaaaa")["reason"] == "deadline", state_of(proj, "aaaaaaaa"))
        run(["arm", "--session", S1, "--hours", "1"], proj, data, fb, now=NOW + 5000)
        st = state_of(proj, "aaaaaaaa")
        if st["caffeinatePid"]:
            spawned.append(st["caffeinatePid"])
        run(["report-fallback", "--session", S1], proj, data, fb, now=NOW + 5100)
        check("a report older than the night start is replaced by the fallback", open(report).read().startswith("AUTO-GENERATED"))
        run(["stop", "--session", S1], proj, data, fb, now=NOW + 5200)

        # stop
        proj2 = make_repo(base, "app2")
        run(["arm", "--session", S2, "--hours", "1"], proj2, data, fb)
        st = state_of(proj2, "bbbbbbbb")
        if st["caffeinatePid"]:
            spawned.append(st["caffeinatePid"])
        rc, out, err = run(["stop", "--reason", "off", "--session", S2], proj2, data, fb, now=NOW + 100)
        st = state_of(proj2, "bbbbbbbb")
        check("stop: status stopped, reason off, report written", rc == 0 and st["status"] == "stopped" and st["reason"] == "off" and os.path.exists(os.path.join(proj2, "night", "bbbbbbbb", "REPORT.md")), (rc, st, err))
        check("stop: caffeinate gone", wait_dead(spawned[-1]) if spawned else True)

        # stop while opening (the user cancels the interview): works, no report
        S3 = "cccccccc-1"
        run(["open", "--session", S3], proj2, data, fb)
        rc, out, err = run(["stop", "--reason", "off", "--session", S3], proj2, data, fb)
        st = state_of(proj2, "cccccccc")
        check("stop from opening works", rc == 0 and st["status"] == "stopped" and st["reason"] == "off", (rc, st, err))
        check("stop from opening writes no report", not os.path.exists(os.path.join(proj2, "night", "cccccccc", "REPORT.md")))
        run(["open", "--session", "cccccccd-1"], proj2, data, fb)
        check("done from opening is refused", run(["done", "--session", "cccccccd-1"], proj2, data, fb)[0] != 0)

        # resume: ORIGINAL deadline, new session id, pointer moved
        proj3 = make_repo(base, "app3")
        OLD, NEW = "dddddddd-old", "eeeeeeee-new"
        run(["arm", "--session", OLD, "--hours", "4"], proj3, data, fb)
        st0 = state_of(proj3, "dddddddd")
        if st0["caffeinatePid"]:
            spawned.append(st0["caffeinatePid"])
        run(["stop", "--session", OLD], proj3, data, fb, now=NOW + 600)
        rc, out, err = run(["resume", "--session", NEW], proj3, data, fb, now=NOW + 3600)
        st = state_of(proj3, "dddddddd")
        check("resume rebinds without --from when one night is unfinished", rc == 0 and st["session"] == NEW and st["status"] == "armed", (rc, st, err))
        check("resume keeps the original deadline and softWrap", st["deadline"] == st0["deadline"] and st["softWrap"] == st0["softWrap"] == NOW + 4 * 3600 - 1800, st)
        check("resume keeps the folder name and sid8", st["sid8"] == "dddddddd" and st["dir"].endswith("night/dddddddd"), st)
        check("resume moves the pointer", os.path.isfile(os.path.join(data, "night", NEW)) and not os.path.exists(os.path.join(data, "night", OLD)))
        check("resume resets the counters", st["blocks"] == 0 and st["noProgress"] == 0 and st["ended"] == 0 and st["reason"] == "", st)
        if st["caffeinatePid"]:
            spawned.append(st["caffeinatePid"])
        run(["stop", "--session", NEW], proj3, data, fb, now=NOW + 3700)
        rc, out, err = run(["resume", "--session", NEW], proj3, data, fb, now=NOW + 4 * 3600 - 600)
        check("resume inside the soft wrap time goes to wrapup", rc == 0 and state_of(proj3, "dddddddd")["status"] == "wrapup", (rc, err))
        if state_of(proj3, "dddddddd")["caffeinatePid"]:
            spawned.append(state_of(proj3, "dddddddd")["caffeinatePid"])
        run(["stop", "--session", NEW], proj3, data, fb, now=NOW + 4 * 3600 - 500)
        rc, out, err = run(["resume", "--session", NEW], proj3, data, fb, now=NOW + 4 * 3600 + 5)
        check("resume after the deadline is refused", rc != 0 and "never extended" in err, (rc, err))

        # resume with two candidates needs --from
        proj4 = make_repo(base, "app4")
        for sid in ("gggggggg-1", "hhhhhhhh-1"):
            run(["arm", "--session", sid, "--hours", "4"], proj4, data, fb)
            s = state_of(proj4, sid[:8])
            if s["caffeinatePid"]:
                spawned.append(s["caffeinatePid"])
            run(["stop", "--session", sid], proj4, data, fb, now=NOW + 60)
        rc, out, err = run(["resume", "--session", "iiiiiiii-1"], proj4, data, fb, now=NOW + 120)
        check("two resumable nights: --from is required", rc != 0 and "--from" in err, (rc, err))
        rc, out, err = run(["resume", "--session", "iiiiiiii-1", "--from", "hhhhhhhh"], proj4, data, fb, now=NOW + 120)
        check("resume --from picks the night", rc == 0 and state_of(proj4, "hhhhhhhh")["session"] == "iiiiiiii-1", (rc, err))
        s = state_of(proj4, "hhhhhhhh")
        if s["caffeinatePid"]:
            spawned.append(s["caffeinatePid"])

        # --until with the fake clock (TZ=UTC): 2027-01-15 08:00:00
        proj5 = make_repo(base, "app5")
        rc, out, err = run(["arm", "--session", "jjjjjjjj-1", "--until", "09:30"], proj5, data, fb)
        st = state_of(proj5, "jjjjjjjj")
        check("--until later today", rc == 0 and st["deadline"] == NOW + 5400, (rc, st, err))
        run(["stop", "--session", "jjjjjjjj-1"], proj5, data, fb)
        run(["arm", "--session", "jjjjjjjj-1", "--until", "07:00"], proj5, data, fb)
        check("--until a time already past means tomorrow", state_of(proj5, "jjjjjjjj")["deadline"] == NOW + 23 * 3600, state_of(proj5, "jjjjjjjj"))
        run(["stop", "--session", "jjjjjjjj-1"], proj5, data, fb)
        run(["arm", "--session", "jjjjjjjj-1", "--hours", "1.5"], proj5, data, fb)
        check("--hours accepts a fraction", state_of(proj5, "jjjjjjjj")["deadline"] == NOW + 5400)
        run(["stop", "--session", "jjjjjjjj-1"], proj5, data, fb)
        run(["arm", "--session", "jjjjjjjj-1", "--dry-run"], proj5, data, fb)
        st = state_of(proj5, "jjjjjjjj")
        check("--dry-run: 20 minutes, soft wrap at 15", st["dryRun"] is True and st["deadline"] == NOW + 1200 and st["softWrap"] == NOW + 900, st)
        for pid_ in [st["caffeinatePid"]]:
            if pid_:
                spawned.append(pid_)
        run(["stop", "--session", "jjjjjjjj-1"], proj5, data, fb)
        for bad in (["--until", "25:00"], ["--until", "7pm"], ["--hours", "0"], ["--hours", "30"], ["--hours", "x"], [], ["--until", "09:00", "--hours", "1"], ["--hours", "1", "--git", "push"], ["--hours", "1", "--git", "branch:"]):
            rc, out, err = run(["arm", "--session", "kkkkkkkk-1", *bad], proj5, data, fb)
            check(f"arm {' '.join(bad) or '(nothing)'} is refused", rc != 0 and not os.path.exists(os.path.join(proj5, "night", "kkkkkkkk")), (rc, err))
        rc, out, err = run(["arm", "--session", "kkkkkkkk-1", "--hours", "1", "--git", "branch:night-work"], proj5, data, fb)
        check("--git branch:<name> is kept", rc == 0 and state_of(proj5, "kkkkkkkk")["git"] == "branch:night-work", err)
        s = state_of(proj5, "kkkkkkkk")
        if s["caffeinatePid"]:
            spawned.append(s["caffeinatePid"])
        check("arm needs a session id", run(["arm", "--hours", "1"], proj5, data, fb)[0] != 0)
        check("a bad session id is refused", run(["open", "--session", "../x"], proj5, data, fb)[0] != 0)

        # exclude: existing file without a trailing newline keeps its content; present line is not repeated
        proj6 = make_repo(base, "app6")
        ex = os.path.join(proj6, ".git", "info", "exclude")
        with open(ex, "w") as f:
            f.write("*.log")
        run(["open", "--session", "llllllll-1"], proj6, data, fb)
        run(["open", "--session", "mmmmmmmm-1"], proj6, data, fb)
        lines = open(ex).read().split("\n")
        check("exclude keeps old lines, adds night/ once", lines[0] == "*.log" and lines.count("night/") == 1, lines)
        # a worktree-style root: outside git, cwd is the root and nothing is excluded
        plain = os.path.join(base, "plain")
        os.makedirs(plain)
        rc, out, err = run(["open", "--session", "nnnnnnnn-1"], plain, data, fb)
        check("outside git: cwd is the root", rc == 0 and os.path.isfile(os.path.join(plain, "night", "nnnnnnnn", "state.json")), (rc, err))

        # a session id from the environment, and the single running night without any id
        proj7 = make_repo(base, "app7")
        run(["open", "--session", "oooooooo-1"], proj7, data, fb)
        check("no --session: the one running night in this repo", run(["get", "status"], proj7, data, fb)[1].strip() == "opening")
        check("no --session: CLAUDE_SESSION_ID is used", run(["get", "status"], proj7, data, fb, extra={"CLAUDE_SESSION_ID": "oooooooo-1"})[1].strip() == "opening")
        run(["open", "--session", "pppppppp-1"], proj7, data, fb)
        check("no --session with two running nights: refused for a change", run(["task", "X"], proj7, data, fb)[0] != 0)

        # cleanup: 7 days for the working files, 30 days for REPORT.md and DECISIONS.md, never a running night
        proj8 = make_repo(base, "app8")
        nd = os.path.join(proj8, "night")

        def make_night(sid8, status, age_days, report_age=None):
            d = os.path.join(nd, sid8)
            os.makedirs(d)
            with open(os.path.join(d, "state.json"), "w") as f:
                json.dump({"status": status, "sid8": sid8, "session": sid8, "deadline": 0}, f)
            for name in ("NIGHT.md", "QUESTIONS.md", "events.log", "hold", "REPORT.md", "DECISIONS.md"):
                with open(os.path.join(d, name), "w") as f:
                    f.write("x\n")
            t = time.time() - age_days * 86400
            for name in os.listdir(d):
                os.utime(os.path.join(d, name), (t, t))
            if report_age is not None:
                t = time.time() - report_age * 86400
                for name in ("REPORT.md", "DECISIONS.md"):
                    os.utime(os.path.join(d, name), (t, t))
            return d

        os.makedirs(nd)
        young = make_night("young0001", "done", 3)
        mid = make_night("mid00001", "done", 10)
        old = make_night("old00001", "stalled", 40)
        stopped = make_night("stop0001", "stopped", 8)
        running = make_night("run00001", "armed", 60)
        wrapping = make_night("wrap0001", "wrapup", 60)
        opening = make_night("open0001", "opening", 60)
        outside = os.path.join(base, "outside.txt")
        open(outside, "w").write("keep\n")
        rc, out, err = run(["cleanup"], proj8, data, fb, now=None)
        files = lambda d: sorted(os.listdir(d)) if os.path.isdir(d) else None
        check("cleanup: a 3 day old night is untouched", len(files(young)) == 7, files(young))
        check("cleanup: after 7 days the working files go", files(mid) == ["DECISIONS.md", "REPORT.md"], files(mid))
        check("cleanup: a stopped night is cleaned like a done one", files(stopped) == ["DECISIONS.md", "REPORT.md"], files(stopped))
        check("cleanup: after 30 days report, decisions and the folder go", files(old) is None, files(old))
        check("cleanup: an armed, wrapup or opening night is never touched", len(files(running)) == 7 and len(files(wrapping)) == 7 and len(files(opening)) == 7)
        check("cleanup: nothing outside night/ is touched", open(outside).read() == "keep\n" and os.path.exists(os.path.join(proj8, "README.md")))
        rc, out, err = run(["cleanup"], proj8, data, fb, now=None)
        check("cleanup twice changes nothing more", files(mid) == ["DECISIONS.md", "REPORT.md"] and rc == 0)
        # reports are kept 30 days from their own date even when the working files went at 7 days
        t = time.time() - 31 * 86400
        for name in ("REPORT.md", "DECISIONS.md"):
            os.utime(os.path.join(mid, name), (t, t))
        run(["cleanup"], proj8, data, fb, now=None)
        check("cleanup: a report older than 30 days goes on a later run", files(mid) is None, files(mid))
        check("cleanup rewrites SUMMARY.md", os.path.exists(os.path.join(nd, "SUMMARY.md")) and "mid00001" not in open(os.path.join(nd, "SUMMARY.md")).read())
        # arm runs the cleanup too
        old2 = make_night("old00002", "done", 45)
        run(["arm", "--session", "qqqqqqqq-1", "--hours", "1"], proj8, data, fb, now=None)
        check("arm cleans old nights", files(old2) is None)
        s = state_of(proj8, "qqqqqqqq")
        if s["caffeinatePid"]:
            spawned.append(s["caffeinatePid"])

        # caffeinate is only killed while the pid is still a caffeinate process
        proj9 = make_repo(base, "app9")
        run(["arm", "--session", "rrrrrrrr-1", "--hours", "1"], proj9, data, fb)
        other = subprocess.Popen(["sleep", "60"])
        spawned.append(other.pid)
        real = state_of(proj9, "rrrrrrrr")["caffeinatePid"]
        if real:
            spawned.append(real)
        sp = os.path.join(proj9, "night", "rrrrrrrr", "state.json")
        s = json.load(open(sp))
        s["caffeinatePid"] = other.pid
        json.dump(s, open(sp, "w"))
        run(["done", "--session", "rrrrrrrr-1"], proj9, data, fb)
        time.sleep(0.2)
        check("a pid that is not a caffeinate process is never killed", other.poll() is None)
        other.kill()
        other.wait()
        check("done leaves caffeinatePid 0", state_of(proj9, "rrrrrrrr")["caffeinatePid"] == 0)
        check("done before the deadline with no other reason: early", state_of(proj9, "rrrrrrrr")["reason"] == "early", state_of(proj9, "rrrrrrrr"))

        # no caffeinate on this machine: arm still works
        tools = {}
        bindir = os.path.join(base, "tools")
        os.makedirs(bindir)
        for tool in ("sh", "jq", "git", "date", "awk", "grep", "sed", "cut", "tr", "head", "tail", "wc", "cat", "mkdir", "rm", "rmdir", "mv", "find", "stat", "ps", "kill", "sleep", "cksum", "dirname", "pwd"):
            p = shutil.which(tool)
            if p:
                os.symlink(p, os.path.join(bindir, tool))
        proj10 = make_repo(base, "app10")
        rc, out, err = run(["arm", "--session", "ssssssss-1", "--hours", "1"], proj10, data, fb, path=bindir)
        check("without caffeinate arm works and records pid 0", rc == 0 and state_of(proj10, "ssssssss")["caffeinatePid"] == 0, (rc, err))

        # no jq: the CLI says so and exits 1
        nojq = os.path.join(base, "nojq")
        os.makedirs(nojq)
        for tool in ("sh", "cat", "dirname", "git"):
            p = shutil.which(tool)
            if p:
                os.symlink(p, os.path.join(nojq, tool))
        rc, out, err = run(["arm", "--session", "tttttttt-1", "--hours", "1"], proj10, data, fb, path=nojq)
        check("no jq: a clear error, nothing written", rc == 1 and "jq" in err and not os.path.exists(os.path.join(proj10, "night", "tttttttt")), (rc, err))
    finally:
        for p in spawned:
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


if __name__ == "__main__":
    main()
