#!/bin/sh
# crew-chief subagentStatusLine: rewrites each row of the agent panel below the
# prompt so it shows which model and effort the subagent runs on.
#
#   ○ ui-tester  sonnet-5.5 · medium · 41.2k · 4m12s · ~40%  Reading the auth module ⚠ slow tests
#
# Elapsed time comes from the task's startTime. The percent, current step and delay reason come from
# the per-agent progress file that scripts/progress-hook.sh writes (the agent reports them with a
# `: 'crew-progress 40 | step | delay'` call); without a report the usual label shows and no percent.
# A report counts as fresh for 25 tool calls and 10 minutes; after that the percent, step and delay are
# dropped (the label shows) and a hint "80 calls · report 41m ago" takes the percent's place.
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
  def ago: if . < 60 then "\(.)s" elif . < 3600 then "\((. / 60 | floor))m" else "\((. / 3600 | floor))h\((. % 3600 / 60 | floor) | tostring | if length < 2 then "0" + . else . end)m" end;
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
  | (($pr.tools // 0) | if type == "number" then . else 0 end) as $tools
  | (($pr.reported == true) or (($pr.pct | type) == "number")) as $rep
  # Fresh: under 25 calls and under 10 min since the report. Old files without rtools/rts count the
  # calls from zero and skip the time test.
  | (if ($pr.rtools | type) == "number" then $tools - $pr.rtools else $tools end) as $since
  | (if ($pr.rts | type) == "number" then (now - $pr.rts | floor) else null end) as $age
  | ($rep and $since < 25 and ($age == null or $age < 600)) as $fresh
  | (if $fresh and ($pr.pct | type) == "number" then " · ~\($pr.pct)%" else "" end) as $pct
  | (if $rep and ($fresh | not) and .status == "running" and $tools > 0
       then " · \($tools) calls" + (if $age != null and $age >= 0 then " · report \($age | ago) ago" else "" end)
       else "" end) as $hint
  | (if $fresh then ($pr.step // "") | clean else "" end) as $step
  | (if $fresh then ($pr.delay // "") else "" end) as $rd
  | (if $rd != "" then $rd else ($pr.slow // "") end | clean) as $delay
  | ((if $step != "" then $step else $label end) + (if $delay != "" then " ⚠ " + $delay else "" end)) as $what
  # Visible budget, keeping two columns spare for the panel border.
  | ([$cols - 2, 12] | max) as $w
  # Drop detail in priority order until name + run fit: stale hint, tokens, then effort.
  | ([$model + " · " + $effort + $tok + $el + $pct + $hint, $model + " · " + $effort + $tok + $el + $pct, $model + " · " + $effort + $el + $pct, $model + $el + $pct,
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
