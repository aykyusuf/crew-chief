# Crew Chief

**Difficulty-based subagent routing for Claude Code.** You pick the main session's model and effort. Claude then decides, task by task, what to do itself and what to hand to a cheaper or stronger subagent, at the right effort. It escalates when a tier gets stuck and follows your overrides.

[Türkçe README](README.tr.md)

```
you ──▶ main session (your model/effort) ──┬─ does interactive, coupled, quick work itself
                                           ├─▶ scanner          haiku  / low     lookups, noisy logs
                                           ├─▶ deep-reader      sonnet / medium  multi-file analysis
                                           ├─▶ implementer      sonnet / medium  well-specified edits
                                           ├─▶ implementer-hard opus   / high    hard, multi-module work
                                           └─▶ reviewer         opus   / high    independent review
```

## Why

Out of the box, every subagent runs on whatever model and effort it was given, no matter how easy or hard the job is. Claude Code now lets the main session set `model` and `effort` per subagent call (2.1.292+), but something has to decide when to use them. Crew Chief is that decision layer, plus the tiers it routes to:

- **Routing policy** injected at every session start (and after `/clear` or compaction), so it is always active.
- **Five tiered agents** with tight "use when / don't use when" descriptions, tool limits, turn limits, and a fixed report format.
- **Escalation ladder**: `implementer` → `implementer-hard` → main session, instead of retrying the same tier.
- **Read-only guard**: a hook that stops the scanner, deep-reader, and reviewer from writing files, changing git state, or installing anything, even when your session runs with permissions bypassed.
- **Overrides in plain language**: "do it yourself", "use agents", "give this to Sonnet at medium", or `/crew-chief:crew-mode solo`.
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

Requirements: Claude Code 2.1.292 or later for per-call effort (older versions still work, routing by tier defaults). The guard uses `jq` or `python3`; with neither it allows everything.

## Use

Nothing to do: start a session, pick your model and effort as usual, and work. Crew Chief's policy tells Claude when to delegate.

| You say | What happens |
|---|---|
| *(nothing)* | `auto` mode: routed by difficulty |
| "do it yourself", "no subagents" | `solo`: everything stays in the main session |
| "use agents", "delegate this" | `delegate`: independent pieces go to tiers in parallel |
| "do the UI directly with Opus" | That part stays in the main session; the rest is routed |
| "give the tests to Haiku", "Sonnet at medium for this" | The subagent runs with exactly that model/effort |
| `@agent-crew-chief:implementer-hard fix the race in sync.go` | That agent, guaranteed |
| `/crew-chief:crew-mode auto\|solo\|delegate\|status` | Switch or show the mode |

Set the default mode in the plugin options (`claude plugin configure crew-chief`): `auto`, `solo`, or `delegate`.

**Change a tier's model or effort:** create `.claude/agents/<name>.md` in your project with the same name (for example `implementer.md`). Project agents take priority over plugin agents, and plugin updates never overwrite them.

## What it runs

Everything is plain, readable shell and Python in this repo. Nothing is sent over the network.

| Component | When | What it does |
|---|---|---|
| `scripts/session-policy.sh` | SessionStart (startup, resume, clear, compact) | Prints the ~2 KB routing policy into the session context |
| `scripts/readonly-guard.sh` | PreToolUse on Bash | Reads the hook input; if the caller is `crew-chief:scanner`, `deep-reader`, or `reviewer`, blocks commands that write files, change git state, or install packages (exit 2). Every other caller passes through untouched |
| `scripts/json-field.py` | Called by the guard when `jq` is missing | Reads one field from the hook input JSON |

With `/crew-setup` (no plugin), the same guard is copied to `.claude/hooks/crew-chief-guard.sh` and wired through `.claude/settings.json` with `--project`, matching the bare agent names. It is not put in the agents' frontmatter on purpose: Claude Code skips frontmatter hooks of project agents until the folder's trust dialog is accepted, and never runs them in `-p` sessions.

The guard is a pattern check, not a sandbox: it blocks the common ways to write and errs on the side of blocking (for example a `>` inside a quoted awk expression). It does not try to catch deliberately obfuscated commands.

## Privacy

Crew Chief collects, stores, and sends no data. Its hooks run locally, read only the hook input Claude Code passes them (the session's project path and the Bash command a subagent is about to run), and print text or an exit code. There is no telemetry, network access, or storage. Bug reports go to [GitHub issues](https://github.com/aykyusuf/crew-chief/issues).

## How routing decides

Delegate only when the work is self-contained **and** it can run in parallel, would flood the main context, or a cheaper tier can do it equally well. Otherwise the main session does it. Multi-agent setups cost several times the tokens of one session and most coding work is tightly coupled, so the default leans towards doing it yourself. When a subagent fails, the rule is to diagnose before escalating: careless means raise effort, out of its depth means raise the model.

The full policy is in [skills/crew-routing/SKILL.md](skills/crew-routing/SKILL.md), with [mechanisms](skills/crew-routing/references/mechanisms.md) and [model and effort](skills/crew-routing/references/model-and-effort.md) references summarised from the official Claude Code docs.

## Develop

```bash
claude --plugin-dir .                      # load this checkout for one session
python3 tests/test_guard.py                # guard: 161 cases, with and without jq
python3 tools/build_assets.py              # regenerate skills/crew-setup/assets after editing agents/ or scripts/
claude plugin validate . --strict          # marketplace manifest
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin eval . --scaffold --allow-tools Bash --runs 1   # behaviour evals (real model calls, billed)
```

Eval cases live in `evals/`: a solo override, a named model and effort, a noisy test run that should go to the scanner, and an orchestration question that should load the routing skill.

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
