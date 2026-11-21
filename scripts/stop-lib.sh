#!/bin/sh
# crew-chief shared Stop-hook helper (sourced, POSIX sh). First user: night-stop.sh. Needs jq.
#
#   stop_parse "$input"      parse the hook input; returns 1 (caller should exit 0, fail open) on no jq or garbage.
#                            Sets STOP_SID and STOP_ACTIVE (true|false: the hook has already blocked this turn once).
#   stop_count_get|set|reset <file>   a file-based block counter, for hooks that give up after N blocks.
#   emit_block <reason>      print {"decision":"block","reason":...}; the session keeps working and sees the reason.
#
# stop_hook_active is true on EVERY Stop after the first block, so an ordinary gate exits 0 when it is true
# (the user can always stop on the second try); a hook that must hold longer (night mode) ignores it and keeps its own
# no-progress counter. The helper only reports the flag and lets the caller decide.

stop_parse() {
  command -v jq >/dev/null 2>&1 || return 1
  printf '%s' "$1" | jq -e 'type == "object"' >/dev/null 2>&1 || return 1
  STOP_SID=$(printf '%s' "$1" | jq -r '.session_id // empty | strings' 2>/dev/null)
  STOP_ACTIVE=$(printf '%s' "$1" | jq -r 'if .stop_hook_active == true then "true" else "false" end' 2>/dev/null)
  return 0
}

stop_count_get() {
  _c=$(cat "$1" 2>/dev/null)
  case "$_c" in ''|*[!0-9]*) _c=0 ;; esac
  printf '%s\n' "$_c"
}
stop_count_set() { printf '%s\n' "$2" > "$1" 2>/dev/null; }
stop_count_reset() { rm -f "$1" 2>/dev/null; }

emit_block() {
  jq -n --arg r "$1" '{decision: "block", reason: $r}'
}
