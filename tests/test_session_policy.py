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
        bare = repo("bare")
        out = run(bare, data=data)
        check("policy printed", "<crew-chief-policy>" in out, out[:200])
        check("offer on a fresh repo without handoff files", OFFER in out)
        check("offer names what changes and cites the source",
              "STATUS.md" in out and "tasks.json" in out and "PROGRESS.md" in out and "Nothing is committed" in out
              and "anthropic.com/engineering/effective-harnesses-for-long-running-agents" in out)
        check("offer writes nothing itself", not os.path.exists(data) and sorted(os.listdir(bare)) == [".git"])

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

        built = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_assets.py"), "--check"],
                               capture_output=True, text=True)
        check("generated CLAUDE.md section unaffected (build_assets --check)", built.returncode == 0, built.stdout + built.stderr)
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)


if __name__ == "__main__":
    main()
