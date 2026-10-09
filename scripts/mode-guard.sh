#!/bin/sh
# crew-chief mode guard: makes /crew-chief:crew-mode solo binding instead of a request.
#
# Usage (two hooks, one file):
#   mode-guard.sh record   UserPromptSubmit and UserPromptExpansion: when the prompt is
#                          "/crew-chief:crew-mode <mode>", remember the mode for this session
#   mode-guard.sh check    PreToolUse, matcher Agent: while the session is in solo mode, block
#                          subagent spawns (exit 2; Claude Code shows stderr to the model)
#
# The mode lives in ${CLAUDE_PLUGIN_DATA}/modes/<session_id>, never in the project. Only the slash
# command is recognised; "do it yourself" in plain words stays a prose rule the model follows.
# Without CLAUDE_PLUGIN_DATA, a session id, or a recorded solo mode, everything is allowed.
# Reads the hook input with jq when available, otherwise with sed.

input=$(cat)

# Print a top-level string field of the hook input.
field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r ".$1 // empty" 2>/dev/null
    return
  fi
  printf '%s' "$input" | tr '\n' ' ' |
    sed -nE 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' |
    sed -e 's/\\"/"/g' -e 's/\\\\/\\/g'
}

[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
sid=$(field session_id)
case "$sid" in
  ''|*[!A-Za-z0-9_-]*) exit 0 ;;
esac
dir="$CLAUDE_PLUGIN_DATA/modes"

case "$1" in
  record)
    # First line of the prompt only. Without jq a newline or tab arrives as a literal \n or \t.
    line=$(field prompt | head -n 1 | sed -e 's/\\n.*//' -e 's/\\t/ /g')
    mode=$(printf '%s\n' "$line" | sed -nE 's#^[[:space:]]*/(crew-chief:)?crew-mode[[:space:]]+(auto|solo|delegate)([[:space:]].*)?$#\2#p')
    if [ -z "$mode" ]; then
      # UserPromptExpansion form of the same command: command_name plus command_args.
      case "$(field command_name)" in
        crew-mode|crew-chief:crew-mode)
          mode=$(printf '%s\n' "$(field command_args)" | head -n 1 | sed -nE 's#^[[:space:]]*(auto|solo|delegate)([[:space:]].*)?$#\1#p') ;;
      esac
    fi
    [ -n "$mode" ] || exit 0
    if [ "$mode" = "solo" ]; then
      mkdir -p "$dir" 2>/dev/null && printf 'solo\n' > "$dir/$sid" 2>/dev/null
    else
      rm -f "$dir/$sid" 2>/dev/null
    fi
    # Sessions are short-lived; drop records nobody has touched for two weeks.
    find "$dir" -type f -mtime +14 -delete 2>/dev/null
    exit 0 ;;
  check)
    [ -f "$dir/$sid" ] && [ "$(cat "$dir/$sid" 2>/dev/null)" = "solo" ] || exit 0
    echo "Blocked by crew-chief: this session is in solo mode (/crew-chief:crew-mode solo), so no subagents. Do the work in the main session; if you think a subagent is needed, tell the user and let them run /crew-chief:crew-mode auto." >&2
    exit 2 ;;
esac
exit 0
