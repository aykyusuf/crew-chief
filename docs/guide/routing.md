# Routing and agents

How Crew Chief decides who does a piece of work (the main session or a tiered subagent), which agents exist, and how to override it.

[← README](../../README.md) · [Türkçe](../rehber/routing.md)

**Difficulty-based subagent routing for Claude Code.** You pick the main session's model and effort. Claude then decides, task by task, what to do itself and what to hand to a cheaper or stronger subagent, at the right effort. It escalates when a tier gets stuck and follows your overrides.

```
you ──▶ main session (your model/effort) ──┬─ does interactive, coupled, quick work itself
                                           ├─▶ scanner          haiku  / low     lookups, noisy logs
                                           ├─▶ deep-reader      sonnet / medium  multi-file analysis, web research
                                           ├─▶ mechanic         haiku  / low     rote edits with a verify command
                                           ├─▶ implementer      sonnet / medium  well-specified edits
                                           ├─▶ planner          opus   / medium  read-only plan before a big change
                                           ├─▶ implementer-hard opus   / medium  hard, multi-module work
                                           ├─▶ ui-designer      opus   / high    read-only design spec for big UI work
                                           ├─▶ ui-implementer   sonnet / medium  UI code, design skills preloaded (model/effort per call)
                                           ├─▶ ui-scout         sonnet / medium  design references: live sites + galleries, screenshots
                                           ├─▶ ui-smoke         haiku  / low     quick read-only UI check
                                           ├─▶ ui-tester        sonnet / medium  browser/emulator flows
                                           ├─▶ verifier         sonnet / high    checks done_when or a claim, tries to refute it
                                           ├─▶ critic           opus   / medium  strict rubric grade for visual/quality results
                                           └─▶ reviewer         opus   / medium  independent review
```

## Why

Out of the box, every subagent runs on whatever model and effort it was given, no matter how easy or hard the job is. Claude Code now lets the main session set `model` and `effort` per subagent call (2.1.292+), but something has to decide when to use them. Crew Chief is that decision layer, plus the tiers it routes to:

- **Routing policy** injected at every session start (and after `/clear` or compaction), so it is always active.
- **Tiered agents** with tight "use when / don't use when" descriptions, tool limits, turn limits, and a fixed report format.
- **Escalation ladder**: `implementer` → `implementer-hard` → main session, instead of retrying the same tier.
- **UI testing tiers**: `ui-smoke` for a quick read-only check and `ui-tester` for multi-step browser, emulator, or simulator flows, so screenshots stay out of the main context.
- **UI work with the design skills enforced**: a task that builds or restyles an interface goes to `ui-implementer`, which has the design skills loaded, follows a per-project UI profile, and does not ship Claude's default look. See [UI work](ui.md).
- **Read-only guard**: a hook that stops the scanner, deep-reader, reviewer, planner, ui-smoke, ui-designer (which may write only its design spec) and ui-scout (which may write only `.crew-chief/refs/`) from changing project files, changing git state, or installing anything, even when your session runs with permissions bypassed. The one write it allows is a long report into the crew-chief reports folder (see [Reports and skills](skills-and-reports.md)).
- **Skills that actually get used**: agents can load skills, the prompt gets a one-line reminder when the work matches an installed skill, and a one-time, opt-in line at the end of Claude's first answer suggests hand-checked skills for the project's stack. See [Reports and skills](skills-and-reports.md).
- **Overrides in plain language**: "do it yourself", "use agents", "give this to Sonnet at medium", or `/crew-chief:crew-mode solo`.
- **See who runs where**: the agent panel below the prompt shows each subagent's model and effort, for example `ui-tester  sonnet-5.5 · medium · 41.2k  Checking the login flow`. See [Panel and status line](panel.md).
- **Session handoff, offered once per project**: three small files (status, task list, progress log) so a new session picks up where the last one stopped. See [Session handoff](handoff.md).
- **A token saver that asks first**: at 70/80/90 % of your 5-hour limit (50/75/85/90 % weekly) it asks whether to cap subagent effort for this session, and warns about day-long sessions. See [Token saver](token-saver.md).
- **Compaction that loses nothing important, and only with your yes**: at a phase boundary Claude proposes it, you answer, the handoff files are updated first, then the conversation is compacted with a detailed brief, and your pinned rules and open tasks are put back from the files. See [Compact flow](compact.md).
- **Limit resets and `continue`**: a toast when a limit you were close to resets, and, when a limit stops Claude, an offer to send "continue" at the reset. See [Limit resets](limits-and-audit.md#limit-resets).
- **`/crew-tidy` and `/crew-report`**: what in your context is oversized, stale or repeated (nothing changes, except an archive move you confirm), and tokens and cost by model and by main or subagent. See [Context audit and report](limits-and-audit.md#context-audit-and-report).
- **`/crew-chief:crew-brief`**: you act as the manager and Claude writes one approved brief for you. See [Briefs](brief.md).
- **An advisor offer, once**: if the experimental `/advisor` is off, it explains the benefit and offers to turn it on. See [Advisor offer](advisor.md).
- **Solo that holds**: `/crew-chief:crew-mode solo` is enforced by a hook that blocks the Agent tool, not just requested in the prompt.
- **Update notices**: after an update, your first prompt shows what changed, and an open session is told once when it is still running the old copy. See [Updating](updating.md).
- **A mechanism guide** (`routing` skill) for when one subagent is the wrong tool: forks, Monitor, `/loop`, `/goal`, dynamic workflows, agent teams, routines.

Two more agents are described elsewhere: `researcher` (Sonnet, web access; see [Research](research.md)) and `security-reviewer` (Opus, medium; see [Security review](security.md)).

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

## How routing decides

Delegate only when the work is self-contained **and** it can run in parallel, would flood the main context, or a cheaper tier can do it equally well. Otherwise the main session does it. Multi-agent setups cost several times the tokens of one session and most coding work is tightly coupled, so the default leans towards doing it yourself. Difficulty is read from what is visible (scope, whether a check exists, ambiguity, whether the root cause is known, blast radius), not guessed. When a subagent fails, the rule is to diagnose before escalating: careless means raise effort, out of its depth means raise the model. Escalation also triggers on evidence (check not run, files changed outside the brief, `maxTurns` hit), and a task that turns out harder mid-run can be steered, stopped, or resumed on a stronger model. The optional [advisor](../../skills/crew-routing/references/model-and-effort.md) (`/advisor`, experimental) lets a cheaper agent consult a stronger model itself.

The full policy is in [skills/crew-routing/SKILL.md](../../skills/crew-routing/SKILL.md), with [mechanisms](../../skills/crew-routing/references/mechanisms.md) and [model and effort](../../skills/crew-routing/references/model-and-effort.md) references summarised from the official Claude Code docs.
