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


def run(home, data, prompt, session="s1", env_extra=None, raw=None):
    env = {"PATH": os.environ["PATH"], "HOME": home, "CLAUDE_PLUGIN_ROOT": ROOT, "CLAUDE_PLUGIN_DATA": data}
    env.update(env_extra or {})
    payload = raw if raw is not None else json.dumps({"prompt": prompt, "session_id": session, "cwd": home})
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
