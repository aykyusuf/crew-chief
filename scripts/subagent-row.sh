#!/bin/sh
# crew-chief subagentStatusLine: rewrites each row of the agent panel below the
# prompt so it shows which model and effort the subagent runs on.
#
#   ○ ui-tester  sonnet-5.5 · medium · 41.2k · 4m12s · ~40%  Reading the auth module ⚠ slow tests
#
# Elapsed time comes from the task's startTime. The percent, current step and delay reason come from
# the per-agent progress file that scripts/progress-hook.sh writes (the agent reports them with a
# `: 'crew-progress 40 | step | delay'` call); without a report the usual label shows and no percent.
#
# Claude Code passes all visible rows as one JSON object on stdin ("tasks"
# array, "columns" = usable row width) and reads back one JSON line per row:
# {"id": ..., "content": ...}. Needs jq; without it this prints nothing and the
# default rows stay.
#
# Width rules: the model/effort/tokens part is never cut. The agent name drops
# its plugin prefix and is capped; the description gets whatever is left.

command -v jq >/dev/null 2>&1 || exit 0

pdir="${TMPDIR:-/tmp}"
pdir="${pdir%/}/crew-chief-progress"
prog=$(cd "$pdir" 2>/dev/null && for f in ./*.json; do [ -f "$f" ] && jq -c 'select(type == "object" and .id != null) | {key: .id, value: .}' "$f" 2>/dev/null; done | jq -cs 'from_entries' 2>/dev/null)
[ -n "$prog" ] || prog='{}'

jq -c --argjson prog "$prog" '
  def clean: tostring | gsub("[\u0000-\u001f\u007f]"; " ") | gsub("  +"; " ") | ltrimstr(" ") | rtrimstr(" ");
  def cut($n): if $n <= 0 then "" elif length <= $n then . elif $n == 1 then "…" else .[0:($n - 1)] + "…" end;
  def short_model:
    if . == null or . == "" then "starting"
    else clean | sub("^claude-"; "") | sub("\\[[^]]*\\]$"; "")
      | sub("-(?<maj>[0-9]+)-(?<min>[0-9]+)(-[0-9]{8})?$"; "-\(.maj).\(.min)")
    end;
  def tokens:
    if (type != "number") then ""
    elif . >= 1000000 then " · \((. / 100000 | floor) / 10)M"
    elif . >= 1000 then " · \((. / 100 | floor) / 10)k"
    else " · \(.)" end;
  def elapsed:
    if . < 0 then "" elif . < 60 then " · \(.)s"
    elif . < 3600 then " · \((. / 60 | floor))m\(. % 60 | tostring | if length < 2 then "0" + . else . end)s"
    else " · \((. / 3600 | floor))h\((. % 3600 / 60 | floor) | tostring | if length < 2 then "0" + . else . end)m" end;
  def mark: if . == "failed" then "✗ " elif . == "killed" then "■ " else "" end;

  ((.columns // 100) | if type == "number" then . else 100 end) as $cols
  | .tasks[]?
  | select(.id != null)
  | ((.name // .agentType // "agent") | clean | sub("^.*:"; "") | if . == "" then "agent" else . end) as $name
  | (.model | short_model) as $model
  | ((.effort // "default") | clean) as $effort
  | (.tokenCount | tokens) as $tok
  | ((.label // .description // "") | clean) as $label
  | (.status | mark) as $mark
  | ($prog[.id // ""] // {}) as $pr
  | (if .status == "running" and (.startTime | type) == "number" then ((now * 1000 - .startTime) / 1000 | floor | elapsed) else "" end) as $el
  | (if ($pr.pct | type) == "number" then " · ~\($pr.pct)%" else "" end) as $pct
  | (($pr.step // "") | clean) as $step
  | (($pr.delay // "") as $d | if $d != "" then $d else ($pr.slow // "") end | clean) as $delay
  | ((if $step != "" then $step else $label end) + (if $delay != "" then " ⚠ " + $delay else "" end)) as $what
  # Visible budget, keeping two columns spare for the panel border.
  | ([$cols - 2, 12] | max) as $w
  # Drop detail in priority order until name + run fit: tokens, then effort.
  | ([$model + " · " + $effort + $tok + $el + $pct, $model + " · " + $effort + $el + $pct, $model + $el + $pct,
      $model + " · " + $effort + $tok, $model + " · " + $effort, $model]
     | map(select(($mark | length) + ([($name | length), 6] | min) + 2 + length <= $w))
     | first // $model) as $run
  | ([($name | length), 32, ($w - ($mark | length) - 2 - ($run | length)), ($w / 3 | floor | if . < 6 then 6 else . end)] | min) as $nl
  | ($name | cut([$nl, 1] | max)) as $who
  | ($w - ($mark | length) - ($who | length) - 2 - ($run | length) - 2) as $left
  | {id, content: (
      $mark + $who + "  \u001b[2m" + ($run | cut($w - ($mark | length) - ($who | length) - 2)) + "\u001b[0m"
      + (if $left >= 4 and ($what | length) > 0 then "  " + ($what | cut($left)) else "" end)
    )}
'
