# Settings: `/crew-config`

Every number crew-chief uses, changeable with `/crew-config` without environment variables.

[← README](../../README.md) · [Türkçe](../rehber/settings.md)

The numbers crew-chief uses are yours to change, without environment variables. `/crew-config` lists them with what they do and where each value comes from; `/crew-config set <name> <value>` saves one (in the plugin's store, kept between sessions; nothing is written to `settings.json` or the project); `/crew-config reset <name>|all` puts the default back. An environment variable of the same meaning still wins when it is set, and the command says so. A value that does not parse is refused, and an old value that went bad is ignored, so a typo never turns a feature off.

| Name | Default | What it changes |
|---|---|---|
| `compact.enabled` | on | The whole compact flow (`CREW_CHIEF_COMPACT=off`) |
| `compact.arm` | 250k | Context size at which Claude is told to propose a compaction at the next phase boundary (`CREW_CHIEF_COMPACT_ARM`) |
| `compact.ask` | 400k | Size at which crew-chief asks by itself when Claude never proposed one (`CREW_CHIEF_COMPACT_ASK`) |
| `compact.fallback` | on | Whether it may ask by itself at all; `off` means only when Claude proposes it or you type `/crew-compact` |
| `compact.reask` | 100k | After *Not now*, how much the context must grow before the next proposal |
| `compact.quiet` | 10 s | How long the session must stay quiet after a turn before the question opens |
| `compact.armpct`, `compact.askpct` | 60 %, 85 % | On a small window, the share of it that arms and asks (used only while you have not set the size yourself) |
| `saver.ask` | on | Whether the saver asks at the limit thresholds (`CREW_CHIEF_SAVER=off`; `/saver` still works) |
| `saver.five`, `saver.seven` | 70,80,90 and 50,75,85,90 | The limit percents that raise the saver question |
| `ask.timeout` | 20 min | Minutes before an unanswered question takes its safe answer, 1-30 or `off` (`CREW_CHIEF_ASK_TIMEOUT_MIN`) |
| `handoff.mode` | nudge | Keeping the handoff files current: `off`, `nudge` (reminders to Claude) or `turn` (also one extra turn asking for the update when reminders went unanswered); `CREW_CHIEF_HANDOFF` |
| `handoff.files` | 6 | Distinct project files edited since the handoff files were last written before Claude is reminded |
| `handoff.minutes` | 45 | Minutes of editing after which a third of that many files is enough |
| `handoff.max` | 6 | Most ordinary reminders per session |
| `panel.style` | `capsule` | How the band draws a running subagent outside the terminal: `capsule`, `cat` or `text` (no pictures); the terminal always gets the line (`CREW_CHIEF_PANEL_STYLE`, or `/crew-ui panel <name>`) |
| `panel.click` | on | Outside the terminal, a click on a subagent row of the band opens what it is doing under it, with *Full view* and a message field; `off` keeps the rows as plain lines (`CREW_CHIEF_PANEL_CLICK`). `/crew-agents` works either way |
| `panel.perf` | off | Performance mode, what stands still: `agents`, `theme`, `all` or `off` (see [Performance mode](performance.md); `CREW_CHIEF_PANEL_PERF`) |
| `agents.warn` | 5 | The band notes the cost of watching when more than this many subagents run at once |
| `notify.agent` | on | A toast when a subagent finishes (`CREW_CHIEF_NOTIFY_AGENT`) |
| `notify.native` | on | The same as a system notification through your own notification channel; skipped quietly where none can be raised (`CREW_CHIEF_NOTIFY_NATIVE`) |
| `notify.min` | 10 s | Seconds a subagent must have run before its end is announced, 0-3600; an error is always announced (`CREW_CHIEF_NOTIFY_MIN`) |

If a question comes too early for you: `/crew-config set compact.arm 400k`, `/crew-config set compact.ask 600k`, or `/crew-config set compact.fallback off`.

**Per project: `.claude/crew-chief.json`.** A project can carry its own values in this file, as flat keys (`{"compact.ask": "300k", "compact.arm": "200k"}`); they win over `/crew-config`'s saved values and lose to environment variables, and `/crew-config` marks them `[this project]`. The compaction question's "Don't ask again" is written there as `"compact.never": true`, so it holds for that project in later sessions too; `/crew-compact` removes it, `/crew-compact never` sets it.
