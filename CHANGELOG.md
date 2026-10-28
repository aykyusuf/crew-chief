# Changelog

## 0.10.3 (2026-10-28)
- Windows with `jq` installed no longer gets the extra `⚠crew-chief: ...` line above the prompt: the panel row below it (model, effort, tokens, time, percent) works there too, so the line was a duplicate. It is drawn on Windows only when `jq` is missing, like on every other terminal (`CREW_CHIEF_ROW_MOD=on` still forces it). Seen on Windows with `jq` 1.8.2: the panel row and the `~NN%` both work.

## 0.10.2 (2026-10-28)
- The progress reminder now says the no-op is a Bash command, not a separate tool. A subagent on Windows had read "run this no-op" as a tool it did not have and skipped the report, so no percentage showed.
- Without `jq` the agent panel below the prompt cannot show each subagent's model and effort (that row is a shell script that needs it). crew-chief now says so once, in a toast (never a question): `winget install jqlang.jq` on Windows, `brew install jq` elsewhere. Not shown with no surface (`-p`, SDK) or `CREW_CHIEF_ROW=off`. A `jq`-free version of the panel row is planned, not built.

## 0.10.1 (2026-10-28)
- Progress on Windows and wherever `jq` is missing: the mod counts each subagent's tool calls and `crew-progress` reports itself (in memory), so the status line shows `~40%` next to the model and effort, and the 10-call reminder reaches a subagent without `jq`. Where `jq` works the shell hook still does the reminding, so nobody is reminded twice.
- Compaction after a "not now": `crew_compact_checkpoint` takes `user_requested: true`. When you ask for a compaction in your own words it works even right after you declined one (or chose "don't ask again"), instead of answering "not needed yet". The "not needed" answer now says so, and Claude is told not to send you to `/compact`.
- The default guard config no longer stops the first ssh to every host: `ssh.mode` is `warn` (a note for you and for Claude on the first contact with a non-loopback host). Set `"gate"` and list your production hosts to stop the first attempt. Configs already written are not changed.
- The guard's warning keeps every field of the tool result it wraps instead of rebuilding it (a defence against a "result does not match its output shape" error seen when two guards wrap the same `rm -rf`; not confirmed as the cause).

## 0.10.0 (2026-10-28)
- The command guard sets itself up: the first interactive session with no `~/.claude/crew-chief-guard.json` writes a default config (built-in rules, ssh gate with every non-loopback host as production) and turns the guard on in that session, with one toast. It is written once; a deleted file is not recreated. `CREW_CHIEF_GUARD_AUTOSETUP=off` or `CREW_CHIEF_GUARD=off` prevents it; `-p`/SDK runs never write. This changes the default for everyone who updates.
- `/crew-guard on` and `/crew-guard off` switch the guard by setting `enabled` in the config (other keys kept, invalid JSON refused, applied at once); only when you type them, never when Claude, a plugin or the SDK runs them.
- The ssh gate: a `*` host pattern no longer matches localhost, 127.x, `::1` or `*.local`, and no longer stops commands that only mention ssh (`ssh -V`, `which ssh`, commit messages, `GIT_SSH_COMMAND`).
- Handoff and skill offers no longer block the first reply: Claude does your request first, then adds one short line at the end of its answer (no dialog). The offer is skipped for overnight, background or looped jobs and non-interactive runs, and is recorded as "later" as soon as it is shown, so an ignored offer pauses for a week.
- Compaction in a project without handoff files no longer asks about setting them up. It goes ahead and mentions `/crew-chief:crew-handoff` once in its closing line.
- `crew-routing` skill: when `implementer-hard` stops on a product decision, Claude finishes what does not depend on it and puts the question in its final answer instead of stopping the whole job.

## 0.9.0 (2026-10-27)
- Command guard, opt-in and off by default: blocks `rm -rf` on `/`, `~` or `*`, `DROP`/`TRUNCATE`, `git push --force`, `git reset --hard` and private key files; warns on other `rm -rf`, `.env` access, `DELETE`/`UPDATE` without `WHERE`, deploys, service stop/restart and database clients over ssh. Your own deny/warn rules and switched-off built-ins go in `~/.claude/crew-chief-guard.json`; `docs/examples/crew-chief-guard.example.json` reproduces a personal prod-guard mod. `CREW_CHIEF_GUARD=auto|on|off`.
- Three levels: deny (never runs), confirm (the first attempt is stopped with a 5-line checklist Claude answers by itself: what runs where, what can be lost, backup or undo, right target, SAFE or RISKY; the identical command then passes silently within `confirmTtlMinutes`, default 360; a changed command is new) and warn. Only catastrophic `rm -rf` and the guard's own config are deny by default; risky deletes, destructive SQL, force push, hard reset, private keys, deploys, service stops and database clients over ssh are confirm.
- `crew_guard_suggest`: Claude flags a host, path, secret (name only) or command your config misses; it returns at once and never asks. `/crew-guard status|suggestions` prints the state and ready-to-paste JSON; it writes nothing. One note per session tells Claude about the tool while the guard is on.
- Claude may not write `~/.claude/crew-chief-guard.json` (Write/Edit, or Bash redirection, tee, sed -i, mv, cp, rm, interpreters); reading it is fine. Also a speed bump.
- ssh "first contact" gate (`ssh.mode: "gate"`): the first call to a listed production host in a session is held once with a request to analyse what really runs there; read-only remote commands (`ls`, `tail`, `grep`, `systemctl status`, `docker logs`...) then pass, anything else is held once per command and passes when retried unchanged within the approval window (360 minutes by default). `ssh`, `scp`, `sftp` and `rsync` are read with a small quote-aware tokenizer; what it cannot read counts as risky. Read-only agents get a plain deny. A speed bump, not a security boundary: the README lists the server-side controls that protect a server.
- Status: covered by unit tests (rules, prod-guard parity, config checks, 60 ssh parser cases, the gate) and mod-harness tests; not yet run live against a real server, with subagents in a real session, or on Windows.
- Agent panel row and progress reports: the reported `~N%` and step show only while the report is fresh (under 25 tool calls and 10 minutes old); after that the row shows `80 calls · report 41m ago` instead of a stale percent (one agent had shown `~2%` for 44 minutes). Reports are now enforced by hooks and not only by the agents' briefs: every subagent starts with the report rule (new `SubagentStart` hook, `scripts/subagent-start.sh`), and after every 10 tool calls without a report the PostToolUse hook adds a reminder to the agent's context. Whether the reminder reaches a subagent is the natural reading of the docs, not verified live.

## 0.8.0 (2026-10-27)
- The model, effort and tokens of your subagents now also reach the Desktop app, VS Code and Windows terminals: the mod keeps one status line above the prompt (`scanner haiku-5.5·low 12.4k | implementer opus-5.5·medium 48.1k`), cleared when the subagents finish. The effort is the one the request went out with, after the saver's cap; the tokens are the agent's latest request (its context size). Elapsed time and the `~40%` progress stay in the shell panel row only.
- `CREW_CHIEF_ROW_MOD=auto|on|off`: `auto` (default) shows the line when the session draws somewhere other than the terminal, or in a terminal where the shell panel row cannot draw (Windows, or no `jq`; `jq --version` runs once a session to find out); `on` always, `off` never. A plain terminal with `jq` sees no change.
- Status: run live in a terminal; documented for VS Code (extension 2.1.299+), not run here; expected but not verified on the Desktop app; Windows is covered by design (no `jq`) but was not run on a Windows terminal.

## 0.7.1 (2026-10-27)
- The one-time skill offer now also suggests the project map ([structure-map](https://github.com/aykyusuf/structure-map)) in any code project with at least 60 tracked files, when it is not installed (new `minFiles` field in `data/skill-catalog.json`). Same rules as before: asked once, nothing installed without a yes, "Not now" pauses a week, "Never" is remembered.

## 0.7.0 (2026-10-27)
- No plugin question waits forever any more: a saver, advisor, compaction, limit-reset or `/crew-tidy archive` question left unanswered for 20 minutes counts as its safe answer (*Not now*, *Remind me in a week*, *No*, *Cancel*; never the yes and never *Don't ask again*), with a toast that says so. `CREW_CHIEF_ASK_TIMEOUT_MIN` sets the minutes (at most 30; `off` keeps the old waiting). Where it can, the mod also closes the dialog; a question raised between turns may stay on screen, and a late click on it then changes nothing.
- The compaction question no longer holds Claude's turn open: the `crew_compact_checkpoint` tool only takes note and returns at once, and you are asked after the turn has ended with an answer and the session has stayed quiet for 10 seconds (no new prompt, no model request, no subagent running); otherwise at the next such turn end. A long job left running overnight no longer stops at it.
- Claude's own `AskUserQuestion` questions are never touched.

## 0.6.6 (2026-10-25)
- Fixed the saver not lowering subagent effort: the `turn.step` rewrite (`high -> medium`) was logged but `/tasks` still showed the Opus agents at `high`, because the effort in an agent's own definition wins over it (seen on Claude Code 2.1.310). While the saver is on, an `Agent` call for `implementer-hard`, `reviewer` or any agent called with an Opus/Fable model now carries `effort: medium` itself, and only downwards (`low`/`medium` stay, Sonnet and Haiku agents are never touched). The `turn.step` cap stays as a second line. If the rewrite fails the call goes through unchanged.

## 0.6.5 (2026-10-25)
- Diagnostics for the saver: every subagent request now writes one debug-log line (`saver: step agent=... model=... effort=... saver=...`, visible with `claude --debug-file <path>`), to find out why a subagent can still run at `high` while the saver is on. No behavior change.

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
