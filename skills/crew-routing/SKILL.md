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

**Is it an edge or just an "and then"?** Before chaining two steps, ask: does the second one actually read the first one's output? If you cannot name the variable, file, or result that crosses from one to the other, there is no dependency: run them in parallel (or drop the wait). Writing steps in the order you thought of them is not a dependency.

**Is it a model task at all?** If you can describe the step without the words judge, decide, assess or summarize (merge, sort, dedupe, compare before and after, rename), it is a few lines of code or a shell command with one correct answer. Do not spend a model call, let alone a subagent, on it.

Multi-agent setups cost several times the tokens of one session, and most coding work is tightly coupled. When in doubt, do it yourself.

**If your own model is Fable,** your context is the most expensive one: hand reading and searching (more than two or three files, logs, web pages) to `scanner` or `deep-reader` and ask for findings, not file dumps, so your context is spent on decisions. Anthropic's Fable 5.2 guide: it plans and orchestrates other models well, and standing lines about the cost of delegating make it delegate about a third less.

## 2. Pick the tier

| Work | Agent type | Default |
|---|---|---|
| Where is X, which files use Y, filter a long log, run tests and return failures | `crew-chief:scanner` | haiku / low |
| Understand several files together, trace a flow, find a root cause, map impact, or read code plus current web sources (report returned as text; the caller saves it) | `crew-chief:deep-reader` | sonnet / medium |
| Change with named files, a clear change, and a check to run | `crew-chief:implementer` | sonnet / medium |
| UI code: components, styles, pages, screens, Flutter widgets, SwiftUI views (design skills preloaded; the brief names the UI profile, the extra skills and the reference image paths; see "UI code" below) | `crew-chief:ui-implementer` | sonnet / medium (default; pass model and effort per call) |
| Design spec for big UI work (3+ screens, a new site, a redesign): direction, palette, type, layout, components, motion, per-screen notes, acceptance checks, written to `.crew-chief/design/<slug>.md` (read-only, no code) | `crew-chief:ui-designer` | opus / high |
| Design references for a UI project (the user picked "find some" at the reference step): domain notes, 3-4 live sites and open galleries, desktop and mobile screenshots and a ranked `REFS.md`, written to `.crew-chief/refs/` (no code; inspiration only; see "UI code" below) | `crew-chief:ui-scout` | sonnet / medium |
| Rote edits in named files with a verify command (renames, the same line in many files, applying a diff you wrote) | `crew-chief:mechanic` | haiku / low |
| A change across several modules or with real design choices, before building it: files, order, risks, a testable done condition (read-only) | `crew-chief:planner` | opus / medium (high for a large or risky change) |
| Multi-module change, algorithms, concurrency, unknown root cause, a task `implementer` stopped on | `crew-chief:implementer-hard` | opus / medium (high after a failed attempt or for risky work) |
| Quick read-only check that a page or screen is up, shows text X, or logs errors | `crew-chief:ui-smoke` | haiku / low |
| Multi-step UI flow or regression pass in a browser, emulator, or simulator (screenshots) | `crew-chief:ui-tester` | sonnet / medium |
| Web research for a question that needs sources: find them, quote them verbatim with URL and access date, or look for counter-evidence to a stated assumption (the brief names the role: research, verify or counter-evidence; the result is a JSON file in the reports folder; `/crew-chief:crew-research` drives it) | `crew-chief:researcher` | sonnet / medium |
| A task claims to be done: check its `done_when` (or a claim) independently by running the checks, and try to refute it; give the criteria and the location, not the author's conclusion | `crew-chief:verifier` | sonnet / high |
| Grade a finished visual or quality-sensitive result against a rubric (UI screens, renders, documents), especially when the author called its own work fine | `crew-chief:critic` | opus / medium |
| Independent check before a commit or PR of a significant or risky change, or when the user asks | `crew-chief:reviewer` | opus / medium (high or xhigh by risk, below) |
| Security review of a change to auth, crypto, secrets, payments, migrations, or input reaching SQL/shell/path sinks (and CI or dependency changes), or when the security gate holds back a commit; `/crew-chief:security` runs it | `crew-chief:security-reviewer` | only when behaviour changes at a trust boundary (most commits need none); sonnet / medium for one focused question, opus / medium usually, opus / high for broad, money, permission or migration changes; xhigh only for a large cross-cutting change before it ships or when the user asks |

If the plugin is not installed but the project has `.claude/agents/` copies from `/crew-chief:crew-setup`, use the bare names (`scanner`, `implementer`, ...).

**Reading the difficulty.** Decide from what you can see, not from a hunch:
- Scope: one file or several modules? Named up front, or still to be found?
- Check: is there a command that proves it works? No check means a higher tier or the main session.
- Ambiguity: does the brief need a design or product decision? Then it is not delegable.
- Root cause: known, or still unknown? Unknown goes to `implementer-hard`.
- Blast radius: auth, money, data loss, migrations, concurrency raise the tier and the review depth, whatever the size.
The first two decide the tier; the last decides how carefully the result is checked.

**Size the brief.** Agents stop at a turn limit (implementer 80, ui-implementer 80, implementer-hard 120, reviewer 80, deep-reader, ui-tester and ui-scout 60, planner and ui-designer 40, mechanic 30). Split a large multi-file task into 2-3 independent pieces with their own definition of done instead of one long call; for a long piece, name a progress file the agent can checkpoint to. A stopped agent returns partial output: continue it with SendMessage rather than starting over. When two or more implementers run in parallel, give them disjoint file sets; if they could touch the same files, run them one after the other. Worktree isolation is a last resort: a worktree starts from the default branch, so it does not see uncommitted work and has no installed dependencies.

**Haiku at low effort** skips searches and checks on long briefs (Anthropic's effort guide): keep `scanner`, `mechanic` and `ui-smoke` briefs short and specific, and if one misses things try haiku at medium before moving to Sonnet.

**Start at medium, climb only when needed** (Anthropic's Claude 5.5 model guide: most work starts on Opus 5.5 at medium; medium scores about 2.5 points below high at about 70 percent of the cost, xhigh about 1.4 points above high at 2.5 times the cost). When a piece fails, climb in this order: (1) can the agent check its own work (a test, a build, a script)? give it that check first; (2) raise effort one step; (3) only then a bigger model, at a lower effort. With an automatic check, run a batch at low or medium and re-run only the failures at high: in the guide's numbers that passed more tasks than running everything at high, for less. Fable is never a tier: pass `model` per call, only when Opus at high was not enough and the user asked for Fable. For wide file searches use `crew-chief:scanner` (Haiku) rather than the built-in Explore, which runs on the session's own (often expensive) model.

**Adjust per call.** The Agent tool takes `model` and `effort` (Claude Code 2.1.292+). They override the tier's defaults for that call only:
- Easier than the tier assumes: lower effort before lowering the model.
- The agent was careless (skipped files, did not run the check): raise **effort**.
- The agent lacked knowledge or judgement: raise the **model**.
- The user named a model or effort ("give this to Sonnet at medium"): pass exactly that.

**Review depth by risk.** Spend review tokens where a missed bug is expensive:
- Ordinary change: `reviewer` at its default (medium).
- A significant or risky change (a public API, a schema, many callers): `reviewer` with `effort: "high"`.
- Security-relevant files (the list in the table above): `security-reviewer` (it has the security-audit skill), not `reviewer`. Data loss, concurrency, or code about to ship: `reviewer` with `effort: "xhigh"`. On Opus 5.5, xhigh scores slightly higher than high at about 2.5 times the cost, so use it only on this list.
- A large diff across many files: the built-in `/code-review` (it runs several finders plus a verification pass), or a workflow with adversarial verification. Not one reviewer at max effort.
- Small or mechanical edits: no review agent. Run the checks yourself.

If the Agent tool has no `effort` parameter (older Claude Code), pick the tier whose defaults fit instead.

**UI checks.** Screenshots cost about 1,000 to 3,000 tokens each and are resent on every later turn, so a long visual check in the main session gets expensive fast.
- One quick look (did it load, is the text there): do it yourself or use `ui-smoke`.
- A flow, a regression pass, or more than about five screenshots: `ui-tester`. It keeps the images in its own context and returns a short pass/fail report with evidence paths.
- Judging whether a design looks right is a product call: keep it with the user in the main session, using the tester's evidence.
- Only one UI agent per browser, emulator, or simulator at a time (never `ui-scout` and `ui-tester` on the same browser at once), and do not use that device yourself while it runs. UI agents cannot ask the user; on login, CAPTCHA, or permission prompts they come back BLOCKED.
- If the project has no launch recipe yet, `/run-skill-generator` records one so testers do not rediscover it each time.

**UI code.** UI is decided per task, not per project: a prompt about screens, styling or components, or a brief that touches `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.html`, Flutter widgets or SwiftUI, is a UI task. UI code goes to `crew-chief:ui-implementer` (design skills preloaded), not to `implementer` or `mechanic`. Before the first UI brief of a project: read `.crew-chief/ui-profile.json` (`{profile, motion, perfBudget, notes, refs[]}`); if it is missing, infer it from the project (three or @react-three/fiber: immersive; motion, framer-motion or gsap: lively; an existing DESIGN.md) and say so, otherwise ask the user once with AskUserQuestion, listing the profiles neutrally (no recommended option, no warning that one is too heavy or too light; the user picks and you follow the pick), then write the file and one pointer line in STATUS.md if there is one. The file's top level is the project default; an optional `pages` object (keys: file paths or route globs, values override profile, motion, perfBudget, notes) covers pages that differ, and a new page with no entry uses the default without a question: when you brief an agent, apply the matching entry and name the effective profile for that page. immersive means a real Three.js/WebGL scene (react-three-fiber for React), never a CSS or SVG imitation; an agent that cannot build real 3D says so in its report with the reason. Ask once for a reference, with AskUserQuestion, three options in the user's language: "I'll send one" / "Find some (ui-scout)" / "None". On "find", brief `crew-chief:ui-scout` (sonnet / medium, no model parameter needed; give it the project, the effective profile and motion level and what the user asked for): it researches what matters in this kind of project, finds 3-4 live sites and open galleries, looks at them (Claude in Chrome, else headless Chrome, else curl) and writes screenshots and `REFS.md` to `.crew-chief/refs/`. Then show the user its candidates (path and one line each) in one AskUserQuestion (multiSelect allowed) with the scout's #1 pick named; if the user does not answer (away or night mode) use #1. The picked paths go into `refs[]` of the profile and into every UI brief. References are inspiration only, never copied 1:1. Every UI brief names the profile, the extra skills to load (immersive: animate, choreograph, web-3d-perf; lively: animate; calm: remove-animations; all with the `crew-chief:` prefix; plus design-taste-frontend for a landing page, portfolio or redesign) and the reference paths. The rules and lists live in `data/ui-policy.json` (override: `~/.claude/crew-chief-ui.json`). A UI brief that goes to another writing agent, or does not name the profile, is held back once by a hook; the identical retry passes (`CREW_CHIEF_UI_GATE=off` turns the hook off).

**UI model and effort.** The agent's own default is only sonnet / medium: pass `model` and `effort` on every UI Agent call, from this table (the same rules are in `data/ui-policy.json` under `models`, and the UI hint repeats them; override one rule in `~/.claude/crew-chief-ui.json`):

| The UI work | model / effort |
|---|---|
| Small fix: 1-2 files, existing look (CSS, a bug, wiring, copy, a token swap) | sonnet / medium |
| A component or screen with a reference image or a DESIGN.md | sonnet / high |
| Clear simple-to-mid UI work with a defined direction | opus / medium |
| A new landing, redesign or hero with no direction | opus / high |
| A new immersive scene | opus / high |
| A repair pass after a visual review (a concrete defect list) | sonnet / medium; the same defect after two passes: opus / high |

Never sonnet at xhigh (go to opus high instead), never effort above high on UI work, never a Fable model unless the user asked for Fable (a call naming Fable is held back once; retry it only when the user did ask, otherwise use Opus; `CREW_CHIEF_FABLE_GATE=off` turns that hook off). For a big job (3 or more screens, a new site, a redesign) start with `crew-chief:ui-designer` (opus / high, read-only; it writes the spec to `.crew-chief/design/<slug>.md`), then brief `ui-implementer` (sonnet / high) to build from that spec and name its path in the brief; below that size, one opus pass is cheaper than two briefs. Under plain saver an Opus call drops to medium effort; under ultra-saver a call naming Opus asks the user first, and ui-designer without a named model drops to Sonnet high silently like the other Opus agents: that is the saver's job, not a reason to skip the parameters.

## 3. Brief the subagent

A subagent does not see this conversation. Every brief states:
1. **Goal**, one sentence, and why it matters.
2. **Scope**: files or directories, and what is off limits.
3. **Definition of done**: the observable result.
4. **Check**: the exact command or test to run.
5. **Constraints**: anything the user said in this conversation that applies ("do not modify X", "no commits", "answer in Turkish"). A subagent only sees `CLAUDE.md`, not the conversation, and constraints are what gets dropped at this boundary.
6. **Return format**, if you need something specific.
7. **Decision rights**, when the project has a brief (`BRIEF.md` or `docs/briefs/`, made by `crew-chief:crew-brief`): copy its three lists (decide alone and log / park and ask / never without the user). The agent settles small choices inside the first list itself and reports what it decided; it returns the second and third to you.

Do not write "this codebase is yours" into a brief by default: on Fable 5.2 it makes the agent merge repeated code and make unrequested changes (about 1.5 times the output tokens in Anthropic's test). Add it only for a refactor where structural cleanup is the goal, and then review the diff, not the agent's summary.

Items 2 and 4 are the brief's SCOPE and DONE-CHECK: a brief without them is not ready to send. Parallel reviewers or auditors each get their own context and their own angle (a different slice or lens); do not give them a shared window or a shared findings file, or they converge and you pay several times for one opinion.

**Pilot before a batch.** For a repeated job over many files, run the brief on three of them first, read the result, fix the brief, then run the rest. Watch the first runs of any new agent or brief yourself before you trust it unattended.

Vague briefs lead to duplicated work and gaps. Independent briefs go out in one message so they run in parallel. Never run two agents that edit the same files at the same time, or two that share one emulator, device, or local server.

## 4. Escalate, don't retry

- `implementer` says stopped → hand the same brief plus its report to `implementer-hard`.
- `implementer-hard` says stopped → take it into the main session. If it is a product decision, do not stop the whole job to wait for an answer: finish what does not depend on it and put the question in your final answer (ask on the spot only when the user is clearly present and nothing else can proceed).
- Do not re-run the same tier with the same brief hoping for a different result.

**Send back the unit, not the batch.** When one piece of a split job fails, return only that piece. Do not redo or re-verify the pieces that passed. The return carries: the unit, the verdict (red), the reason (which check), the evidence (expected vs actual, `path:line`), and a scope line ("fix this file only, do not touch other units"). Without the scope line a returned agent opens neighbouring files and a one-unit fix becomes an unreviewed multi-file diff.

**Three strikes means the plan is wrong.** If the same unit fails three corrections (counting across tiers), stop escalating: the problem is in the brief or the split that produced it, which no retry can see. Re-cut the unit, fix the brief, or take it to the user.

**A check cannot start because a dependency is missing.** The agent stops and reports which one and the project's install command (it does not install). You decide: install it yourself with the project's own package manager (never sudo, no global installs), then re-run the check or continue the agent with `SendMessage`. If the install is large or touches disk space or storage, a license, a paid service or the system, ask the user first.

**A refusal.** Do not re-run the same brief at the same tier, and do not ask an agent for its reasoning or scratchpad text (Anthropic bills a refusal for that and the run stops); ask for findings and evidence. Change the brief, or take the piece into the main session.

**Evidence or it is not done.** An agent's report counts as done only with the command it ran and the tail of its output. A report with no check, or only "looks fine", is `unverified`: run the check yourself or send it back for it.

**Re-review converges.** When you send a fix back through `reviewer`, tell it which round this is, give it the findings already seen or resolved, and ask for the new diff only. After round three, stop reviewing and question the approach.

Escalate on evidence, not only on the agent's own "stopped". Treat these as stopped too: the check was not run or still fails, files changed outside the brief, or the run ended at `maxTurns` with partial output. Verify a "done" yourself with the diff and the check before relying on it.

**If you learn mid-task that it is harder than you judged**, act in this order, cheapest first:
1. The agent has barely started: stop it (`TaskStop`) and spawn the higher tier fresh. Resuming a short history saves almost nothing.
2. It is on the right track but missing a fact: `SendMessage` the hint; a running subagent treats it as a course correction.
3. It is deep in and needs more capability: stop it, then `SendMessage` it again with a higher `model`. The per-call `model` applies on resume (Claude Code 2.1.211+) and the history is kept, but the model switch costs one uncached request. Whether `effort` also applies on resume is not documented: test before relying on it.
4. A subagent the user stopped from `/tasks` does not resume (messages to it are refused); spawn a new one with its report.
You can only do this when you are awake: you are notified when a subagent finishes, not while it runs. Do not poll for progress; the agent panel shows model, effort, and tokens for the user.

If the advisor tool is on (`/advisor`), a Sonnet or Haiku agent can consult a stronger model by itself at the hard moment, with no restart. See [references/model-and-effort.md](references/model-and-effort.md).

## 4b. Runs that do not need the user

Before you start something the user will not watch (an overnight `/loop`, a `/goal`, a background workflow, a batch), answer five questions, and stop to ask the user if you cannot:
1. **Done:** what is the condition, written so a command can evaluate it (tests exit 0, every claim has a source line, the diff touches only the planned files)? "Looks good", "the model is confident" and "no errors were raised" are not conditions.
2. **Check:** what runs by itself to prove it (test suite, Stop hook, review step)?
3. **Boundaries:** which files, branch and commands are allowed? Stay inside them.
4. **Guardrails:** how many turns or how much spend before it stops?
5. **Output and approval:** where does the result land (a PR, a summary, a progress file), and what does a person approve before anything irreversible (migrations, deletes, production, money)?
In a project with handoff files, the open task's `done_when` in `tasks.json` is a good `/goal` condition.
For a whole unattended night, use `/crew-chief:crew-night`: it asks these questions up front, then enforces the boundaries and the deadline with hooks.

## 5. User overrides

These last until the user says otherwise:

| User says | You do |
|---|---|
| "do it yourself", "no subagents", "everything on Opus" | Solo: no subagents at all (`/crew-chief:crew-mode solo` is also enforced by a hook that blocks the Agent tool) |
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
