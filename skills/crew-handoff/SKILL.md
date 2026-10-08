---
name: crew-handoff
description: "Sets up session handoff files (STATUS.md, tasks.json, PROGRESS.md and a start/end routine in CLAUDE.md) so a new Claude Code session picks up where the last one stopped. Use when the user accepts crew-chief's handoff offer, or asks to set up handoff, progress, or status files for this project. Never overwrites existing files."
argument-hint: "[sub-project directory]"
---

Set up session handoff files. Arguments: `$ARGUMENTS` (optional sub-project directory; default: the repository root). Templates are in `${CLAUDE_SKILL_DIR}/assets/`.

Why: a fresh session otherwise rediscovers the project from scratch. This is the pattern in Anthropic's "Effective harnesses for long-running agents" (https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents): a progress file, a JSON task list where only the status changes (models alter JSON less readily than Markdown), and reading git log plus the progress file at the start of each session.

## 1. Look before writing

Target directory: the argument if given, otherwise `git rev-parse --show-toplevel`.

Search the target and one level below for handoff-like files under any name or language, for example `STATUS.md`, `PROGRESS.md`, `HANDOFF.md`, `tasks.json`, `feature_list.json`, `claude-progress.txt`, `durum.md`, `ilerleme.md`, and for a session start/end routine in `CLAUDE.md` (a `crew-chief:handoff` block, or headings such as "Session start" or their translation).

- **Something equivalent exists:** do not create a parallel set. Show what you found and ask whether to keep using it (default), add only the missing pieces next to it, or stop. Never rename or rewrite the user's files. If they keep using it, record `installed` (step 4) so the offer does not return.
- **Nothing exists:** continue.

## 2. Show the plan and a preview, then confirm

Show the user, in their language:
- the exact files to be created (only missing ones) and the block to add to `CLAUDE.md` between `<!-- crew-chief:handoff:start` and `<!-- crew-chief:handoff:end -->`; the rest of `CLAUDE.md` stays as it is;
- that nothing is committed and no other file changes;
- a short preview of each file's contents, filled from what you can verify in the repository (README, build files, scripts, CI config, `git log`). Mark anything you could not verify as "unverified"; never invent commands, results, or tasks.

Wait for confirmation. If the user declines, record `never` or `later` as in step 4 and stop.

## 3. Write

Using `${CLAUDE_SKILL_DIR}/assets/` as templates:
- `STATUS.md`: now, environment (start, stop, build, test commands you actually found), next, open questions, failed attempts, decisions.
- `tasks.json`: keep the `_rule` text as is. Add tasks only from what the user said or the repository states (open TODOs, README roadmap); otherwise leave one example task for the user to replace. Every task needs a measurable `done_when`.
- `PROGRESS.md`: one dated line saying the files were set up.
- `CLAUDE.md`: append `${CLAUDE_SKILL_DIR}/assets/claude-md-routine.md` if no `crew-chief:handoff` block exists (create `CLAUDE.md` if missing). If the block exists, leave it alone.

Create files only where none exists. Check that `tasks.json` parses as JSON.

## 4. Record the answer

So the session hook does not offer again, append one line to `${CLAUDE_PLUGIN_DATA}/handoff-offers.tsv` (create the directory if needed), tab-separated: the repository root, the answer (`installed`, `never`, or `later`), and the current Unix time from `$(date +%s)` (digits only), for example `printf '%s\tlater\t%s\n' "$root" "$(date +%s)" >> "${CLAUDE_PLUGIN_DATA}/handoff-offers.tsv"`. Skip this step when the path above still reads literally `${CLAUDE_PLUGIN_DATA}` (skills installed without the plugin: there is no offer to silence).

## 5. Report

List what was created, what was left untouched, and anything marked unverified. Do not commit.
