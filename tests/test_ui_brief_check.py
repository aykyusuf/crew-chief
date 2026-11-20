"""Tests for scripts/ui-brief-check.sh (the PreToolUse Agent gate for UI briefs). Run: python3 tests/test_ui_brief_check.py (needs jq)."""
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "scripts", "ui-brief-check.sh")
SCRATCH = os.path.join(ROOT, ".test-tmp", "ui-brief-check")
failures = []

if not shutil.which("jq"):
    print("skip: jq not installed")
    sys.exit(0)


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f": {detail}"))
    if not ok:
        failures.append(name)


def world(name, profile=None):
    base = os.path.join(SCRATCH, name)
    home, data, proj = (os.path.join(base, x) for x in ("home", "data", "proj"))
    for d in (home, data, proj):
        os.makedirs(d)
    if profile is not None:
        os.makedirs(os.path.join(proj, ".crew-chief"))
        json.dump(profile, open(os.path.join(proj, ".crew-chief", "ui-profile.json"), "w"))
    return home, data, proj


def run(home, data, proj, agent, prompt, env_extra=None, raw=None, desc="", path=None, with_data=True):
    env = {"PATH": path or os.environ["PATH"], "HOME": home, "CLAUDE_PLUGIN_ROOT": ROOT, "GIT_CEILING_DIRECTORIES": SCRATCH}
    if with_data:
        env["CLAUDE_PLUGIN_DATA"] = data
    env.update(env_extra or {})
    tool_input = {"prompt": prompt, "description": desc}
    if agent is not None:
        tool_input["subagent_type"] = agent
    payload = raw if raw is not None else json.dumps({"session_id": "s1", "cwd": proj, "tool_name": "Agent", "tool_input": tool_input})
    return subprocess.run(["/bin/sh", HOOK], input=payload, capture_output=True, text=True, env=env)


UI = "Restyle src/components/Hero.tsx and src/styles/app.css: bigger heading, new button states. Run npm test."
NONUI = "Add a retry to src/api/client.ts and run npm test."


def main():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    os.makedirs(SCRATCH)
    try:
        h, d, p = world("basic", {"profile": "lively", "motion": 3, "refs": [".crew-chief/refs/a.png"]})
        r = run(h, d, p, "crew-chief:implementer", UI)
        check("UI brief to implementer: exit 2", r.returncode == 2, f"{r.returncode} {r.stderr!r}")
        check("reason names ui-implementer, the profile and its skills", "crew-chief:ui-implementer" in r.stderr and "lively" in r.stderr and "crew-chief:animate" in r.stderr, r.stderr)
        check("reason is short", len(r.stderr) < 1800, str(len(r.stderr)))
        check("a state file is written", len(os.listdir(os.path.join(d, "ui-gate"))) == 1)
        r = run(h, d, p, "crew-chief:implementer", UI)
        check("the identical retry passes", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        r = run(h, d, p, "crew-chief:implementer", UI + " Also the footer.")
        check("a different brief is held back again", r.returncode == 2)
        r = run(h, d, p, "crew-chief:implementer-hard", UI)
        check("same brief, other agent type, is a different call", r.returncode == 2)

        for agent in (None, "implementer", "mechanic", "general-purpose", "crew-chief:mechanic", "crew-chief:implementer-hard"):
            h2, d2, p2 = world("w-" + str(agent).replace(":", "_"))
            r = run(h2, d2, p2, agent, UI)
            check(f"writing agent {agent}: held back", r.returncode == 2, f"{r.returncode}")
        r = run(h, d, p, "crew-chief:ui-designer", UI)
        check("ui-designer gets a UI brief without the profile, untouched", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        r = run(h, d, p, "crew-chief:ui-scout", "Find three references for the landing page of a coffee shop: src/pages/index.html. " + UI)
        check("ui-scout gets a UI brief without the profile, untouched", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        r = run(h, d, p, "ui-scout", "Find references for the new site's hero in Hero.tsx")
        check("bare ui-scout type is untouched too", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        r = run(h, d, p, "ui-designer", "Design the landing page for the new site: palette, type, layout. " + UI)
        check("bare ui-designer type is untouched too", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        r = run(h, d, p, "implementer", "Build from the spec written by crew-chief:ui-designer in .crew-chief/design/site.md for src/components/Hero.tsx")
        check("a brief that only mentions ui-designer is still a UI brief for implementer (held back)", r.returncode == 2, f"{r.returncode}")
        r = run(h, d, p, "implementer", "Use UI profile immersive. " + UI)
        check("naming the profile does not make implementer the right agent", r.returncode == 2)

        h2, d2, p2 = world("ui-noprofile", None)
        r = run(h2, d2, p2, "crew-chief:ui-implementer", UI)
        check("ui-implementer without the profile in the brief: held back", r.returncode == 2 and "does not name the UI profile" in r.stderr, r.stderr)
        check("no profile file: the reason says to set one", "no UI profile yet" in r.stderr.lower() or "There is no UI profile" in r.stderr, r.stderr)
        r = run(h2, d2, p2, "crew-chief:ui-implementer", UI)
        check("ui-implementer retry passes", r.returncode == 0)
        for text in ("UI profile: calm. " + UI, "Profile is immersive, motion 8. " + UI, "Read .crew-chief/ui-profile.json first. " + UI):
            h3, d3, p3 = world("uip" + str(abs(hash(text)) % 1000))
            r = run(h3, d3, p3, "crew-chief:ui-implementer", text)
            check("ui-implementer naming the profile passes: " + text[:30], r.returncode == 0, r.stderr)
        h3, d3, p3 = world("own-profile", {"profile": "my-look", "motion": 2})
        r = run(h3, d3, p3, "ui-implementer", "Build the settings screen in Settings.vue. Profile my-look.")
        check("the project's own profile id counts", r.returncode == 0, r.stderr)

        h4, d4, p4 = world("nonui")
        check("non-UI brief to implementer passes", run(h4, d4, p4, "crew-chief:implementer", NONUI).returncode == 0)
        check("non-UI general-purpose passes", run(h4, d4, p4, None, "Find where retries are configured and report.").returncode == 0)
        check("a ui-scout mention is not a UI word", run(h4, d4, p4, "implementer", "Fix the server. Afterwards crew-chief:ui-scout will look for references.").returncode == 0)
        check("a ui-smoke mention is not a UI word", run(h4, d4, p4, "implementer", "Fix the server. Afterwards crew-chief:ui-smoke will check it.").returncode == 0)

        for agent in ("crew-chief:scanner", "crew-chief:deep-reader", "crew-chief:reviewer", "crew-chief:planner", "crew-chief:ui-smoke", "crew-chief:ui-tester", "Explore", "scanner", "some-other-agent"):
            h5, d5, p5 = world("ro-" + agent.replace(":", "_"))
            r = run(h5, d5, p5, agent, UI)
            check(f"read-only or unknown agent {agent} passes a UI brief", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")

        h6, d6, p6 = world("words")
        for text, ui in (("bu landing page için hero bölümünü yenile", True), ("arayüzü yeniden düzenle", True), ("Make the dashboard darker", True),
                         ("Flutter widget for the cart: lib/cart/cart_view.dart", True), ("Port the SwiftUI settings view", True),
                         ("Add a column to the users table", False), ("Fix the build script", False), ("Refactor the guild module", False)):
            r = run(h6, d6, p6, "implementer", text)
            check(f"detection: {text[:40]!r} -> {'UI' if ui else 'not UI'}", (r.returncode == 2) == ui, f"{r.returncode}")
        for text, ui in (("kahve dükkanı için tek sayfalık bir landing sayfası yap, index.html olarak", True), ("bana bir web sitesi yap", True),
                         ("ana sayfayı yenile", True), ("giriş sayfası hazırla", True), ("login ekranı yap", True), ("Build a website for the bakery", True),
                         ("create the homepage", True), ("write index.html", True), ("Add Settings.vue", True), ("tasarım yap bana", True),
                         ("backend API endpoint yaz", False), ("veritabanı şemasını düzelt", False), ("add a migration for the orders table", False),
                         ("the guild module needs tests", False), ("write a python script to rename files", False)):
            r = run(h6, d6, p6, "implementer", text)
            check(f"widened detection: {text[:44]!r} -> {'UI' if ui else 'not UI'}", (r.returncode == 2) == ui, f"{r.returncode}")
        r = run(h6, d6, p6, "implementer", "fix it", desc="Build the admin dashboard")
        check("the description counts too", r.returncode == 2)

        h7, d7, p7 = world("off")
        check("CREW_CHIEF_UI_GATE=off", run(h7, d7, p7, "implementer", UI, env_extra={"CREW_CHIEF_UI_GATE": "off"}).returncode == 0)
        check("garbage input passes", run(h7, d7, p7, "implementer", UI, raw="not json").returncode == 0)
        check("empty input passes", run(h7, d7, p7, "implementer", UI, raw="").returncode == 0)
        check("a JSON array passes", run(h7, d7, p7, "implementer", UI, raw="[1]").returncode == 0)
        check("an Agent call without a prompt passes", run(h7, d7, p7, "implementer", "", ).returncode == 0)
        check("no data folder: passes (it could not remember the retry)", run(h7, d7, p7, "implementer", UI, with_data=False).returncode == 0)

        bindir = os.path.join(SCRATCH, "bin-nojq")
        os.makedirs(bindir)
        for tool in ("cat", "dirname", "sed", "grep", "tr", "find", "cksum"):
            src = shutil.which(tool)
            if src:
                os.symlink(src, os.path.join(bindir, tool))
        r = run(h7, d7, p7, "implementer", UI, path=bindir)
        check("no jq: passes", r.returncode == 0 and r.stderr == "", f"{r.returncode} {r.stderr!r}")
        check("no jq: the PATH really has none", subprocess.run(["/bin/sh", "-c", "command -v jq"], env={"PATH": bindir}, capture_output=True).returncode != 0)

        h8, d8, p8 = world("ttl")
        run(h8, d8, p8, "implementer", UI)
        gate = os.path.join(d8, "ui-gate")
        f = os.path.join(gate, os.listdir(gate)[0])
        old = time.time() - 5 * 3600
        os.utime(f, (old, old))
        r = run(h8, d8, p8, "implementer", UI)
        check("a denial older than four hours is forgotten (denied again)", r.returncode == 2)

        h9, d9, p9 = world("user-policy", {"profile": "mine"})
        os.makedirs(os.path.join(h9, ".claude"))
        json.dump({"profiles": {"mine": {"skills": ["crew-chief:remove-animations"], "motion": 1}}}, open(os.path.join(h9, ".claude", "crew-chief-ui.json"), "w"))
        r = run(h9, d9, p9, "implementer", UI)
        check("the user's override file adds a profile (its skills show in the reason)", r.returncode == 2 and "crew-chief:remove-animations" in r.stderr, r.stderr)
        check("the user's override file is only read", os.listdir(os.path.join(h9, ".claude")) == ["crew-chief-ui.json"])
        json.dump({"profiles": "broken"}, open(os.path.join(h9, ".claude", "crew-chief-ui.json"), "w"))
        r = run(h9, d9, p9, "implementer", UI + " v2")
        check("a broken override file does not make the gate throw", r.returncode in (0, 2) and "syntax" not in r.stderr.lower(), r.stderr)
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)
    print("FAIL" if failures else "OK", f"({len(failures)} failures)")
    sys.exit(1 if failures else 0)


main()
