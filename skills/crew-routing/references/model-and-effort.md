# Choosing model and effort

Summarised from code.claude.com/docs/en/model-config, /costs, and Anthropic's model and effort guidance. Prices and defaults change; check the docs when they matter.

## Models (aliases)

| Alias | Official positioning | Good subagent work |
|---|---|---|
| `haiku` | Simple tasks | Lookups, listing, log and test-output filtering, classification |
| `sonnet` | Daily coding tasks | Well-specified edits, tests, multi-file reading |
| `opus` | Complex reasoning | Design, hard debugging, multi-module changes, independent review |
| `fable` | Hardest, longest-running tasks | Ambiguous problems an Opus run could not crack |
| `opusplan` | Opus in plan mode, Sonnet for execution | A session setting, not a subagent choice |

"Sonnet handles most coding tasks well and costs less than Opus. Reserve Opus for complex architectural decisions or multi-step reasoning." Use `haiku` for simple subagent tasks.

Aliases move with releases: "Aliases point to the recommended version for your provider and update over time." When a new Opus or Sonnet ships and Claude Code updates, the tiers follow without edits. They resolve per provider (on Bedrock or Vertex, `sonnet` and `haiku` currently point to older models than on the Anthropic API). To pin a version, set `ANTHROPIC_DEFAULT_OPUS_MODEL` (and the `_SONNET_`, `_HAIKU_`, `_FABLE_` variants) or use a full model ID. A family alias given to a subagent resolves to the main session's exact model when the main session is in that family.

A subagent may run on a stronger model or a higher effort than the main session; nothing ties it to the session's choice. If an organization's `availableModels` blocks the requested model, Claude Code substitutes a permitted one and warns. If a model does not support the requested effort, it runs at the highest supported level below it.

## Effort levels

| Level | Use for |
|---|---|
| `low` | Quick exchanges you review yourself, mechanical subagent work |
| `medium` | Day-to-day work with a clear scope. Default on Opus 5.5, Sonnet 5.5, Haiku 5.5 |
| `high` | Work where verification matters or edge cases are likely, such as fixing a bug in existing code |
| `xhigh` | Deeper reasoning at higher token spend; long autonomous runs |
| `max` | Hard problems worked through unattended. Diminishing returns, prone to overthinking |

`ultracode` is not an effort level: it is a session setting that plans a dynamic workflow for each substantive task. `ultrathink` in a prompt asks for deeper reasoning on that turn only and does not change the effort sent to the API.

## Diagnose before escalating

Ask: did it not try hard enough, or did it not know enough?
- Skipped files, did not run the check, stopped early → raise **effort**.
- Wrong approach, missed a subtle interaction, shallow analysis → raise the **model**.

For most tasks the model's default effort is right. Lower effort cuts thinking tokens, which bill as output.

## Where model and effort come from

- **Session:** `CLAUDE_CODE_EFFORT_LEVEL` / `--effort` / `/effort` > per-model `modelSettings` in user settings > `effortLevel` > model default. Do not write effort into a project's shared settings; it silently overrides each user's own preference.
- **Subagent model:** Agent tool `model` > agent file `model:` > `CLAUDE_CODE_SUBAGENT_MODEL` > main model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces one model on every subagent and defeats tiering.
- **Subagent effort:** Agent tool `effort` (2.1.292+) and agent file `effort:` override the session level; `CLAUDE_CODE_EFFORT_LEVEL` overrides frontmatter. Leave that variable unset when using tiers.
- **Skills:** `model` and `effort` in skill frontmatter apply for the turn that invokes the skill; with `context: fork` they set the forked agent's model.
- **Org caps:** `availableModels` and `maxEffortLevel` can step a request down.

## Cost notes

- Each subagent sends its own requests against the same usage limits.
- A fresh subagent on a different model pays to read its context from scratch; a fork reuses the parent's cache. Delegating rarely and inconsistently can cost more than not delegating at all.
- Changing the session's model or effort mid-session resets the prompt cache once. Switch when the kind of work changes, not every turn.
