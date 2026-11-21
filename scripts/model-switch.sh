#!/bin/sh
# crew-chief model switch hooks (ONERILER-26 item 8).
#   model-switch.sh pre    PreModelSwitch: asks the user only when the switch is costly or loses reasoning: leaving Fable
#                          (other models cannot read Fable's thinking blocks), or a warm prompt cache whose re-write would
#                          cost about 1 USD or more. The question names the cost and suggests updating the handoff files first.
#   model-switch.sh post   PostModelSwitch: one note for the new model (reasoning lost after leaving Fable; keep the
#                          context lean on a more expensive model).
# CREW_CHIEF_MODEL_SWITCH=off turns both off. Needs jq; without it nothing happens. Never denies.

[ "${CREW_CHIEF_MODEL_SWITCH:-on}" = off ] && exit 0
input=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0
from=$(printf '%s' "$input" | jq -r '.from_model // ""')
to=$(printf '%s' "$input" | jq -r '.to_model // ""')
warm=$(printf '%s' "$input" | jq -r '.prompt_cache_warm // false')
usd=$(printf '%s' "$input" | jq -r '.estimated_cache_write_usd // 0')
ctx=$(printf '%s' "$input" | jq -r '.context_tokens // 0')

rank() {
  case $(printf '%s' "$1" | tr 'A-Z' 'a-z') in
    *fable*|*mythos*) echo 4 ;;
    *opus*) echo 3 ;;
    *sonnet*) echo 2 ;;
    *haiku*) echo 1 ;;
    *) echo 0 ;;
  esac
}
rf=$(rank "$from")
rt=$(rank "$to")
kt=$(awk -v c="$ctx" 'BEGIN { printf "%d", c / 1000 }')
costly=$(awk -v u="$usd" 'BEGIN { print (u >= 1.0) ? "yes" : "no" }')
dollars=$(awk -v u="$usd" 'BEGIN { printf "%.2f", u }')

case "$1" in
  pre)
    why=""
    if [ "$rf" = 4 ] && [ "$rt" != 4 ]; then
      why="Leaving Fable: the new model cannot read Fable's thinking, so the reasoning behind the current work is lost."
    fi
    if [ "$warm" = true ] && [ "$costly" = yes ]; then
      why="${why:+$why }The prompt cache is warm: the next request re-sends about ${kt}k tokens uncached on the new model (about ${dollars} USD)."
    fi
    [ -n "$why" ] || exit 0
    jq -nc --arg r "crew-chief: $why Better at a natural break: have Claude update the handoff files (or /compact) first, then switch. Switch anyway?" \
      '{hookSpecificOutput: {hookEventName: "PreModelSwitch", permissionDecision: "ask", permissionDecisionReason: $r}}'
    ;;
  post)
    note=""
    if [ "$rf" = 4 ] && [ "$rt" != 4 ]; then
      note="crew-chief: the session just moved from $from to $to. Fable's thinking from before the switch is not readable by you: before continuing, restate the current goal, plan and next step from the conversation and the handoff files (STATUS.md, tasks.json) instead of assuming earlier reasoning."
    elif [ "$rt" -gt "$rf" ] && [ "$rf" != 0 ]; then
      note="crew-chief: the session just moved to $to, a more expensive model. Keep this context for decisions: hand file reading, log reading and searches to the cheap subagents (scanner, deep-reader)."
    fi
    [ -n "$note" ] || exit 0
    jq -nc --arg t "$note" '{hookSpecificOutput: {hookEventName: "PostModelSwitch", additionalContext: $t}}'
    ;;
esac
exit 0
