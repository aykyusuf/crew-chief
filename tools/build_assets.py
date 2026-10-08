"""Generate skills/crew-setup/assets/ from the plugin's own files.

The setup skill must work when only the skills are installed (for example with
`npx skills add`), so it carries copies of the agents, the guard, and the policy.
This script keeps those copies in sync. Run it after editing agents/, scripts/,
or scripts/session-policy.sh:

    python3 tools/build_assets.py          # write assets
    python3 tools/build_assets.py --check  # fail if assets are stale (CI, tests)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "skills", "crew-setup", "assets")
# The guard is wired through .claude/settings.json, not agent frontmatter: frontmatter
# hooks of project agents are skipped until the folder's trust dialog is accepted,
# and never run in -p sessions.
SETTINGS_HOOK = {
    "hooks": {
        "PreToolUse": [
            {
                "matcher": "Bash",
                "hooks": [
                    {
                        "type": "command",
                        "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/crew-chief-guard.sh --project",
                    }
                ],
            }
        ]
    }
}


def project_agent(name, text):
    """Plugin agent file -> project agent file (same content today)."""
    return text


def claude_md_section():
    policy = subprocess.run(
        ["sh", os.path.join(ROOT, "scripts", "session-policy.sh")],
        capture_output=True, text=True, check=True,
        env={"PATH": os.environ["PATH"], "CLAUDE_PROJECT_DIR": tempfile.gettempdir()},
    ).stdout
    policy = re.sub(r"</?crew-chief-policy>\n?", "", policy)
    policy = policy.replace("crew-chief is installed. ", "")
    policy = policy.replace("crew-chief:", "")
    policy = policy.replace("load the crew-routing skill first.", "load the crew-routing skill first if it is installed.")
    policy = policy.replace("Tiers (agent type, default model/effort):", "Tiers (agents in .claude/agents, default model/effort):")
    return (
        "<!-- crew-chief:start (managed by /crew-chief:crew-setup; edit freely, re-running setup replaces this block) -->\n"
        "## Model and subagent routing\n\n"
        + policy.strip()
        + "\n<!-- crew-chief:end -->\n"
    )


def build(out_dir):
    agents_out = os.path.join(out_dir, "agents")
    hooks_out = os.path.join(out_dir, "hooks")
    os.makedirs(agents_out)
    os.makedirs(hooks_out)
    for fname in sorted(os.listdir(os.path.join(ROOT, "agents"))):
        if fname.endswith(".md"):
            with open(os.path.join(ROOT, "agents", fname)) as f:
                text = f.read()
            with open(os.path.join(agents_out, fname), "w") as f:
                f.write(project_agent(fname[:-3], text))
    shutil.copy2(os.path.join(ROOT, "scripts", "readonly-guard.sh"), os.path.join(hooks_out, "crew-chief-guard.sh"))
    shutil.copy2(os.path.join(ROOT, "scripts", "json-field.py"), os.path.join(hooks_out, "json-field.py"))
    with open(os.path.join(out_dir, "claude-md-section.md"), "w") as f:
        f.write(claude_md_section())
    with open(os.path.join(out_dir, "settings-hook.json"), "w") as f:
        f.write(json.dumps(SETTINGS_HOOK, indent=2) + "\n")


def tree(path):
    result = {}
    for base, _, files in os.walk(path):
        for name in files:
            full = os.path.join(base, name)
            with open(full, "rb") as f:
                result[os.path.relpath(full, path)] = f.read()
    return result


def main():
    generated = ["agents", "hooks", "claude-md-section.md", "settings-hook.json"]
    with tempfile.TemporaryDirectory() as tmp:
        build(tmp)
        if "--check" in sys.argv:
            current = {k: v for k, v in tree(ASSETS).items() if k.split(os.sep)[0] in generated}
            if current != tree(tmp):
                print("skills/crew-setup/assets is stale: run python3 tools/build_assets.py")
                sys.exit(1)
            print("assets up to date")
            return
        for name in generated:
            target = os.path.join(ASSETS, name)
            if os.path.isdir(target):
                shutil.rmtree(target)
            elif os.path.exists(target):
                os.remove(target)
            src = os.path.join(tmp, name)
            if os.path.isdir(src):
                shutil.copytree(src, target)
            else:
                shutil.copy2(src, target)
    print("assets written to skills/crew-setup/assets")


if __name__ == "__main__":
    main()
