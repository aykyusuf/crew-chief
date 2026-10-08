#!/bin/sh
# crew-chief subagentStatusLine: rewrites each row of the agent panel below the
# prompt so it shows which model and effort the subagent runs on.
#
#   ○ ui-tester  sonnet-5.5 · medium · 41.2k  Checking the login flow
#
# Claude Code passes all visible rows as one JSON object on stdin ("tasks"
# array) and reads back one JSON line per row: {"id": ..., "content": ...}.
# Needs jq; without it this prints nothing and the default rows stay.

command -v jq >/dev/null 2>&1 || exit 0

jq -c '
  def short_model:
    if . == null then "starting"
    else sub("^claude-"; "") | sub("-(?<maj>[0-9]+)-(?<min>[0-9]+)(-[0-9]{8})?$"; "-\(.maj).\(.min)")
    end;
  def tokens:
    if . == null then ""
    elif . >= 1000 then " · \((. / 100 | floor) / 10)k"
    else " · \(.)" end;
  (.columns // 120) as $cols
  | .tasks[]?
  | ((.name // .agentType // "agent") | sub("^crew-chief:"; "")) as $who
  | ((.model | short_model) + " · " + ((.effort // "default") | tostring) + (.tokenCount | tokens)) as $run
  | (.label // .description // "") as $what
  | ($who + "  \u001b[2m" + $run + "\u001b[0m  " + $what) as $row
  | {id, content: (if ($row | length) > $cols + 8 then $row[0:($cols + 5)] + "…" else $row end)}
'
