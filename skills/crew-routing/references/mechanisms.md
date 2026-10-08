# Orchestration mechanisms: which one when

Summarised from the official Claude Code docs (code.claude.com/docs/en: agents, sub-agents, scheduled-tasks, workflows, agent-teams, agent-view, tools-reference, costs). Check the docs when a limit matters; they change between releases.

## Contents
- Decision table
- Subagents and forks
- Waiting and polling: Monitor, /loop, /goal, background Bash
- Scheduling: /loop vs desktop tasks vs routines
- Dynamic workflows
- Agent teams
- Background sessions and cross-session messages
- Limits worth knowing

## Decision table

| Need | Use |
|---|---|
| A side task whose output would flood your context (search, logs, file dumps) | Subagent; a **fork** if it needs this conversation's context |
| Several independent long tasks the user checks on later | Background sessions (`claude --bg`, `/bg`, agent view) |
| Workers that must talk to and challenge each other | Agent team (experimental, off by default) |
| Dozens to hundreds of agents, a repeatable plan, cross-verified results | Dynamic workflow (`ultracode`, "use a workflow") |
| Review a large diff for bugs | Built-in `/code-review [low..max]` (several finders, a verification pass, Important/Nit/Pre-existing); `/code-review ultra` for a deeper cloud review |
| Wait for one event or stream in this session | Monitor tool |
| Poll something on an interval in this session | `/loop` |
| Keep working turn after turn until a condition holds | `/goal`, or a workflow "loop until done" |
| Run a shell command without blocking | Background Bash (Ctrl+B) |
| Run with the machine off | Routine (cloud) |
| Run unattended on this machine with local files | Desktop scheduled task |

The official "choose an approach" questions: who coordinates (you, Claude in one conversation, a lead agent, or a script)? Do workers need to talk to each other? Do tasks touch the same files?

## Subagents and forks

Use the main conversation when the task needs back-and-forth, when phases share a lot of context, for quick targeted changes, or when latency matters (a fresh subagent has to gather context first).

Use a subagent when the output is verbose and you only need a summary, when you want to restrict its tools, or when the work is self-contained.

- **Model order:** Agent tool `model` parameter > agent file `model:` > `CLAUDE_CODE_SUBAGENT_MODEL` > main model. A family alias (`opus`) resolves to the main session's exact model when the main session is in that family.
- **Effort:** agent file `effort:` overrides the session level. The Agent tool's `effort` parameter (2.1.292+) sets it per call. `CLAUDE_CODE_EFFORT_LEVEL` overrides frontmatter; how it interacts with the per-call parameter is not documented.
- **Fork** (`subagent_type: "fork"`): inherits the whole conversation, system prompt, tools, and model, and reuses the parent's prompt cache, so it is cheaper than a fresh agent for work that needs the same context. Its own tool calls stay out of your context. A fork cannot spawn further forks.
- **Background by default** in interactive sessions: Claude keeps working while subagents run. Background subagents get a narrower tool set and surface permission prompts in the main session.
- **Nesting:** subagents can spawn subagents up to three levels deep unless `Agent` is missing from their `tools`. crew-chief's agents cannot spawn, on purpose.
- **Withheld from every subagent:** AskUserQuestion, plan mode tools, ScheduleWakeup, Workflow. Anything needing the user goes back through you.

## Waiting and polling

- **Monitor** runs a command in the background and feeds each output line back: tail a log and react to errors, watch CI, watch a directory. Deadline 5 minutes by default, 30 at most. Often more token-efficient than polling. Not available on Bedrock, Vertex, or Foundry.
- **/loop** is for time-based polling while the session is open: "poll a deployment, babysit a PR, check back on a long-running build".
  - `/loop 5m <prompt>` fixed interval (cron under the hood).
  - `/loop <prompt>` self-paced: Claude picks 1 minute to 1 hour between iterations.
  - `/loop` alone runs the maintenance prompt (or `.claude/loop.md`).
  - Each iteration sends the full context, even when idle. Up to 50 tasks per session; recurring tasks expire after 7 days; fires only while Claude Code is running and idle.
  - Subagents cannot schedule wakeups.
- **/goal** keeps working toward a condition across turns. Use it, not `/loop`, for "iterate until it passes".
- **Background Bash** moves a long command off the critical path without spawning an agent.

## Scheduling

| | Routine (cloud) | Desktop task | /loop |
|---|---|---|---|
| Runs on | Anthropic cloud | Your machine | Your machine |
| Machine must be on | No | Yes | Yes |
| Session must be open | No | No | Yes |
| Local files | No (fresh clone) | Yes | Yes |
| Minimum interval | 1 hour | 1 minute | 1 minute |

Routines (`/schedule`) need a self-contained prompt and run autonomously, with every connector included by default.

## Dynamic workflows

A script holds the plan, the loop, and intermediate results; only the final answer reaches your context. Use it when a job needs more agents than one conversation can coordinate, or when results should be cross-checked (adversarial verification, judge panels, loop-until-dry). Examples: codebase-wide audit, a 500-file migration, cross-checked research.

- Triggered by the keyword `ultracode` in a typed prompt, by the user asking for a workflow, or for every substantive task while `/effort ultracode` is on.
- Each `agent()` can set `model`, `effort`, `agentType` (e.g. `crew-chief:scanner`), `schema`, and `isolation: 'worktree'`. Default to omitting `model`; use `effort: 'low'` for mechanical stages and higher only for verify/judge stages.
- Size guideline `workflowSizeGuideline`: small (<5 agents), medium (<10, default), large (<50).
- Up to 16 agents run concurrently by default. A run is resumable in the same session. Run it on a small slice first to gauge cost.

## Agent teams

Experimental (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Teammates are full sessions that message each other and share a task list.

Good for research and review from several angles, debugging with competing hypotheses, and cross-layer features. Not for sequential tasks, same-file edits, or work with many dependencies. Start with 3 to 5 teammates and use Sonnet for them. Teams use far more tokens than one session (about 7x when teammates run in plan mode).

## Background sessions and messages

`claude --bg "<prompt>"`, `/bg`, and agent view run independent sessions, each isolated in a worktree before editing. Ten in parallel uses quota about ten times as fast. Sessions can reach each other with `ListAgents` and `SendMessage`; a message from another session can never approve anything on the user's behalf.

## Limits worth knowing

- 20 concurrent subagents per session (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`); ultracode sessions are exempt.
- Subagent nesting depth 3 (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`; 1 turns nesting off).
- A subagent that reaches its `maxTurns` returns partial output and can be continued with SendMessage.
- Agent teams, workflows, and parallel subagents all draw on the same usage limits as the main session.
