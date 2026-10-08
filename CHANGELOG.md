# Changelog

## 0.2.2 (2026-10-08)
- Session handoff, offered once per project: on a fresh start in a git repository without handoff files, the session hook asks Claude to offer STATUS.md, tasks.json, and PROGRESS.md plus a marked CLAUDE.md routine, saying what changes and citing Anthropic's "Effective harnesses for long-running agents". Quiet on resume/clear/compact, outside git, in home and temp directories, when similar files exist (including `durum.md` / `ilerleme.md`), or with `CREW_CHIEF_HANDOFF_OFFER=off`. Answers (`installed`, `never`, `later` for 7 days) are kept in `${CLAUDE_PLUGIN_DATA}`, never in the repository.
- New `crew-handoff` skill (model-invocable): finds existing equivalents first, previews before writing, creates only missing files, never overwrites or commits. `crew-setup --handoff` now delegates to it.
- `tasks.json` rule spells out the status lifecycle: `done` needs every part of `done_when`, sign-offs included; `blocked` carries its reason in `evidence`.
- README: Session handoff section; Privacy now states the one local file that is stored.
- Tests: `tests/test_session_policy.py`.

## 0.2.1 (2026-10-08)
- The agent panel below the prompt now shows each subagent's model, effort, and token count (`ui-tester  sonnet-5.5 · medium · 41.2k  Checking the login flow`), via a default `subagentStatusLine` in the plugin's `settings.json`. Needs `jq`; without it the default rows stay. A `subagentStatusLine` in your own settings takes precedence.

## 0.2.0 (2026-10-08)
- New tier `ui-tester` (sonnet/medium): multi-step browser, Android emulator, and iOS simulator checks with Claude in Chrome, adb, and computer use; cheapest tool first, screenshots in batches, one device at a time, pass/fail report with evidence.
- New tier `ui-smoke` (haiku/low): read-only yes/no check from page text, DOM, console, or logcat; covered by the read-only guard.
- Routing policy and `crew-routing` skill explain when UI checks stay inline, go to ui-smoke, or go to ui-tester.

## 0.1.2 (2026-10-08)
- Guard no longer lists `wget` and avoids a variable named `key`, which the directory scanner read as a credential.
- Guard parses hook input with `jq` or `sed` in a single script; the Python helper is gone.
- Removed the `default_mode` option: the session hook no longer reads plugin options from the environment. Switch modes with `/crew-mode`.
- Added a listing icon.

## 0.1.1 (2026-10-08)
- Reviewer verifies every candidate finding against the code before reporting, follows the repository's `REVIEW.md`, and uses Claude Code's Important / Nit / Pre-existing severities with a nit cap.
- Review depth by risk: high by default, `effort: xhigh` per call only for security, data loss, concurrency, money, or shipping code; large diffs go to `/code-review`.
- Reviewer is no longer invoked proactively after every significant change, only before a commit or PR of a significant or risky change or on request, to avoid needless spend.

## 0.1.0 (2026-10-08)
- First release.
- Five tiered agents: scanner (haiku/low), deep-reader (sonnet/medium), implementer (sonnet/medium), implementer-hard (opus/high), reviewer (opus/high).
- SessionStart routing policy with auto, solo, and delegate modes (`default_mode` option).
- Read-only guard for scanner, deep-reader, and reviewer (PreToolUse on Bash).
- Skills: `crew-routing` (routing rules, mechanism and model/effort references), `crew-mode`, `crew-setup` (project install for `npx skills` users, optional handoff files).
- Session hook stays quiet when the policy is already in the project's CLAUDE.md (no double policy).
- Eval suite: solo override, named model and effort, noisy tests to scanner, routing skill trigger.
