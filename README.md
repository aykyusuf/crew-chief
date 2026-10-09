# Crew Chief

**Difficulty-based subagent routing for Claude Code.** You pick the main session's model and effort. Claude then decides, task by task, what to do itself and what to hand to a cheaper or stronger subagent, at the right effort. It escalates when a tier gets stuck and follows your overrides.

[Türkçe README](README.tr.md)

```
you ──▶ main session (your model/effort) ──┬─ does interactive, coupled, quick work itself
                                           ├─▶ scanner          haiku  / low     lookups, noisy logs
                                           ├─▶ deep-reader      sonnet / medium  multi-file analysis
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
- **Read-only guard**: a hook that stops the scanner, deep-reader, reviewer, and ui-smoke from writing files, changing git state, or installing anything, even when your session runs with permissions bypassed.
- **Overrides in plain language**: "do it yourself", "use agents", "give this to Sonnet at medium", or `/crew-chief:crew-mode solo`.
- **See who runs where**: the agent panel below the prompt shows each subagent's model and effort, for example `ui-tester  sonnet-5.5 · medium · 41.2k  Checking the login flow`.
- **Session handoff, offered once per project**: three small files (status, task list, progress log) so a new session picks up where the last one stopped. See [Session handoff](#session-handoff).
- **A token saver that asks first**: at 70/80/90 % of your 5-hour limit (50/75/85/90 % weekly) it asks whether to cap subagent effort for this session, and warns about huge contexts and day-long sessions. See [Token saver](#token-saver).
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
- **It never sticks:** every new session, `/clear`, and `/resume` starts with the saver off. No saver state is saved; the only thing remembered between sessions is the language (see below).
- **`/saver on|off|status`** switches it by hand and shows your limits, their reset times, and the context size.
- **Toasts, once per session:** when the context passes 150k tokens (`/compact` mid-task, `/clear` between tasks) and when the session is 8 hours old.

**Language.** Questions, toasts, `/saver`, and the update notices speak English or Turkish, whichever you write in. Order of precedence: `CREW_CHIEF_LANG=tr|en`, then Claude Code's `language` setting (`turkish` or `english`), then your recent prompts (Turkish letters and common Turkish words; the majority of the last five prompts, so one stray English sentence changes nothing; slash commands and code count for nothing), then the language last detected (so the first question of a new session already speaks it), then the `LANG` locale, then English. The only thing kept between sessions is that one word, `tr` or `en`, in the plugin's store. Other languages fall back to English; adding one means adding an object to `hooks/saver-i18n.mjs` (a test checks that its keys match English). Update notes come from `CHANGELOG.tr.md` when it has the version, otherwise from `CHANGELOG.md`.

| Environment variable | Effect |
|---|---|
| `CREW_CHIEF_SAVER=off` | No questions and no toasts (`/saver` still works) |
| `CREW_CHIEF_SAVER_FIVE_HOUR=60,85` | Your own 5-hour thresholds |
| `CREW_CHIEF_SAVER_SEVEN_DAY=50,90` | Your own weekly thresholds |
| `CREW_CHIEF_LANG=tr` or `en` | Force the language of every message |

**Needs:** Claude Code 2.1.287 or later (older versions never load the mod; the first prompt after install tells you), and a Pro or Max plan for the limit data (with an API key the mod stays quiet; the context and age toasts still work). The questions need an interactive session; `claude -p` never asks.

Measured on Claude Code 2.1.295: the limits are available right when a session starts, and match `/usage` and the status line. For a hard cap that needs no questions, set `"maxEffortLevel": "medium"` in your settings.

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
| `scripts/subagent-row.sh` | Agent panel refresh, while subagents run | Reads the panel's row data (agent type, model, effort, tokens) and prints the row text. Needs `jq`; without it the default rows stay |
| `hooks/register.js` (a mod) | Session events | The [token saver](#token-saver): reads `$.session.usage()` for your plan limits and context size, asks with `$.ui.ask`, and lowers subagent effort in `turn.step` while the saver is on. Keeps saver state in memory only; remembers one word, the language |
| `scripts/mode-guard.sh` | UserPromptSubmit and UserPromptExpansion; PreToolUse on Agent | `record`: when your prompt is `/crew-chief:crew-mode <mode>`, remembers the mode for this session. `check`: while that mode is `solo`, blocks subagent spawns (exit 2). No recorded mode means everything passes |
| `scripts/plugin-notices.sh` | UserPromptSubmit | On the first prompt after an update, shows the version change and the first lines of its CHANGELOG section. In a session that still runs a replaced copy, says so once instead. Both print a `systemMessage` for you |
| `scripts/readonly-guard.sh` | PreToolUse on Bash | Reads the hook input; if the caller is `crew-chief:scanner`, `deep-reader`, `reviewer`, or `ui-smoke`, blocks commands that write files, change git state, or install packages (exit 2). Every other caller passes through untouched |

With `/crew-setup` (no plugin), the same guard is copied to `.claude/hooks/crew-chief-guard.sh` and wired through `.claude/settings.json` with `--project`, matching the bare agent names. It is not put in the agents' frontmatter on purpose: Claude Code skips frontmatter hooks of project agents until the folder's trust dialog is accepted, and never runs them in `-p` sessions.

The guard is a pattern check, not a sandbox: it blocks the common ways to write and errs on the side of blocking (for example a `>` inside a quoted awk expression). It does not try to catch deliberately obfuscated commands.

## Privacy

Crew Chief collects and sends no data. Its hooks run locally and print text or an exit code. They read the hook input Claude Code passes them (the session's project path and id, the first line of your prompt to spot `/crew-chief:crew-mode`, and the Bash command a subagent is about to run) and, at session start, look at the project itself: whether it is a git repository, whether `CLAUDE.md` or handoff files exist. What is stored stays in `~/.claude/plugins/data/<plugin>/` on your machine, which Claude Code deletes when you uninstall the plugin: your answer to the handoff offer (`handoff-offers.tsv`: a line per answer, the project path and `installed`, `never`, or `later` with a timestamp; the latest line per project counts), the plugin version you were last told about (`last-seen-version`), the plugin version for which it last checked your Claude Code version (`claude-version-checked`), and small per-session marker files for solo mode (`modes/`) and the stale-session notice (`stale-notified/`), named by session id and pruned when newer ones are written once they are two weeks old. Nothing is written into your project. The saver reads your plan usage, context size, and the first lines of your prompts (only to tell Turkish from English) inside Claude Code, keeps just the detected language (`tr` or `en`) in the plugin's store, and sends nothing anywhere. There is no telemetry or network access. Bug reports go to [GitHub issues](https://github.com/aykyusuf/crew-chief/issues).

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
node --test tests/saver-logic.test.mjs tests/saver-i18n.test.mjs   # saver thresholds, effort caps, messages, language detection (plain Node)
claude plugin test                         # the saver mod's hooks, with stubs (no session, no network)
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
