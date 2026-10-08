---
name: crew-setup
description: "Installs crew-chief's tiered agents, read-only guard, and routing policy into the current project's .claude/ directory and CLAUDE.md, for use without the plugin (for example after npx skills add). Optionally adds session handoff files."
argument-hint: "[--handoff]"
disable-model-invocation: true
---

Set up crew-chief in the current project. Arguments: `$ARGUMENTS`. Assets are in `${CLAUDE_SKILL_DIR}/assets/`.

## 1. Check what is already there

- If agent types named `crew-chief:scanner` and so on are available to you, the crew-chief **plugin** is installed: its agents, guard, and policy are already active. Do not copy agents or hooks (that would create duplicates). Say so, and continue only with step 5 if `--handoff` was given or the user wants it.
- List `.claude/agents/`, `.claude/hooks/`, `.claude/settings.json`, and `CLAUDE.md` in the project root. Note any file that setup would overwrite: `scanner.md`, `deep-reader.md`, `implementer.md`, `implementer-hard.md`, `reviewer.md`, `ui-smoke.md`, `ui-tester.md`, `crew-chief-guard.sh`.

## 2. Confirm the plan

Show the user, in their language, exactly which files will be created or replaced, that a Bash hook will be added to `.claude/settings.json`, and that a `## Model and subagent routing` block will be added to `CLAUDE.md`. If any existing file would be overwritten, ask before replacing it; offer to skip that file. Do not continue without confirmation.

## 3. Install

1. Copy every file in `${CLAUDE_SKILL_DIR}/assets/agents/` to `.claude/agents/`.
2. Copy `${CLAUDE_SKILL_DIR}/assets/hooks/crew-chief-guard.sh` to `.claude/hooks/`, then make the guard executable (`chmod +x .claude/hooks/crew-chief-guard.sh`).
3. Merge `${CLAUDE_SKILL_DIR}/assets/settings-hook.json` into `.claude/settings.json` (create it if missing): append its entry to `hooks.PreToolUse`, keep every existing key and hook, and skip the append if a hook command containing `crew-chief-guard.sh` is already there. Keep the file valid JSON. This wires the read-only guard; it is deliberately not in the agents' frontmatter, because frontmatter hooks of project agents are skipped until the folder's trust dialog is accepted and never run in `-p` sessions.
4. Insert `${CLAUDE_SKILL_DIR}/assets/claude-md-section.md` into `CLAUDE.md` (create the file if missing). If a block between `<!-- crew-chief:start` and `<!-- crew-chief:end -->` already exists, replace that block; otherwise append it at the end. Leave the rest of `CLAUDE.md` untouched.

Do not write any `effort` or model setting into `.claude/settings.json`: project settings would override each user's own effort preference.

## 4. Verify

- Run the guard once to prove it blocks writes from a read-only agent and leaves others alone:
  `printf '%s' '{"agent_type":"scanner","tool_input":{"command":"touch x"}}' | .claude/hooks/crew-chief-guard.sh --project; echo "exit $?"` must print `exit 2`.
  `printf '%s' '{"agent_type":"scanner","tool_input":{"command":"git log -1"}}' | .claude/hooks/crew-chief-guard.sh --project; echo "exit $?"` must print `exit 0`.
  `printf '%s' '{"agent_type":"implementer","tool_input":{"command":"touch x"}}' | .claude/hooks/crew-chief-guard.sh --project; echo "exit $?"` must print `exit 0`.
- Check that `.claude/settings.json` still parses as JSON.
- Tell the user:
  - If `.claude/agents/` did not exist before this run, Claude Code must be **restarted** before the new agents appear.
  - How to override: "do it yourself", "use agents", "give X to Sonnet at medium", `@agent-implementer-hard ...`.

## 5. Optional: session handoff files (`--handoff`)

Only if the user passed `--handoff` or says yes when offered. Follow the `crew-handoff` skill (`/crew-chief:crew-handoff`, or `/crew-handoff` when installed with npx): it creates STATUS.md, tasks.json, and PROGRESS.md only where nothing equivalent exists, shows a preview first, and adds a marked routine block to `CLAUDE.md`.

Do not commit anything. Report what was created and anything you could not fill in.
