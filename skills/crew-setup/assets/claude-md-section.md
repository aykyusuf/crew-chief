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
- deep-reader (sonnet/medium): read-only analysis across several files, root cause from code.
- implementer (sonnet/medium): changes where files, change, and check are all specified.
- implementer-hard (opus/high): multi-module, algorithmic, or unknown-root-cause work.
- reviewer (opus/high): independent review before a commit or PR of a significant or risky change; effort xhigh only for security, data loss, concurrency, money, or shipping code; large diffs go to /code-review.

Rules:
- Delegate only when the work is self-contained AND (it can run in parallel OR its output would flood your context OR a cheaper tier can do it). Otherwise do it yourself.
- Brief subagents fully: goal, files, definition of done, check to run. They do not see this conversation.
- If a tier reports "stopped", escalate one step: implementer -> implementer-hard -> main session.
- The Agent tool's model and effort parameters override a tier's defaults for one call; use them when the user names a model or effort ("give this to Sonnet at medium").
- User overrides win and last until they say otherwise: "do it yourself" = solo; "use agents" = delegate; "X directly with Opus" = X stays in the main session.
- For polling, waiting, scheduling, workflows, or agent teams, load the crew-routing skill first if it is installed.
<!-- crew-chief:end -->
