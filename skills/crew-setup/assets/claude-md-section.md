<!-- crew-chief:start (managed by /crew-chief:crew-setup; edit freely, re-running setup replaces this block) -->
## Model and subagent routing

The user chose this session's model and effort; you decide who does each piece of work.

Mode: auto (the user can switch with /crew-mode or by saying so).
- auto: route by the table below.
- solo: do everything in the main session; spawn no subagents.
- delegate: actively hand independent pieces to the tiers below, in parallel where possible.

Tiers (agents in .claude/agents, default model/effort):
- main session: back-and-forth with the user, design or product decisions, planning, tightly coupled work, quick fixes.
- scanner (haiku/low): mechanical lookups, filtering long logs or test output.
- deep-reader (sonnet/medium): read-only analysis across several files, root cause from code, code plus web research (read-only; a long report goes to a file in the crew-chief reports folder and a short summary comes back).
- implementer (sonnet/medium): changes where files, change, and check are all specified.
- ui-implementer (sonnet/medium): UI code (components, styles, pages, screens, Flutter widgets, SwiftUI views) with the design skills preloaded; UI code goes here, not to implementer. Pass model and effort on every UI call (the UI hint carries the table, data/ui-policy.json; sonnet/medium is only the default, never Fable unless the user asks). The brief names the project UI profile (.crew-chief/ui-profile.json), the extra skills to load and the reference image paths; a UI brief without them, or sent to another writing agent, is held back once.
- mechanic (haiku/low): rote edits in named files with a verify command (renames, same line in many files, applying a given diff); anything needing judgement goes to implementer.
- implementer-hard (opus/medium; high after a failed attempt or for risky work): multi-module, algorithmic, or unknown-root-cause work.
- planner (opus/medium; high for a large or risky change): read-only plan for a multi-module change before implementer-hard: files, order, risks, a testable done condition; no edits.
- ui-designer (opus/high): read-only design spec for big UI work (3+ screens, a new site, a redesign), written to .crew-chief/design/<slug>.md; no code. ui-implementer then builds from the spec (sonnet/high).
- ui-scout (sonnet/medium): design reference scout, used when the user picks "find some" at the reference step: it researches what matters in this kind of project, finds 3-4 live sites and open galleries, looks at them in a browser, and writes screenshots and REFS.md to .crew-chief/refs/ (no code; inspiration only). Never run it and ui-tester on the same browser at the same time.
- ui-smoke (haiku/low): quick read-only check that a page or screen is up, shows given text, or logs errors; no screenshots.
- ui-tester (sonnet/medium): multi-step browser, emulator, or simulator checks with screenshots; reports pass/fail with evidence; never two UI agents on the same device or browser at once.
- reviewer (opus/medium): independent review before a commit or PR of a significant or risky change; effort high for risky changes, xhigh only for security, data loss, concurrency, money, or shipping code; large diffs go to /code-review.
- security-reviewer (opus/high, read-only, security-audit skill preloaded): security review before committing changes to auth, crypto, secrets, payments, migrations or input reaching SQL/shell/path sinks (effort xhigh there; model sonnet, effort high for CI or dependency changes only). /security runs it; a gate holds back the first git commit of such files (the identical retry passes).

Rules:
- Delegate only when the work is self-contained AND (it can run in parallel OR its output would flood your context OR a cheaper tier can do it). Otherwise do it yourself.
- Brief subagents fully: goal, files, definition of done, check to run, and any constraint the user gave in this conversation (do not modify X, no commits). They do not see this conversation.
- If your own model is Fable, your context is the most expensive: hand reading and searching (more than two or three files, logs, web pages) to scanner or deep-reader, ask for findings and not file dumps, and keep your context for decisions.
- Never start a subagent on a Fable model unless the user asked for Fable (use Opus).
- If a tier reports "stopped", escalate one step: implementer -> implementer-hard -> main session.
- The Agent tool's model and effort parameters override a tier's defaults for one call; use them when the user names a model or effort ("give this to Sonnet at medium").
- User overrides win and last until they say otherwise: "do it yourself" = solo; "use agents" = delegate; "X directly with Opus" = X stays in the main session.
- Subagents cannot see your skill list. When a task needs a skill, name it in the brief; every tier except scanner, mechanic and ui-smoke can load it with the Skill tool. For skill-heavy work you may use general-purpose, but pass model explicitly, because it otherwise inherits the main model.
- For polling, waiting, scheduling, workflows, or agent teams, load the crew-routing skill first if it is installed.
<!-- crew-chief:end -->
