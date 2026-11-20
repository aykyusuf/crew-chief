#!/bin/sh
# crew-chief PreToolUse hook (matcher Agent): the user's rule is "no Fable subagents unless I ask for Fable".
# An Agent call whose `model` parameter contains "fable" (any case, so "fable", "Fable" or a full model id) is
# denied ONCE (exit 2, the reason on stderr goes to the model). The denied call is remembered (cksum of
# model + subagent_type + prompt in ${CLAUDE_PLUGIN_DATA}/fable-gate, four hours), so the identical retry
# passes: the model retries only when the user did ask for Fable in the conversation, and otherwise uses Opus.
#
# It applies to every subagent, not only UI ones, so it is its own script and not part of ui-brief-check.sh
# (which exits early for every agent it does not own). The saver never rewrites a call to Fable (it only
# rewrites to Sonnet), so the two do not meet.
#
# CREW_CHIEF_FABLE_GATE=off turns it off. Needs jq and ${CLAUDE_PLUGIN_DATA}; without them, or when the input
# cannot be parsed, it lets the call through. It never blocks by accident.

input=$(cat)
[ "${CREW_CHIEF_FABLE_GATE:-on}" = "off" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0

model=$(printf '%s' "$input" | jq -r '.tool_input.model // empty | strings' 2>/dev/null)
case $(printf '%s' "$model" | tr '[:upper:]' '[:lower:]') in
  *fable*) ;;
  *) exit 0 ;;
esac

atype=$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null)
prompt=$(printf '%s' "$input" | jq -r '.tool_input.prompt // empty' 2>/dev/null)

dir="$CLAUDE_PLUGIN_DATA/fable-gate"
key=$(printf '%s\n%s\n%s' "$model" "$atype" "$prompt" | cksum 2>/dev/null | tr ' ' '-')
[ -n "$key" ] || exit 0
if [ -f "$dir/$key" ] && [ -n "$(find "$dir/$key" -mmin -240 2>/dev/null)" ]; then
  exit 0
fi
mkdir -p "$dir" 2>/dev/null || exit 0
: > "$dir/$key" 2>/dev/null || exit 0
find "$dir" -type f -mmin +240 -delete 2>/dev/null

echo "crew-chief: the user's rule is no Fable subagents unless they ask for Fable. If the user explicitly asked for Fable in this conversation, retry the identical call; otherwise use Opus." >&2
exit 2
