# Develop

Commands to test and build the plugin, behaviour evals and the cost-per-task comparison.

[← README](../../README.md) · [Türkçe](../rehber/develop.md)

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

Eval cases live in `evals/`: (added in 0.12, not yet run, billed when run) a brief that must carry its scope and its check, an unattended-run answer that must state a done condition and a limit, a sort that must be a command and not a subagent, and three lessons turned into cases (a unit that failed three corrections gets its plan questioned, a failed unit goes back alone, a report without evidence is unverified); and, from before: a solo override, a named model and effort, a noisy test run that should go to the scanner, an orchestration question that should load the routing skill, and (added in 0.3.0, not yet run) a quick edit that must stay inline, a risky change that should get the reviewer at `xhigh`, an escalation after a stopped implementer, and a user constraint that must reach the subagent's brief.

**Cost per finished task.** `python3 evals/compare/compare.py` runs the same small, checkable tasks (`evals/compare/tasks.json`) solo (Agent tool disallowed), routed (the plugin as it is) and in ultra-saver, and prints cost per *finished* task, turns and time; a run that did not pass its check counts as no result. Without `--run` it only lists what would run and costs nothing; with `--run --budget 3` each call is capped by `--max-budget-usd`. One run per cell is a sample of one (use `--repeat`), and these tasks are small enough that the routed arm may never delegate: add a task where delegation could pay before drawing a conclusion. A multi-model setup is worth keeping only if it beats the solo point.

Last run (0.1.0, Claude Code 2.1.294, `--model sonnet --judge-model haiku --runs 1`, total cost $0.47):

| Case | With plugin | Without | Plugin indicator |
|---|---|---|---|
| solo-override | 1.0 | 1.0 | no subagent spawned |
| named-model-effort | 1.0 | 1.0 | Agent called with `model: sonnet`, `effort: medium` |
| verbose-tests-go-to-scanner | 1.0 | 1.0 | `crew-chief:scanner` used |
| routing-skill-fires | 1.0 | 0.0 | `crew-routing` skill loaded |

One run per arm is a smoke test, not a benchmark; use `--runs 3` or more before drawing conclusions.
