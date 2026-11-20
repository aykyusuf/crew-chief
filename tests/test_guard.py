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
        for agent in ("crew-chief:deep-reader", "crew-chief:reviewer", "crew-chief:security-reviewer", "crew-chief:scanner", "crew-chief:ui-smoke", "crew-chief:planner"):
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


def design_spec_cases(failures):
    """ui-designer may write its design spec (a .md under .crew-chief/design/ in the project) and nothing else."""
    import shutil
    import tempfile
    scratch = os.path.realpath(tempfile.mkdtemp(prefix="crew-chief-design-"))
    proj = os.path.join(scratch, "proj")
    sub = os.path.join(proj, "web", "app")
    os.makedirs(sub)
    n = 0

    def expect(code, label, tool, tool_input, agent="crew-chief:ui-designer", cwd=proj, project=False):
        nonlocal n
        n += 1
        payload = {"tool_name": tool, "tool_input": tool_input, "cwd": cwd}
        if agent:
            payload["agent_type"] = agent
        env = dict(ENV if ENV is not None else os.environ, TMPDIR=scratch)
        got = subprocess.run([GUARD] + (["--project"] if project else []), input=json.dumps(payload), capture_output=True, text=True, env=env).returncode
        if got != code:
            failures.append(f"design spec: expected {code}, got {got}: {label}")

    spec = proj + "/.crew-chief/design/site.md"
    try:
        expect(0, "spec, folder does not exist yet", "Write", {"file_path": spec})
        os.makedirs(proj + "/.crew-chief/design")
        expect(0, "spec, folder exists", "Write", {"file_path": spec})
        expect(0, "spec in a nested folder", "Write", {"file_path": proj + "/.crew-chief/design/a/b.md"})
        expect(0, "project install, bare agent name", "Write", {"file_path": spec}, agent="ui-designer", project=True)
        expect(0, "cwd is a subfolder of a non-git project: its own .crew-chief", "Write", {"file_path": sub + "/.crew-chief/design/x.md"}, cwd=sub)
        expect(2, "cwd is a subfolder of a non-git project: not the parent's", "Write", {"file_path": spec}, cwd=sub)
        expect(2, "code file", "Write", {"file_path": proj + "/src/App.tsx"})
        expect(2, "code file in the spec folder", "Write", {"file_path": proj + "/.crew-chief/design/App.tsx"})
        expect(2, "css next to the spec", "Write", {"file_path": proj + "/.crew-chief/design/site.css"})
        expect(2, "md outside the spec folder", "Write", {"file_path": proj + "/DESIGN.md"})
        expect(2, "the profile file", "Write", {"file_path": proj + "/.crew-chief/ui-profile.json"})
        expect(2, "a sibling folder with the same prefix", "Write", {"file_path": proj + "/.crew-chief/design-evil/x.md"})
        expect(2, "the reports folder", "Write", {"file_path": scratch + "/crew-chief-reports/x.md"})
        expect(2, "Edit of the spec", "Edit", {"file_path": spec})
        expect(2, "MultiEdit of the spec", "MultiEdit", {"file_path": spec})
        expect(2, "relative path", "Write", {"file_path": ".crew-chief/design/x.md"})
        expect(2, "dot dot out", "Write", {"file_path": proj + "/.crew-chief/design/../x.md"})
        expect(2, "no path", "Write", {})
        expect(2, "no project folder", "Write", {"file_path": spec}, cwd="")
        outside = os.path.join(scratch, "outside")
        os.makedirs(outside)
        os.symlink(outside, proj + "/.crew-chief/design/link")
        expect(2, "symlinked subfolder out", "Write", {"file_path": proj + "/.crew-chief/design/link/x.md"})
        os.symlink(os.path.join(outside, "t.md"), proj + "/.crew-chief/design/file-link.md")
        expect(2, "symlinked file out", "Write", {"file_path": proj + "/.crew-chief/design/file-link.md"})
        proj2 = os.path.join(scratch, "proj2")
        os.makedirs(proj2)
        os.symlink(outside, proj2 + "/.crew-chief")
        expect(2, "symlinked .crew-chief folder", "Write", {"file_path": proj2 + "/.crew-chief/design/x.md"}, cwd=proj2)
        expect(2, "another project's spec folder", "Write", {"file_path": proj2 + "/.crew-chief/design/x.md"})
        # The other read-only agents keep the reports-folder rule only; writing agents are never touched.
        expect(2, "planner may not write a spec", "Write", {"file_path": spec}, agent="crew-chief:planner")
        expect(2, "reviewer may not write a spec", "Write", {"file_path": spec}, agent="crew-chief:reviewer")
        expect(0, "implementer is not touched", "Write", {"file_path": proj + "/src/App.tsx"}, agent="crew-chief:ui-implementer")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return n


def scout_cases(failures):
    """ui-scout may write REFS.md and screenshots under <project>/.crew-chief/refs/ (Write, and one headless Chrome command) and nothing else."""
    import shutil
    import tempfile
    scratch = os.path.realpath(tempfile.mkdtemp(prefix="crew-chief-scout-"))
    proj = os.path.join(scratch, "proj")
    os.makedirs(proj)
    n = 0
    env = dict(ENV if ENV is not None else os.environ, TMPDIR=scratch)

    def expect(code, label, tool, tool_input, agent="crew-chief:ui-scout", cwd=proj, project=False):
        nonlocal n
        n += 1
        payload = {"tool_name": tool, "tool_input": tool_input, "cwd": cwd}
        if agent:
            payload["agent_type"] = agent
        got = subprocess.run([GUARD] + (["--project"] if project else []), input=json.dumps(payload), capture_output=True, text=True, env=env).returncode
        if got != code:
            failures.append(f"scout: expected {code}, got {got}: {label}")

    refs = proj + "/.crew-chief/refs"
    chrome = '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'
    udd = "--user-data-dir=" + scratch + "/crew-chief-scout"

    def shot(path, extra="", url="https://example.com/", binary=chrome, flags="--headless=new"):
        return f"{binary} {flags} {udd} {extra} --screenshot={path} {url}"

    try:
        expect(0, "REFS.md, folder does not exist yet", "Write", {"file_path": refs + "/REFS.md"})
        expect(0, "png", "Write", {"file_path": refs + "/1-cafe-desktop.png"})
        expect(0, "jpg", "Write", {"file_path": refs + "/1-cafe-mobile.jpg"})
        expect(0, "webp", "Write", {"file_path": refs + "/1-cafe-mobile.webp"})
        expect(0, "upper-case extension", "Write", {"file_path": refs + "/1-cafe.PNG"})
        expect(0, "project install, bare agent name", "Write", {"file_path": refs + "/REFS.md"}, agent="ui-scout", project=True)
        os.makedirs(refs)
        expect(0, "REFS.md, folder exists", "Write", {"file_path": refs + "/REFS.md"})
        expect(2, "code file", "Write", {"file_path": proj + "/src/App.tsx"})
        expect(2, "html in refs", "Write", {"file_path": refs + "/page.html"})
        expect(2, "svg in refs", "Write", {"file_path": refs + "/logo.svg"})
        expect(2, "script in refs", "Write", {"file_path": refs + "/a.sh"})
        expect(2, "md outside refs", "Write", {"file_path": proj + "/README.md"})
        expect(2, "png outside refs", "Write", {"file_path": proj + "/a.png"})
        expect(2, "the design spec folder", "Write", {"file_path": proj + "/.crew-chief/design/x.md"})
        expect(2, "the profile file", "Write", {"file_path": proj + "/.crew-chief/ui-profile.json"})
        expect(2, "a sibling folder with the same prefix", "Write", {"file_path": proj + "/.crew-chief/refs-evil/x.md"})
        expect(2, "Edit", "Edit", {"file_path": refs + "/REFS.md"})
        expect(2, "MultiEdit", "MultiEdit", {"file_path": refs + "/REFS.md"})
        expect(2, "relative path", "Write", {"file_path": ".crew-chief/refs/REFS.md"})
        expect(2, "dot dot out", "Write", {"file_path": refs + "/../x.md"})
        expect(2, "no path", "Write", {})
        expect(2, "no project folder", "Write", {"file_path": refs + "/REFS.md"}, cwd="")
        outside = os.path.join(scratch, "outside")
        os.makedirs(outside)
        os.symlink(outside, refs + "/link")
        expect(2, "symlinked subfolder out", "Write", {"file_path": refs + "/link/x.md"})
        os.symlink(os.path.join(outside, "t.png"), refs + "/file-link.png")
        expect(2, "symlinked file out", "Write", {"file_path": refs + "/file-link.png"})
        proj2 = os.path.join(scratch, "proj2")
        os.makedirs(proj2)
        os.symlink(outside, proj2 + "/.crew-chief")
        expect(2, "symlinked .crew-chief folder", "Write", {"file_path": proj2 + "/.crew-chief/refs/REFS.md"}, cwd=proj2)
        expect(2, "another project's refs folder", "Write", {"file_path": proj2 + "/.crew-chief/refs/REFS.md"})
        # The other read-only agents may not write into refs; the designer keeps only its spec folder.
        expect(2, "ui-designer may not write refs", "Write", {"file_path": refs + "/REFS.md"}, agent="crew-chief:ui-designer")
        expect(2, "planner may not write refs", "Write", {"file_path": refs + "/REFS.md"}, agent="crew-chief:planner")
        # Bash: the one headless screenshot command into refs.
        d = refs + "/1-cafe-desktop.png"
        expect(0, "screenshot desktop", "Bash", {"command": shot(d, "--hide-scrollbars --window-size=1440,900")})
        expect(0, "screenshot mobile, quoted url, time budget", "Bash", {"command": shot(refs + "/1-cafe-mobile.png", "--window-size=390,844 --virtual-time-budget=8000", url='"https://example.com/a?b=1"')})
        expect(0, "screenshot, webgl flags and long budget", "Bash", {"command": shot(d, "--use-angle=swiftshader --enable-unsafe-swiftshader --use-gl=angle --virtual-time-budget=20000")})
        expect(2, "screenshot, unknown gpu flag", "Bash", {"command": shot(d, "--use-angle=metal")})
        expect(2, "screenshot, unknown flag", "Bash", {"command": shot(d, "--enable-unsafe-webgpu")})
        expect(0, "screenshot, quoted path with a space", "Bash", {"command": f'{chrome} --headless=new {udd} --screenshot="{refs}/1 a-desktop.png" https://example.com/'})
        expect(0, "screenshot, rtk prefix", "Bash", {"command": "rtk " + shot(d)})
        expect(0, "screenshot, linux binary", "Bash", {"command": shot(d, binary="chromium")})
        expect(0, "screenshot, linux binary with path", "Bash", {"command": shot(d, binary="/usr/bin/google-chrome")})
        expect(0, "screenshot, jpg", "Bash", {"command": shot(refs + "/1-a.jpg")})
        expect(0, "screenshot in a nested refs folder", "Bash", {"command": shot(refs + "/sub/1-a.png")})
        expect(0, "project install, bare agent name", "Bash", {"command": shot(d)}, agent="ui-scout", project=True)
        expect(2, "screenshot elsewhere in the project", "Bash", {"command": shot(proj + "/public/x.png")})
        expect(2, "screenshot in the design folder", "Bash", {"command": shot(proj + "/.crew-chief/design/x.png")})
        expect(2, "screenshot to /tmp", "Bash", {"command": shot("/tmp/x.png")})
        expect(2, "screenshot, home folder", "Bash", {"command": shot(os.path.expanduser("~/x.png"))})
        expect(2, "screenshot, relative path", "Bash", {"command": shot(".crew-chief/refs/x.png")})
        expect(2, "screenshot, dot dot out of refs", "Bash", {"command": shot(refs + "/../x.png")})
        expect(2, "screenshot, wrong extension", "Bash", {"command": shot(refs + "/x.html")})
        expect(2, "screenshot, no extension", "Bash", {"command": shot(refs + "/x")})
        expect(2, "screenshot, symlinked subfolder out", "Bash", {"command": shot(refs + "/link/x.png")})
        expect(2, "screenshot, symlinked file out", "Bash", {"command": shot(refs + "/file-link.png")})
        # Bash: this plugin's own ui-shot.mjs (real mobile emulation) into refs.
        script = os.path.realpath(os.path.join(os.path.dirname(GUARD), "ui-shot.mjs"))
        expect(0, "ui-shot", "Bash", {"command": f"node {script} https://example.com/ {refs} 1-cafe"})
        expect(0, "ui-shot, quoted script, webgl, wait", "Bash", {"command": f'node "{script}" https://example.com/a {refs}/ 2-x --webgl --wait=15000'})
        expect(0, "ui-shot, rtk prefix", "Bash", {"command": f"rtk node {script} https://example.com/ {refs} a"})
        expect(2, "ui-shot, another copy of the script", "Bash", {"command": f"node {scratch}/ui-shot.mjs https://example.com/ {refs} a"})
        expect(2, "ui-shot, out dir outside refs", "Bash", {"command": f"node {script} https://example.com/ {proj}/public a"})
        expect(2, "ui-shot, out dir dot dot", "Bash", {"command": f"node {script} https://example.com/ {refs}/.. a"})
        expect(2, "ui-shot, file url", "Bash", {"command": f"node {script} file:///etc/passwd {refs} a"})
        expect(2, "ui-shot, slug with a slash", "Bash", {"command": f"node {script} https://example.com/ {refs} a/b"})
        expect(2, "ui-shot, dot slug", "Bash", {"command": f"node {script} https://example.com/ {refs} .x"})
        expect(2, "ui-shot, unknown flag", "Bash", {"command": f"node {script} https://example.com/ {refs} a --eval=1"})
        expect(2, "ui-shot, bad wait", "Bash", {"command": f"node {script} https://example.com/ {refs} a --wait=1x"})
        expect(2, "ui-shot, chained", "Bash", {"command": f"node {script} https://example.com/ {refs} a; rm -rf {proj}"})
        expect(2, "ui-shot, missing slug", "Bash", {"command": f"node {script} https://example.com/ {refs}"})
        expect(2, "ui-shot, too many args", "Bash", {"command": f"node {script} https://example.com/ {refs} a b c d"})
        expect(2, "ui-shot, other agent", "Bash", {"command": f"node {script} https://example.com/ {refs} a"}, agent="crew-chief:planner")
        expect(2, "screenshot, symlinked .crew-chief", "Bash", {"command": shot(proj2 + "/.crew-chief/refs/x.png")}, cwd=proj2)
        expect(2, "screenshot, another project's refs", "Bash", {"command": shot(proj2 + "/.crew-chief/refs/x.png")})
        expect(2, "two screenshots", "Bash", {"command": shot(d, f"--screenshot={proj}/x.png")})
        expect(2, "no screenshot flag (headless would only print)", "Bash", {"command": f"{chrome} --headless=new {udd} https://example.com/"})
        expect(2, "dump-dom flag", "Bash", {"command": shot(d, "--dump-dom")})
        expect(2, "print-to-pdf elsewhere", "Bash", {"command": shot(d, "--print-to-pdf=/tmp/a.pdf")})
        expect(2, "log file flag", "Bash", {"command": shot(d, "--enable-logging --log-file=/tmp/a.log")})
        expect(2, "remote debugging flag", "Bash", {"command": shot(d, "--remote-debugging-port=9222")})
        expect(2, "load-extension flag", "Bash", {"command": shot(d, "--load-extension=/tmp/e")})
        expect(2, "not headless", "Bash", {"command": shot(d, flags="--window-size=1440,900")})
        expect(2, "no user data dir (would reuse the user's browser)", "Bash", {"command": f"{chrome} --headless=new --screenshot={d} https://example.com/"})
        expect(2, "user data dir outside temp", "Bash", {"command": f"{chrome} --headless=new --user-data-dir=/home/someone/p --screenshot={d} https://example.com/"})
        expect(2, "user data dir with dot dot", "Bash", {"command": f"{chrome} --headless=new --user-data-dir={scratch}/../etc --screenshot={d} https://example.com/"})
        expect(2, "file url", "Bash", {"command": shot(d, url="file:///etc/passwd")})
        expect(2, "no url", "Bash", {"command": shot(d, url="")})
        expect(2, "pipe", "Bash", {"command": shot(d) + " | cat"})
        expect(2, "redirect", "Bash", {"command": shot(d) + " > /tmp/log"})
        expect(2, "redirect to dev null still not the one command", "Bash", {"command": shot(d) + " 2>/dev/null"})
        expect(2, "second command", "Bash", {"command": shot(d) + "; rm -rf x"})
        expect(2, "and", "Bash", {"command": shot(d) + " && touch x"})
        expect(2, "background", "Bash", {"command": shot(d) + " &"})
        expect(2, "command substitution in url", "Bash", {"command": shot(d, url="https://a.com/$(id)")})
        expect(2, "backtick in url", "Bash", {"command": shot(d, url="https://a.com/`id`")})
        expect(2, "variable", "Bash", {"command": shot(d, url="https://a.com/$HOME")})
        expect(2, "newline", "Bash", {"command": shot(d) + "\nrm x"})
        expect(2, "quote escape", "Bash", {"command": shot(d, url='"https://a.com/\\"')})
        expect(2, "env prefix", "Bash", {"command": "FOO=1 " + shot(d)})
        # Other read-only agents and the other Bash rules are unchanged for ui-scout.
        expect(2, "env prefix on the browser command", "Bash", {"command": "env " + shot(d)})
        expect(2, "shell wrapper around the browser command", "Bash", {"command": "sh -c 'x' --screenshot=/tmp/a.png"})
        expect(0, "ui-tester is not touched", "Bash", {"command": shot("/tmp/x.png")}, agent="crew-chief:ui-tester")
        expect(2, "curl download", "Bash", {"command": "curl -sL -o " + refs + "/a.png https://example.com/a.png"})
        expect(0, "curl to read html", "Bash", {"command": "curl -sL https://example.com/ | head -c 60000"})
        expect(0, "curl and grep for colours", "Bash", {"command": "curl -sL https://example.com/ | grep -o '#[0-9a-fA-F]\\{6\\}' | sort -u"})
        expect(0, "date", "Bash", {"command": "date +%F"})
        expect(0, "temp folder lookup", "Bash", {"command": 'printf %s "${TMPDIR:-/tmp}"'})
        expect(0, "chrome binary check", "Bash", {"command": 'ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'})
        expect(0, "progress line", "Bash", {"command": ": 'crew-progress 40 | looking at site 2 |'"})
        expect(2, "mkdir", "Bash", {"command": "mkdir -p " + refs})
        expect(2, "cp into refs", "Bash", {"command": "cp a.png " + refs + "/a.png"})
        expect(2, "redirect into refs", "Bash", {"command": "echo x > " + refs + "/REFS.md"})
        expect(2, "git write", "Bash", {"command": "git add -A"})
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return n


def main():
    failures = []

    def expect(code, command, **kw):
        got = run(command, **kw)
        if got != code:
            failures.append(f"expected {code}, got {got}: {command!r} {kw}")

    for agent in ("crew-chief:scanner", "crew-chief:deep-reader", "crew-chief:reviewer", "crew-chief:security-reviewer", "crew-chief:ui-smoke", "crew-chief:planner", "crew-chief:ui-designer", "crew-chief:ui-scout"):
        for c in ALLOWED:
            expect(0, c, agent_type=agent)
        for c in BLOCKED:
            expect(2, c, agent_type=agent)
    # Writing agents, the main session, and other plugins' agents are never touched.
    for agent in (None, "crew-chief:implementer", "crew-chief:implementer-hard", "crew-chief:ui-tester", "crew-chief:mechanic", "reviewer", "other:scanner"):
        for c in BLOCKED:
            expect(0, c, agent_type=agent)
    # --project (settings hook from /crew-setup) matches bare agent names only.
    for agent in ("scanner", "deep-reader", "reviewer", "security-reviewer", "ui-smoke", "planner", "ui-designer", "ui-scout"):
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
    total += 4 * (len(ALLOWED) + len(BLOCKED))
    total += file_tool_cases(failures)
    total += design_spec_cases(failures)
    total += scout_cases(failures)
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
    for tool in ("sh", "cat", "grep", "sed", "tr", "mkdir", "chmod", "dirname", "wc"):
        path = shutil.which(tool)
        if path:
            os.symlink(path, os.path.join(bindir, tool))
    return {"PATH": bindir}


if __name__ == "__main__":
    main()
    ENV = without_jq_env()
    print("without jq:", end=" ")
    main()
