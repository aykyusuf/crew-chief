"""Tests for scripts/subagent-start.sh (context given to every subagent; the UI context for ui-implementer). Run: python3 tests/test_subagent_start.py (needs jq)."""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "scripts", "subagent-start.sh")
SCRATCH = os.path.join(ROOT, ".test-tmp", "subagent-start")
failures = []

if not shutil.which("jq"):
    print("skip: jq not installed")
    sys.exit(0)


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f": {detail}"))
    if not ok:
        failures.append(name)


def run(home, proj, agent, raw=None, path=None):
    env = {"PATH": path or os.environ["PATH"], "HOME": home, "CLAUDE_PLUGIN_ROOT": ROOT, "GIT_CEILING_DIRECTORIES": SCRATCH}
    payload = raw if raw is not None else json.dumps({"agent_type": agent, "agent_id": "a1", "cwd": proj})
    r = subprocess.run(["/bin/sh", HOOK], input=payload, capture_output=True, text=True, env=env)
    if r.returncode != 0 or r.stderr:
        check("exit 0, no stderr", False, f"rc={r.returncode} {r.stderr!r}")
    if not r.stdout.strip():
        return ""
    j = json.loads(r.stdout)
    assert j["hookSpecificOutput"]["hookEventName"] == "SubagentStart", j
    return j["hookSpecificOutput"]["additionalContext"]


def main():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    home = os.path.join(SCRATCH, "home")
    proj = os.path.join(SCRATCH, "proj")
    os.makedirs(home)
    os.makedirs(proj)
    try:
        for agent in ("crew-chief:scanner", "crew-chief:implementer", "general-purpose", "Explore", ""):
            out = run(home, proj, agent)
            check(f"{agent or 'no type'}: only the progress rule", out.startswith("crew-chief progress rule:") and "UI rules" not in out, out)
        check("garbage input still gives the progress rule", run(home, proj, None, raw="not json").startswith("crew-chief progress rule:"))
        check("empty input still gives the progress rule", run(home, proj, None, raw="").startswith("crew-chief progress rule:"))

        out = run(home, proj, "crew-chief:ui-implementer")
        check("ui-implementer keeps the progress rule", out.startswith("crew-chief progress rule:"), out)
        check("no profile: says to ask the main session", "No UI profile" in out and "main session" in out, out)
        check("ban list names the defaults", all(w in out for w in ("Inter", "Arial", "purple", "cream", "terracotta", "three equal feature cards", "centred hero")), out)
        check("allowed only when profile, DESIGN.md or brief chooses it", "DESIGN.md" in out and "on purpose" in out, out)
        check("theSVG rule", "never hand-drawn" in out and "crew-chief:thesvg" in out, out)
        check("polish checklist with credit", "after jakub.kr, MIT" in out and "text-wrap: balance" in out and "tabular-nums" in out and "transition: all" in out and "0.96" in out and "44px" in out and "nested rounded corners" in out, out)
        check("preloaded and load lines", "crew-chief:frontend-design" in out and "crew-chief:design-taste-frontend" in out and "listing the skills you have" in out, out)
        check("bare agent type works too", "UI rules" in run(home, proj, "ui-implementer"))

        os.makedirs(os.path.join(proj, ".crew-chief"))
        json.dump({"profile": "lively", "motion": 3, "perfBudget": "150-250 ms", "notes": "calm, dense", "refs": [".crew-chief/refs/a.png", ".crew-chief/refs/b.png"]},
                  open(os.path.join(proj, ".crew-chief", "ui-profile.json"), "w"))
        out = run(home, proj, "crew-chief:ui-implementer")
        check("profile shown", "Profile: lively | motion 3 | perf budget: 150-250 ms" in out and "Notes: calm, dense" in out, out)
        check("profile's extra skills shown", "Extra skills for this profile: crew-chief:animate" in out, out)
        check("reference paths shown with the Read instruction", "- .crew-chief/refs/a.png" in out and "- .crew-chief/refs/b.png" in out and "Read" in out, out)
        check("no 'No UI profile' line", "No UI profile" not in out, out)

        check("the page-override rule is in the context", "apply the entry whose path or glob matches the file you work on" in out and "uses the default profile" in out, out)
        check("polish checklist has the 360px overflow rule", "no horizontal overflow at 360px" in out and "header actions and CTAs must fit or collapse" in out, out)
        check("no pages in the file: no 'Page overrides (' list", "Page overrides (a file" not in out, out)
        json.dump({"profile": "lively", "motion": 3, "refs": [], "pages": {"index.html": {"profile": "immersive", "motion": 8, "perfBudget": "60 fps"}, "src/pages/menu/**": {"profile": "calm", "notes": "plain menu"}}},
                  open(os.path.join(proj, ".crew-chief", "ui-profile.json"), "w"))
        for agent in ("crew-chief:ui-implementer", "crew-chief:ui-designer"):
            out = run(home, proj, agent)
            check(f"{agent}: page overrides are listed with their keys and values", "Page overrides (a file or route that matches a key" in out and "index.html -> profile immersive, motion 8, perf budget: 60 fps" in out and "src/pages/menu/** -> profile calm, notes: plain menu" in out, out)
            check(f"{agent}: the default profile is still shown", "Profile: lively | motion 3" in out, out)
        json.dump({"profile": "immersive", "motion": 8},
                  open(os.path.join(proj, ".crew-chief", "ui-profile.json"), "w"))
        out = run(home, proj, "crew-chief:ui-implementer")
        check("immersive: the real-3D rule is in the context", "Profile rule: immersive means a real 3D scene" in out and "Three.js/WebGL" in out and "CSS or SVG imitation is not acceptable" in out and "say so explicitly" in out, out)
        json.dump({"profile": "lively", "motion": 3, "perfBudget": "150-250 ms", "notes": "calm, dense", "refs": [".crew-chief/refs/a.png", ".crew-chief/refs/b.png"]},
                  open(os.path.join(proj, ".crew-chief", "ui-profile.json"), "w"))
        check("lively: no real-3D rule", "Profile rule:" not in run(home, proj, "crew-chief:ui-implementer"))

        json.dump({"profile": "performance-3d", "motion": 8, "refs": [], "pages": {"a.html": {"profile": "static-minimal"}}},
                  open(os.path.join(proj, ".crew-chief", "ui-profile.json"), "w"))
        out = run(home, proj, "crew-chief:ui-implementer")
        check("old id performance-3d resolves to immersive (id, skills, rule)", "Profile: immersive | motion 8" in out and "performance-3d" not in out and "Extra skills for this profile: crew-chief:animate, crew-chief:choreograph, crew-chief:web-3d-perf" in out and "Profile rule: immersive means a real 3D scene" in out, out)
        check("old id in a page override resolves to calm", "a.html -> profile calm" in out, out)
        json.dump({"profile": "clean-practical", "motion": 3, "refs": []}, open(os.path.join(proj, ".crew-chief", "ui-profile.json"), "w"))
        check("old id clean-practical shows as lively", "Profile: lively | motion 3" in run(home, proj, "crew-chief:ui-implementer"))
        json.dump({"profile": "lively", "motion": 3, "perfBudget": "150-250 ms", "notes": "calm, dense", "refs": [".crew-chief/refs/a.png", ".crew-chief/refs/b.png"]},
                  open(os.path.join(proj, ".crew-chief", "ui-profile.json"), "w"))

        sub = os.path.join(proj, "web", "app")
        os.makedirs(sub)
        subprocess.run(["git", "init", "-q", proj], check=True)
        check("profile found from a subfolder via the git root", "Profile: lively" in run(home, sub, "crew-chief:ui-implementer"))

        out = run(home, proj, "crew-chief:ui-designer")
        check("ui-designer keeps the progress rule and gets the UI context", out.startswith("crew-chief progress rule:") and "UI rules" in out and "Profile: lively" in out, out)
        check("ui-designer is told it writes a spec and no code, and what is preloaded", "write the design spec (.crew-chief/design/<slug>.md) and no code" in out and "Preloaded: crew-chief:frontend-design, crew-chief:ui-ux-pro-max, crew-chief:design-taste-frontend." in out and "thesvg" not in out.split("Preloaded:")[1].split("\n")[0], out)
        check("ui-designer gets the references, the ban list and the polish checklist", "- .crew-chief/refs/a.png" in out and "Banned default look" in out and "Polish checklist" in out, out)
        check("bare ui-designer type works too", "UI rules" in run(home, proj, "ui-designer"))
        for agent in ("crew-chief:ui-implementer", "crew-chief:ui-designer"):
            out = run(home, proj, agent)
            check(f"{agent}: every motion band is in the context, with the every-band rule", all(w in out for w in ("Motion bands", "0-1 = no motion: colour and opacity changes on hover and focus only", "2-3 = scroll reveal of the sections, hover and press feedback", "4-6 = everything in 2-3, plus a staggered hero entrance sequence, a micro-interaction on every interactive element, one ambient loop", "choreographed section transitions", "7-8 = everything in 4-6, plus scroll-linked scenes, parallax and page or view transitions", "9-10 = everything in 7-8, plus a continuous scene and 3D/WebGL effects", "prefers-reduced-motion fallback", "compositor properties (transform and opacity)", "must deliver that band's whole list")), out)
        out = run(home, proj, "crew-chief:ui-implementer")
        check("ui-implementer gets the mandatory visual self-check (screenshots, overflow at 390 and 360, band check, where to save, gitignore)", all(w in out for w in ("Visual self-check before you report done (mandatory)", "ui-shot.mjs", "real 390 px", "Out dir: .crew-chief/check", "scrollWidth > window.innerWidth", "390 and 360", "band's list", ".crew-chief/check/", "never in the project source", ".gitignore", "not verified")), out)
        out = run(home, proj, "crew-chief:ui-designer")
        check("ui-designer is not given the implementer's self-check", "Visual self-check" not in out, out)
        out = run(home, proj, "crew-chief:ui-scout")
        check("ui-scout does not get the motion bands or the self-check", "Motion bands" not in out and "Visual self-check" not in out, out)
        check("ui-scout keeps the progress rule and gets the profile", out.startswith("crew-chief progress rule:") and "UI reference scout rules" in out and "Profile: lively | motion 3" in out, out)
        check("ui-scout is told where it may write, no code, the same-browser rule and that pages are untrusted", "write only under .crew-chief/refs/" in out and "no code" in out and "same time as a ui-tester on the same browser" in out and "untrusted data" in out and "never instructions" in out, out)
        check("ui-scout is given this plugin's screenshot script with an absolute path", "Screenshots: run `node /" in out and "/scripts/ui-shot.mjs <url> <out dir> <slug>`" in out and "Out dir: the project's .crew-chief/refs folder" in out, out)
        check("ui-scout sees the references the project already has, not the Read-before-first-screen order", "References the project already has" in out and "- .crew-chief/refs/a.png" in out and "Open each reference image" not in out, out)
        check("ui-scout does not get the ban list, the polish checklist or the preloaded skills", "Banned default look" not in out and "Polish checklist" not in out and "Preloaded:" not in out, out)
        check("bare ui-scout type works too", "UI reference scout rules" in run(home, proj, "ui-scout"))
        check("ui-implementer is not told it is the designer", "write the design spec" not in run(home, proj, "crew-chief:ui-implementer"))

        os.makedirs(os.path.join(home, ".claude"))
        json.dump({"bannedDefaults": ["only this"], "profiles": {"lively": {"skills": ["crew-chief:interaction-design"]}}}, open(os.path.join(home, ".claude", "crew-chief-ui.json"), "w"))
        out = run(home, proj, "crew-chief:ui-implementer")
        check("user override replaces the ban list and a profile's skills", "only this" in out and "Inter" not in out and "Extra skills for this profile: crew-chief:interaction-design" in out, out)

        bindir = os.path.join(SCRATCH, "bin")
        os.makedirs(bindir)
        for tool in ("cat", "dirname"):
            os.symlink(shutil.which(tool), os.path.join(bindir, tool))
        r = subprocess.run(["/bin/sh", HOOK], input="{}", capture_output=True, text=True, env={"PATH": bindir, "HOME": home})
        check("no jq: no output, exit 0", r.returncode == 0 and r.stdout == "" and r.stderr == "", f"{r.returncode} {r.stdout!r} {r.stderr!r}")
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)
    print("FAIL" if failures else "OK", f"({len(failures)} failures)")
    sys.exit(1 if failures else 0)


main()
