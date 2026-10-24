# Changelog

## 0.6.4 (2026-10-24)
- Fixed `/saver` answering "registered /saver but no command.run hook answered" in many sessions: after `/clear`, `/resume` or a plugin reload the module thought the command was not its own and stayed silent. It now checks the command list before refusing.

## 0.6.3 (2026-10-16)
- Compact proposals now wait for a real pause: nothing is proposed, and an approved compaction does not start, while a subagent is running; only a turn that ended with an answer counts as a phase boundary (not an interrupt, error or refusal). A dev server or watcher left open in the background is not waited for (neither is a subagent `waiting` on a server it started): the question shows it, and the summarizer is told to keep its task id and command, since after a compaction Claude forgets the handles of background tasks (anthropics/claude-code#29193).
- The compact question now says what is going on (`Now: subagents running: 0, background processes: 2 (npm run dev, ...), uncommitted files: 3`). `/crew-compact` while subagents run says to ask again later.

## 0.6.2 (2026-10-15)
- The mod is one file again: the directory that reviews plugins accepts `$` and `on` only when they are passed to a function declared in the same file, so the parts that touch `$` now live in `hooks/src/` and `tools/build_mod.py` joins them into the readable `hooks/register.js` (CI checks it is current, and that `$` is never passed to a function from another file). No behavior change.
- README gains "What the mod does with your machine": what it reads, runs, submits and writes, and why.

## 0.6.1 (2026-10-15)
- Compact flow in a project with no handoff files: after your yes, Claude first offers to set them up (the `crew-handoff` skill, with its own preview and confirmation) and puts the rules you gave in the conversation under Constraints, so they can be put back after the compaction. Decline and it compacts without them, as before.

## 0.6.0 (2026-10-15)
- Compact flow: past 250k tokens Claude is told to propose a compaction at a natural phase boundary; the tool asks you (a fallback asks between turns past 400k). On yes Claude updates STATUS.md, tasks.json and PROGRESS.md, compaction waits until STATUS.md changed, then runs between turns with a detailed brief for the summarizer. Nothing is compacted without a yes. `/crew-compact` starts it by hand; `CREW_CHIEF_COMPACT=off` turns it off.
- Nothing important lost: the brief names every default section, copies your rules verbatim and marks output of failed or killed processes `UNCONFIRMED`; it is also added to `/compact` and automatic compactions. After any compaction a new SessionStart hook (`scripts/compact-restore.sh`) puts your pinned Constraints, Now, Next, Decisions, latest failed attempts and open tasks back from the handoff files, with the transcript path; the raw summary is saved and checked against your pinned lines.
- Handoff files gain a Constraints section (your rules, verbatim). The 150k-token toast is replaced by the compact flow.
- Limit resets: a toast when a window you were close to resets, and an offer to send "continue" at the reset when a limit really stops Claude. `CREW_CHIEF_RESET=off`.
- `/crew-tidy`: a read-only audit of what Claude Code loaded (oversized CLAUDE.md and MEMORY.md, stale paths, repeats, big STATUS.md, MCP cost); `/crew-tidy archive` moves PROGRESS.md entries older than 60 days to an archive after asking. `/crew-report`: tokens and cost by model and role, plus a learned prompt-cache-cooling hint.
- Checked live on Claude Code 2.1.300: session.compact instructions add to the default prompt; classic compact hooks fire for a plugin-started compaction; SessionStart output reaches the model; the transcript keeps pre-compaction lines. A plugin cannot compact in `claude -p`. Needs Claude Code 2.1.287+ (the shell hook works on its own).

## 0.5.0 (2026-10-13)
- Skills in subagents: `deep-reader`, `implementer`, `implementer-hard`, `reviewer`, and `ui-tester` can now load skills (`Skill` tool). Subagents do not see your skill list, so the policy tells the main session to name the skill in the brief, and to pass `model` explicitly when it uses `general-purpose` (it otherwise inherits the main model).
- Reports in files: `deep-reader` and `reviewer` get `Write`, but the read-only guard lets them write only into `${TMPDIR:-/tmp}/crew-chief-reports/`. A report over about 40 lines is written there and a summary of at most 15 lines plus the path comes back, so the main context stays small. Everything else is still blocked: other paths, `Edit`, relative paths, `..`, symlinks out of the folder (the guard now also covers Write/Edit/NotebookEdit calls).
- Skill reminder: new UserPromptSubmit hook `scripts/skill-hint.sh` matches the prompt against `data/skill-catalog.json` (English and Turkish keywords) and, when a preferred skill is installed, adds a one-line "load the X skill first". At most two per prompt, each kind of work once per session. Your own kinds of work: `~/.claude/crew-chief-skills.json`. `CREW_CHIEF_SKILL_HINTS=off` turns it off.
- Skill offer: new SessionStart hook `scripts/skill-offer.sh` detects the stack (Flutter, React/Next.js, SwiftUI, web UI, Supabase) and, if no preferred skill is installed, has Claude offer once, opt-in, the hand-checked skills (checked 2026-10-13: Flutter team's `dart-flutter`, Vercel `vercel-react-best-practices`, `swiftui-pro`, Anthropic `frontend-design`, Supabase `postgres-best-practices`). Shows the source, the exact command, and risks; installs nothing without a yes; skills that fetch instructions at run time or run scripts are left out. `CREW_CHIEF_SKILL_OFFER=off` turns it off.
- The reports folder must be owned by you; a trailing slash in `TMPDIR` is handled. Re-running `/crew-setup` now widens an older Bash-only guard entry in `.claude/settings.json` so the project's `deep-reader` and `reviewer` stay guarded. Skills of plugins you switched off do not count as installed. Needs `jq` for the new hooks; without it they do nothing.

## 0.4.0 (2026-10-12)
- Agent panel row shows elapsed time (`· 4m12s`) for running subagents and, when the agent reports it, an approximate percent, the step it is on, and why it is slow: `implementer-hard  opus-5.5 · high · 232k · 4m12s · ~40%  Reading the auth module ⚠ slow test suite`.
- New PostToolUse hook `scripts/progress-hook.sh` keeps one small progress file per subagent in `${TMPDIR:-/tmp}/crew-chief-progress/` (pruned after 12 hours). `deep-reader`, `implementer`, `implementer-hard`, `reviewer`, and `ui-tester` now send a one-line `: 'crew-progress 40 | step | delay'` report about every 10 tool calls (a no-op Bash call that counts toward the turn limit). The percent is the agent's own estimate. A tool call of 45 s or more adds a delay note by itself. Needs `jq`.
- Read-only guard allows the progress report for the read-only agents.
- Checked on Claude Code 2.1.296: the panel row's task `id` is the hook's `agent_id`, and the row refreshes every few seconds.

## 0.3.3 (2026-10-11)
- Agent panel row fixed: Claude Code reads a `subagentStatusLine` from a plugin's `settings.json` but does not apply it to the panel (the same command works from the user's `settings.json`). On the first session after install or update, `scripts/install-row.sh` copies the row script to `~/.claude/` and adds the key to your `settings.json`. It never touches a `subagentStatusLine` that is not its own, installs once (a key you delete is not added back), keeps a backup, and needs `jq`. `CREW_CHIEF_ROW=off` turns it off.

## 0.3.2 (2026-10-11)
- `deep-reader` can now search and fetch the web (WebSearch, WebFetch), so one agent can read code together with current vendor docs, package pages, or design guidelines. It stays read-only: it returns the report as text and the caller saves it.
- Turn limits: `implementer-hard` 80 -> 120, `reviewer` 60 -> 80. Agents now count their own tool calls (they cannot see the remaining turns), stop opening new threads at about 70 % of the limit, and report. The reviewer keeps a running findings list and marks what it did not reach as `not reviewed`, so it no longer stops without a report.
- Implementers run builds and tests in the foreground with bounded output instead of waiting on a background run; `implementer-hard` writes checkpoints to a progress file when the brief names one.
- Reviewer: Important is reserved for correctness bugs and missed requirements, so a sound change gets `No blocking issues` instead of padded findings.
- Routing: split a large multi-file task into 2-3 independent pieces, give parallel implementers disjoint files (worktrees only as a last resort), and continue a stopped (partial) agent with SendMessage instead of starting over.

## 0.3.1 (2026-10-09)
- Advisor offer: if `/advisor` is off, the saver mod explains the benefit once (after the first finished turn) and, on yes, runs `/advisor` for you. Off with `CREW_CHIEF_ADVISOR_OFFER=off`.
- Remembers "remind me in a week" and "never"; skips clouds without the advisor; says "second opinion" for Opus and Fable main models.
- A refused `/advisor` (a policy, Fable usage credits) is not repeated; the toast says to run `/advisor` to see why.

## 0.3.0 (2026-10-09)
- Token saver (a mod; Claude Code 2.1.287+): off in every new session; asks at 70/80/90 % of the 5-hour limit (weekly 50/75/85/90) before capping subagent effort. `/saver on|off|status`.
- Toasts when the context passes 150k tokens and when a session is 8 hours old, the two things that eat most of a plan limit.
- On the first prompt after an install or update, a one-line warning if Claude Code is older than 2.1.287 (the saver needs it; everything else works).
- Messages follow the language you write in (English or Turkish): `CREW_CHIEF_LANG`, then Claude Code's `language` setting, then your recent prompts, then the locale. Turkish update notes live in `CHANGELOG.tr.md`.
- Update notice: your first prompt after an update shows what changed, and `CREW_CHIEF_WHATS_NEW=off` silences it.
- Stale-session notice: an open session still running a replaced copy is told once to run `/reload-plugins`.
- `/crew-chief:crew-mode solo` now holds: a hook records the mode per session and blocks the Agent tool until you switch back, instead of relying on the model to comply.
- Briefs carry the user's constraints ("do not modify X", "no commits") to subagents; the policy and routing skill say so.
- Difficulty is read from visible signals (scope, check, ambiguity, root cause, blast radius); escalation also triggers on evidence (check not run, files outside the brief, `maxTurns`), with a mid-task protocol: steer, stop, or resume on a stronger model.
- `implementer` and `implementer-hard` hand over what they tried and learned when stopped or partial.
- Documented the experimental `/advisor` (a cheaper agent consults a stronger model itself) and how to update the plugin.
- Four new eval cases (inline edit, reviewer at xhigh, escalation after stopped, constraint in brief) and tests for both new hook scripts.

## 0.2.3 (2026-10-08)
- Agent panel rows fit narrow terminals: the model is always shown; effort, tokens, and the description drop out in that order as space runs out; long agent names lose their plugin prefix and are shortened with an ellipsis instead of pushing the model off screen.
- Rows mark failed (✗) and stopped (■) subagents, strip control characters, show token counts in millions, and skip malformed rows.

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
