"""Tests for scripts/session-policy.sh (routing policy + handoff offer). Run: python3 tests/test_session_policy.py

Scratch repositories go under .test-tmp/ in this checkout (git-ignored): the hook deliberately
stays quiet in /tmp and other temporary directories, so tempfile's default location would not do.
"""
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "scripts", "session-policy.sh")
SCRATCH = os.path.join(ROOT, ".test-tmp", "session-policy")
OFFER = "<crew-chief-handoff-offer>"
CHECK = "<crew-chief-handoff-check>"
failures = []
SHELL = "sh"


def run(cwd, source="startup", data=None, env_extra=None, raw=None):
    env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/")}
    if data is not None:
        env["CLAUDE_PLUGIN_DATA"] = data
    env.update(env_extra or {})
    payload = raw if raw is not None else json.dumps({"cwd": cwd, "source": source, "hook_event_name": "SessionStart"})
    r = subprocess.run([SHELL, HOOK], input=payload, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        check(f"exit 0 ({SHELL})", False, f"rc={r.returncode} {r.stderr.strip()}")
    return r.stdout


def repo(name, files=()):
    path = os.path.join(SCRATCH, name)
    os.makedirs(path)
    subprocess.run(["git", "init", "-q", path], check=True)
    for rel, text in files:
        full = os.path.join(path, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(text)
    return path


def check(name, ok, detail=""):
    label = f"[{SHELL}] {name}"
    print(("PASS " if ok else "FAIL ") + label + ("" if ok else ": " + detail))
    if not ok:
        failures.append(label)


def main():
    global SHELL
    for SHELL in ["sh"] + (["dash"] if shutil.which("dash") else []):
        suite()
    if failures:
        sys.exit(f"{len(failures)} failed")
    print("all session-policy checks passed")


def suite():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    os.makedirs(SCRATCH)
    data = os.path.join(SCRATCH, "data")
    try:
        # An old crew-chief routine in CLAUDE.md (no repeated-mistake step) is named in the weekly check, a current one is not.
        old_routine = "<!-- crew-chief:handoff:start -->\n## Session end\n1. x\n<!-- crew-chief:handoff:end -->\n"
        ro = repo("routine-old", [("CLAUDE.md", old_routine), ("STATUS.md", "# s\n")])
        out = run(ro, data=os.path.join(SCRATCH, "rdata1"))
        check("weekly check: an old routine is named with the missing step", "older than the plugin's template" in out and "edit only after a yes" in out, out)
        rn = repo("routine-new", [("CLAUDE.md", old_routine.replace("1. x", "1. x\n4. Repeated mistake: ...")), ("STATUS.md", "# s\n")])
        check("weekly check: a current routine is not named", "older than the plugin's template" not in run(rn, data=os.path.join(SCRATCH, "rdata2")))
        # Night mode: a finished night's report is shown once, at the next startup only.
        nr = repo("night-report", [("night/abcd1234/state.json", json.dumps({"status": "done"})), ("night/abcd1234/REPORT.md", "# r\n"), ("night/live0000/state.json", json.dumps({"status": "armed"})), ("night/live0000/REPORT.md", "# x\n")])
        ndata = os.path.join(SCRATCH, "ndata")
        os.makedirs(ndata)
        out = run(nr, data=ndata)
        check("night: a finished night's report is announced at startup", "<crew-chief-night-report>" in out and "abcd1234/REPORT.md" in out, out)
        check("night: a running night's report is not announced", "live0000" not in out, out)
        check("night: the same report is not announced twice", "<crew-chief-night-report>" not in run(nr, data=ndata))
        check("night: not on resume", "<crew-chief-night-report>" not in run(nr, source="resume", data=os.path.join(SCRATCH, "data-other")))
        bare = repo("bare")
        out = run(bare, data=data)
        check("policy printed", "<crew-chief-policy>" in out, out[:200])
        check("offer on a fresh repo without handoff files", OFFER in out)
        check("tier list names ui-implementer (sonnet/medium, UI code goes there, not to implementer)",
              "crew-chief:ui-implementer (sonnet/medium)" in out and "not to implementer" in out and ".crew-chief/ui-profile.json" in out, out[:300])
        check("tier list names ui-designer (opus/high, read-only, design spec in .crew-chief/design, no code) and the per-call model rule",
              "crew-chief:ui-designer (opus/high): read-only design spec" in out and ".crew-chief/design/<slug>.md" in out and "Pass model and effort on every UI call" in out, out[:300])
        check("tier list names ui-scout (sonnet/medium, refs folder, not with ui-tester on one browser)",
              "crew-chief:ui-scout (sonnet/medium): design reference scout" in out and ".crew-chief/refs/" in out and "Never run it and ui-tester on the same browser at the same time" in out, out[:300])
        check("policy says no Fable subagent unless the user asked", "Never start a subagent on a Fable model unless the user asked for Fable" in out, out[:300])
        check("offer names what changes and cites the source",
              "STATUS.md" in out and "tasks.json" in out and "PROGRESS.md" in out and "Nothing is committed" in out
              and "anthropic.com/engineering/effective-harnesses-for-long-running-agents" in out)
        check("offer writes nothing itself", not os.path.exists(data) and sorted(os.listdir(bare)) == [".git"])
        # The offer must never hold up the user's work: no question before the work, no dialog, one line at the end.
        check("offer does not ask first or open a dialog",
              "Ask the user ONCE" not in out and "at the start of your first reply" not in out
              and "AskUserQuestion if available" not in out and "never use AskUserQuestion or any other dialog" in out
              and "Do the user's first request first" in out and "Do NOT ask about this before starting" in out)
        check("offer is one short line at the end of the final answer",
              "exactly ONE short line" in out and "very end of your final answer" in out
              and "Say yes to set them up." in out and "in the user's language" in out)
        check("offer skips long autonomous or non-interactive runs",
              "long autonomous or unattended job" in out and "overnight" in out and "every N minutes" in out
              and "I am leaving" in out and "non-interactive" in out)
        check("offer records later right away, then installed or never on the answer",
              "record it as offered with Bash" in out and f"printf '%s\\tlater\\t%s\\n' '{bare}'" in out
              and "handoff-offers.tsv" in out and "crew-chief:crew-handoff" in out
              and f"printf '%s\\tnever\\n' '{bare}'" in out)

        for source in ("resume", "clear", "compact"):
            check(f"no offer on {source}", OFFER not in run(bare, source=source, data=data))
        check("no offer without CLAUDE_PLUGIN_DATA (answer could not be remembered)", OFFER not in run(bare, data=None))
        check("no offer when switched off", OFFER not in run(bare, data=data, env_extra={"CREW_CHIEF_HANDOFF_OFFER": "off"}))
        check("no offer with empty hook input", OFFER not in run(bare, data=data, raw=""))

        plain = os.path.join(SCRATCH, "not-a-repo")
        os.makedirs(plain)
        # .test-tmp sits inside this checkout's own repository; stop git from finding it.
        check("no offer outside a git repository",
              OFFER not in run(plain, data=data, env_extra={"GIT_CEILING_DIRECTORIES": SCRATCH}))
        check("no offer in /tmp", OFFER not in run("/tmp", data=data))
        home_repo = repo("home")
        check("no offer in the home directory, even when it is a git repo",
              OFFER not in run(home_repo, data=data, env_extra={"HOME": home_repo}))

        for name, rel in [("tasks", "tasks.json"), ("status", "STATUS.md"), ("tr", "durum.md"),
                          ("nested", "app/tasks.json"), ("progress", "claude-progress.txt")]:
            path = repo("has-" + name, [(rel, "x")])
            check(f"quiet when {rel} exists", OFFER not in run(path, data=data))
        marked = repo("marked", [("CLAUDE.md", "# x\n<!-- crew-chief:handoff:start -->\n<!-- crew-chief:handoff:end -->\n")])
        check("quiet when CLAUDE.md has the handoff block", OFFER not in run(marked, data=data))

        sub = os.path.join(bare, "src", "deep")
        os.makedirs(sub)
        out = run(sub, data=data)
        check("offer keyed by repository root from a subdirectory", OFFER in out and f"({bare})" in out)

        policy_repo = repo("policy-in-claude-md", [("CLAUDE.md", "<!-- crew-chief:start -->\n")])
        out = run(policy_repo, data=data)
        check("project-policy branch still offers", "routing policy is in this project's CLAUDE.md" in out and OFFER in out)

        os.makedirs(data, exist_ok=True)
        state = os.path.join(data, "handoff-offers.tsv")
        with open(state, "a") as f:
            f.write(f"{bare}\tnever\n")
        check("never is remembered", OFFER not in run(bare, data=data))
        with open(state, "a") as f:
            f.write(f"{policy_repo}\tlater\t{int(time.time())}\n")
        check("later snoozes", OFFER not in run(policy_repo, data=data))
        with open(state, "a") as f:
            f.write(f"{policy_repo}\tlater\t{int(time.time()) - 8 * 86400}\n")
        check("later expires after 7 days (last line wins)", OFFER in run(policy_repo, data=data))
        with open(state, "a") as f:
            f.write(f"{policy_repo}\tinstalled\t{int(time.time())}\n")
        check("installed is remembered", OFFER not in run(policy_repo, data=data))
        other = repo("other")
        check("another project is still offered", OFFER in run(other, data=data))

        quoted = repo("it's-quoted")
        check("no offer when the path contains a quote", OFFER not in run(quoted, data=data))
        check("no offer when the data path contains a quote", OFFER not in run(other, data=os.path.join(SCRATCH, "o'neil")))

        # A malformed "later" timestamp must neither crash the hook nor silence it forever.
        for bad in ("2026-10-08", "abc", "1.5", f"{int(time.time())}\r", ""):
            target = repo("bad-" + str(abs(hash(bad))))
            with open(state, "a") as f:
                f.write(f"{target}\tlater\t{bad}\n")
            out = run(target, data=data)
            check(f"malformed later {bad!r}: policy kept, offer shown again",
                  "<crew-chief-policy>" in out and (OFFER in out or bad.endswith("\r")))
        back = repo("back\\slash")
        with open(state, "a") as f:
            f.write(f"{back}\tnever\n")
        check("never is matched for a path with a backslash", OFFER not in run(back, data=data))


        # ---- the offer text and the mod's marker -------------------------------------------------
        fresh = repo("text-and-marker")
        data_m = os.path.join(SCRATCH, "data-marker")
        out = run(fresh, data=data_m)
        check("offer says the files are written in the same turn after a yes",
              "written in the same turn" in out and "A preview is shown before anything is written" not in out, out[-900:])
        os.makedirs(data_m)
        marker = os.path.join(data_m, "mod-offer-active")
        for label, text, expect_offer in [
            ("a fresh marker (the mod is asking) silences the shell's offer", f"{int(time.time())}\n", False),
            ("a marker from 13 days ago still silences it", f"{int(time.time()) - 13 * 86400}\n", False),
            ("a marker older than 14 days does not", f"{int(time.time()) - 15 * 86400}\n", True),
            ("a malformed marker does not", "yesterday\n", True),
            ("an empty marker does not", "", True),
        ]:
            with open(marker, "w") as f:
                f.write(text)
            check(label, (OFFER in run(fresh, data=data_m)) == expect_offer)
        with open(marker, "w") as f:
            f.write(f"{int(time.time())}\n")
        check("the marker does not hide the routing policy", "<crew-chief-policy>" in run(fresh, data=data_m))

        # ---- the weekly staleness check ----------------------------------------------------------
        data_c = os.path.join(SCRATCH, "data-check")
        checks = os.path.join(data_c, "handoff-checks.tsv")

        def lines_for(root):
            if not os.path.exists(checks):
                return []
            return [l.split("\t") for l in open(checks).read().splitlines() if l.split("\t")[0] == root]

        proj = repo("check-proj", [("STATUS.md", "# s\n"), ("tasks.json", "{}")])
        before = time.time()
        out = run(proj, data=data_c)
        rec = lines_for(proj)
        check("check printed on a fresh startup, after the policy",
              CHECK in out and out.index("<crew-chief-policy>") < out.index(CHECK) and OFFER not in out, out[-600:])
        check("check is one pass, three lines, at the end, advisory",
              "ONE consistency pass" in out and "at most 3 lines" in out and "end of your first answer" in out
              and "in_progress" in out and "git log" in out and "Do the user's request first" in out and "never blocking" in out)
        check("check recorded right away: root TAB unix time",
              len(rec) == 1 and len(rec[0]) == 2 and rec[0][1].isdigit() and before - 2 <= int(rec[0][1]) <= time.time() + 2, str(rec))
        check("no size facts for small files", "Size facts" not in out)
        check("not repeated within 7 days", CHECK not in run(proj, data=data_c) and len(lines_for(proj)) == 1)
        with open(checks, "a") as f:
            f.write(f"{proj}\t{int(time.time()) - 6 * 86400}\n")
        check("a record 6 days old still silences it", CHECK not in run(proj, data=data_c))
        with open(checks, "a") as f:
            f.write(f"{proj}\t{int(time.time()) - 8 * 86400}\n")
        n_before = len(lines_for(proj))
        check("a record 8 days old (last line wins) brings it back and records again",
              CHECK in run(proj, data=data_c) and len(lines_for(proj)) == n_before + 1)
        with open(checks, "a") as f:
            f.write(f"{proj}\tgarbage\n")
        check("a malformed record is treated as no record", CHECK in run(proj, data=data_c))
        other_proj = repo("check-other", [("tasks.json", "{}")])
        check("another project has its own record", CHECK in run(other_proj, data=data_c))

        for source in ("resume", "clear", "compact"):
            stale = repo("check-" + source, [("STATUS.md", "# s\n")])
            check(f"no check on {source}, and nothing recorded", CHECK not in run(stale, source=source, data=data_c) and lines_for(stale) == [])
        check("no check without CLAUDE_PLUGIN_DATA", CHECK not in run(repo("check-nodata", [("STATUS.md", "x")]), data=None))
        check("no check without handoff files (the offer is the other path)", CHECK not in run(repo("check-none"), data=data_c))
        check("check from a subdirectory is keyed by the repository root",
              len(lines_for(proj)) > 0 and CHECK not in run(os.path.join(proj), data=data_c))
        deep = repo("check-deep", [("STATUS.md", "x")])
        os.makedirs(os.path.join(deep, "src"))
        run(os.path.join(deep, "src"), data=data_c)
        check("recorded under the root, not the subdirectory", len(lines_for(deep)) == 1 and lines_for(os.path.join(deep, "src")) == [])
        nested = repo("check-nested", [("app/STATUS.md", "x")])
        check("handoff files one level down count", CHECK in run(nested, data=data_c))
        plain_proj = os.path.join(SCRATCH, "check-nogit")
        os.makedirs(plain_proj)
        with open(os.path.join(plain_proj, "tasks.json"), "w") as f:
            f.write("{}")
        out = run(plain_proj, data=data_c, env_extra={"GIT_CEILING_DIRECTORIES": SCRATCH})
        check("no git repository: the working directory is the project", CHECK in out and len(lines_for(plain_proj)) == 1)
        check("home directory is skipped", CHECK not in run(repo("check-home", [("STATUS.md", "x")]), data=data_c,
                                                           env_extra={"HOME": os.path.join(SCRATCH, "check-home")}))
        policy_chk = repo("check-policy-branch", [("CLAUDE.md", "<!-- crew-chief:start -->\n"), ("STATUS.md", "x")])
        out = run(policy_chk, data=data_c)
        check("the project-policy branch checks too", "routing policy is in this project's CLAUDE.md" in out and CHECK in out)

        old_day = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 200 * 86400))
        new_day = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 2 * 86400))
        big = repo("check-big", [
            ("STATUS.md", "x" * 7000),
            ("tasks.json", "{" + " " * 62000 + "}"),
            ("CLAUDE.md", "line\n" * 201),
            ("PROGRESS.md", f"# Progress\n\n{new_day}: recent\n\n- {old_day}: old one\n  detail\n## {old_day}\nold two\n"),
        ])
        out = run(big, data=data_c)
        check("size facts: STATUS.md over 6 KB", "STATUS.md is 6 KB" in out or "STATUS.md is 7 KB" in out, out[-700:])
        check("size facts: CLAUDE.md over 200 lines", "CLAUDE.md has 201 lines" in out)
        check("size facts: tasks.json over 60 KB", "tasks.json is 60 KB" in out or "tasks.json is 61 KB" in out)
        check("size facts: PROGRESS.md entries older than 60 days (only the old ones counted)",
              "PROGRESS.md has 2 entries older than 60 days" in out, out[-700:])
        check("size facts point to /crew-tidy and /crew-tidy archive", "/crew-tidy" in out and "/crew-tidy archive" in out)
        calm = repo("check-calm", [("STATUS.md", "x" * 5000), ("tasks.json", "{}"), ("CLAUDE.md", "l\n" * 200),
                                   ("PROGRESS.md", f"{new_day}: recent\n")])
        out = run(calm, data=data_c)
        check("no size facts when every file is within its limit", CHECK in out and "Size facts" not in out, out[-500:])

        built = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_assets.py"), "--check"],
                               capture_output=True, text=True)
        check("generated CLAUDE.md section unaffected (build_assets --check)", built.returncode == 0, built.stdout + built.stderr)
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)


if __name__ == "__main__":
    main()
