#!/bin/sh
# crew-chief SubagentStart hook: gives every subagent the progress-report rule as starting context, so
# the panel row's percent does not depend on each agent's brief. The hook input (agent_id, agent_type)
# is not needed; the text is the same for all. Needs jq; without it this does nothing. Never blocks.

cat >/dev/null
command -v jq >/dev/null 2>&1 || exit 0
jq -nc '{hookSpecificOutput: {hookEventName: "SubagentStart", additionalContext:
  "crew-chief progress rule: every 10 tool calls, and before any long command or when your phase changes, run the no-op Bash call : \u0027crew-progress NN | what you are on | why slow\u0027. NN is your honest percent done (0-100); never leave an old number standing. A reminder will show up if you forget."}}' 2>/dev/null
exit 0
