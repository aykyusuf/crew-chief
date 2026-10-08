#!/bin/sh
# crew-chief subagentStatusLine: rewrites each row of the agent panel below the
# prompt so it shows which model and effort the subagent runs on.
#
#   ○ ui-tester  sonnet-5.5 · medium · 41.2k  Checking the login flow
#
# Claude Code passes all visible rows as one JSON object on stdin ("tasks"
# array, "columns" = usable row width) and reads back one JSON line per row:
# {"id": ..., "content": ...}. Needs jq; without it this prints nothing and the
# default rows stay.
#
# Width rules: the model/effort/tokens part is never cut. The agent name drops
# its plugin prefix and is capped; the description gets whatever is left.

command -v jq >/dev/null 2>&1 || exit 0

jq -c '
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
  def mark: if . == "failed" then "✗ " elif . == "killed" then "■ " else "" end;

  ((.columns // 100) | if type == "number" then . else 100 end) as $cols
  | .tasks[]?
  | select(.id != null)
  | ((.name // .agentType // "agent") | clean | sub("^.*:"; "") | if . == "" then "agent" else . end) as $name
  | (.model | short_model) as $model
  | ((.effort // "default") | clean) as $effort
  | (.tokenCount | tokens) as $tok
  | ((.label // .description // "") | clean) as $what
  | (.status | mark) as $mark
  # Visible budget, keeping two columns spare for the panel border.
  | ([$cols - 2, 12] | max) as $w
  # Drop detail in priority order until name + run fit: tokens, then effort.
  | ([$model + " · " + $effort + $tok, $model + " · " + $effort, $model]
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
