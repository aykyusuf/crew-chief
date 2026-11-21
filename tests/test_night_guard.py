#!/usr/bin/env python3
"""Tests for scripts/night-guard.sh (night mode PreToolUse and PermissionRequest guard). Run: python3 tests/test_night_guard.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
STATE = os.path.join(SCRIPTS, "night-state.sh")
GUARD = os.path.join(SCRIPTS, "night-guard.sh")
failures = []
count = 0
NOW = 1_800_000_000
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


def env_for(data, fb, path=None):
    env = dict(os.environ, CLAUDE_PLUGIN_DATA=data, TZ="UTC", CREW_CHIEF_NOW=str(NOW), PATH=path or (fb + os.pathsep + os.environ["PATH"]))
    env.pop("CLAUDE_SESSION_ID", None)
    return env


def cli(args, proj, data, fb):
    return subprocess.run(["sh", STATE, *args], cwd=proj, capture_output=True, text=True, env=env_for(data, fb))


def guard(data, fb, payload=None, raw=None, path=None):
    if raw is None:
        raw = json.dumps(payload)
    r = subprocess.run(["sh", GUARD], input=raw, capture_output=True, text=True, env=env_for(data, fb, path))
    return r.returncode, r.stdout, r.stderr


def pre(tool, tool_input, sid=SID, **extra):
    return dict({"session_id": sid, "hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": tool_input}, **extra)


def bash(cmd, sid=SID):
    return pre("Bash", {"command": cmd}, sid)


def state(proj, sid8=SID8):
    with open(os.path.join(proj, "night", sid8, "state.json")) as f:
        return json.load(f)


def events(proj, sid8=SID8):
    p = os.path.join(proj, "night", sid8, "events.log")
    return open(p).read() if os.path.exists(p) else ""


def main():
    base = os.path.realpath(tempfile.mkdtemp(prefix="crew-chief-nguard-"))
    pids = []
    try:
        fb = os.path.join(base, "fakebin")
        os.makedirs(fb)
        with open(os.path.join(fb, "caffeinate"), "w") as f:
            f.write("#!/bin/sh\ntrap 'kill $c 2>/dev/null; exit 0' TERM\nsleep 120 &\nc=$!\nwait\n")
        os.chmod(os.path.join(fb, "caffeinate"), 0o755)
        data = os.path.join(base, "data")
        proj = make_repo(base, "app")

        # no night at all: everything passes silently
        for label, p in (("git push", bash("git push origin main")), ("AskUserQuestion", pre("AskUserQuestion", {"questions": []})),
                         ("permission request", dict(pre("Bash", {"command": "ls"}), hook_event_name="PermissionRequest"))):
            check(f"no night: {label} passes silently", guard(data, fb, p) == (0, "", ""))

        # opening: the interview blocks, so AskUserQuestion passes; nothing else is held back yet
        cli(["open", "--session", SID], proj, data, fb)
        check("opening: AskUserQuestion passes", guard(data, fb, pre("AskUserQuestion", {"questions": []})) == (0, "", ""))
        check("opening: git push passes (the night is not running yet)", guard(data, fb, bash("git push")) == (0, "", ""))
        check("opening: a permission request is not touched", guard(data, fb, dict(bash("ls"), hook_event_name="PermissionRequest")) == (0, "", ""))
        check("opening: an Agent call is not counted", guard(data, fb, pre("Agent", {"model": "opus", "prompt": "x"}))[0] == 0 and state(proj)["spawned"] == 0)

        r = cli(["arm", "--session", SID, "--hours", "3", "--forbid", "kubectl apply", "--forbid", "terraform destroy"], proj, data, fb)
        assert r.returncode == 0, r.stderr
        if state(proj)["caffeinatePid"]:
            pids.append(state(proj)["caffeinatePid"])

        # git push in any form is denied
        pushes = ["git push", "git push origin main", "git push --force-with-lease", "git  push", "git -C /tmp/x push", 'git -C "/tmp/a b" push origin',
                  "git -c user.name=x push", "git --no-pager push", "git --git-dir=/x/.git push", "git --git-dir /x/.git push", "/usr/bin/git push",
                  "cd app && git push", "ls; git push;", "echo hi | git push", "sh -c 'git push'", "FOO=1 git push", "git commit -m x && git push -u origin HEAD"]
        for c in pushes:
            rc, out, err = guard(data, fb, bash(c))
            check(f"armed: denied: {c}", rc == 2 and "git push" in err and not out, (rc, err))
        allowed = ["git status", "git pull", 'git commit -m "update the push button"', "git stash push -m x", "echo pushing", "git log --oneline", "ls", "npm test",
                   "git remote -v", "git fetch origin", "kubectl get pods", "terraform plan"]
        for c in allowed:
            check(f"armed: allowed: {c}", guard(data, fb, bash(c)) == (0, "", ""), guard(data, fb, bash(c)))
        # built-in outward commands (bypass mode: the hook is the only gate)
        outward = ["gh pr merge 12 --squash", "gh pr create --fill", "gh release create v1", "gh repo delete x/y --yes", "gh workflow run deploy.yml",
                   "gh api -X DELETE repos/x/y", "vercel --prod", "vercel deploy", "netlify deploy --prod", "fly deploy", "firebase deploy",
                   "kubectl apply -f k.yaml", "helm upgrade app ./chart", "terraform apply -auto-approve", "npm publish", "pnpm publish", "docker push img:1",
                   "wrangler deploy", "supabase db push", "aws s3 rm s3://b --recursive", "gcloud run deploy", "ssh prod 'systemctl restart app'",
                   "scp a.sql user@db:/tmp/", "rsync -av dist/ user@host:/var/www/", "cd x && eas submit -p ios", "sudo ssh root@h", "FOO=1 vercel --prod"]
        for c in outward:
            rc, out, err = guard(data, fb, bash(c))
            check(f"armed: outward denied: {c}", rc == 2 and ("outside this machine" in err or "the user forbade" in err), (rc, err))
        quiet_ok = ["gh pr view 12", "gh pr list", "gh api repos/x/y", "gh run list", "kubectl get pods", "terraform plan", "helm template ./chart",
                    "npm run build", "docker build -t x .", "rsync -av src/ dist/", "echo ssh is a word", "vercel dev", "git commit -m 'deploy note'"]
        for c in quiet_ok:
            check(f"armed: still allowed: {c}", guard(data, fb, bash(c))[0] == 0, guard(data, fb, bash(c)))
        root = state(proj)["root"]
        for c in ["rm -rf /tmp/x", "rm -rf ~/Documents", "rm -r ../other", "cd a && rm -fr /etc/x", "rm -Rf '/Users/x/y'"]:
            rc, out, err = guard(data, fb, bash(c))
            check(f"armed: rm -r outside the repo denied: {c}", rc == 2 and "recursive deletes" in err, (rc, err))
        for c in [f"rm -rf {root}/build", "rm -rf build dist", "rm -f /tmp/one-file", "rm -rf node_modules"]:
            check(f"armed: rm allowed: {c}", guard(data, fb, bash(c))[0] == 0, guard(data, fb, bash(c)))
        ev = events(proj)
        check("a denied push is logged in events.log", " guard git push denied: git push" in ev, ev)
        check("events.log lines are '<ISO time> <source> <text>'", all(len(l.split(" ", 2)) == 3 and l.startswith("2027-01-15T08:00:00Z ") for l in ev.splitlines()), ev[:200])

        # forbidden list
        rc, out, err = guard(data, fb, bash("kubectl apply -f deploy.yaml"))
        check("forbidden list entry denied", rc == 2 and "kubectl apply" in err, (rc, err))
        check("forbidden list: second entry denied", guard(data, fb, bash("cd x && terraform destroy -auto-approve"))[0] == 2)
        check("forbidden denial logged", "forbidden command denied (kubectl apply)" in events(proj))
        sp = os.path.join(proj, "night", SID8, "state.json")
        s = json.load(open(sp))
        s["forbidden"] = ["", "rm -rf /data"]
        json.dump(s, open(sp, "w"))
        check("an empty forbidden entry does not deny everything", guard(data, fb, bash("ls")) == (0, "", ""))
        check("the other entry still works", guard(data, fb, bash("rm -rf /data/x"))[0] == 2)
        s["forbidden"] = ["a|b", "$HOME", "*"]
        json.dump(s, open(sp, "w"))
        check("forbidden entries are plain substrings, not patterns", guard(data, fb, bash("echo hello")) == (0, "", "") and guard(data, fb, bash("echo $HOME"))[0] == 2 and guard(data, fb, bash("a|b"))[0] == 2)
        s["forbidden"] = []
        json.dump(s, open(sp, "w"))

        # AskUserQuestion
        rc, out, err = guard(data, fb, pre("AskUserQuestion", {"questions": [{"question": "which?"}]}))
        check("armed: AskUserQuestion denied with the exact reason", rc == 2 and f"night mode: write this question to night/{SID8}/QUESTIONS.md with your default, then continue" in err, (rc, err))
        check("AskUserQuestion denial logged", "AskUserQuestion denied" in events(proj))

        # Agent: Fable and the budget
        for m in ("fable", "claude-FABLE-1", "Fable-5"):
            rc, out, err = guard(data, fb, pre("Agent", {"model": m, "prompt": "x"}))
            check(f"Agent on {m} denied", rc == 2 and "Fable" in err, (rc, err))
        check("a denied Fable call is not counted", state(proj)["spawned"] == 0)
        for m in ("opus", "sonnet", "haiku", None):
            ti = {"prompt": "x"}
            if m:
                ti["model"] = m
            check(f"Agent on {m} allowed", guard(data, fb, pre("Agent", ti)) == (0, "", ""))
        check("allowed Agent calls are counted", state(proj)["spawned"] == 4, state(proj))
        s = json.load(open(sp))
        s["spawned"] = 19
        json.dump(s, open(sp, "w"))
        check("the 20th Agent call is allowed", guard(data, fb, pre("Agent", {"model": "opus"}))[0] == 0 and state(proj)["spawned"] == 20)
        rc, out, err = guard(data, fb, pre("Agent", {"model": "opus"}))
        check("the 21st Agent call is denied", rc == 2 and "20" in err and "budget" in err, (rc, err))
        check("a denied Agent call is not counted", state(proj)["spawned"] == 20)
        check("budget denial logged", "subagent budget of 20 used" in events(proj))

        # parallel Agent calls count exactly
        proj2 = make_repo(base, "par")
        S2 = "pa000002-aaaa"
        cli(["arm", "--session", S2, "--hours", "3"], proj2, data, fb)
        if state(proj2, "pa000002")["caffeinatePid"]:
            pids.append(state(proj2, "pa000002")["caffeinatePid"])
        procs = [subprocess.Popen(["sh", GUARD], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env_for(data, fb)) for _ in range(26)]
        payload = json.dumps(pre("Agent", {"model": "opus"}, S2))
        for p in procs:
            p.stdin.write(payload)
            p.stdin.close()
        codes = [p.wait() for p in procs]
        for p in procs:
            p.stdout.close()
            p.stderr.close()
        check("26 parallel Agent calls: exactly 20 pass, 6 are denied", codes.count(0) == 20 and codes.count(2) == 6, codes)
        check("the parallel count in state is exactly 20", state(proj2, "pa000002")["spawned"] == 20, state(proj2, "pa000002"))

        # other tools and wrapup
        check("other tools pass", guard(data, fb, pre("Read", {"file_path": "/etc/hosts"})) == (0, "", ""))
        check("Write passes", guard(data, fb, pre("Write", {"file_path": "x", "content": "y"})) == (0, "", ""))
        cli(["phase", "wrapup", "--session", SID], proj, data, fb)
        check("wrapup: push still denied", guard(data, fb, bash("git push"))[0] == 2)
        check("wrapup: AskUserQuestion still denied", guard(data, fb, pre("AskUserQuestion", {}))[0] == 2)

        # PermissionRequest
        pr = dict(bash("rm -rf build"), hook_event_name="PermissionRequest")
        rc, out, err = guard(data, fb, pr)
        j = json.loads(out) if out else {}
        d = j.get("hookSpecificOutput", {})
        check("PermissionRequest at night: deny decision on stdout, exit 0", rc == 0 and d.get("hookEventName") == "PermissionRequest" and d.get("decision", {}).get("behavior") == "deny" and "night mode" in d["decision"].get("message", ""), (rc, out, err))
        check("PermissionRequest denial logged", "permission request denied: Bash rm -rf build" in events(proj))
        check("PermissionRequest for another tool also denied", json.loads(guard(data, fb, dict(pre("Write", {"file_path": "x"}), hook_event_name="PermissionRequest"))[1])["hookSpecificOutput"]["decision"]["behavior"] == "deny")
        ns = os.path.join(SCRIPTS, "night-state.sh")
        for c in (f'sh {ns} done --session {SID}', f'"{ns}" task X-1', f'sh "{ns}" phase wrapup --reason limit', f"{ns} get status"):
            rc, out, err = guard(data, fb, dict(bash(c), hook_event_name="PermissionRequest"))
            check(f"PermissionRequest: the night's own state script is allowed: {c[:40]}", rc == 0 and json.loads(out)["hookSpecificOutput"]["decision"]["behavior"] == "allow", (rc, out))
        for c in (f"{ns} done; rm -rf x", f"{ns} done && curl x", f"{ns} done $(id)", f"{ns} done > /etc/x", "sh /tmp/other.sh", f"echo {ns}"):
            rc, out, err = guard(data, fb, dict(bash(c), hook_event_name="PermissionRequest"))
            check(f"PermissionRequest: not allowed by the state-script exception: {c[:40]}", rc == 0 and json.loads(out)["hookSpecificOutput"]["decision"]["behavior"] == "deny", (rc, out))

        # other sessions, broken input, no jq
        check("another session: everything passes", guard(data, fb, bash("git push", sid="zzzzzzzz-other")) == (0, "", ""))
        check("another session's AskUserQuestion passes", guard(data, fb, pre("AskUserQuestion", {}, sid="zzzzzzzz-other")) == (0, "", ""))
        check("a second session id hidden inside the command is not mistaken", guard(data, fb, raw=json.dumps({"session_id": "zzzzzzzz-other", "tool_name": "Bash", "tool_input": {"command": f'echo "session_id":"{SID}" git push'}})) == (0, "", ""))
        check("garbage input: exit 0", guard(data, fb, raw="{{ nope")[:2] == (0, ""))
        check("empty input: exit 0", guard(data, fb, raw="")[:2] == (0, ""))
        check("input without a session id: exit 0", guard(data, fb, raw=json.dumps({"tool_name": "Bash", "tool_input": {"command": "git push"}}))[:2] == (0, ""))
        open(sp, "w").write("{{{ garbage")
        check("garbage state.json: exit 0 (fail open)", guard(data, fb, bash("git push"))[:2] == (0, ""))
        s["spawned"] = 0
        s["status"] = "armed"
        json.dump(s, open(sp, "w"))
        check("state restored: denies again", guard(data, fb, bash("git push"))[0] == 2)
        nojq = os.path.join(base, "nojq")
        os.makedirs(nojq)
        for tool in ("sh", "cat", "grep", "head", "sed", "dirname", "tr", "cut"):
            p = shutil.which(tool)
            if p:
                os.symlink(p, os.path.join(nojq, tool))
        check("no jq: exit 0, silent", guard(data, fb, bash("git push"), path=nojq) == (0, "", ""))
        check("no CLAUDE_PLUGIN_DATA: exit 0", subprocess.run(["sh", GUARD], input=json.dumps(bash("git push")), capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k != "CLAUDE_PLUGIN_DATA"}).returncode == 0)

        # after the night: allowed again
        cli(["done", "--session", SID], proj, data, fb)
        check("done: git push no longer held by the night guard", guard(data, fb, bash("git push")) == (0, "", ""))
        check("done: AskUserQuestion passes again", guard(data, fb, pre("AskUserQuestion", {})) == (0, "", ""))
        check("done: permission requests pass again", guard(data, fb, dict(bash("ls"), hook_event_name="PermissionRequest")) == (0, "", ""))
        check("no stray lock or temp files", not [f for f in os.listdir(os.path.join(proj, "night", SID8)) if f == ".lock" or f.startswith("state.json.")])
        check("the guard never writes outside night/<sid8>/", sorted(os.listdir(proj)) == [".git", "README.md", "night"], os.listdir(proj))
    finally:
        for p in pids:
            try:
                os.kill(p, 15)
            except OSError:
                pass
        shutil.rmtree(base, ignore_errors=True)

    if failures:
        for f in failures:
            print("FAIL", f)
        print(f"FAIL {len(failures)}/{count}")
        sys.exit(1)
    print(f"OK {count}/{count}")


if __name__ == "__main__":
    main()
