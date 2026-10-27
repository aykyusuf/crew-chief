# Crew Chief

**Difficulty-based subagent routing for Claude Code.** You pick the main session's model and effort. Claude then decides, task by task, what to do itself and what to hand to a cheaper or stronger subagent, at the right effort. It escalates when a tier gets stuck and follows your overrides.

[Türkçe README](README.tr.md)

```
you ──▶ main session (your model/effort) ──┬─ does interactive, coupled, quick work itself
                                           ├─▶ scanner          haiku  / low     lookups, noisy logs
                                           ├─▶ deep-reader      sonnet / medium  multi-file analysis, web research
                                           ├─▶ implementer      sonnet / medium  well-specified edits
                                           ├─▶ implementer-hard opus   / high    hard, multi-module work
                                           ├─▶ ui-smoke         haiku  / low     quick read-only UI check
                                           ├─▶ ui-tester        sonnet / medium  browser/emulator flows
                                           └─▶ reviewer         opus   / high    independent review
```

## Why

Out of the box, every subagent runs on whatever model and effort it was given, no matter how easy or hard the job is. Claude Code now lets the main session set `model` and `effort` per subagent call (2.1.292+), but something has to decide when to use them. Crew Chief is that decision layer, plus the tiers it routes to:

- **Routing policy** injected at every session start (and after `/clear` or compaction), so it is always active.
- **Seven tiered agents** with tight "use when / don't use when" descriptions, tool limits, turn limits, and a fixed report format.
- **Escalation ladder**: `implementer` → `implementer-hard` → main session, instead of retrying the same tier.
- **UI testing tiers**: `ui-smoke` for a quick read-only check and `ui-tester` for multi-step browser, emulator, or simulator flows, so screenshots stay out of the main context.
- **Read-only guard**: a hook that stops the scanner, deep-reader, reviewer, and ui-smoke from changing project files, changing git state, or installing anything, even when your session runs with permissions bypassed. The one write it allows is a long report into the crew-chief reports folder (see [Reports and skills](#reports-and-skills)).
- **Skills that actually get used**: agents can load skills, the prompt gets a one-line reminder when the work matches an installed skill, and a one-time, opt-in offer suggests hand-checked skills for the project's stack. See [Reports and skills](#reports-and-skills).
- **Overrides in plain language**: "do it yourself", "use agents", "give this to Sonnet at medium", or `/crew-chief:crew-mode solo`.
- **See who runs where**: the agent panel below the prompt shows each subagent's model and effort, for example `ui-tester  sonnet-5.5 · medium · 41.2k  Checking the login flow`. Claude Code reads a `subagentStatusLine` from a plugin's `settings.json` but does not apply it to the panel (checked on 2.1.296), so on your first session after install or update crew-chief copies the row script to `~/.claude/` and adds the key to your `settings.json` (needs `jq`; see [the row installer](#panel-row-installer)).
- **Session handoff, offered once per project**: three small files (status, task list, progress log) so a new session picks up where the last one stopped. See [Session handoff](#session-handoff).
- **A token saver that asks first**: at 70/80/90 % of your 5-hour limit (50/75/85/90 % weekly) it asks whether to cap subagent effort for this session, and warns about day-long sessions. See [Token saver](#token-saver).
- **Compaction that loses nothing important, and only with your yes**: at a phase boundary Claude proposes it, you answer, the handoff files are updated first, then the conversation is compacted with a detailed brief, and your pinned rules and open tasks are put back from the files. See [Compact flow](#compact-flow).
- **Limit resets and `continue`**: a toast when a limit you were close to resets, and, when a limit stops Claude, an offer to send "continue" at the reset. See [Limit resets](#limit-resets).
- **`/crew-tidy` and `/crew-report`**: what in your context is oversized, stale or repeated (nothing changes, except an archive move you confirm), and tokens and cost by model and by main or subagent. See [Context audit and report](#context-audit-and-report).
- **An advisor offer, once**: if the experimental `/advisor` is off, it explains the benefit and offers to turn it on. See [Advisor offer](#advisor-offer).
- **Solo that holds**: `/crew-chief:crew-mode solo` is enforced by a hook that blocks the Agent tool, not just requested in the prompt.
- **Update notices**: after an update, your first prompt shows what changed, and an open session is told once when it is still running the old copy. See [Updating](#updating).
- **A mechanism guide** (`routing` skill) for when one subagent is the wrong tool: forks, Monitor, `/loop`, `/goal`, dynamic workflows, agent teams, routines.

## Install

**Claude Code plugin (full: agents, hooks, skills):**

```bash
claude plugin marketplace add aykyusuf/crew-chief
claude plugin install crew-chief@crew-chief
```

Or inside a session: `/plugin install crew-chief --marketplace aykyusuf/crew-chief`.

**Skills only, any agent tool (`npx skills`):**

```bash
npx skills add aykyusuf/crew-chief
```

This installs the skills but not the agents or hooks. In Claude Code, run `/crew-chief:crew-setup` (or `/crew-setup` when installed with npx) once per project to copy the agents, the guard, and the policy into `.claude/` and `CLAUDE.md`. Restart Claude Code afterwards if `.claude/agents/` did not exist before.

Pick one route per machine. Installing both the plugin and the `npx` skills lists each skill twice (`/crew-chief:crew-routing` and `/crew-routing`), which only wastes context. `/crew-setup` detects the plugin and skips the agents and guard, and the plugin's session hook stays quiet when the policy is already in `CLAUDE.md`.

Requirements: Claude Code 2.1.292 or later for per-call effort (older versions still work, routing by tier defaults); 2.1.287 or later for the token saver. The guard parses its input with `jq` when installed and with `sed` otherwise.

## Updating

Third-party marketplaces do **not** auto-update by default, so turn it on once: `/plugin` → **Marketplaces** → `crew-chief` → **Enable auto-update**. Claude Code then refreshes the plugin shortly after your first message in a session. Or update by hand: `claude plugin update crew-chief@crew-chief`.

An update does not change the session that is already running:
- After an auto-update Claude Code prints `Plugin updated: crew-chief · Run /reload-plugins to apply`. Run `/reload-plugins` to switch the hooks in that session (a new session loads the new version by itself).
- After `claude plugin update` in a shell, other open sessions get no message from Claude Code. Crew Chief fills that gap: on your next prompt it says once per session that this session still runs the old copy and to run `/reload-plugins`. After an auto-update you may see both messages, since the old copy is marked in that case too.
- Your first prompt after an update shows a short "what's new": the first three items of that version's [CHANGELOG](CHANGELOG.md) section. A fresh install shows nothing, except the old-Claude-Code warning below (an upgrade from before 0.3.0 is announced too, if you had answered the handoff offer). Switch it off with `CREW_CHIEF_WHATS_NEW=off`.

Both notices are printed by a UserPromptSubmit hook (`systemMessage`) under your prompt, not written by the model. A SessionStart hook's `systemMessage` is not shown by Claude Code 2.1.295, which is why the notice waits for your first prompt.

## Token saver

Plan limits are eaten mostly by long sessions and big contexts, then by subagents on Opus. The saver is a small [mod](https://code.claude.com/docs/en/plugins/mods/overview) (`hooks/register.js`) that watches your limits from inside Claude Code and asks before it changes anything.

- **When it asks:** the first time your 5-hour limit passes 70, 80, or 90 %, or your weekly limit passes 50, 75, 85, or 90 %, once per threshold and limit window. If a session starts already past a threshold, it asks right away. If two thresholds are crossed at once, it asks once.
- **Answers:** *Turn on saver*, *Not now* (asks again at the next threshold), *Don't ask again this session*.
- **What the saver does, only for subagents:** Opus (and Fable) run at **medium** effort at most; Sonnet runs at **high** at most (no `xhigh` or `max`); Haiku and your main session are never touched. It changes the effort of each subagent request, not the model.
- **It never sticks:** every new session, `/clear`, and `/resume` starts with the saver off. No saver state is saved; what is remembered between sessions is the language and the advisor-offer answer (see below).
- **`/saver on|off|status`** switches it by hand and shows your limits, their reset times, and the context size.
- **One toast per session** when the session is 8 hours old. (The old toast at 150k tokens is gone: the [compact flow](#compact-flow) replaces it with a real proposal at a better moment.)

**Language.** Questions, toasts, `/saver`, and the update notices speak English or Turkish, whichever you write in. Order of precedence: `CREW_CHIEF_LANG=tr|en`, then Claude Code's `language` setting (`turkish` or `english`), then your recent prompts (Turkish letters and common Turkish words; the majority of the last five prompts, so one stray English sentence changes nothing; slash commands and code count for nothing), then the language last detected (so the first question of a new session already speaks it), then the `LANG` locale, then English. Kept between sessions in the plugin's store: that one word, `tr` or `en`, and the answer to the [advisor offer](#advisor-offer). Other languages fall back to English; adding one means adding an object to `hooks/saver-i18n.mjs` (a test checks that its keys match English). Update notes come from `CHANGELOG.tr.md` when it has the version, otherwise from `CHANGELOG.md`.

| Environment variable | Effect |
|---|---|
| `CREW_CHIEF_SAVER=off` | No saver questions and no toasts (`/saver` still works; the one-time [advisor offer](#advisor-offer) has its own switch below) |
| `CREW_CHIEF_SAVER_FIVE_HOUR=60,85` | Your own 5-hour thresholds |
| `CREW_CHIEF_SAVER_SEVEN_DAY=50,90` | Your own weekly thresholds |
| `CREW_CHIEF_LANG=tr` or `en` | Force the language of every message |
| `CREW_CHIEF_ADVISOR_OFFER=off` | Never offer the advisor |
| `CREW_CHIEF_ASK_TIMEOUT_MIN=10` | Minutes before an unanswered question takes its safe answer (default 20, at most 30; `off` or `0`: questions wait for you) |

**Questions never wait forever.** Every question the mod asks (saver, advisor offer, compaction, the compaction gate, limit reset, `/crew-tidy archive`) counts as answered with its safe choice when nobody answers for 20 minutes: *Not now* for the saver and the compaction, *No* for the limit reset, *Remind me in a week* for the advisor offer, *Cancel* for the compaction gate and the archive. Never the yes, and never *Don't ask again*. A toast says so (`No answer for 20 min: treated as "Not now".`). The mod moves on in every case; where it can, it also closes the dialog (it answers its own `AskUserQuestion` call), but a question raised between turns may stay on screen, and a late click on it then changes nothing. An `AskUserQuestion` that Claude itself raises is never touched.

**Needs:** Claude Code 2.1.287 or later (older versions never load the mod; the first prompt after install tells you), and a Pro or Max plan for the limit data (with an API key the mod stays quiet; the context and age toasts still work). The questions need an interactive session; `claude -p` never asks.

Measured on Claude Code 2.1.295: the limits are available right when a session starts, and match `/usage` and the status line. For a hard cap that needs no questions, set `"maxEffortLevel": "medium"` in your settings.

## Compact flow

A long conversation costs more with every request and answers worse. `/compact` helps, but it replaces the conversation with a summary, and details, especially rules you stated early, can fall out of it. This flow makes compaction a decision you take at a good moment, with safeguards.

1. **Arming.** Past **250k tokens** (on a small window: 60 % of it), your next prompt carries a one-time note telling Claude to call the tool `crew_compact_checkpoint` at the next natural phase boundary (a task finished, tests green; never in the middle of work). Claude decides when a phase is over.
2. **Asking.** The tool only takes note and returns at once, so Claude's turn never waits for you. You are asked after that turn has ended with an answer and the session has then stayed quiet for **10 seconds** (no new prompt, no model request, no subagent running); if something started in those seconds, you are asked at the next such turn end instead. If Claude never calls the tool, the same happens once the context passes **400k** (85 % of a small window). *Not now* asks again after another 100k tokens; *Don't ask again this session* ends it; no answer for 20 minutes counts as *Not now* (`CREW_CHIEF_ASK_TIMEOUT_MIN`, see [Token saver](#token-saver)). Nothing is compacted without a yes.
   **Only at a real pause.** Nothing is proposed, and an approved compaction does not start, while a subagent is running (`$.agent.list()`: pending or running; a subagent `waiting` on a server it started, on a plan's approval or on another agent is shown but not waited for): a subagent always finishes and brings a result back, so it must not be cut in half. The question then waits for the next finished turn. Only a turn that ended with an answer counts (not an interrupt, an error or a refusal). A dev server or watcher left open in the background is never waited for, because it never ends and a compaction does not touch it; the question shows it instead (`Now: subagents running: 0, background processes: 2 (npm run dev, uvicorn app:app), uncommitted files: 3`) and the summarizer is told to keep its task id and command, because after a compaction Claude no longer remembers the handles of background tasks it started ([anthropics/claude-code#29193](https://github.com/anthropics/claude-code/issues/29193)). The background processes come from the Stop event's task list, which a mod receives only where the settings-hook events reach it; the other numbers do not depend on that.
3. **Updating.** On yes, Claude updates the project's handoff files that exist: `STATUS.md` (including **Constraints**: your rules, copied verbatim), `tasks.json`, `PROGRESS.md`. Compaction waits until `STATUS.md` has changed. If it did not, you are asked: *Compact anyway*, *Ask Claude to update first*, or *Cancel*. In a project without handoff files, Claude first offers to set them up (the `crew-handoff` skill shows a preview and needs its own yes; its Constraints start with the rules you gave in the conversation), because without them nothing can put your rules back after the compaction; if you decline, it compacts without them and only the brief, the saved summary and the transcript path protect you.
4. **Compacting.** Between turns, with a detailed brief for the summarizer: every default section (request and intent, constraints verbatim, decisions and why, files, errors, verification status, all instructions, pending work), plus a rule that output of a failed, timed-out or killed process is written as `UNCONFIRMED`, never as completed. The same brief is added to a `/compact` you type and to an automatic compaction, after your own words.
5. **After.** The raw summary is saved to the plugin's data folder (`compact-summaries/`, last 5, readable only by you). The summary is checked, by plain string matching and not by a model, for your pinned constraints and the open tasks; a toast says how many were missing. `scripts/compact-restore.sh` (SessionStart, `compact`) then prints your Constraints, Now, Next, Decisions, the latest failed attempts and the open tasks **from the files, not from the summary**, with the path of the full transcript. Claude Code keeps the lines from before a compaction in that transcript, so a missing detail can be searched; if a compaction ever loses lines, the next ones copy the transcript first (last 3, readable only by you).

`/crew-compact` starts the proposal by hand. Environment: `CREW_CHIEF_COMPACT=off` turns the whole flow off; `CREW_CHIEF_COMPACT_FOCUS=off` only stops the brief being added; `CREW_CHIEF_COMPACT_ARM=300k` and `CREW_CHIEF_COMPACT_ASK=500k` set the two sizes; `CREW_CHIEF_RESTORE=off` stops the restore block.

**Why these numbers, and what is checked.** Anthropic gives no recommended compaction point (only the default, about 967k on a 1M model). Reports put the drop in quality at 300-400k tokens, "highly dependent on the task", so the sizes are absolute tokens and yours to change. Checked on Claude Code 2.1.300 in an interactive session: instructions from a `session.compact` hook are honored and *added* to the default summary prompt (the documented API *replaces* it, so the brief is written to stand on its own either way); the classic PreCompact, PostCompact and SessionStart (`compact`) hooks fire for a compaction a plugin starts; the SessionStart output reaches the model; the transcript keeps its pre-compaction lines. A plugin cannot start a compaction in `claude -p` or from a command; it runs from a timer after the turn, and is retried a few times if a turn is still running. Constraints pinned in `STATUS.md` are re-injected after every compaction because rules that exist only in the conversation are the ones research found to decay most.

## Limit resets

- A timer per window that was at 90 % or more and resets within 12 hours: a toast at the reset, even if the session sat idle (Claude Code only measures after a response).
- When a limit really stops Claude (the `StopFailure` event with error `rate_limit`, not the 100 % mark: with usage credits you keep working past it), you are asked whether to send "continue" at the reset. Only on a yes, only for a reset within 6 hours, and nothing is sent if you typed something in the meantime. The message says it comes from crew-chief; it is not sent as your own words. `CREW_CHIEF_RESET=off` turns both off.

## Context audit and report

`/crew-tidy` reads what Claude Code actually loaded (the same list `/context` shows) and reports, changing nothing: instruction and memory files over Anthropic's limits (CLAUDE.md under about 200 lines; MEMORY.md loads only its first 200 lines or 25 KB, the rest is dropped silently), paths a file mentions that no longer exist, `MEMORY.md` entries pointing at missing files, lines repeated across files, a `STATUS.md` over 6 KB (read at every start), `PROGRESS.md` entries older than 60 days, MCP servers by token cost, the largest parts of the context. Files under `~/.claude` are only reported. `/crew-tidy archive` moves `PROGRESS.md` entries older than 60 days to `PROGRESS-archive.md` after asking: the archive is written and read back before the source is rewritten, an entry whose date is unclear stays, nothing is deleted.

`/crew-report` shows tokens (exact) and cost (approximate) by main or subagent and model, and how much of the output came from subagents and from Sonnet or Haiku. Claude Code reports one session total, so each request is credited with what the total grew by since the previous one ended. A toast on your next prompt also warns when the prompt cache has probably gone cold during an idle gap (the cache lifetime is learned from the usage numbers; nothing is warned until an expiry has been seen; `CREW_CHIEF_CACHE_HINT=off`).

## What the mod does with your machine

For reviewers and for you. Everything below happens inside Claude Code on your machine; the mod has no network access and sends nothing anywhere.

| What | Where | Why |
|---|---|---|
| **Reads files** (`$.fs.read`, `exists`, `list`, `stat`) | The project's `STATUS.md`, `tasks.json`, `PROGRESS.md`; the instruction and memory files Claude Code loaded (the list `/context` shows), only for `/crew-tidy`; file times for the compact gate | To check the summary against your pinned rules and open tasks, to audit context, to wait until `STATUS.md` was updated |
| **Reads settings** (`$.settings.read`) | Only the `language` and `advisorModel` keys | To speak your language and to know whether the advisor offer applies. It never reads API keys, tokens or any credential |
| **Reads environment** (`$.env.get`) | `HOME`, `TMPDIR`, `LANG`, the `CREW_CHIEF_*` switches, and a few `CLAUDE_CODE_USE_*` flags | Paths, language, switches, and whether a cloud provider route is in use |
| **Runs programs** (`$.process.run`) | `wc -l <transcript>` (count lines before and after a compaction); `git status --porcelain` (count uncommitted files, shown in the compact question); `chmod 600 <file>` (make its own backups private); `rm -f <old backup>` (delete only its own backups beyond the newest 5 or 3); `mkdir -p`, `cp -p <transcript> <backup>` (only if a compaction ever lost transcript lines). The arguments are paths the mod computes, not text from the conversation | Backups and the transcript check |
| **Runs a slash command** | `/advisor`, once, only after you said yes to the [advisor offer](#advisor-offer) | To turn the advisor on for you |
| **Submits prompts** (`$.prompt.submit`) | Two fixed texts, framed as coming from crew-chief (never as your own words): "update the handoff files" after you approved a compaction, and "continue where you left off" at a limit reset you approved. They contain no file contents and no conversation text | To carry out what you approved |
| **Writes files** (`$.fs.write`) | Its own data folder (`compact-summaries/`); and, only when you confirm `/crew-tidy archive`, `PROGRESS.md` (shortened) and `PROGRESS-archive.md` (the old entries). It never writes your instruction files, settings, or build files | Backups; the archive you asked for |
| **Registers a tool** | `crew_compact_checkpoint`, which only notes that a phase ended and tells Claude to carry on; you are asked after the turn | The phase-boundary proposal |
| **Answers its own questions** (a `tool.call` hook on `AskUserQuestion`) | Only the dialogs the mod itself opened: after `CREW_CHIEF_ASK_TIMEOUT_MIN` minutes (default 20) without an answer it answers with the question's safe choice (never yes, never *Don't ask again*). Claude's own `AskUserQuestion` calls pass through untouched | So an unattended session is not held by a plugin question |
| **Compaction hooks** | Adds a summarizer brief to a compaction (`session.compact`), and starts a compaction only after your yes | Nothing important lost |

## Advisor offer

`/advisor` (experimental, Anthropic API only) lets Claude ask a stronger model for advice at hard moments: before choosing an approach, when stuck, before finishing. Subagents inherit it, so a Sonnet `implementer` can consult Opus instead of stopping and being re-run as `implementer-hard`. In Anthropic's own benchmark a Sonnet and Opus pair finished tasks about 12% cheaper and slightly better; each consultation is billed at the advisor's rates.

When the advisor is off, the saver mod offers it **once**, after the first finished turn of a session (never at startup, never over a saver question):
- **Sonnet or Haiku main model:** "asks Opus at hard moments". **Opus or Fable main model:** the wording becomes "a second Opus (Fable) reviews the plan", an independent check that costs extra.
- **Answers:** *Turn it on* runs `/advisor opus` (`/advisor fable` for Fable) for you, which saves `advisorModel` in your user settings exactly as if you had typed it, and says so in a toast. If the setting does not appear (a policy, Fable usage credits not enabled), the toast tells you to run `/advisor` yourself to see why, and the offer is not repeated. *Remind me in a week* and *Don't ask again* are remembered in the plugin's store. Dismissing the dialog remembers nothing.
- **Never offered** when `advisorModel` is already set, on Bedrock, Vertex, Foundry or the other cloud routes, when `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` is set, when this Claude Code has no `/advisor`, when the main model is unknown, in `claude -p`, or after you said yes (turn it off later with `/advisor off`; it will not come back). It also waits for a turn that ended normally, not one you interrupted.
- `CREW_CHIEF_ADVISOR_OFFER=off` switches the offer off for good.

## Use

Nothing to do: start a session, pick your model and effort as usual, and work. Crew Chief's policy tells Claude when to delegate.

| You say | What happens |
|---|---|
| *(nothing)* | `auto` mode: routed by difficulty |
| "do it yourself", "no subagents" | `solo`: everything stays in the main session (`/crew-chief:crew-mode solo` also blocks the Agent tool with a hook until you switch back) |
| "use agents", "delegate this" | `delegate`: independent pieces go to tiers in parallel |
| "do the UI directly with Opus" | That part stays in the main session; the rest is routed |
| "give the tests to Haiku", "Sonnet at medium for this" | The subagent runs with exactly that model/effort |
| `@agent-crew-chief:implementer-hard fix the race in sync.go` | That agent, guaranteed |
| `/crew-chief:crew-mode auto\|solo\|delegate\|status` | Switch or show the mode |

**Change a tier's model or effort:** create `.claude/agents/<name>.md` in your project with the same name (for example `implementer.md`). Project agents take priority over plugin agents, and plugin updates never overwrite them.

## Session handoff

A new session starts with no memory of the last one, so it rediscovers the project: what works, what was tried, what is next. Crew Chief can set up three small files that carry that over. This follows Anthropic's engineering post [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (Nov 2025): a progress file, a JSON task list whose status is the only thing that changes (models are less likely to rewrite JSON than Markdown), and reading `git log` plus the progress file at the start of each session.

| File | Holds | Changes how |
|---|---|---|
| `STATUS.md` | Now, environment commands, next, open questions, failed attempts, decisions | Rewritten to describe the present |
| `tasks.json` | Tasks with `id`, `title`, `priority`, measurable `done_when`, `status`, `evidence` | Only `status` and `evidence` change: `todo` → `in_progress` → `done` (every part of `done_when`, sign-offs included) or `blocked` (reason in `evidence`) |
| `PROGRESS.md` | Dated log, newest first | One paragraph appended per session |
| `CLAUDE.md` | A start/end routine between `<!-- crew-chief:handoff:start -->` and `:end` markers | Added once; the rest of the file is not touched |

**How it is offered.** On a fresh session start (not resume, `/clear`, or compaction) in a git repository that has none of these files yet, the session hook asks Claude to ask you once, saying what would change and why. Answers: *Set it up*, *Not now* (asks again after 7 days), *Never for this project*. The hook stays quiet:
- when any handoff-like file already exists at the root or one level down, under common names (`tasks.json`, `STATUS.md`, `PROGRESS.md`, `HANDOFF.md`, `claude-progress.txt`, `feature_list.json`, and their Turkish equivalents `durum.md`, `ilerleme.md`) or as a `crew-chief:handoff` block in `CLAUDE.md`;
- outside git repositories, in your home directory, and in temporary directories;
- when `CREW_CHIEF_HANDOFF_OFFER=off` is set in your environment.

**What setup does** (`/crew-chief:crew-handoff`, or just say "set up handoff files"): it looks for existing equivalents first and offers to keep using them instead of creating a parallel set; shows the files and a preview filled only from what it can verify in the repository (unverifiable items are marked unverified); creates only missing files; adds the `CLAUDE.md` block; never overwrites, renames, or commits anything. `/crew-chief:crew-setup --handoff` runs the same steps after a project install.

## What it runs

Everything is plain, readable shell in this repo. Nothing is sent over the network.

| Component | When | What it does |
|---|---|---|
| `scripts/session-policy.sh` | SessionStart (startup, resume, clear, compact) | Prints the ~2 KB routing policy into the session context. On a fresh start in a git repository without handoff files, also adds the one-time [handoff offer](#session-handoff); it never writes files itself |
| `scripts/install-row.sh` | SessionStart (startup only) | Adds `subagentStatusLine` to `~/.claude/settings.json` once, see [the row installer](#panel-row-installer) |
| `scripts/subagent-row.sh` | Agent panel refresh, while subagents run | Reads the panel's row data (agent type, model, effort, tokens, start time) and prints the row text: elapsed time, and the reported percent, step and delay reason when the agent sent one (see [Progress in the panel](#progress-in-the-panel)). Needs `jq`; without it the default rows stay |
| `scripts/skill-hint.sh` | UserPromptSubmit | Adds a one-line "load the X skill" reminder when the prompt matches a kind of work in `data/skill-catalog.json` and a preferred skill is installed. Remembers per session which hints it gave (`${CLAUDE_PLUGIN_DATA}/skill-hints/`). Needs `jq` |
| `scripts/skill-offer.sh` | SessionStart (startup only) | Prints the one-time [skill offer](#reports-and-skills) when the project's stack has hand-checked skills and none is installed. Answers are kept in `skill-offers.tsv`. Needs `jq` |
| `scripts/skill-lib.sh` | (sourced) | Lists the installed skills for the two scripts above |
| `scripts/progress-hook.sh` | PostToolUse (subagent calls only) | Keeps one small file per subagent in `${TMPDIR:-/tmp}/crew-chief-progress/` (tool count, last tool, a slow-call note, and the agent's own `crew-progress` report); files older than 12 hours are removed. Needs `jq` |
| `hooks/register.js` (a mod) | Session events | The [token saver](#token-saver): reads `$.session.usage()` for your plan limits and context size, asks with `$.ui.ask`, and lowers subagent effort in `turn.step` while the saver is on. Keeps saver state in memory only; remembers the language and your answer to the advisor offer. Also offers `/advisor` once (see [Advisor offer](#advisor-offer)) |
| `hooks/src/*.js` (the mod's parts, joined into `hooks/register.js`) | Session events | The [compact flow](#compact-flow), [limit resets](#limit-resets), and [`/crew-tidy` and `/crew-report`](#context-audit-and-report). The directory that reviews plugins reads the mod file by itself, so everything that touches `$` is joined into the one readable `hooks/register.js` by `tools/build_mod.py` (edit `hooks/src/`, then run it; CI checks it is current). Pure helpers that never see `$` stay separate: `compact-logic.mjs`, `tidy-logic.mjs`, `report-logic.mjs`, `saver-logic.mjs`, `saver-i18n.mjs`, `coord.mjs` |
| `scripts/compact-restore.sh` | SessionStart (compact) | After a compaction, prints the user's pinned Constraints, Now, Next, Decisions, the latest failed attempts and the open tasks from the project's handoff files (about 8000 characters at most) and the transcript path. Reads only; `CREW_CHIEF_RESTORE=off` turns it off |
| `scripts/mode-guard.sh` | UserPromptSubmit and UserPromptExpansion; PreToolUse on Agent | `record`: when your prompt is `/crew-chief:crew-mode <mode>`, remembers the mode for this session. `check`: while that mode is `solo`, blocks subagent spawns (exit 2). No recorded mode means everything passes |
| `scripts/plugin-notices.sh` | UserPromptSubmit | On the first prompt after an update, shows the version change and the first lines of its CHANGELOG section. In a session that still runs a replaced copy, says so once instead. Both print a `systemMessage` for you |
| `scripts/readonly-guard.sh` | PreToolUse on Bash, Write, Edit | Reads the hook input; if the caller is `crew-chief:scanner`, `deep-reader`, `reviewer`, or `ui-smoke`, blocks commands that write files, change git state, or install packages, and any file write outside `${TMPDIR:-/tmp}/crew-chief-reports/` (exit 2). Every other caller passes through untouched |

With `/crew-setup` (no plugin), the same guard is copied to `.claude/hooks/crew-chief-guard.sh` and wired through `.claude/settings.json` with `--project`, matching the bare agent names. It is not put in the agents' frontmatter on purpose: Claude Code skips frontmatter hooks of project agents until the folder's trust dialog is accepted, and never runs them in `-p` sessions.

The guard is a pattern check, not a sandbox: it blocks the common ways to write and errs on the side of blocking (for example a `>` inside a quoted awk expression). It does not try to catch deliberately obfuscated commands.

## Reports and skills

**Long reports go to a file.** `deep-reader` and `reviewer` have the `Write` tool, but the guard lets them write only into `${TMPDIR:-/tmp}/crew-chief-reports/`. A report longer than about 40 lines is written there (file name with a time suffix, so two agents do not collide) and the agent returns a summary of at most 15 lines plus the path, so the main context stays small; shorter reports still come back as text. Any other path, `Edit`, a relative path, a `..` segment, or a symlink out of the folder is blocked (the message names the allowed folder). The folder must be owned by you or the guard refuses it. It is in your temp directory, so it is cleared by the system, not by crew-chief.

**Agents can load skills.** `deep-reader`, `implementer`, `implementer-hard`, `reviewer`, and `ui-tester` have the `Skill` tool. They do not see your skill list, so the policy tells the main session to name the skill in the brief. `scanner` and `ui-smoke` (Haiku, mechanical work) do not get it. For skill-heavy work you can still use `general-purpose`, but pass `model` explicitly: it otherwise inherits the main model.

**A reminder when a skill fits.** Claude picks skills from one-line descriptions that are cut when many are installed, so a fitting skill is sometimes never loaded. `scripts/skill-hint.sh` (UserPromptSubmit) matches the prompt against `data/skill-catalog.json` (English and Turkish keywords per kind of work; a keyword is a whole word, one ending in `*` matches as a word prefix, and capital Turkish letters are handled) and, if a preferred skill for that kind of work is installed and enabled, adds one line: "load the X skill first". It is advice, not enforcement. At most two hints per prompt, each kind of work once per session, nothing for slash commands. Add your own kinds of work in `~/.claude/crew-chief-skills.json` (same shape as the catalog's `categories`; the same `id` replaces the shipped one, `"disabled": true` removes it). `CREW_CHIEF_SKILL_HINTS=off` turns it off.

**A one-time skill offer.** On a fresh start in a git project, `scripts/skill-offer.sh` looks at the stack (`pubspec.yaml`, `package.json`, `*.xcodeproj`, `supabase/config.toml`, ...). If none of the preferred skills for it is installed, Claude asks once, in your language, whether to install the hand-checked ones from the catalog: name, source, what it does, the exact install command, and a note on risks. Nothing is installed without your yes, and nothing in the project is touched. "Not now" pauses a week, "Never" is remembered per project and kind of work. The list was verified on the date in the catalog (`verified`); Claude is told to say so and offer a web check when it is older than 90 days. Skills that fetch instructions at run time or run scripts are left out of the offer on purpose. `CREW_CHIEF_SKILL_OFFER=off` turns it off.

## Progress in the panel

The agent panel row shows how long each subagent has been running and, when the agent reports it, how far along it is and why it is slow:

```
implementer-hard  opus-5.5 · high · 232k · 4m12s · ~40%  Reading the auth module ⚠ slow test suite
```

- Elapsed time comes from the task's `startTime`; it needs nothing from the agent.
- `deep-reader`, `implementer`, `implementer-hard`, `reviewer`, and `ui-tester` are told to send a one-line report about every 10 tool calls: a no-op Bash call `: 'crew-progress 40 | what I am on | why it is slow'`. `scripts/progress-hook.sh` (PostToolUse) picks it up by the agent's id, the row script reads it. The percent is the agent's own estimate, so the row marks it with `~`; it is not a measured value. The call counts toward the agent's turn limit, which is why it is rare.
- Without a report the row shows the usual label and no percent. A single tool call of 45 s or more adds `⚠ Bash took 61s` on its own.
- The read-only guard lets the report through, even for the read-only agents.

## Panel row installer

On a fresh session, `scripts/install-row.sh` puts the agent panel row into your own `~/.claude/settings.json`, because a plugin-supplied `subagentStatusLine` does not reach the panel. What it does:

- Copies `subagent-row.sh` to `~/.claude/crew-chief-subagent-row.sh` and adds `"subagentStatusLine": {"type": "command", "command": "\"$HOME/.claude/crew-chief-subagent-row.sh\""}`. The copy follows the plugin version.
- Never touches a `subagentStatusLine` that is not its own, and installs once: if you delete the key later it is not added back.
- Keeps one backup (`settings.json.crew-chief-bak`), checks the JSON before writing, and writes in place so a symlinked `settings.json` stays a symlink.
- Does nothing without `jq`, with an invalid `settings.json`, or when `CLAUDE_CONFIG_DIR` is not `~/.claude`. `CREW_CHIEF_ROW=off` turns it off.
- Undo: delete the `subagentStatusLine` key and the `~/.claude/crew-chief-subagent-row.sh` copy.

## Privacy

Crew Chief collects and sends no data. Its hooks run locally and print text or an exit code. They read the hook input Claude Code passes them (the session's project path and id, your prompt to spot `/crew-chief:crew-mode` and to match the skill hints, and the Bash command or file path a subagent is about to use) and, at session start, look at the project itself: whether it is a git repository, whether `CLAUDE.md` or handoff files exist, and which stack files (`pubspec.yaml`, `package.json`, ...) it has, and which skills are installed on your machine, only to decide about the skill offer and hints. What is stored stays in `~/.claude/plugins/data/<plugin>/` on your machine, which Claude Code deletes when you uninstall the plugin: your answer to the handoff offer (`handoff-offers.tsv`: a line per answer, the project path and `installed`, `never`, or `later` with a timestamp; the latest line per project counts), the plugin version you were last told about (`last-seen-version`), the plugin version for which it last checked your Claude Code version (`claude-version-checked`), and small per-session marker files for solo mode (`modes/`), the stale-session notice (`stale-notified/`) and the skill hints already given (`skill-hints/`), named by session id and pruned when newer ones are written once they are two weeks old, and your answers to the [skill offer](#reports-and-skills) (`skill-offers.tsv`: project path, kind of work, and `installed`, `never`, or `later` with a timestamp). Subagent progress files and long reports live in your temp directory (`crew-chief-progress/`, `crew-chief-reports/`), outside the plugin's store. The plugin writes into your project only when you say yes: `/crew-handoff` creates the handoff files you confirmed, `/crew-tidy archive` appends old entries to `PROGRESS-archive.md` and shortens `PROGRESS.md` after you confirm, and at a compaction you approved, Claude (not the plugin's scripts) updates `STATUS.md`, `tasks.json` and `PROGRESS.md`. Beyond that, the plugin keeps in its data folder: `compact-summaries/` (the raw summary of each compaction, last 5, readable only by you) and, only if a compaction ever lost transcript lines, `transcripts/` (a copy of the session transcript taken before later compactions, last 3, readable only by you); a plugin loaded from a plain directory, without a data folder, uses `${TMPDIR:-/tmp}/crew-chief-compact/` instead. The one file it writes outside the plugin's store is your `~/.claude/settings.json` (plus `crew-chief-subagent-row.sh`, a backup, and a marker next to it), once, to add the panel row; see [Panel row installer](#panel-row-installer). The saver reads your plan usage, context size, and the first lines of your prompts (only to tell Turkish from English) inside Claude Code, keeps just the detected language (`tr` or `en`), your answer to the advisor offer (`answered`, `never`, or a pause time), whether the transcript kept its lines in a compaction (`transcript_kept`) and the shortest and longest idle gaps it has seen the prompt cache expire or survive (`cache_hint`) in the plugin's store, and sends nothing anywhere. The compact flow reads your handoff files, the instruction and memory files Claude Code loaded, the session transcript's line count (`wc -l`) and, to copy it if needed, the transcript file itself; none of that leaves your machine. There is no telemetry or network access. Bug reports go to [GitHub issues](https://github.com/aykyusuf/crew-chief/issues).

## How routing decides

Delegate only when the work is self-contained **and** it can run in parallel, would flood the main context, or a cheaper tier can do it equally well. Otherwise the main session does it. Multi-agent setups cost several times the tokens of one session and most coding work is tightly coupled, so the default leans towards doing it yourself. Difficulty is read from what is visible (scope, whether a check exists, ambiguity, whether the root cause is known, blast radius), not guessed. When a subagent fails, the rule is to diagnose before escalating: careless means raise effort, out of its depth means raise the model. Escalation also triggers on evidence (check not run, files changed outside the brief, `maxTurns` hit), and a task that turns out harder mid-run can be steered, stopped, or resumed on a stronger model. The optional [advisor](skills/crew-routing/references/model-and-effort.md) (`/advisor`, experimental) lets a cheaper agent consult a stronger model itself.

The full policy is in [skills/crew-routing/SKILL.md](skills/crew-routing/SKILL.md), with [mechanisms](skills/crew-routing/references/mechanisms.md) and [model and effort](skills/crew-routing/references/model-and-effort.md) references summarised from the official Claude Code docs.

## Develop

```bash
claude --plugin-dir .                      # load this checkout for one session
python3 tests/test_guard.py                # guard tests, with and without jq
python3 tests/test_session_policy.py       # session hook: policy and when the handoff offer appears
python3 tests/test_mode_guard.py           # solo mode: record and block
python3 tests/test_plugin_notices.py       # what's-new, Claude Code version, and stale-session notices
python3 tools/build_mod.py                 # rebuild hooks/register.js from hooks/src/ after editing the mod (add --check to verify)
python3 tests/test_compact_restore.py     # what is put back after a compaction (sh and dash)
node --test tests/*.test.mjs               # saver, compact, tidy and report logic, messages, language detection (plain Node)
claude plugin test                         # the mod's hooks (saver, compact, resets, tidy, report), with stubs (no session, no network)
python3 tools/build_assets.py              # regenerate skills/crew-setup/assets after editing agents/ or scripts/
claude plugin validate . --strict          # marketplace manifest
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin eval . --scaffold --allow-tools Bash --runs 1   # behaviour evals (real model calls, billed)
```

Eval cases live in `evals/`: a solo override, a named model and effort, a noisy test run that should go to the scanner, an orchestration question that should load the routing skill, and (added in 0.3.0, not yet run) a quick edit that must stay inline, a risky change that should get the reviewer at `xhigh`, an escalation after a stopped implementer, and a user constraint that must reach the subagent's brief.

Last run (0.1.0, Claude Code 2.1.294, `--model sonnet --judge-model haiku --runs 1`, total cost $0.47):

| Case | With plugin | Without | Plugin indicator |
|---|---|---|---|
| solo-override | 1.0 | 1.0 | no subagent spawned |
| named-model-effort | 1.0 | 1.0 | Agent called with `model: sonnet`, `effort: medium` |
| verbose-tests-go-to-scanner | 1.0 | 1.0 | `crew-chief:scanner` used |
| routing-skill-fires | 1.0 | 0.0 | `crew-routing` skill loaded |

One run per arm is a smoke test, not a benchmark; use `--runs 3` or more before drawing conclusions.

## License

MIT
