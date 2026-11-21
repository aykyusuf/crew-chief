# Crew Chief

**Difficulty-based subagent routing for Claude Code.** Crew Chief is a Claude Code plugin. You pick the main session's model and effort; Claude then decides, task by task, what to do itself and what to hand to a cheaper or stronger subagent at the right effort. It escalates when a tier gets stuck and follows your overrides. Around that core it adds guards (a read-only guard for reading agents and a command guard for dangerous commands), a token saver, a compact flow that loses nothing important, session handoff files, UI work with the design skills enforced, night mode, sourced research and security review.

[Türkçe README](README.tr.md)

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
                                           ├─▶ researcher       sonnet / medium  web research, claims with URL + quote
                                           ├─▶ security-reviewer opus  / medium  security review at a trust boundary
                                           └─▶ reviewer         opus   / medium  independent review
```

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

## Update

Third-party marketplaces do **not** auto-update by default, so turn it on once: `/plugin` → **Marketplaces** → `crew-chief` → **Enable auto-update**. Or update by hand: `claude plugin update crew-chief@crew-chief`. An update does not change a session that is already running: run `/reload-plugins` there. Details and the "what's new" notice: [Updating](docs/guide/updating.md).

## Why

Out of the box, every subagent runs on whatever model and effort it was given, no matter how easy or hard the job is. Claude Code now lets the main session set `model` and `effort` per subagent call (2.1.292+), but something has to decide when to use them. Crew Chief is that decision layer, plus the tiers it routes to:

- **Routing policy** injected at every session start (and after `/clear` or compaction), so it is always active.
- **Escalation ladder**: `implementer` → `implementer-hard` → main session, instead of retrying the same tier.
- **Read-only guard**: a hook that stops the reading agents from changing project files, changing git state, or installing anything, even when your session runs with permissions bypassed.
- **Overrides in plain language**, and **solo that holds**: `/crew-chief:crew-mode solo` is enforced by a hook that blocks the Agent tool.

## Use

Nothing to do: start a session, pick your model and effort as usual, and work. Crew Chief's policy tells Claude when to delegate.

| You say | What happens |
|---|---|
| *(nothing)* | `auto` mode: routed by difficulty |
| "do it yourself", "no subagents" | `solo`: everything stays in the main session |
| "use agents", "delegate this" | `delegate`: independent pieces go to tiers in parallel |
| "give the tests to Haiku", "Sonnet at medium for this" | The subagent runs with exactly that model/effort |
| `@agent-crew-chief:implementer-hard fix the race in sync.go` | That agent, guaranteed |

## Features

Each row links to its guide page.

| Feature | What it does | Command | Guide |
|---|---|---|---|
| Routing and agents | Claude delegates by difficulty to tiered subagents, escalates a stuck tier, follows overrides ("do it yourself", "use agents") | `/crew-chief:crew-mode auto\|solo\|delegate\|status` | [Routing and agents](docs/guide/routing.md) |
| Briefs | You act as the manager: Claude interviews you and writes one approved brief (goal, constraints, success criteria, decision rights) | `/crew-chief:crew-brief` | [Briefs](docs/guide/brief.md) |
| Token saver | Asks at 70/80/90 % of your 5-hour limit (50/75/85/90 % weekly) whether to cap subagent effort; ultra-saver is stricter | `/saver on\|off\|status\|ultra` | [Token saver](docs/guide/token-saver.md) |
| Settings | Every number crew-chief uses, changeable without environment variables | `/crew-config` | [Settings](docs/guide/settings.md) |
| Compact flow | Claude proposes compaction at a phase boundary; handoff files are updated first, your pinned rules are put back after | `/crew-compact` | [Compact flow](docs/guide/compact.md) |
| Limit resets, audit, report | A toast when a limit resets and an offer to send "continue"; what in your context is oversized or stale; tokens and cost by model | `/crew-tidy`, `/crew-report` | [Limit resets and audit](docs/guide/limits-and-audit.md) |
| Command guard | Stops or warns before dangerous commands and first contact with production hosts (a speed bump, not a security boundary) | `/crew-guard` | [Command guard](docs/guide/guard.md) |
| Session handoff | Three small files (`STATUS.md`, `tasks.json`, `PROGRESS.md`) so a new session picks up where the last one stopped | `/crew-chief:crew-handoff` | [Session handoff](docs/guide/handoff.md) |
| UI work | Interface work goes to `ui-implementer` with design skills, a UI profile, references, gates and a visual self-check; the default look is banned | | [UI work](docs/guide/ui.md) |
| Night mode | Claude keeps working until a deadline you set, within hard limits (no push, no deploy), and leaves a morning report | `/crew-chief:crew-night` | [Night mode](docs/guide/night.md) |
| Research | Sourced claims with the access date and a verbatim quote, checked against the cited page | `/crew-chief:crew-research`, `/crew-chief:crew-lint` | [Research](docs/guide/research.md) |
| Security review | Read-only `security-reviewer`, a risk map, a commit gate, and a verification gate before commits | `/crew-chief:security` | [Security review](docs/guide/security.md) |
| Reports and skills | Long reports go to a file; agents load skills; a reminder and a one-time offer when a skill fits the work | | [Reports and skills](docs/guide/skills-and-reports.md) |
| Panel row and status line | Each subagent's model, effort, tokens, time and progress below the prompt and in a status line | | [Panel row and status line](docs/guide/panel.md) |
| crew-ui band and panes | A quiet band above the prompt, questions as buttons, agent panes and finish notices | `/crew-ui`, `/crew-agents`, `/crew-panel` | [crew-ui](docs/guide/crew-ui.md) |
| Performance mode | Stills the band's moving pictures and a theme's animation | `/crew-perf` | [Performance mode](docs/guide/performance.md) |
| Advisor offer | A one-time offer to turn on the experimental `/advisor` | `/advisor` | [Advisor offer](docs/guide/advisor.md) |
| Model switches | Asks first when changing the session's model would cost something real | | [Model switches](docs/guide/model-switches.md) |
| Hooks and scripts | Every hook and script the plugin ships, when it runs and what it does | | [What it runs](docs/guide/hooks.md) |

Some behaviours are covered by unit tests only and have not been seen live; each guide page says which. To change a tier's model or effort, create `.claude/agents/<name>.md` in your project with the same name: project agents take priority over plugin agents and updates never overwrite them.

## Privacy

Crew Chief collects and sends no data: its hooks run locally and print text or an exit code, and the mod has no network access. There is no telemetry. Two exceptions, both only when you use them: the bundled theSVG skill has the agent fetch icons from cdn.jsdelivr.net, and a research run (`/crew-chief:crew-research`, `/crew-chief:crew-lint`) fetches the pages the researchers cited to check each quote (`scripts/source-check.mjs`: read only, sends no project data, refuses private and loopback addresses, never prints page text). What is stored stays on your machine in `~/.claude/plugins/data/<plugin>/` (answers to offers, small markers, compaction summaries), which Claude Code deletes when you uninstall the plugin; progress files and long reports live in your temp directory. The plugin writes into your project only when you say yes, and outside its own store only `~/.claude/settings.json` (the panel row, once) and `~/.claude/crew-chief-guard.json` (the default guard config, once). Full list: [Privacy](docs/guide/privacy.md). Bug reports go to [GitHub issues](https://github.com/aykyusuf/crew-chief/issues).

## Develop

```bash
claude --plugin-dir .                      # load this checkout for one session
node --test tests/*.test.mjs               # logic tests (plain Node)
for t in tests/test_*.py; do python3 $t; done   # hook and script tests
claude plugin test                         # the mod's hooks, with stubs (no session, no network)
python3 tools/build_mod.py                 # rebuild hooks/register.js from hooks/src/ (add --check to verify)
python3 tools/build_assets.py              # regenerate skills/crew-setup/assets (add --check to verify)
claude plugin validate . --strict          # marketplace manifest
```

All test commands, the behaviour evals and the cost-per-task comparison: [Develop](docs/guide/develop.md).

## License

MIT

The plugin's own code is MIT. It bundles pinned copies of third-party agent skills (UI, motion, security) under `skills/`, each under its own license: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
