"""Tests for scripts/skill-hint.sh (skill reminder on matching prompts). Run: python3 tests/test_skill_hint.py (needs jq)."""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "scripts", "skill-hint.sh")
SCRATCH = os.path.join(ROOT, ".test-tmp", "skill-hint")
failures = []

if not shutil.which("jq"):
    print("skip: jq not installed")
    sys.exit(0)


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f": {detail}"))
    if not ok:
        failures.append(name)


def world(name, skills=(), plugin_skills=(), trash_skills=()):
    """A scratch HOME with user skills, one installed plugin with skills, and a trashed plugin."""
    home = os.path.join(SCRATCH, name, "home")
    data = os.path.join(SCRATCH, name, "data")
    os.makedirs(data)
    for s in skills:
        os.makedirs(os.path.join(home, ".claude", "skills", s))
        open(os.path.join(home, ".claude", "skills", s, "SKILL.md"), "w").write("---\nname: x\n---\n")
    plugins = {}
    if plugin_skills:
        base = os.path.join(home, ".claude", "plugins", "cache", "m", "p", "1.0.0")
        for s in plugin_skills:
            os.makedirs(os.path.join(base, "skills", s))
            open(os.path.join(base, "skills", s, "SKILL.md"), "w").write("x")
        plugins = {"p@m": [{"installPath": base, "scope": "user"}]}
    for s in trash_skills:
        d = os.path.join(home, ".claude", "plugins", ".trash", "old", "skills", s)
        os.makedirs(d)
        open(os.path.join(d, "SKILL.md"), "w").write("x")
    os.makedirs(os.path.join(home, ".claude", "plugins"), exist_ok=True)
    json.dump({"version": 2, "plugins": plugins}, open(os.path.join(home, ".claude", "plugins", "installed_plugins.json"), "w"))
    return home, data


def run(home, data, prompt, session="s1", env_extra=None, raw=None, cwd=None):
    env = {"PATH": os.environ["PATH"], "HOME": home, "CLAUDE_PLUGIN_ROOT": ROOT, "CLAUDE_PLUGIN_DATA": data, "GIT_CEILING_DIRECTORIES": SCRATCH}
    env.update(env_extra or {})
    payload = raw if raw is not None else json.dumps({"prompt": prompt, "session_id": session, "cwd": cwd or home})
    r = subprocess.run(["sh", HOOK], input=payload, capture_output=True, text=True, env=env)
    if r.returncode != 0 or r.stderr:
        check("exit 0, no stderr", False, f"rc={r.returncode} {r.stderr!r}")
    return r.stdout


def hint(out):
    if not out.strip():
        return ""
    j = json.loads(out)
    assert j["hookSpecificOutput"]["hookEventName"] == "UserPromptSubmit", j
    return j["hookSpecificOutput"]["additionalContext"]


def main():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    os.makedirs(SCRATCH)
    try:
        h, d = world("basic", skills=["flutter", "frontend-design"])
        out = hint(run(h, d, "bu flutter ekranına bloc ekle"))
        check("keyword with an installed skill gives a hint", "load the flutter skill" in out and out.startswith("<crew-chief-skill-hint>"), out)
        check("hint is valid hook JSON with a tag", out.endswith("</crew-chief-skill-hint>"), out)
        check("same category once per session", run(h, d, "flutter again") == "")
        check("a new session hints again", "load the flutter skill" in hint(run(h, d, "flutter again", session="s2")))
        check("no keyword, no hint", run(h, d, "what is the weather") == "")
        check("slash command is skipped", run(h, d, "/flutter now", session="s3") == "")
        check("empty prompt is skipped", run(h, d, "", session="s3") == "")
        check("Turkish keyword matches", "frontend-design" in hint(run(h, d, "yeni bir arayüz tasarla", session="s4")))
        check("prefix of a longer word matches", "flutter" in hint(run(h, d, "Flutter'da widgetlar", session="s5")))
        check("keyword inside another word does not match", run(h, d, "the curls and rlsx", session="s6") == "")
        check("bloc does not match blocked", run(h, d, "why is this blocked", session="s6b") == "")
        check("react does not match reaction", run(h, d, "what a reaction", session="s6c") == "")
        check("whole word with an apostrophe suffix matches", "flutter" in hint(run(h, d, "Flutter'da bir sayfa", session="s6d")))
        check("stem keyword matches Turkish suffixes", "frontend-design" in hint(run(h, d, "yeni arayüzü tasarlayalım", session="s6e")))
        check("ASCII-typed Turkish (dotted i for dotless) matches", "frontend-design" in hint(run(h, d, "tasarimi yenile", session="s6g")))
        check("capital Turkish letters match", "frontend-design" in hint(run(h, d, "ARAYÜZ İYİLEŞTİR", session="s6f")))

        h, d = world("prefer", skills=["flutter-ui", "flutter"])
        check("first installed skill in the prefer list wins", "load the flutter skill" in hint(run(h, d, "flutter")))
        h, d = world("later", skills=["flutter-ui"])
        check("a later prefer entry is used when the first is missing", "load the flutter-ui skill" in hint(run(h, d, "flutter")))
        h, d = world("none", skills=["unrelated"])
        check("no preferred skill installed, no hint", run(h, d, "flutter bloc") == "")

        h, d = world("plugin", plugin_skills=["swiftui-pro"], trash_skills=["fastapi"])
        check("skill from an installed plugin counts", "swiftui-pro" in hint(run(h, d, "swiftui view")))
        check("skill in the plugin trash does not count", run(h, d, "fastapi route") == "")
        h, d = world("disabled", plugin_skills=["swiftui-pro"])
        json.dump({"enabledPlugins": {"p@m": False}}, open(os.path.join(h, ".claude", "settings.json"), "w"))
        check("skill of a disabled plugin does not count", run(h, d, "swiftui view") == "")
        json.dump({"enabledPlugins": {"p@m": True}}, open(os.path.join(h, ".claude", "settings.json"), "w"))
        check("skill of an enabled plugin counts", "swiftui-pro" in hint(run(h, d, "swiftui view")))

        h, d = world("two", skills=["flutter", "frontend-design", "swiftui-pro", "supabase"])
        out = hint(run(h, d, "flutter app with supabase and a new dashboard and swiftui"))
        check("at most two hints", out.count("work: load the") == 2, out)

        h, d = world("user", skills=["flutter", "my-skill"])
        json.dump({"categories": [
            {"id": "kuyum", "label": "jewelry", "keywords": ["kuyumcu"], "prefer": ["my-skill"]},
            {"id": "flutter", "disabled": True}]},
            open(os.path.join(h, ".claude", "crew-chief-skills.json"), "w"))
        check("user category is added", "load the my-skill skill" in hint(run(h, d, "kuyumcu raporu")))
        check("user can disable a shipped category", run(h, d, "flutter bloc", session="s7") == "")
        json.dump({"categories": [{"id": "all", "label": "everything", "keywords": ["*", ""], "prefer": ["my-skill"]}]},
                  open(os.path.join(h, ".claude", "crew-chief-skills.json"), "w"))
        check("a keyword that is only a star or empty matches nothing", run(h, d, "what is the weather", session="s7b") == "")
        open(os.path.join(h, ".claude", "crew-chief-skills.json"), "w").write("{not json")
        check("broken user file falls back to the shipped catalog", "load the flutter skill" in hint(run(h, d, "flutter", session="s8")))

        # The brief offer: a plugin skill that needs no install, once per project, never where a brief exists.
        h, d = world("kickoff")
        proj = os.path.join(SCRATCH, "kickoff", "proj")
        os.makedirs(proj)
        out = hint(run(h, d, "Yeni proje başlatalım, bir takip uygulaması", session="k1", cwd=proj))
        check("TR new-project prompt offers the brief", "/crew-chief:crew-brief" in out and "ONE short line" in out, out)
        check("the offer is not a load-the-skill hint", "load the" not in out, out)
        check("not offered twice for the same project, even in a new session", run(h, d, "new project: a blog", session="k2", cwd=proj) == "")
        proj2 = os.path.join(SCRATCH, "kickoff", "proj2")
        os.makedirs(proj2)
        out = hint(run(h, d, "let's add a new feature to the cart", session="k3", cwd=proj2))
        check("EN new-feature prompt in another project offers the brief", "/crew-chief:crew-brief" in out, out)
        proj3 = os.path.join(SCRATCH, "kickoff", "proj3")
        os.makedirs(proj3)
        open(os.path.join(proj3, "BRIEF.md"), "w").write("# Brief\n")
        check("not offered when BRIEF.md exists", run(h, d, "new project time", session="k4", cwd=proj3) == "")
        proj4 = os.path.join(SCRATCH, "kickoff", "proj4")
        os.makedirs(os.path.join(proj4, "docs", "briefs"))
        check("not offered when docs/briefs exists", run(h, d, "yeni özellik ekleyelim", session="k5", cwd=proj4) == "")
        proj5 = os.path.join(SCRATCH, "kickoff", "proj5")
        os.makedirs(proj5)
        check("feature ekle* matches", "crew-brief" in hint(run(h, d, "sepete feature ekle", session="k6", cwd=proj5)))
        check("not offered in the home directory", run(h, d, "new project", session="k7") == "")
        check("no offer without a data folder (cannot be once per project)", "crew-brief" not in subprocess.run(
            ["sh", HOOK], input=json.dumps({"prompt": "new project", "session_id": "k8", "cwd": proj5}), capture_output=True, text=True,
            env={"PATH": os.environ["PATH"], "HOME": h, "CLAUDE_PLUGIN_ROOT": ROOT}).stdout)

        # UI policy text (data/ui-policy.json): no skill needs to be installed, the plugin's own skills are always there.
        h, d = world("ui", skills=["unrelated"])
        proj_ui = os.path.join(h, "proj-ui")
        os.makedirs(proj_ui)
        out = hint(run(h, d, "bana bir landing page tasarla", session="u1", cwd=proj_ui))
        check("UI prompt: STOP first line, before any file is read or written", out.split("\n")[1].startswith("UI task. STOP before reading or writing project files: ask ONE AskUserQuestion"), out)
        check("UI prompt: routes all UI code to crew-chief:ui-implementer, ui-designer first for a big job", "hand ALL UI code" in out.replace("Then hand", "hand") and "crew-chief:ui-implementer" in out and "crew-chief:ui-designer first for 3+ screens, a new site or a redesign" in out and "never write UI files yourself" in out, out)
        check("UI prompt: no escape hatch to write UI code yourself", "write UI code yourself" not in out and "If you write UI" not in out, out)
        check("UI prompt: profile step (no profile yet) writes the profile file", ".crew-chief/ui-profile.json" in out and "AskUserQuestion" in out and "motion 0-10" in out, out)
        check("UI prompt: the reference question has the three choices in both languages", all(w in out for w in ("\"I'll send one\" / \"Ben göndereyim\"", "\"Find some (ui-scout)\" / \"Sen bul (ui-scout)\"", "\"None\" / \"Yok\"")), out)
        check("UI prompt: find = brief crew-chief:ui-scout, then one AskUserQuestion with the candidates, #1 when no answer, picks into refs[]", all(w in out for w in ("brief crew-chief:ui-scout sonnet/medium", "one AskUserQuestion", "its #1 if the user does not answer", "picks go to refs[]")), out)
        check("UI prompt: the brief contents are listed (profile and motion band, extra skills, reference paths)", "The brief names: the effective profile and motion band" in out and "crew-chief:design-taste-frontend" in out and "reference paths" in out, out)
        check("UI prompt: base skills are in the brief's skill list", "crew-chief:frontend-design, crew-chief:ui-ux-pro-max" in out, out)
        check("UI prompt: the compact model line (rules, model/effort) and the never list", all(w in out for w in ("Pass `model` and `effort` on every UI Agent call", "small fix sonnet/medium", "with a reference or DESIGN.md sonnet/high", "clear direction opus/medium", "new landing, redesign or hero opus/high", "immersive scene opus/high", "sonnet at xhigh or max", "effort above high", "a Fable model unless the user asked for Fable")), out)
        check("UI prompt: asking the profile is neutral (no recommended marker)", "no recommended marker" in out and "too heavy" not in out, out)
        check("UI prompt: the long details stay out of the main session (they go to the agents)", not any(w in out for w in ("Banned default look", "Polish checklist", "Motion bands", "Visual self-check", "Never run ui-scout")), out)
        check("UI prompt: the profile question uses the labels in both languages", all(w in out for w in ("Calm: almost no motion, fast and crisp", "Sakin: neredeyse hareketsiz, hızlı ve net", "Lively: measured animation, smooth transitions", "Canlı: ölçülü animasyon, akıcı geçişler", "Immersive 3D: a real WebGL scene within a performance budget", "Sürükleyici 3D: gerçek WebGL sahne, performans bütçeli")) and "in the user's language" in out, out)
        check("UI prompt: short enough", len(out) <= 2200, str(len(out)))
        check("UI prompt: once per session", run(h, d, "yeni arayüz tasarla", session="u1", cwd=proj_ui) == "")
        check("UI prompt: no skill-specific one-line hint beside it", "work: load the" not in out, out)
        for i, text in enumerate(("make the navbar sticky", "buton rengini değiştir", "add a modal to the cart", "tailwind classes for the card", "the ui is too busy", "fix the css")):
            check(f"UI keyword: {text}", "crew-chief:ui-implementer" in hint(run(h, d, text, session=f"uk{i}", cwd=proj_ui)))
        live = "kahve dükkanı için tek sayfalık bir landing sayfası yap, index.html olarak"
        out = hint(run(h, d, live, session="ul1", cwd=proj_ui))
        check("the live-test prompt (Turkish, landing sayfası yap, index.html) gets the UI rules", "crew-chief:ui-implementer" in out and "STOP before reading or writing project files" in out and "Write the answers to" in out, out)
        for i, text in enumerate(("bana bir web sitesi yap", "ana sayfayı yenile", "giriş sayfası hazırla", "login ekranı yap", "Build a website for the bakery",
                                  "create the homepage", "make a home page for it", "tasarım yap", "sayfası yap", "bu ekranı yap", "landing sayfasına bölüm ekle", "export it as html",
                                  "ANA SAYFA YAP", "Landing page ekle", "site yapalım")):
            check(f"widened UI keyword: {text}", "crew-chief:ui-implementer" in hint(run(h, d, text, session=f"uw{i}", cwd=proj_ui)))
        for i, text in enumerate(("write index.html", "add Settings.vue", "edit src/App.tsx", "fix styles/app.scss", "port Cart.svelte", "update lib/cart_screen.dart widget")):
            check(f"UI file name in the prompt: {text}", "crew-chief:ui-implementer" in hint(run(h, d, text, session=f"uf{i}", cwd=proj_ui)))
        for i, text in enumerate(("backend API endpoint yaz", "veritabanı şemasını düzelt", "write a python script to rename files", "add a migration for the orders table",
                                  "fix lib/model.dart", "the site is down, check the server logs")):
            check(f"widened detection, negative: {text}", run(h, d, text, session=f"un{i}", cwd=proj_ui) == "", text)
        check("non-UI prompt gets no UI text", run(h, d, "add a retry to the api client and run the tests", session="u2", cwd=proj_ui) == "")
        check("a UI word inside another word does not match", run(h, d, "the guild quits and the curl failed", session="u3", cwd=proj_ui) == "")

        os.makedirs(os.path.join(proj_ui, ".crew-chief"))
        json.dump({"profile": "immersive", "motion": 8, "perfBudget": "60 fps", "notes": "dark, neon", "refs": [".crew-chief/refs/a.png"]},
                  open(os.path.join(proj_ui, ".crew-chief", "ui-profile.json"), "w"))
        out = hint(run(h, d, "redesign the pricing page", session="u4", cwd=proj_ui))
        check("with a profile file: its values are shown, no ask", "Profile: immersive | motion 8 | perf budget: 60 fps" in out and "Notes: dark, neon" in out, out)
        check("with a profile file: its extra skills", "Extra skills for this profile: crew-chief:animate, crew-chief:choreograph, crew-chief:web-3d-perf" in out, out)
        check("with a profile file: no profile question, the file is used", "ask ONE AskUserQuestion" not in out and "so use it" in out, out)
        check("with a profile file: the recorded reference is shown", ".crew-chief/refs/a.png" in out, out)
        json.dump({"profile": "static-minimal", "motion": 0}, open(os.path.join(proj_ui, ".crew-chief", "ui-profile.json"), "w"))
        out = hint(run(h, d, "redesign the pricing page", session="u4b", cwd=proj_ui))
        check("old id static-minimal in the profile file shows as calm", "Profile: calm | motion 0" in out and "static-minimal" not in out and "Extra skills for this profile: crew-chief:remove-animations" in out, out)
        json.dump({"profile": "immersive", "motion": 8, "perfBudget": "60 fps", "notes": "dark, neon", "refs": [".crew-chief/refs/a.png"]},
                  open(os.path.join(proj_ui, ".crew-chief", "ui-profile.json"), "w"))

        h2, d2 = world("ui-deps", skills=[])
        proj_deps = os.path.join(h2, "proj")
        os.makedirs(proj_deps)

        os.makedirs(os.path.join(h2, ".claude"), exist_ok=True)
        json.dump({"base": ["crew-chief:frontend-design"], "profiles": {"mine": {"skills": ["crew-chief:remove-animations"]}}}, open(os.path.join(h2, ".claude", "crew-chief-ui.json"), "w"))
        out = hint(run(h2, d2, "build a dashboard", session="u6", cwd=proj_deps))
        check("~/.claude/crew-chief-ui.json is merged (own profile, own base list)", "mine = \"mine\" / \"mine\"" in out and "immersive = " in out and "ui-ux-pro-max" not in out, out)
        json.dump({"models": {"rules": {"small-fix": {"model": "haiku", "effort": "low"}}, "never": ["anything at all"]}}, open(os.path.join(h2, ".claude", "crew-chief-ui.json"), "w"))
        out = hint(run(h2, d2, "build a dashboard", session="u6b", cwd=proj_deps))
        check("~/.claude/crew-chief-ui.json changes one model rule key by key, the other rules stay", "small fix haiku/low" in out and "with a reference or DESIGN.md sonnet/high" in out and "Never: anything at all." in out, out)

        h3, d3 = world("ui-off", skills=[])
        json.dump({"categories": [{"id": "ui-build", "disabled": True}]}, open(os.path.join(h3, ".claude", "crew-chief-skills.json"), "w"))
        check("a user catalog can disable the UI category", run(h3, d3, "build a dashboard", session="u7") == "")

        h, d = world("off", skills=["flutter"])
        check("CREW_CHIEF_SKILL_HINTS=off", run(h, d, "flutter", env_extra={"CREW_CHIEF_SKILL_HINTS": "off"}) == "")
        check("garbage input is harmless", run(h, d, "", raw="not json") == "")
        check("bad session id writes no marker", "flutter" in hint(run(h, d, "flutter", session="../x")) and not os.path.exists(os.path.join(d, "skill-hints", "..", "x")))
        r = subprocess.run(["sh", HOOK], input=json.dumps({"prompt": "flutter", "session_id": "s9", "cwd": h}), capture_output=True,
                           text=True, env={"PATH": os.environ["PATH"], "HOME": h, "CLAUDE_PLUGIN_ROOT": ROOT})
        check("works without a data dir (no once-per-session memory)", "flutter" in hint(r.stdout) and r.returncode == 0)
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)
    print("FAIL" if failures else "OK", f"({len(failures)} failures)")
    sys.exit(1 if failures else 0)


main()
