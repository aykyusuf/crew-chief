"""Tests for the vendored third-party skills under skills/. Run: python3 tests/test_vendored_skills.py (offline).

Every vendored skill dir must have a SKILL.md with name and description frontmatter, be listed in
skills/VENDORED.lock.json (with a pinned 40-hex commit and a hash that still matches the folder) and
in THIRD_PARTY_NOTICES.md. Any other skills/ dir must be crew-chief's own (crew-*).
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS = os.path.join(ROOT, "skills")
LOCK = os.path.join(SKILLS, "VENDORED.lock.json")
NOTICES = os.path.join(ROOT, "THIRD_PARTY_NOTICES.md")
failures = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f": {detail}"))
    if not ok:
        failures.append(name)


def frontmatter(path):
    """Top-level keys of the leading --- block, mapped to their text (block scalars joined)."""
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    if not lines or lines[0].strip() != "---":
        return None
    out, key = {}, None
    for line in lines[1:]:
        if line.strip() == "---":
            return out
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if m and not line.startswith(" "):
            key = m.group(1)
            out[key] = m.group(2).strip().strip("|>").strip()
        elif key and line.startswith(" "):
            out[key] = (out[key] + " " + line.strip()).strip()
    return None


spec = importlib.util.spec_from_file_location("vendor_skills", os.path.join(ROOT, "tools", "vendor_skills.py"))
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

lock = json.load(open(LOCK, encoding="utf-8"))
notices = open(NOTICES, encoding="utf-8").read()
dirs = sorted(d for d in os.listdir(SKILLS) if os.path.isdir(os.path.join(SKILLS, d)))

check("lock lists at least one skill", len(lock) > 0)
# crew-chief's own skills: crew-* and the ones written from scratch here (not vendored, no lock entry).
OWN = {"web-3d-perf"}
check("every skills/ dir is vendored (in the lock) or crew-chief's own (crew-* or written from scratch)",
      all(d in lock or d.startswith("crew-") or d in OWN for d in dirs),
      str([d for d in dirs if d not in lock and not d.startswith("crew-") and d not in OWN]))
check("a skill written from scratch is not in the lock", not [n for n in OWN if n in lock])
check("every lock entry has a dir", all(n in dirs for n in lock), str([n for n in lock if n not in dirs]))
check("no lock entry shadows a crew-chief skill", not [n for n in lock if n.startswith("crew-")])

for name, e in sorted(lock.items()):
    folder = os.path.join(SKILLS, name)
    skill = os.path.join(folder, "SKILL.md")
    check(f"{name}: has SKILL.md", os.path.isfile(skill))
    fm = frontmatter(skill) if os.path.isfile(skill) else None
    check(f"{name}: frontmatter has name and description", bool(fm) and bool(fm.get("name")) and bool(fm.get("description")), str(fm)[:120])
    check(f"{name}: frontmatter name equals the dir name", bool(fm) and fm.get("name") == name, str(fm and fm.get("name")))
    required = ("repo", "path", "commit", "license", "fetched", "modified", "sha256")
    check(f"{name}: lock entry has {', '.join(required)}", all(k in e for k in required), str(sorted(e)))
    sources = [e] + e.get("also", [])
    check(f"{name}: pinned commits are full 40-hex shas", all(re.match(r"^[0-9a-f]{40}$", s.get("commit", "")) for s in sources))
    check(f"{name}: modified is a bool", isinstance(e.get("modified"), bool))
    check(f"{name}: listed in THIRD_PARTY_NOTICES.md with its commit",
          f"`{name}`" in notices and all(s["commit"] in notices for s in sources))
    check(f"{name}: folder hash matches the lock", os.path.isdir(folder) and tool.tree_hash(folder) == e.get("sha256"),
          "edited by hand? see tools/vendor_skills.py --check --offline")
    links = [r for r in tool.list_files(folder) if os.path.islink(os.path.join(folder, r))] if os.path.isdir(folder) else []
    check(f"{name}: no symlinks", not links, str(links))

check("notices carry the MIT and Apache texts", "Permission is hereby granted, free of charge" in notices and "Apache License" in notices)
fd = lock.get("frontend-design", {})
check("frontend-design: LICENSE.txt present", os.path.isfile(os.path.join(SKILLS, "frontend-design", "LICENSE.txt")))
fd_text = open(os.path.join(SKILLS, "frontend-design", "SKILL.md"), encoding="utf-8").read()
fd_front, _, fd_body = fd_text[4:].partition("\n---\n")
check("frontend-design: 'Modified by crew-chief' note right after the frontmatter",
      fd_text.startswith("---\n") and fd_body.lstrip().startswith("> **Modified by crew-chief**"))
check("frontend-design: fork's od:/triggers: frontmatter dropped",
      not re.search(r"^(od|triggers):", fd_front, re.M))
check("frontend-design: modified and recorded as hand-merged", fd.get("modified") is True and fd.get("update") == "manual")

# ui-ux-pro-max: every script path SKILL.md tells the agent to run must exist in this plugin, and one must run.
uu = open(os.path.join(SKILLS, "ui-ux-pro-max", "SKILL.md"), encoding="utf-8").read()
paths = set(re.findall(r"\$\{CLAUDE_PLUGIN_ROOT\}/(\S+?\.py)", uu))
check("ui-ux-pro-max: SKILL.md script paths exist under the plugin root",
      bool(paths) and all(os.path.isfile(os.path.join(ROOT, p)) for p in paths), str(sorted(paths)))
scratch = tempfile.mkdtemp(prefix="vendored-skills-test-")
try:
    r = subprocess.run([sys.executable, "-I", "-B", os.path.join(SKILLS, "ui-ux-pro-max", "scripts", "search.py"), "keyboard focus", "--domain", "ux"],
                       cwd=scratch, capture_output=True, text=True, timeout=60)
    check("ui-ux-pro-max: search.py runs from another cwd", r.returncode == 0 and "UI Pro Max" in r.stdout, (r.stdout + r.stderr)[-200:])
    check("ui-ux-pro-max: search.py wrote nothing into the cwd", os.listdir(scratch) == [], str(os.listdir(scratch)))
finally:
    shutil.rmtree(scratch, ignore_errors=True)

if shutil.which("node"):
    cjs = [f for f in tool.list_files(os.path.join(SKILLS, "security-audit")) if f.endswith(".cjs")]
    bad = [f for f in cjs if subprocess.run(["node", "--check", os.path.join(SKILLS, "security-audit", f)], capture_output=True).returncode != 0]
    check("security-audit: .cjs validators parse", bool(cjs) and not bad, str(bad))

print(f"\n{len(failures)} failed" if failures else "\nall passed")
sys.exit(1 if failures else 0)
