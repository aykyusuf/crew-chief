---
name: crew-routing
description: "Decides who should do a piece of work and how: the main session or a tiered subagent (Haiku, Sonnet, Opus) at which effort, and which orchestration mechanism fits (subagent, fork, background session, /loop, Monitor, dynamic workflow, agent team, routine). Use before delegating or spawning agents, before parallelising work, when waiting on CI, logs, or deploys, when a task keeps failing at one tier, or when the user says things like \"do it yourself\", \"use agents\", \"give this to Sonnet\", \"use a cheaper model\", or \"run this in parallel\"."
---

# Routing work by difficulty

The user picks the main session's model and effort. From then on, routing is your call: keep the work in the main session or hand it to the cheapest tier that will do it well. These rules apply for the whole task, not just the next step.

## 1. Main session or subagent?

Keep it in the main session when any of these hold:
- The user will iterate on it with you (design, UI, wording, product calls).
- The steps share a lot of context (plan, implement, test the same thing).
- It is a quick, targeted change. Briefing a subagent would cost more than doing it.
- You need the result before you can do anything else and nothing can run alongside it.

Delegate only when the work is self-contained **and** at least one holds:
- It can run in parallel with other work.
- Its output (search hits, logs, test runs, file dumps) would flood your context.
- A cheaper tier can do it as well as you.

Multi-agent setups cost several times the tokens of one session, and most coding work is tightly coupled. When in doubt, do it yourself.

## 2. Pick the tier

| Work | Agent type | Default |
|---|---|---|
| Where is X, which files use Y, filter a long log, run tests and return failures | `crew-chief:scanner` | haiku / low |
| Understand several files together, trace a flow, find a root cause, map impact | `crew-chief:deep-reader` | sonnet / medium |
| Change with named files, a clear change, and a check to run | `crew-chief:implementer` | sonnet / medium |
| Multi-module change, algorithms, concurrency, unknown root cause, a task `implementer` stopped on | `crew-chief:implementer-hard` | opus / high |
| Quick read-only check that a page or screen is up, shows text X, or logs errors | `crew-chief:ui-smoke` | haiku / low |
| Multi-step UI flow or regression pass in a browser, emulator, or simulator (screenshots) | `crew-chief:ui-tester` | sonnet / medium |
| Independent check before a commit or PR of a significant or risky change, or when the user asks | `crew-chief:reviewer` | opus / high |

If the plugin is not installed but the project has `.claude/agents/` copies from `/crew-chief:crew-setup`, use the bare names (`scanner`, `implementer`, ...).

**Adjust per call.** The Agent tool takes `model` and `effort` (Claude Code 2.1.292+). They override the tier's defaults for that call only:
- Easier than the tier assumes: lower effort before lowering the model.
- The agent was careless (skipped files, did not run the check): raise **effort**.
- The agent lacked knowledge or judgement: raise the **model**.
- The user named a model or effort ("give this to Sonnet at medium"): pass exactly that.

**Review depth by risk.** Spend review tokens where a missed bug is expensive:
- Ordinary change: `reviewer` at its default (high).
- Security, auth, data loss or migrations, concurrency, money or billing logic, or code about to ship: `reviewer` with `effort: "xhigh"`. On Opus 5.5, xhigh scores slightly higher than high at about 2.5 times the cost, so use it only on this list.
- A large diff across many files: the built-in `/code-review` (it runs several finders plus a verification pass), or a workflow with adversarial verification. Not one reviewer at max effort.
- Small or mechanical edits: no review agent. Run the checks yourself.

If the Agent tool has no `effort` parameter (older Claude Code), pick the tier whose defaults fit instead.

**UI checks.** Screenshots cost about 1,000 to 3,000 tokens each and are resent on every later turn, so a long visual check in the main session gets expensive fast.
- One quick look (did it load, is the text there): do it yourself or use `ui-smoke`.
- A flow, a regression pass, or more than about five screenshots: `ui-tester`. It keeps the images in its own context and returns a short pass/fail report with evidence paths.
- Judging whether a design looks right is a product call: keep it with the user in the main session, using the tester's evidence.
- Only one UI agent per browser, emulator, or simulator at a time, and do not use that device yourself while it runs. UI agents cannot ask the user; on login, CAPTCHA, or permission prompts they come back BLOCKED.
- If the project has no launch recipe yet, `/run-skill-generator` records one so testers do not rediscover it each time.

## 3. Brief the subagent

A subagent does not see this conversation. Every brief states:
1. **Goal**, one sentence, and why it matters.
2. **Scope**: files or directories, and what is off limits.
3. **Definition of done**: the observable result.
4. **Check**: the exact command or test to run.
5. **Return format**, if you need something specific.

Vague briefs lead to duplicated work and gaps. Independent briefs go out in one message so they run in parallel. Never run two agents that edit the same files at the same time, or two that share one emulator, device, or local server.

## 4. Escalate, don't retry

- `implementer` says stopped → hand the same brief plus its report to `implementer-hard`.
- `implementer-hard` says stopped → take it into the main session, or ask the user if it is a product decision.
- Do not re-run the same tier with the same brief hoping for a different result.

## 5. User overrides

These last until the user says otherwise:

| User says | You do |
|---|---|
| "do it yourself", "no subagents", "everything on Opus" | Solo: no subagents at all |
| "use agents", "delegate", "go agentic" | Delegate: hand every independent piece to its tier, in parallel |
| "do the UI directly with Opus" (any part X) | Keep X in the main session; route the rest normally |
| "give X to Sonnet/Haiku at medium" | Spawn the fitting tier with that `model` and `effort` |
| `@agent-crew-chief:<tier> ...` | That agent, guaranteed |
| `/crew-chief:crew-mode auto\|solo\|delegate` | Switch mode |
| `ultracode` or "use a workflow" | A dynamic workflow (see mechanisms) |

## 6. Beyond one subagent

For waiting, polling, scheduling, many agents, or peer collaboration, read [references/mechanisms.md](references/mechanisms.md). Short version:
- Wait for one event (log line, CI state) → **Monitor**. Poll on a schedule in this session → **/loop**. Keep working until a condition holds → **/goal** or a workflow loop.
- Needs this conversation's context → **fork** (shares the prompt cache, cheaper than a fresh agent).
- Dozens of agents, a repeatable plan, cross-checked results → **dynamic workflow**.
- Workers must debate or coordinate with each other → **agent team** (experimental).
- Must run with the machine off → **routine**.

For model and effort choice details, read [references/model-and-effort.md](references/model-and-effort.md).
