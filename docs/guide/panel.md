# Panel row and status line

The agent panel row, the progress report, the status line for places the row cannot draw, and the row installer.

[← README](../../README.md) · [Türkçe](../rehber/panel.md)

The agent panel below the prompt shows each subagent's model and effort, for example `ui-tester  sonnet-5.5 · medium · 41.2k  Checking the login flow`. Claude Code reads a `subagentStatusLine` from a plugin's `settings.json` but does not apply it to the panel (checked on 2.1.296), so on your first session after install or update crew-chief copies the row script to `~/.claude/` and adds the key to your `settings.json` (needs `jq`; see [the row installer](#panel-row-installer)).

## Progress in the panel

The agent panel row shows how long each subagent has been running and, when the agent reports it, how far along it is and why it is slow:

```
implementer-hard  opus-5.5 · high · 232k · 4m12s · ~40%  Reading the auth module ⚠ slow test suite
```

- Elapsed time comes from the task's `startTime`; it needs nothing from the agent.
- Every subagent starts with a rule to send a one-line report every 10 tool calls (a `SubagentStart` hook adds it, and before a long command or when the phase changes too): a no-op Bash call `: 'crew-progress 40 | what I am on | why it is slow'`. `scripts/progress-hook.sh` (PostToolUse) picks it up by the agent's id, the row script reads it. The percent is the agent's own estimate, so the row marks it with `~`; it is not a measured value. The rule is also said by the mod at the agent's second call when it has not reported (the `SubagentStart` hook that carries it needs `jq`), and if an agent forgets, the mod adds a reminder to the result of its next call after each 10 calls without a report, louder each time one goes unanswered (`reminder 2: 20 tool calls ...`). Nothing is ever held back: a reminder rides with the result, it does not stop a call. That this reaches a subagent was seen live on Windows. Where an agent never reports, the band shows `34 calls · 4m12s` instead of a percentage. A report counts as fresh for 25 tool calls and 10 minutes; after that the row hides the percent, step and delay and shows `80 calls · report 41m ago` with the usual label. The call counts toward the agent's turn limit, so it stays to these moments.
- Without a report, or with a stale one, the row shows the usual label and no percent. A single tool call of 45 s or more adds `⚠ Bash took 61s` on its own.
- The read-only guard lets the report through, even for the read-only agents.

## Agent row status line

The panel row above is drawn by a shell script, so it needs a terminal with `jq` (and `sh`). For the places it cannot reach, the mod also keeps one status line above the prompt with every running subagent's model, effort and tokens:

```
scanner haiku-5.5·low 12.4k | implementer opus-5.5·medium 48.1k
```

- Model and effort come from each subagent request, after the [token saver](token-saver.md)'s cap; the tokens are the agent's latest request (input, cache and output: the size of its context), not a running sum. Names and who is still running come from Claude Code's agent list; the line is cleared when no subagent runs. The elapsed time stays in the shell panel row only. The `~40%` progress report is in both: the mod counts each subagent's calls itself (in memory, no `jq`, bash or node needed), so on Windows the line reads `reviewer opus-5.5·high ~40% 48.5k`. The percentage shows while the report is fresh (under 25 calls and 10 minutes old). Without `jq` the panel row below the prompt cannot show model and effort; crew-chief says so once in a toast with the install command (`winget install jqlang.jq` on Windows). Where `jq` is missing, the mod also sends the 10-call reminder that `scripts/progress-hook.sh` sends elsewhere, so an agent never gets it twice.
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
