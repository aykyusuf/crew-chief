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
    for tool in ("sh", "cat", "grep", "sed", "tr"):
        path = shutil.which(tool)
        if path:
            os.symlink(path, os.path.join(bindir, tool))
    return {"PATH": bindir}


if __name__ == "__main__":
    main()
    ENV = without_jq_env()
    print("without jq:", end=" ")
    main()
