#!/bin/sh
# crew-chief SessionStart hook: prints the routing policy, which Claude Code adds
# to the session context. Runs on startup, resume, clear, and compact so the
# policy survives context resets. Keep it short: it is paid for on every session.
#
# The project directory comes from the hook input ("cwd"), not the environment.
# If /crew-setup already wrote the policy into that project's CLAUDE.md, the
# policy is not added a second time.

cwd=$(tr '\n' ' ' | sed -nE 's/.*"cwd"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p')
if [ -n "$cwd" ] && [ -f "$cwd/CLAUDE.md" ] && grep -q '<!-- crew-chief:start' "$cwd/CLAUDE.md"; then
  echo "crew-chief: the routing policy is in this project's CLAUDE.md. The plugin's agents are also available as crew-chief:<tier>; prefer the project's own copies (bare names) so routing stays consistent."
  exit 0
fi

printf '%s\n' \
  '<crew-chief-policy>' \
  'crew-chief is installed. The user chose this session'\''s model and effort; you decide who does each piece of work.' \
  '' \
  'Mode: auto (the user can switch with /crew-chief:crew-mode or by saying so).' \
  '- auto: route by the table below.' \
  '- solo: do everything in the main session; spawn no subagents.' \
  '- delegate: actively hand independent pieces to the tiers below, in parallel where possible.' \
  '' \
  'Tiers (agent type, default model/effort):' \
  '- main session: back-and-forth with the user, design or product decisions, planning, tightly coupled work, quick fixes.' \
  '- crew-chief:scanner (haiku/low): mechanical lookups, filtering long logs or test output.' \
  '- crew-chief:deep-reader (sonnet/medium): read-only analysis across several files, root cause from code.' \
  '- crew-chief:implementer (sonnet/medium): changes where files, change, and check are all specified.' \
  '- crew-chief:implementer-hard (opus/high): multi-module, algorithmic, or unknown-root-cause work.' \
  '- crew-chief:ui-smoke (haiku/low): quick read-only check that a page or screen is up, shows given text, or logs errors; no screenshots.' \
  '- crew-chief:ui-tester (sonnet/medium): multi-step browser, emulator, or simulator checks with screenshots; reports pass/fail with evidence; never two UI agents on the same device or browser at once.' \
  '- crew-chief:reviewer (opus/high): independent review before a commit or PR of a significant or risky change; effort xhigh only for security, data loss, concurrency, money, or shipping code; large diffs go to /code-review.' \
  '' \
  'Rules:' \
  '- Delegate only when the work is self-contained AND (it can run in parallel OR its output would flood your context OR a cheaper tier can do it). Otherwise do it yourself.' \
  '- Brief subagents fully: goal, files, definition of done, check to run. They do not see this conversation.' \
  '- If a tier reports "stopped", escalate one step: implementer -> implementer-hard -> main session.' \
  '- The Agent tool'\''s model and effort parameters override a tier'\''s defaults for one call; use them when the user names a model or effort ("give this to Sonnet at medium").' \
  '- User overrides win and last until they say otherwise: "do it yourself" = solo; "use agents" = delegate; "X directly with Opus" = X stays in the main session.' \
  '- For polling, waiting, scheduling, workflows, or agent teams, load the crew-chief:crew-routing skill first.' \
  '</crew-chief-policy>'
