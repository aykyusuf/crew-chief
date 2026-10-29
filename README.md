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
- **Skills that actually get used**: agents can load skills, the prompt gets a one-line reminder when the work matches an installed skill, and a one-time, opt-in line at the end of Claude's first answer suggests hand-checked skills for the project's stack. See [Reports and skills](#reports-and-skills).
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
| `CREW_CHIEF_ROW_MOD=auto`, `on` or `off` | The [agent row status line](#agent-row-status-line): `auto` (default) shows it on the Desktop app, VS Code and terminals where the shell panel row cannot draw; `on` always; `off` never |
| `CREW_CHIEF_GUARD=auto`, `on` or `off` | The [command guard](#command-guard): `auto` (default) follows `~/.claude/crew-chief-guard.json` (`"enabled": true`), which the first interactive session writes with default rules; `on` turns on the built-in rules even without the file; `off` never (and prevents the first write) |
| `CREW_CHIEF_GUARD_AUTOSETUP=off` | Do not write the default guard config on the first interactive session (the guard then stays off until you create the file or run `/crew-guard on`) |
| `CREW_CHIEF_ASK_TIMEOUT_MIN=10` | Minutes before an unanswered question takes its safe answer (default 20, at most 30; `off` or `0`: questions wait for you) |

**Questions never wait forever.** Every question the mod asks (saver, advisor offer, compaction, the compaction gate, limit reset, `/crew-tidy archive`) counts as answered with its safe choice when nobody answers for 20 minutes: *Not now* for the saver and the compaction, *No* for the limit reset, *Remind me in a week* for the advisor offer, *Cancel* for the compaction gate and the archive. Never the yes, and never *Don't ask again*. A toast says so (`No answer for 20 min: treated as "Not now".`). The mod moves on in every case; where it can, it also closes the dialog (it answers its own `AskUserQuestion` call), but a question raised between turns may stay on screen, and a late click on it then changes nothing. An `AskUserQuestion` that Claude itself raises is never touched.

**Needs:** Claude Code 2.1.287 or later (older versions never load the mod; the first prompt after install tells you), and a Pro or Max plan for the limit data (with an API key the mod stays quiet; the context and age toasts still work). The questions need an interactive session; `claude -p` never asks.

Measured on Claude Code 2.1.295: the limits are available right when a session starts, and match `/usage` and the status line. For a hard cap that needs no questions, set `"maxEffortLevel": "medium"` in your settings.

## Compact flow

A long conversation costs more with every request and answers worse. `/compact` helps, but it replaces the conversation with a summary, and details, especially rules you stated early, can fall out of it. This flow makes compaction a decision you take at a good moment, with safeguards.

1. **Arming.** Past **250k tokens** (on a small window: 60 % of it), your next prompt carries a one-time note telling Claude to call the tool `crew_compact_checkpoint` at the next natural phase boundary (a task finished, tests green; never in the middle of work). Claude decides when a phase is over.
2. **Asking.** The tool only takes note and returns at once, so Claude's turn never waits for you. You are asked after that turn has ended with an answer and the session has then stayed quiet for **10 seconds** (no new prompt, no model request, no subagent running); if something started in those seconds, you are asked at the next such turn end instead. If Claude never calls the tool, the same happens once the context passes **400k** (85 % of a small window). *Not now* asks again after another 100k tokens; *Don't ask again this session* ends it; no answer for 20 minutes counts as *Not now* (`CREW_CHIEF_ASK_TIMEOUT_MIN`, see [Token saver](#token-saver)). Nothing is compacted without a yes.
   **Only at a real pause.** Nothing is proposed, and an approved compaction does not start, while a subagent is running (`$.agent.list()`: pending or running; a subagent `waiting` on a server it started, on a plan's approval or on another agent is shown but not waited for): a subagent always finishes and brings a result back, so it must not be cut in half. The question then waits for the next finished turn. Only a turn that ended with an answer counts (not an interrupt, an error or a refusal). A dev server or watcher left open in the background is never waited for, because it never ends and a compaction does not touch it; the question shows it instead (`Now: subagents running: 0, background processes: 2 (npm run dev, uvicorn app:app), uncommitted files: 3`) and the summarizer is told to keep its task id and command, because after a compaction Claude no longer remembers the handles of background tasks it started ([anthropics/claude-code#29193](https://github.com/anthropics/claude-code/issues/29193)). The background processes come from the Stop event's task list, which a mod receives only where the settings-hook events reach it; the other numbers do not depend on that.
3. **Updating.** On yes, Claude updates the project's handoff files that exist: `STATUS.md` (including **Constraints**: your rules, copied verbatim), `tasks.json`, `PROGRESS.md`. Compaction waits until `STATUS.md` has changed. If it did not, you are asked: *Compact anyway*, *Ask Claude to update first*, or *Cancel*. In a project without handoff files, Claude does not ask; the compaction goes ahead, and its closing line mentions once that `/crew-chief:crew-handoff` sets them up. Without handoff files only the brief, the saved summary and the transcript path protect your rules.
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

## Command guard

**On after the first interactive session, with default rules.** The first time crew-chief starts in an interactive session (not `-p`, the SDK or the cloud) and `~/.claude/crew-chief-guard.json` does not exist, it writes a default config once and the guard is on from that session: the built-in rules, and an ssh warning on the first contact with any host except localhost, 127.0.0.1, `::1` and `*.local` (nothing is stopped; set `ssh.mode` to `"gate"` and list your production hosts to stop the first attempt). One toast says so. Delete the file and crew-chief will not recreate it; `CREW_CHIEF_GUARD_AUTOSETUP=off` or `CREW_CHIEF_GUARD=off` prevents the first write. A small part of the mod (`hooks/src/guard.js`, rules in `hooks/guard-logic.mjs`) that looks at each Bash, Read, Write and Edit call before it runs, in the main session and in subagents.

**What it does when on.** Three levels:

| Level | What happens | Built-in rules at this level |
|---|---|---|
| `deny` | Never runs. Claude gets the reason, you get a toast | `rm -rf` on `/`, `~`, `$HOME` or a bare `*` (`rm-rf`); writing the guard's own config (`guard-config`, cannot be disabled) |
| `confirm` | The **first attempt** is stopped. Claude gets a short checklist and decides by itself, without asking you and waiting: what exactly runs and where, what can be lost, is there a verified backup or a way back, is the target really the right one, SAFE or RISKY. If SAFE it runs **exactly the same command** again and it passes silently (no toast, no note) within `confirmTtlMinutes` (default 360). A changed command is a new command. A subagent is told to report to its caller when unsure; a read-only agent gets a plain deny | risky `rm -rf` (absolute, home, parent, hidden or wildcard path), `DROP`/`TRUNCATE`, `DELETE`/`UPDATE` without `WHERE`, `git push --force`, `git reset --hard`, private key files (`.pem`, `.p12`, `.pfx`, `id_rsa`, `id_ed25519`; a `.pub` is fine) read, written or copied, deploy commands, stopping, restarting or disabling a service, a database client over `ssh` |
| `warn` | Runs, then a notice for you and a line for Claude | `rm -rf` inside the project, reading, editing, `cat` or `git add` of a `.env` file |

Your own rules use the same three levels. Rule ids: `guard-config`, `rm-rf`, `sql-destructive`, `git-force-push`, `git-reset-hard`, `key-write`, `key-read`, `key-access`, `env-write`, `env-read`, `env-stage`, `env-access`, `ssh-db`, `sql-no-where`, `prod-deploy`, `service-control`.

**Claude flags what your config misses, without stopping.** While the guard is on, the first prompt of a session carries one note telling Claude to call the tool `crew_guard_suggest` (`kind`: host, path, command, secret or other; `value`; `reason`) when it meets a production host, a critical path, a secret or a dangerous command the guard does not cover. The tool returns at once and never opens a dialog; the note stays in memory for the session (at most 50, duplicates dropped, a secret keeps only its name, long tokens are hidden). The first one shows a toast. `/crew-guard` (or `/crew-guard status`) shows whether the guard is on and why, rule counts by level, the ssh mode and host count, first contacts made, and how many suggestions there are; `/crew-guard suggestions` lists them with a ready-to-paste JSON piece each (a host for `ssh.prodHosts`, a path or command as a `confirm` rule). It only prints. `/crew-guard off` and `/crew-guard on` are the one exception: they set `"enabled"` in the config and keep everything else (with no file, `on` writes the default and `off` writes `"enabled": false`), refuse a file that is not valid JSON, apply at once, and work only when you type them yourself, never when Claude, a plugin or the SDK runs them.

**The config is yours.** A Write or Edit to `crew-chief-guard.json`, or a Bash command that writes it (`>`, `>>`, `tee`, `sed -i`, `perl -i`, `mv`, `cp` onto it, `rm`, `dd of=`, `python -c`/`node -e` naming it, also inside `bash -c`), is always denied with "the guard configuration can only be changed by the user; propose the change with crew_guard_suggest". Reading it is allowed. This is a speed bump too: a script file, or a path built from variables, still gets through. Rule ids: `rm-rf`, `sql-destructive`, `git-force-push`, `git-reset-hard`, `key-write`, `key-read`, `key-access`, `env-write`, `env-read`, `env-stage`, `env-access`, `ssh-db`, `sql-no-where`, `prod-deploy`, `service-control`.

**Turning it on or off.** The first interactive session writes the file for you (see above); `/crew-guard off` and `/crew-guard on` switch it. To write your own instead, create `~/.claude/crew-chief-guard.json` with `"enabled": true` (start from [`docs/examples/crew-chief-guard.example.json`](docs/examples/crew-chief-guard.example.json)), or set `CREW_CHIEF_GUARD=on` for the built-in rules without a file. `CREW_CHIEF_GUARD=off` always wins; the default `auto` follows the file. The file is read once when a session starts (`/clear` and `/resume` read it again). A file that is not valid JSON turns the guard off for that session and says so in one toast. A bad rule is skipped (the reason goes to the debug log); the rest still work.

```json
{
  "enabled": true,
  "rules": [
    { "id": "mdb-write", "level": "deny", "tools": ["Write", "Edit"], "target": "file_path",
      "pattern": "(\\.mdb|\\.accdb|/databases/)", "flags": "i", "unless": "/backup/",
      "text": "write to a branch database path" }
  ],
  "disable": ["prod-deploy"],
  "ssh": { "mode": "gate", "prodHosts": ["prod.example.com", "*.prod.example.com", "deploy@10.0.0.5"],
           "safeRemote": ["pm2 (list|status|logs)( .*)?"], "ttlMinutes": 30 }
}
```

- `rules`: your own rules, at most 100. `level` is `deny` or `warn`; `tools` lists tool names (`"*"` for any); `target` is `command` (the Bash command, the default) or `file_path`; `pattern` and the optional `unless` are JavaScript regular expressions of at most 300 characters; `flags` may use `i`, `m`, `s`, `u`. A deny beats a warning; at the same level your rule is reported before a built-in one.
- `disable`: built-in rule ids to switch off.
- `ssh`: the gate below. `mode` is `off` (default), `warn` or `gate`.

**The ssh gate** (`ssh.mode: "gate"`). For `ssh`, `scp`, `sftp` and `rsync` calls to a host in `prodHosts` (`*` is the only wildcard; case does not matter; `user@host` matches that user only; a `-J`/ProxyJump host counts too). The command is read with a small quote-aware tokenizer: options (`-p`, `-i`, `-l`, `-o`, `-J`), `user@host`, the remote command, `&&`/`;`/`|` inside it, `sudo`, `env`, `timeout`, `bash -c "..."`.
1. **First contact.** The first call that touches a production host in a session, per agent, is held once. Claude is asked to write down what really runs on the server, whether it can lose data, stop or restart a service, change config or expose secrets, and whether a read-only way exists, and to run the identical command again only if it is safe.
2. **Read-only commands pass** after that: `ls`, `cat`, `head`, `tail`, `grep`, `find` (without `-delete`/`-exec`), `df`, `du`, `free`, `uptime`, `ps`, `journalctl` (without `--vacuum`/`--rotate`), `systemctl status`, `docker ps`/`logs`, `git status`/`log`/`diff`, `hostname`, `whoami`, `date`, `stat`, `wc`, also piped together, plus your `safeRemote` patterns (each must match a whole part of the remote command). Reading `.env`, key files or `/etc/shadow` does not count as read-only here.
3. **Anything else is held once per command**; the identical command within `ssh.ttlMinutes` (default: `confirmTtlMinutes`, 360) passes. File copies with `scp`, `sftp` or `rsync`, an `ssh` without a command (an interactive session), and anything the tokenizer cannot resolve (a heredoc, a variable, command substitution, `xargs ssh`, a custom `-F` config, `ProxyCommand`) count as risky.
4. **Read-only agents** (`scanner`, `deep-reader`, `reviewer`, `ui-smoke`) get a plain deny for anything but read-only commands, with no retry.
5. `warn` mode never holds a call; it adds the same reminder after the call. The state is kept in memory for the session and never written.

**Honest limits.** This is a speed bump, not a security boundary. It reads command text. A script copied to the server and run, a variable, an ssh config alias that is not listed as written, another tool (an MCP server, Python's paramiko), a mode without hooks, or a model that decides not to call the tool all get past it, and nothing here protects you from instructions hidden in what a server prints back. A retry after a hold only shows that the model was asked to think once. The rules match words, so a commit message or a heredoc that only mentions a blocked command is held too; `disable` turns such a rule off. What protects a server is on the server: a forced command in `authorized_keys` (`command="...",restrict`, with `SSH_ORIGINAL_COMMAND` checked against an allowlist), a restricted account for the agent, a read-only database user, and backups you have restored at least once.

**How it differs from the read-only guard.** `scripts/readonly-guard.sh` is always on and only for crew-chief's read-only agents: it blocks every write (files, git, installs) they try. The command guard is opt-in, for every agent and the main session, and only about dangerous commands and production hosts. Read-only agents keep their own guard; the ssh gate only adds the remote-command check for them.

**Moving from a personal guard mod.** If you have your own mod with rules like these (a "prod-guard"), put its personal rules into `rules` (the example file reproduces such a mod: branch databases, license keys and a "never open a branch" rule), turn this guard on, then remove or disable your own mod. With both on, each warning and block appears twice.

## What the mod does with your machine

For reviewers and for you. Everything below happens inside Claude Code on your machine; the mod has no network access and sends nothing anywhere.

| What | Where | Why |
|---|---|---|
| **Reads files** (`$.fs.read`, `exists`, `list`, `stat`) | The project's `STATUS.md`, `tasks.json`, `PROGRESS.md`; the instruction and memory files Claude Code loaded (the list `/context` shows), only for `/crew-tidy`; file times for the compact gate | To check the summary against your pinned rules and open tasks, to audit context, to wait until `STATUS.md` was updated |
| **Reads settings** (`$.settings.read`) | Only the `language` and `advisorModel` keys | To speak your language and to know whether the advisor offer applies. It never reads API keys, tokens or any credential |
| **Reads environment** (`$.env.get`) | `HOME` (`USERPROFILE` when `HOME` is unset), `TMPDIR`, `LANG`, `OS`, the `CREW_CHIEF_*` switches, and a few `CLAUDE_CODE_USE_*` flags | Paths, language, switches, whether a cloud provider route is in use, and whether this is Windows (`OS=Windows_NT`, for the agent row) |
| **Runs programs** (`$.process.run`) | `wc -l <transcript>` (count lines before and after a compaction); `git status --porcelain` (count uncommitted files, shown in the compact question); `chmod 600 <file>` (make its own backups private); `rm -f <old backup>` (delete only its own backups beyond the newest 5 or 3); `mkdir -p`, `cp -p <transcript> <backup>` (only if a compaction ever lost transcript lines); `jq --version` (once a session, only in a plain terminal, to know whether the shell panel row can draw). The arguments are paths the mod computes, not text from the conversation | Backups and the transcript check |
| **Runs a slash command** | `/advisor`, once, only after you said yes to the [advisor offer](#advisor-offer) | To turn the advisor on for you |
| **Submits prompts** (`$.prompt.submit`) | Two fixed texts, framed as coming from crew-chief (never as your own words): "update the handoff files" after you approved a compaction, and "continue where you left off" at a limit reset you approved. They contain no file contents and no conversation text | To carry out what you approved |
| **Writes files** (`$.fs.write`) | Its own data folder (`compact-summaries/`); and, only when you confirm `/crew-tidy archive`, `PROGRESS.md` (shortened) and `PROGRESS-archive.md` (the old entries). It never writes your instruction files, settings, or build files | Backups; the archive you asked for |
| **Registers a tool** | `crew_compact_checkpoint`, which only notes that a phase ended and tells Claude to carry on; you are asked after the turn | The phase-boundary proposal |
| **Answers its own questions** (a `tool.call` hook on `AskUserQuestion`) | Only the dialogs the mod itself opened: after `CREW_CHIEF_ASK_TIMEOUT_MIN` minutes (default 20) without an answer it answers with the question's safe choice (never yes, never *Don't ask again*). Claude's own `AskUserQuestion` calls pass through untouched | So an unattended session is not held by a plugin question |
| **Draws one status line** (`$.ui.status`), reads the session's surfaces (`$.session.surfaces`) and agent list (`$.agent.list`) | The [agent row](#agent-row-status-line): each running subagent's name, model, effort and tokens, cleared when none runs | So the model and effort of subagents show on the Desktop app, VS Code and Windows too. Nothing is stored or sent |
| **Command guard** (a `tool.call` hook; on after the first interactive session) | Unless `CREW_CHIEF_GUARD=off`, reads `~/.claude/crew-chief-guard.json` once per session start (`HOME`, or `USERPROFILE` on Windows). Once, on the first interactive session with no such file (and unless `CREW_CHIEF_GUARD_AUTOSETUP=off`), writes it with default rules and stores `guard_setup` (`done` or `failed`) in the plugin's store so a deleted file is never recreated; afterwards writes it only when you type `/crew-guard on` or `off`. Only when it is on: reads the text of each Bash command and file path; may refuse a tool call (with a reason for Claude and a toast for you, which shows at most 80 characters of the command) or add a warning after it; reads the agent list only to know whether an agent is read-only. No network, nothing stored or written; the ssh gate's memory ends with the session | The [command guard](#command-guard) |
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

**How it is offered.** On a fresh session start (not resume, `/clear`, or compaction) in a git repository that has none of these files yet, the session hook asks Claude to do your request first and then add one short line at the end of its answer offering the files (never a dialog; skipped for overnight, background or looped jobs and non-interactive runs). Showing it counts as *later* (offered again after 7 days); say yes to set them up, or "never" for this project. The hook stays quiet:
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
| `scripts/subagent-row.sh` | Agent panel refresh, while subagents run | Reads the panel's row data (agent type, model, effort, tokens, start time) and prints the row text: elapsed time, and the reported percent, step and delay reason while the agent's report is fresh (see [Progress in the panel](#progress-in-the-panel)). Needs `jq`; without it the default rows stay |
| `scripts/skill-hint.sh` | UserPromptSubmit | Adds a one-line "load the X skill" reminder when the prompt matches a kind of work in `data/skill-catalog.json` and a preferred skill is installed. Remembers per session which hints it gave (`${CLAUDE_PLUGIN_DATA}/skill-hints/`). Needs `jq` |
| `scripts/skill-offer.sh` | SessionStart (startup only) | Prints the one-time [skill offer](#reports-and-skills) when the project's stack has hand-checked skills and none is installed. Answers are kept in `skill-offers.tsv`. Needs `jq` |
| `scripts/skill-lib.sh` | (sourced) | Lists the installed skills for the two scripts above |
| `scripts/progress-hook.sh` | PostToolUse (subagent calls only) | Keeps one small file per subagent in `${TMPDIR:-/tmp}/crew-chief-progress/` (tool count, last tool, a slow-call note, and the agent's own `crew-progress` report with the tool count and time when it was sent); files older than 12 hours are removed. After every 10 tool calls without a report it adds a reminder to the agent's context. Needs `jq` |
| `scripts/subagent-start.sh` | SubagentStart | Gives every subagent the progress-report rule as starting context, so it no longer depends on each brief. Needs `jq` |
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

**A one-time skill offer.** On a fresh start in a git project, `scripts/skill-offer.sh` looks at the stack (`pubspec.yaml`, `package.json`, `*.xcodeproj`, `supabase/config.toml`, ...). If none of the preferred skills for it is installed, Claude does your request first and then adds one short line, in your language, at the end of its answer offering to install the hand-checked ones from the catalog (never a dialog; skipped for overnight, background or looped jobs): name, source, what it does, the exact install command, and a note on risks. Nothing is installed without your yes, and nothing in the project is touched. "Not now" pauses a week, "Never" is remembered per project and kind of work. The list was verified on the date in the catalog (`verified`); Claude is told to say so and offer a web check when it is older than 90 days. Skills that fetch instructions at run time or run scripts are left out of the offer on purpose. The catalog also holds one kind of work that is not a stack: the project map ([structure-map](https://github.com/aykyusuf/structure-map)), offered in any code project with at least 60 tracked files (`minFiles` in the catalog) unless it is installed. `CREW_CHIEF_SKILL_OFFER=off` turns it off.

## Progress in the panel

The agent panel row shows how long each subagent has been running and, when the agent reports it, how far along it is and why it is slow:

```
implementer-hard  opus-5.5 · high · 232k · 4m12s · ~40%  Reading the auth module ⚠ slow test suite
```

- Elapsed time comes from the task's `startTime`; it needs nothing from the agent.
- Every subagent starts with a rule to send a one-line report every 10 tool calls (a `SubagentStart` hook adds it, and before a long command or when the phase changes too): a no-op Bash call `: 'crew-progress 40 | what I am on | why it is slow'`. `scripts/progress-hook.sh` (PostToolUse) picks it up by the agent's id, the row script reads it. The percent is the agent's own estimate, so the row marks it with `~`; it is not a measured value. If an agent forgets, `scripts/progress-hook.sh` adds a reminder to its context after each 10 calls without a report (that the reminder reaches a subagent is the natural reading of the hooks docs, not verified live). A report counts as fresh for 25 tool calls and 10 minutes; after that the row hides the percent, step and delay and shows `80 calls · report 41m ago` with the usual label. The call counts toward the agent's turn limit, so it stays to these moments.
- Without a report, or with a stale one, the row shows the usual label and no percent. A single tool call of 45 s or more adds `⚠ Bash took 61s` on its own.
- The read-only guard lets the report through, even for the read-only agents.

## Agent row status line

The panel row above is drawn by a shell script, so it needs a terminal with `jq` (and `sh`). For the places it cannot reach, the mod also keeps one status line above the prompt with every running subagent's model, effort and tokens:

```
scanner haiku-5.5·low 12.4k | implementer opus-5.5·medium 48.1k
```

- Model and effort come from each subagent request, after the [token saver](#token-saver)'s cap; the tokens are the agent's latest request (input, cache and output: the size of its context), not a running sum. Names and who is still running come from Claude Code's agent list; the line is cleared when no subagent runs. The elapsed time stays in the shell panel row only. The `~40%` progress report is in both: the mod counts each subagent's calls itself (in memory, no `jq`, bash or node needed), so on Windows the line reads `reviewer opus-5.5·high ~40% 48.5k`. The percentage shows while the report is fresh (under 25 calls and 10 minutes old). Without `jq` the panel row below the prompt cannot show model and effort; crew-chief says so once in a toast with the install command (`winget install jqlang.jq` on Windows). Where `jq` is missing, the mod also sends the 10-call reminder that `scripts/progress-hook.sh` sends elsewhere, so an agent never gets it twice.
- Too long for one line (190 characters): the tokens go first, then the effort, then the last agents (`+2 more`). Claude Code puts its own mark and the plugin name in front; that part cannot be changed.
- When it shows (`CREW_CHIEF_ROW_MOD`, default `auto`): whenever the session also draws somewhere other than the terminal (the Desktop app, the VS Code extension, the mobile app), and in a terminal only when the shell panel row cannot draw there, that is when `jq` is missing (checked once a session with `jq --version`; Windows is no different: with `jq` installed the panel row below the prompt shows model and effort there too, and the line above it stays away). `on` shows it in every session that draws anything, `off` never. Never in `claude -p` or the SDK, where nothing is drawn.
- Where it was checked: in a terminal (a live session drew it). VS Code: documented (extension 2.1.299 or later shows a mod's status line above the prompt box, cut at 200 characters), not run here. The Desktop app: expected, not verified (it draws mods, but its status line is not documented). Windows: by design (no `jq` there by default), not run on a Windows terminal.

## Panel row installer

On a fresh session, `scripts/install-row.sh` puts the agent panel row into your own `~/.claude/settings.json`, because a plugin-supplied `subagentStatusLine` does not reach the panel. What it does:

- Copies `subagent-row.sh` to `~/.claude/crew-chief-subagent-row.sh` and adds `"subagentStatusLine": {"type": "command", "command": "\"$HOME/.claude/crew-chief-subagent-row.sh\""}`. The copy follows the plugin version.
- Never touches a `subagentStatusLine` that is not its own, and installs once: if you delete the key later it is not added back.
- Keeps one backup (`settings.json.crew-chief-bak`), checks the JSON before writing, and writes in place so a symlinked `settings.json` stays a symlink.
- Does nothing without `jq`, with an invalid `settings.json`, or when `CLAUDE_CONFIG_DIR` is not `~/.claude`. `CREW_CHIEF_ROW=off` turns it off.
- Undo: delete the `subagentStatusLine` key and the `~/.claude/crew-chief-subagent-row.sh` copy.

## crew-ui: the band, the questions and the panes

**Off until you ask.** `/crew-ui on` draws a band above the prompt (terminal and Desktop app; VS Code keeps its status line). It never writes to `settings.json`. It is a small part of the mod (`hooks/src/crew-ui.js`, layout in `hooks/ui-logic.mjs`).

- **What it shows.** One line per running subagent (`deep-reader  sonnet-5.5 ●●○○○ medium ▓▓░░░░ 40%  12k  reading auth`), and a status line with the context (with a small graph of the last turns), the 5 h and 7 d limits, the guard, the saver and a compact key. The effort meter has five dots, one per level (`low` to `max`); `max` is a rainbow where colour is drawn.
- **Quiet by default.** The band shows only what is worth a look: a running subagent, a limit or the context from 70 %, something the guard stopped, a compaction due. With nothing to say it is not drawn. `/crew-ui full` shows everything all the time. In the terminal, when you have a `statusLine` of your own, the quiet band leaves out the context and the limits (that line has them); the Desktop app has no such line and shows them.
- **Looks.** `/crew-ui style boxed|plain|color|pills` (default `boxed`: a rounded frame); `/crew-ui demo on` draws sample content so a style can be judged without a busy session.
- **Your questions as buttons.** While the band is on, the plugin's own questions (compact, compact gate, limit and saver, advisor offer, limit reset, `/crew-tidy archive`) are asked in the band instead of a dialog: a lilac strip with `1 Yes  2 Not now ...`. Press the digit with an empty prompt (or `ctrl+x tab`, then the key). Nothing is held; unanswered, it expires to the safe answer after the usual 20 minutes. VS Code, a band that is off, or more than four answers use the old dialog. Claude's own questions (AskUserQuestion) are never touched.
- **Small touches** (`/crew-ui extras off` to remove): the model and effort after the spinner word and before the turn line (`opus ●●○○○ · Baked for 3s`), a note in the footer's mode labels while the saver is on or the guard stopped something, a limit note after the prompt hint. `/crew-ui words on` also swaps the spinner word for a calm one by model (`Pondering`, `Working`, `Skimming`); off by default.
- **Panes.** `/crew-panel tasks` lists the project's `tasks.json`, `/crew-panel agents` draws a timeline of this session's subagents (when each started and ended, model, effort, tokens), `/crew-panel guard` lists what the command guard stopped, denied or warned. They open on request, refresh every two seconds, close with `ctrl+x x` or `/crew-panel close`, and run while a subagent works.
- **Where it was seen.** The band, the quiet and full modes, the `boxed` style, the turn-line touch and the effort meter were seen live in a terminal. The questions in the band, the panes, the spinner words, `color` and `pills` are covered by tests only so far.
- **Environment.** `CREW_CHIEF_UI=on|off` beats the saved choice.

## Privacy

Crew Chief collects and sends no data. Its hooks run locally and print text or an exit code. They read the hook input Claude Code passes them (the session's project path and id, your prompt to spot `/crew-chief:crew-mode` and to match the skill hints, and the Bash command or file path a subagent is about to use) and, at session start, look at the project itself: whether it is a git repository, whether `CLAUDE.md` or handoff files exist, and which stack files (`pubspec.yaml`, `package.json`, ...) it has, and which skills are installed on your machine, only to decide about the skill offer and hints. What is stored stays in `~/.claude/plugins/data/<plugin>/` on your machine, which Claude Code deletes when you uninstall the plugin: your answer to the handoff offer (`handoff-offers.tsv`: a line per answer, the project path and `installed`, `never`, or `later` with a timestamp; the latest line per project counts), the plugin version you were last told about (`last-seen-version`), the plugin version for which it last checked your Claude Code version (`claude-version-checked`), and small per-session marker files for solo mode (`modes/`), the stale-session notice (`stale-notified/`) and the skill hints already given (`skill-hints/`), named by session id and pruned when newer ones are written once they are two weeks old, and your answers to the [skill offer](#reports-and-skills) (`skill-offers.tsv`: project path, kind of work, and `installed`, `never`, or `later` with a timestamp). Subagent progress files and long reports live in your temp directory (`crew-chief-progress/`, `crew-chief-reports/`), outside the plugin's store. The plugin writes into your project only when you say yes: `/crew-handoff` creates the handoff files you confirmed, `/crew-tidy archive` appends old entries to `PROGRESS-archive.md` and shortens `PROGRESS.md` after you confirm, and at a compaction you approved, Claude (not the plugin's scripts) updates `STATUS.md`, `tasks.json` and `PROGRESS.md`. Beyond that, the plugin keeps in its data folder: `compact-summaries/` (the raw summary of each compaction, last 5, readable only by you) and, only if a compaction ever lost transcript lines, `transcripts/` (a copy of the session transcript taken before later compactions, last 3, readable only by you); a plugin loaded from a plain directory, without a data folder, uses `${TMPDIR:-/tmp}/crew-chief-compact/` instead. The files it writes outside the plugin's store are your `~/.claude/settings.json` (plus `crew-chief-subagent-row.sh`, a backup, and a marker next to it), once, to add the panel row; see [Panel row installer](#panel-row-installer); and `~/.claude/crew-chief-guard.json`, once, on the first interactive session when it is missing, and later only by `/crew-guard on` or `off`; see [Command guard](#command-guard). The saver reads your plan usage, context size, and the first lines of your prompts (only to tell Turkish from English) inside Claude Code, keeps just the detected language (`tr` or `en`), your answer to the advisor offer (`answered`, `never`, or a pause time), whether the transcript kept its lines in a compaction (`transcript_kept`) and the shortest and longest idle gaps it has seen the prompt cache expire or survive (`cache_hint`) in the plugin's store, and sends nothing anywhere. The compact flow reads your handoff files, the instruction and memory files Claude Code loaded, the session transcript's line count (`wc -l`) and, to copy it if needed, the transcript file itself; none of that leaves your machine. The [command guard](#command-guard) reads `~/.claude/crew-chief-guard.json` at session start and, only when it is on, the text of each command and file path. It writes that file once, on the first interactive session when it is missing, and afterwards only when you type `/crew-guard on` or `off`; in the plugin's store it keeps only `guard_setup` (`done` or `failed`). There is no telemetry or network access. Bug reports go to [GitHub issues](https://github.com/aykyusuf/crew-chief/issues).

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
node --test tests/*.test.mjs               # saver, compact, tidy, report and agent row logic, messages, language detection (plain Node)
claude plugin test                         # the mod's hooks (saver, compact, resets, tidy, report, agent row), with stubs (no session, no network)
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
