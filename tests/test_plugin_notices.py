"""Tests for scripts/plugin-notices.sh (what's-new and stale-session notices, both on UserPromptSubmit).
Run: python3 tests/test_plugin_notices.py"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "plugin-notices.sh")
failures = []
count = 0
NOJQ = False
SHELL = "sh"

CHANGELOG = """# Changelog

## 1.2.0 (2026-10-09)
- First change.
- Second change with "quotes", a \\ backslash, and a tab\there.
- Third change — with a dash and ünïcode.
- Fourth change is cut off.

## 1.1.0 (2026-10-01)
- Old change.
"""


def check(name, ok, detail=""):
    global count
    count += 1
    if not ok:
        failures.append(f"[{SHELL}{' nojq' if NOJQ else ''}] {name}: {detail}")


def env_for(root, data, extra=None):
    if NOJQ:
        bindir = tempfile.mkdtemp(prefix="crew-chief-nojq-")
        for tool in ("sh", "dash", "cat", "grep", "sed", "tr", "head", "find", "mkdir", "rm", "awk", "cut", "iconv"):
            path = shutil.which(tool)
            if path:
                os.symlink(path, os.path.join(bindir, tool))
        env = {"PATH": bindir}
    else:
        env = {"PATH": os.environ["PATH"]}
    # Never run the real `claude --version` in tests; a recent version unless a test says otherwise.
    env["CREW_CHIEF_CLAUDE_VERSION"] = "2.1.295 (Claude Code)"
    if root is not None:
        env["CLAUDE_PLUGIN_ROOT"] = root
    if data is not None:
        env["CLAUDE_PLUGIN_DATA"] = data
    env.update(extra or {})
    return env


def run(action, payload, root, data, extra=None):
    # Claude Code writes hook input with JSON.stringify: non-ASCII characters arrive as they are,
    # not as \\uXXXX escapes (which the sed fallback could not decode).
    raw = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return subprocess.run([SHELL, SCRIPT, action], input=raw, capture_output=True, text=True, encoding="utf-8", env=env_for(root, data, extra))


def prompt(root, data, sid="s1", extra=None, text="hi"):
    r = run("prompt", {"hook_event_name": "UserPromptSubmit", "session_id": sid, "prompt": text}, root, data, extra)
    check("prompt hook exits 0", r.returncode == 0, r.stderr)
    return r.stdout


def start(root, data, extra=None, text="hi"):
    return prompt(root, data, extra=extra, text=text)


CHANGELOG_TR = """# Değişiklik günlüğü

## 1.2.0 (2026-10-09)
- İlk değişiklik.
- İkinci değişiklik: "tırnak", ters bölü \\ ve ünlü harfler çğıöşü.
- Üçüncü değişiklik.
- Dördüncü değişiklik kesilir.
"""


def make_root(base, version="1.2.0", changelog=CHANGELOG, changelog_tr=None, name="root"):
    root = os.path.join(base, name)
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(os.path.join(root, ".claude-plugin"))
    with open(os.path.join(root, ".claude-plugin", "plugin.json"), "w") as f:
        json.dump({"name": "x", "version": version}, f, indent=2)
    if changelog is not None:
        with open(os.path.join(root, "CHANGELOG.md"), "w") as f:
            f.write(changelog)
    if changelog_tr is not None:
        with open(os.path.join(root, "CHANGELOG.tr.md"), "w") as f:
            f.write(changelog_tr)
    return root


def set_seen(data, version):
    os.makedirs(data, exist_ok=True)
    with open(os.path.join(data, "last-seen-version"), "w") as f:
        f.write(version + "\n")


def suite():
    base = tempfile.mkdtemp(prefix="crew-chief-notices-")
    data = os.path.join(base, "data")
    try:
        root = make_root(base)
        out = start(root, data)
        check("first install is silent", out == "", out)
        check("first install records the version", open(os.path.join(data, "last-seen-version")).read().strip() == "1.2.0")
        check("same version stays silent", start(root, data) == "")

        # Language of the notices: CREW_CHIEF_LANG, then the prompt, then the locale, then English.
        tr_root = make_root(base, changelog_tr=CHANGELOG_TR, name="tr-root")
        tr_data = os.path.join(base, "trdata")
        set_seen(tr_data, "1.1.0")
        out = start(tr_root, tr_data, text="tamam yaz bakalım")
        msg = json.loads(out)["systemMessage"] if out else ""
        check("Turkish prompt: Turkish header and notes from CHANGELOG.tr.md",
              "crew-chief güncellendi: 1.1.0 -> 1.2.0" in msg and "İlk değişiklik" in msg and "First change" not in msg and "CHANGELOG.tr.md" in msg, msg)
        check("Turkish notes keep quotes, backslash and Turkish letters", '"tırnak"' in msg and "çğıöşü" in msg and "\\" in msg, msg)
        check("Turkish notes: three bullets, the fourth is cut", msg.count("• ") == 3 and "Dördüncü" not in msg, msg)
        set_seen(tr_data, "1.1.0")
        out = start(root, tr_data, text="tamam yaz bakalım")
        msg = json.loads(out)["systemMessage"] if out else ""
        check("Turkish prompt but no CHANGELOG.tr.md: English notes, Turkish header, honest footer",
              "crew-chief güncellendi" in msg and "First change" in msg and "(İngilizce)" in msg, msg)
        other_tr = make_root(base, changelog_tr="## 0.0.1\n- Eski.\n", name="other-tr-root")
        set_seen(tr_data, "1.1.0")
        out = start(other_tr, tr_data, text="bunu düzelt lütfen")
        msg = json.loads(out)["systemMessage"] if out else ""
        check("CHANGELOG.tr.md without this version: falls back to English notes", "First change" in msg and "Eski" not in msg and "(İngilizce)" in msg, msg)
        set_seen(tr_data, "1.1.0")
        out = start(tr_root, tr_data, text="please fix the failing test")
        check("English prompt: English", "crew-chief updated: 1.1.0 -> 1.2.0" in out and "First change" in out and "güncellendi" not in out, out)
        set_seen(tr_data, "1.1.0")
        out = start(tr_root, tr_data, text="hi", extra={"LANG": "tr_TR.UTF-8"})
        check("ambiguous prompt, Turkish locale: Turkish", "güncellendi" in out, out)
        set_seen(tr_data, "1.1.0")
        out = start(tr_root, tr_data, text="hi", extra={"LANG": "en_US.UTF-8"})
        check("ambiguous prompt, English locale: English", "crew-chief updated" in out, out)
        set_seen(tr_data, "1.1.0")
        out = start(tr_root, tr_data, text="/crew-chief:crew-mode solo", extra={"LANG": "en_US.UTF-8"})
        check("a slash command says nothing about the language", "crew-chief updated" in out, out)
        set_seen(tr_data, "1.1.0")
        out = start(tr_root, tr_data, text="tamam yaz bakalım", extra={"CREW_CHIEF_LANG": "en"})
        check("CREW_CHIEF_LANG=en beats a Turkish prompt", "crew-chief updated" in out, out)
        set_seen(tr_data, "1.1.0")
        out = start(tr_root, tr_data, text="please fix the failing test", extra={"CREW_CHIEF_LANG": "Turkish"})
        check("CREW_CHIEF_LANG=Turkish beats an English prompt", "güncellendi" in out, out)
        for sample in ("İyi günler", "İYİ GÜNLER", "ııı", "Şimdi göster", "çalıştır", "Lütfen bu hatayı düzelt: TypeError: cannot read property of undefined in the function that is called from the main file"):
            set_seen(tr_data, "1.1.0")
            check(f"Turkish text {sample[:30]!r}", "güncellendi" in start(tr_root, tr_data, text=sample), sample)
        # Not Turkish: other languages sharing short words, names, code, a fenced block.
        for sample in ("Je ne sais pas, ne touche pas", "Arregla mi código y ve si funciona", "ik ben klaar, ben je er?",
                       "Ping Ayşe about it", "Ask Barış to review the PR",
                       "const a = 1;\nfor (const x of y) { if (x) return }",
                       "Traceback (most recent call last):\n  File \"a.py\", line 3, in <module>\n    foo()\nNameError: name x is not defined"):
            set_seen(tr_data, "1.1.0")
            check(f"not Turkish: {sample[:30]!r}", "güncellendi" not in start(tr_root, tr_data, text=sample, extra={"LANG": "en_US.UTF-8"}), sample)
        # The hook inherits a UTF-8 locale in real life; the classifier pins itself to bytes.
        for locale in ("en_US.UTF-8", "tr_TR.UTF-8", "C"):
            set_seen(tr_data, "1.1.0")
            check(f"inherited LC_ALL={locale}: Turkish prompt still Turkish",
                  "güncellendi" in start(tr_root, tr_data, text="tamam yaz bakalım, çok iyi", extra={"LC_ALL": locale}), locale)
        set_seen(tr_data, "1.1.0")
        check("CREW_CHIEF_LANG=TÜRKÇE works like in the mod", "güncellendi" in start(tr_root, tr_data, text="hi", extra={"CREW_CHIEF_LANG": "TÜRKÇE"}))
        old_tr = os.path.join(base, "oldtr")
        out = start(root, old_tr, extra={"CREW_CHIEF_CLAUDE_VERSION": "2.1.286 (Claude Code)"}, text="bunu düzelt lütfen")
        check("old Claude Code warning in Turkish", "tasarruf modu Claude Code 2.1.287 veya üstünü ister (bu sürüm 2.1.286)" in out, out)
        stale_root = make_root(base, name="stale-root")
        open(os.path.join(stale_root, ".orphaned_at"), "w").close()
        out = prompt(stale_root, os.path.join(base, "staletr"), text="tamam yaz bakalım")
        check("stale notice in Turkish", "hâlâ eski kopyayı çalıştırıyor" in out and "/reload-plugins" in out, out)
        out = prompt(stale_root, os.path.join(base, "staleen"), text="please fix the failing test")
        check("stale notice in English", "still runs the old copy" in out, out)

        # Claude Code older than the first version with mods: one warning per plugin version,
        # also on a fresh install, folded into the what's-new notice on an upgrade.
        old = os.path.join(base, "old")
        old_env = {"CREW_CHIEF_CLAUDE_VERSION": "2.1.286 (Claude Code)"}
        out = start(root, old, extra=old_env)
        check("old Claude Code: warned on a fresh install", "needs Claude Code 2.1.287" in out and "this is 2.1.286" in out and "updated" not in out, out)
        check("... only once per plugin version", start(root, old, extra=old_env) == "")
        set_seen(old, "1.1.0")
        open(os.path.join(old, "claude-version-checked"), "w").write("1.1.0\n")
        out = start(root, old, extra=old_env)
        check("old Claude Code on an upgrade: one message, both parts", "1.1.0 -> 1.2.0" in out and "needs Claude Code 2.1.287" in out and out.count("systemMessage") == 1, out)
        for version in ("2.1.287", "2.1.295 (Claude Code)", "3.0.0", "10.0.0", "garbage"):
            fresh_old = os.path.join(base, "chk" + str(abs(hash(version))))
            check(f"Claude Code {version!r}: no warning", start(root, fresh_old, extra={"CREW_CHIEF_CLAUDE_VERSION": version}) == "")
        check("off switch also silences the version warning", start(root, os.path.join(base, "offwarn"), extra={**old_env, "CREW_CHIEF_WHATS_NEW": "off"}) == "")

        # Upgrade from a version that predates last-seen-version: the data directory already
        # holds the handoff answers, so the notice appears without an old version number.
        legacy = os.path.join(base, "legacy")
        os.makedirs(legacy)
        open(os.path.join(legacy, "handoff-offers.tsv"), "w").write("/p\tlater\t1\n")
        out = start(root, legacy)
        check("upgrade from a pre-notice version is announced", "updated to 1.2.0" in out and "->" not in out and "First change" in out, out)
        check("... and only once", start(root, legacy) == "")
        empty = os.path.join(base, "empty")
        os.makedirs(empty)
        check("an empty data directory is a fresh install", start(root, empty) == "")

        set_seen(data, "1.1.0")
        out = start(root, data)
        try:
            parsed = json.loads(out)
        except ValueError as e:
            parsed = {}
            check("update notice is valid JSON", False, f"{e}: {out!r}")
        msg = parsed.get("systemMessage", "")
        check("notice names old and new version", "1.1.0 -> 1.2.0" in msg, msg)
        check("notice lists the first three changes only", "First change" in msg and "Third change" in msg and "Fourth" not in msg and "Old change" not in msg, msg)
        check("quotes, backslash, unicode survive", '"quotes"' in msg and "\\ backslash" in msg and "ünïcode" in msg, msg)
        check("notice uses bullets", msg.count("• ") == 3, msg)
        check("notice is a plain systemMessage (the model is not told anything)", sorted(parsed) == ["systemMessage"], str(sorted(parsed)))
        check("state moves to the new version", open(os.path.join(data, "last-seen-version")).read().strip() == "1.2.0")
        check("second start is silent", start(root, data) == "")

        set_seen(data, "1.1.0")
        check("silent when switched off", start(root, data, extra={"CREW_CHIEF_WHATS_NEW": "off"}) == "")
        check("off leaves the state alone", open(os.path.join(data, "last-seen-version")).read().strip() == "1.1.0")
        check("silent without CLAUDE_PLUGIN_DATA", start(root, None) == "")
        check("silent without CLAUDE_PLUGIN_ROOT", start(None, data) == "")
        r = run("prompt", "", root, data)
        check("empty hook input does not crash", r.returncode == 0 and r.stderr == "", r.stderr)
        check("unknown action is a no-op", run("bogus", {"session_id": "s1"}, root, data).stdout == "")

        long_root = make_root(base, changelog="## 1.2.0\n- " + "é" * 400 + "\n")
        set_seen(data, "1.1.0")
        out = start(long_root, data)
        try:
            check("long multi-byte line still yields valid JSON and is marked as cut", "…" in json.loads(out)["systemMessage"])
        except ValueError as e:
            check("long multi-byte line still yields valid JSON", False, f"{e}")

        bare = make_root(base, changelog=None)
        set_seen(data, "1.1.0")
        out = start(bare, data)
        check("missing CHANGELOG still announces the version", "1.1.0 -> 1.2.0" in out and "•" not in out, out)
        other = make_root(base, changelog="## 9.9.9\n- Elsewhere.\n")
        set_seen(data, "1.1.0")
        out = start(other, data)
        check("no section for this version: announces without notes", "1.1.0 -> 1.2.0" in out and "Elsewhere" not in out, out)
        nover = make_root(base)
        with open(os.path.join(nover, ".claude-plugin", "plugin.json"), "w") as f:
            f.write("{}")
        set_seen(data, "1.1.0")
        check("manifest without a version is silent", start(nover, data) == "")

        # The real plugin: its own CHANGELOG must have a section for its own version.
        manifest = json.load(open(os.path.join(ROOT, ".claude-plugin", "plugin.json")))
        version = manifest["version"]
        check("CHANGELOG has a section for the current version",
              re.search(r"^## " + re.escape(version) + r"( |$)", open(os.path.join(ROOT, "CHANGELOG.md")).read(), re.M) is not None, version)
        check("CHANGELOG.tr.md has a section for the current version",
              re.search(r"^## " + re.escape(version) + r"( |$)", open(os.path.join(ROOT, "CHANGELOG.tr.md")).read(), re.M) is not None, version)
        set_seen(data, "0.0.1")
        out = start(ROOT, data)
        try:
            real = json.loads(out)["systemMessage"]
            check("real notice shows the current version and at least one bullet", f"0.0.1 -> {version}" in real and "• " in real, real)
        except (ValueError, KeyError) as e:
            check("real notice is valid JSON", False, f"{e}: {out!r}")

        # Stale-session notice.
        fresh_data = os.path.join(base, "data2")
        live = make_root(base)
        check("no stale notice for a current copy", prompt(live, fresh_data) == "")
        open(os.path.join(live, ".orphaned_at"), "w").close()
        out = prompt(live, fresh_data)
        check("stale notice for a replaced copy", "/reload-plugins" in json.loads(out)["systemMessage"] if out else False, out)
        check("stale notice once per session", prompt(live, fresh_data) == "")
        check("stale notice again in another session", prompt(live, fresh_data, sid="s2") != "")
        check("odd session id is ignored", prompt(live, fresh_data, sid="../x") == "")
        check("stale silent without CLAUDE_PLUGIN_DATA", prompt(live, None) == "")
        check("stale silent without CLAUDE_PLUGIN_ROOT", prompt(None, fresh_data) == "")
        check("state stays inside the data directory", sorted(os.listdir(fresh_data)) == ["claude-version-checked", "last-seen-version", "stale-notified"], str(os.listdir(fresh_data)))

        # A session on a replaced copy must not announce an older version or touch the record.
        set_seen(fresh_data, "9.9.9")
        out = prompt(live, fresh_data, sid="s9")
        check("stale session: only the stale notice", "/reload-plugins" in out and "updated:" not in out and "->" not in out, out)
        check("stale session leaves last-seen-version alone", open(os.path.join(fresh_data, "last-seen-version")).read().strip() == "9.9.9")
        old = os.path.join(fresh_data, "stale-notified", "s1")
        os.utime(old, (1, 1))
        prompt(live, fresh_data, sid="s3")
        check("stale markers older than two weeks are pruned", not os.path.exists(old))
    finally:
        shutil.rmtree(base, ignore_errors=True)


def main():
    global NOJQ, SHELL
    for SHELL in ["sh"] + (["dash"] if shutil.which("dash") else []):
        NOJQ = False
        suite()
        if shutil.which("jq"):
            NOJQ = True
            suite()
    if failures:
        print("\n".join("FAIL " + f for f in failures))
        sys.exit(1)
    print(f"OK {count} checks")


if __name__ == "__main__":
    main()
