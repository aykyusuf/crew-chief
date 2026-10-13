"""Tests for scripts/readonly-guard.sh. Run: python3 tests/test_guard.py"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUARD = os.path.join(ROOT, "scripts", "readonly-guard.sh")

ALLOWED = [
    "grep -rn foo src | head",
    "python3 tools/data_test.py 2>&1 | tail -20",
    "git log --oneline -5",
    "git diff HEAD~1 -- src",
    "git -C /repo status --short",
    "ls -la > /dev/null",
    "go test ./... 2>&1",
    "adb -s emulator-5554 logcat -d | grep App",
    "cat README.md",
    "find . -name '*.py' | wc -l",
    "rtk git log -3",
    'grep -rn "TODO" src | head -5',
    "python3 -c 'print(1)'",
    ": 'crew-progress 40 | touching up the mv and cp notes | rm of a slow test'",
    ": 'crew-progress 10 | reading'",
]

BLOCKED = [
    "rm notes.txt",
    "git commit -m x",
    "git -C /repo checkout -b feature",
    "sed -i '' s/a/b/ file",
    "echo hi > out.txt",
    "rtk git push",
    "pip install requests",
    "cat a >> /tmp/f",
    "make 2>&1 | tee build.log",
    "curl -o a.zip https://example.com/a.zip",
    "npm install",
    "mkdir build",
    "ls && touch x",
    ": 'crew-progress 40 | x' ; rm a",
    ": 'crew-progress 40 | x' > out.txt",
    "git -c core.x=a\\nb commit -m x",
    "git -c a=\\n push",
    "curl https://x/a\\nb -o out.zip",
    "true;\trm -rf foo",
    ": 'crew-progress 40 | x'\nrm -rf foo",
    "rm foo\n: 'crew-progress 40 | x'",
    ": 'crew-progress 40 | x'\ngit commit -m x",
    ": 'crew-progress 40 | it's | rm a'",
    'echo "a \\"quoted\\" word" > out.txt',
    "printf 'x\\n' >> log.txt",
]


ENV = None


def run(command, agent_type=None, always=False, project=False):
    payload = {"tool_name": "Bash", "tool_input": {"command": command}}
    if agent_type:
        payload["agent_type"] = agent_type
    args = [GUARD] + (["--always"] if always else []) + (["--project"] if project else [])
    return subprocess.run(args, input=json.dumps(payload), capture_output=True, text=True, env=ENV).returncode


def run_tool(tool, tool_input, scratch, agent_type="crew-chief:deep-reader", project=False):
    payload = {"tool_name": tool, "tool_input": tool_input}
    if agent_type:
        payload["agent_type"] = agent_type
    env = dict(ENV if ENV is not None else os.environ, TMPDIR=scratch)
    args = [GUARD] + (["--project"] if project else [])
    return subprocess.run(args, input=json.dumps(payload), capture_output=True, text=True, env=env).returncode


def file_tool_cases(failures):
    """Write into the reports folder is the one allowed file write; everything else is blocked."""
    import shutil
    import tempfile
    scratch = os.path.realpath(tempfile.mkdtemp(prefix="crew-chief-guard-"))
    rd = os.path.join(scratch, "crew-chief-reports")
    n = 0

    def expect(code, label, tool, tool_input, **kw):
        nonlocal n
        n += 1
        got = run_tool(tool, tool_input, scratch, **kw)
        if got != code:
            failures.append(f"file tool: expected {code}, got {got}: {label}")

    try:
        for agent in ("crew-chief:deep-reader", "crew-chief:reviewer", "crew-chief:scanner", "crew-chief:ui-smoke"):
            expect(0, f"{agent} report", "Write", {"file_path": rd + "/review.md"}, agent_type=agent)
            expect(0, f"{agent} nested report", "Write", {"file_path": rd + "/sub/dir/r.md"}, agent_type=agent)
            expect(2, f"{agent} elsewhere", "Write", {"file_path": scratch + "/notes.md"}, agent_type=agent)
            expect(2, f"{agent} Edit", "Edit", {"file_path": rd + "/review.md"}, agent_type=agent)
            expect(2, f"{agent} NotebookEdit", "NotebookEdit", {"notebook_path": rd + "/n.ipynb"}, agent_type=agent)
        expect(2, "relative path", "Write", {"file_path": "crew-chief-reports/x.md"})
        expect(2, "dot dot out", "Write", {"file_path": rd + "/../x.md"})
        expect(2, "dot dot in the middle", "Write", {"file_path": rd + "/a/../../x.md"})
        expect(2, "sibling folder with the same prefix", "Write", {"file_path": rd + "-evil/x.md"})
        expect(2, "the folder itself", "Write", {"file_path": rd})
        expect(2, "no path", "Write", {})
        os.makedirs(rd, exist_ok=True)
        outside = os.path.join(scratch, "outside")
        os.makedirs(outside)
        os.symlink(outside, os.path.join(rd, "link"))
        expect(2, "symlinked subfolder out", "Write", {"file_path": rd + "/link/x.md"})
        os.symlink(os.path.join(scratch, "does-not-exist"), os.path.join(rd, "dangling"))
        expect(2, "dangling symlinked subfolder", "Write", {"file_path": rd + "/dangling/x.md"})
        os.symlink(os.path.join(outside, "target.md"), os.path.join(rd, "file-link.md"))
        expect(2, "symlinked file out", "Write", {"file_path": rd + "/file-link.md"})
        # TMPDIR with a trailing slash (macOS) and the doubled slash it produces in a path.
        slash = scratch + "/"
        for label, fp in (("trailing-slash TMPDIR, single slash path", rd + "/t1.md"), ("trailing-slash TMPDIR, double slash path", slash + "/crew-chief-reports/t2.md")):
            n += 1
            got = run_tool("Write", {"file_path": fp}, slash)
            if got != 0:
                failures.append(f"file tool: {label} expected 0, got {got}")
        n += 1
        if run_tool("Write", {"file_path": scratch + "//elsewhere.md"}, slash) != 2:
            failures.append("file tool: double slash outside the folder was not blocked")
        expect(2, "MultiEdit", "MultiEdit", {"file_path": rd + "/m.md"})
        # Agents that may write, the main session, and other plugins' agents are never touched.
        for agent in (None, "crew-chief:implementer", "crew-chief:implementer-hard", "other:deep-reader"):
            expect(0, f"{agent} free write", "Write", {"file_path": scratch + "/notes.md"}, agent_type=agent)
            expect(0, f"{agent} free edit", "Edit", {"file_path": scratch + "/notes.md"}, agent_type=agent)
        # --project matches bare agent names.
        expect(0, "project report", "Write", {"file_path": rd + "/p.md"}, agent_type="deep-reader", project=True)
        expect(2, "project elsewhere", "Write", {"file_path": scratch + "/p.md"}, agent_type="reviewer", project=True)
        expect(0, "project other agent", "Write", {"file_path": scratch + "/p.md"}, agent_type="implementer", project=True)
        # A symlinked reports folder (planted in a shared temp dir) is refused.
        evil = os.path.realpath(tempfile.mkdtemp(prefix="crew-chief-guard-evil-"))
        os.symlink(outside, os.path.join(evil, "crew-chief-reports"))
        n += 1
        env = dict(ENV if ENV is not None else os.environ, TMPDIR=evil)
        got = subprocess.run([GUARD], input=json.dumps({"tool_name": "Write", "agent_type": "crew-chief:reviewer",
                             "tool_input": {"file_path": evil + "/crew-chief-reports/x.md"}}),
                             capture_output=True, text=True, env=env).returncode
        if got != 2:
            failures.append(f"file tool: symlinked reports folder not refused (got {got})")
        shutil.rmtree(evil, ignore_errors=True)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return n


def main():
    failures = []

    def expect(code, command, **kw):
        got = run(command, **kw)
        if got != code:
            failures.append(f"expected {code}, got {got}: {command!r} {kw}")

    for agent in ("crew-chief:scanner", "crew-chief:deep-reader", "crew-chief:reviewer", "crew-chief:ui-smoke"):
        for c in ALLOWED:
            expect(0, c, agent_type=agent)
        for c in BLOCKED:
            expect(2, c, agent_type=agent)
    # Writing agents, the main session, and other plugins' agents are never touched.
    for agent in (None, "crew-chief:implementer", "crew-chief:implementer-hard", "crew-chief:ui-tester", "reviewer", "other:scanner"):
        for c in BLOCKED:
            expect(0, c, agent_type=agent)
    # --project (settings hook from /crew-setup) matches bare agent names only.
    for agent in ("scanner", "deep-reader", "reviewer", "ui-smoke"):
        for c in BLOCKED:
            expect(2, c, agent_type=agent, project=True)
        for c in ALLOWED:
            expect(0, c, agent_type=agent, project=True)
    for agent in (None, "implementer", "ui-tester", "crew-chief:scanner", "my-scanner"):
        for c in BLOCKED:
            expect(0, c, agent_type=agent, project=True)
    # --always ignores agent_type.
    for c in BLOCKED:
        expect(2, c, always=True)
    for c in ALLOWED:
        expect(0, c, always=True)

    total = 8 * (len(ALLOWED) + len(BLOCKED)) + 11 * len(BLOCKED) + len(BLOCKED) + len(ALLOWED)
    total += file_tool_cases(failures)
    if failures:
        print("\n".join(failures))
        print(f"FAIL {len(failures)}/{total}")
        sys.exit(1)
    print(f"OK {total}/{total}")


def without_jq_env():
    """PATH with the usual tools but no jq, to exercise the sed fallback."""
    import shutil
    import tempfile
    bindir = tempfile.mkdtemp(prefix="crew-chief-nojq-")
    for tool in ("sh", "cat", "grep", "sed", "tr", "mkdir", "chmod", "dirname"):
        path = shutil.which(tool)
        if path:
            os.symlink(path, os.path.join(bindir, tool))
    return {"PATH": bindir}


if __name__ == "__main__":
    main()
    ENV = without_jq_env()
    print("without jq:", end=" ")
    main()
