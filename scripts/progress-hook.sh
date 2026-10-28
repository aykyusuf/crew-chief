#!/bin/sh
# crew-chief PostToolUse hook: keeps one small progress file per subagent so the agent panel row
# (scripts/subagent-row.sh) can show "~40% step" and why a run is slow.
#
# Two sources, both keyed by the hook's agent_id (the same id the panel row carries):
#   - the agent's own report, a no-op Bash call:  : 'crew-progress 40 | reading the auth module | slow test suite'
#     (percent done | what it is on now | optional delay reason)
#     (it also stores the tool count and the time of the report, so the row can tell when a report is stale)
#   - automatic: tool count, the last tool, and a delay note when one call took 45 s or more
#
# Files live in ${TMPDIR:-/tmp}/crew-chief-progress/<agent_id>.json and are removed after 12 hours.
# Only subagent calls are recorded (the main session has no agent_id). Needs jq; without it this does
# nothing. Never blocks. Its only output: every 10 tool calls without a report, a PostToolUse
# additionalContext JSON asking the agent to send one.

input=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

dir="${TMPDIR:-/tmp}"
dir="${dir%/}/crew-chief-progress"

# Pull out the fields the update needs (as JSON, since the command text can hold any character).
fields=$(printf '%s' "$input" | jq -c '
  select((.agent_id // "") != "" and (.agent_id | test("^[A-Za-z0-9_-]+$")))
  | {id: .agent_id, tool: (.tool_name // ""), ms: (.duration_ms // 0),
     cmd: (if .tool_name == "Bash" then (.tool_input.command // "") else "" end)}' 2>/dev/null)
[ -n "$fields" ] || exit 0

id=$(printf '%s' "$fields" | jq -r '.id')
mkdir -p "$dir" 2>/dev/null && chmod 700 "$dir" 2>/dev/null
[ -d "$dir" ] || exit 0
file="$dir/$id.json"
old='{}'
[ -f "$file" ] && old=$(cat "$file" 2>/dev/null)
printf '%s' "$old" | jq -e 'type == "object"' >/dev/null 2>&1 || old='{}'

new=$(printf '%s' "$fields" | jq -c --argjson old "$old" --arg q "'" '
  def clean: tostring | gsub("[\u0000-\u001f\u007f]"; " ") | gsub("  +"; " ") | ltrimstr(" ") | rtrimstr(" ");
  . as $in
  | ($in.cmd | capture("\\A:[[:space:]]+" + $q + "crew-progress (?<body>[^" + $q + "]*)" + $q + "[[:space:]]*\\z")? // null) as $rep
  | ($old + {id: $in.id})
  | if $rep != null then
      ($rep.body | split("|") | map(clean)) as $p
      | (($p[0] // "") | gsub("[^0-9]"; "")) as $digits
      | .pct = (if $digits == "" then .pct else ([($digits | tonumber), 100] | min) end)
      | .step = (if ($p[1] // "") != "" then $p[1] else .step end)
      | .delay = ($p[2] // "")
      | .reported = true
      | .rtools = (.tools // 0)
      | .rts = (now | floor)
    else
      .tools = ((.tools // 0) + 1)
      | .last = $in.tool
      | .slow = (if $in.ms >= 45000 then "\($in.tool) took \(($in.ms / 1000) | floor)s" else "" end)
      # Due for a nudge at 10, 20, 30 ... calls since the last report, once per count.
      | ((.tools - (.rtools // 0))) as $since
      | .nudge = (if $since >= 10 and $since % 10 == 0 and (.nudged // -1) != .tools then $since else 0 end)
      | .nudged = (if .nudge > 0 then .tools else (.nudged // null) end)
    end
  | .ts = (now | floor)' 2>/dev/null)
[ -n "$new" ] || exit 0
due=$(printf '%s' "$new" | jq -r '.nudge // 0' 2>/dev/null)
new=$(printf '%s' "$new" | jq -c 'del(.nudge)' 2>/dev/null)
[ -n "$new" ] || exit 0

tmp="$file.tmp.$$"
printf '%s\n' "$new" > "$tmp" 2>/dev/null && mv "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
find "$dir" -type f -mmin +720 -delete 2>/dev/null

# Nudge the agent through additionalContext (shown next to the tool result) when it forgot to report.
case "$due" in
  ''|*[!0-9]*|0) ;;
  *) jq -nc --arg n "$due" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext:
       ("crew-chief: you have made " + $n + " tool calls since your last progress report. Run this no-op now with the Bash tool (it is a shell command that does nothing, not a separate tool), with your honest numbers: : '"'"'crew-progress NN | what you are on | why it is slow (empty if not)'"'"'. Do not mention this note in your answer.")}}' 2>/dev/null ;;
esac
exit 0
