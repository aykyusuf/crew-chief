#!/bin/sh
# crew-chief night mode Stop hook: while this session's night is armed or in wrap-up, a Stop is refused with a short
# reminder until the deadline; then the night ends by itself (REPORT.md, status done). Every other session, and every
# error (no jq, garbage JSON, unreadable state), exits 0 at once: a hook that fails must never trap the night.
#
# Decision order (CREW_CHIEF_NOW is a fake clock for the tests):
#   1. not this session's armed|wrapup night -> exit 0
#   2. background tasks or crons pending -> exit 0 (waiting for a wake-up), no count
#   3. `hold` file with an epoch in the future (compaction under way) -> exit 0, no count
#   4. now >= deadline -> status done (script-made REPORT.md when the agent wrote none), exit 0
#   5. now >= softWrap -> status wrapup; the block text says: finish, write the report, run `done`
#   6. same progress signature as the last Stop, stallBlocks times in a row -> status stalled, exit 0
#   7. otherwise block. stop_hook_active (true on every block after the first) does NOT end the night.

input=$(cat)
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
sid=$(printf '%s' "$input" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]+"' | head -n 1 | sed -E 's/.*"([A-Za-z0-9_-]+)"$/\1/')
[ -n "$sid" ] && [ -f "$CLAUDE_PLUGIN_DATA/night/$sid" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

here=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
. "$here/night-lib.sh" || exit 0
. "$here/stop-lib.sh" || exit 0
stop_parse "$input" || exit 0
[ "$STOP_SID" = "$sid" ] || exit 0
dir=$(nl_dir_of "$sid")
[ -n "$dir" ] || exit 0

eval "$(jq -r '@sh "status=\(.status // "") owner=\(.session // "") deadline=\(.deadline // 0) softwrap=\(.softWrap // 0) started=\(.started // 0) blocks=\(.blocks // 0) noprog=\(.noProgress // 0) lastsig=\(.lastSig // "") root=\(.root // "") sha=\(.startSha // "") sid8=\(.sid8 // "") reason=\(.reason // "") cur=\(.current.id // "") since=\(.current.since // 0)"' "$dir/state.json" 2>/dev/null)" || exit 0
case "$status" in armed|wrapup) ;; *) exit 0 ;; esac
[ "$owner" = "$sid" ] || exit 0
case "$deadline$softwrap$started$blocks$noprog$since" in *[!0-9]*) exit 0 ;; esac

# A running subagent or a cron will wake the session by itself: let the turn end, no count. A dev server or another
# long-running process never ends, so it must not switch the night off.
pending=$(printf '%s' "$input" | jq -r '(((.background_tasks // []) | map(select(type == "object" and ((.agent_type // "") != "" or (.type // "") == "agent"))) | length) + ((.session_crons // []) | length))' 2>/dev/null)
case "$pending" in ''|0) ;; *[!0-9]*) ;; *) exit 0 ;; esac

now=$(nl_now)
hold=$(head -n 1 "$dir/hold" 2>/dev/null)
case "$hold" in
  ''|*[!0-9]*) ;;
  *) if [ "$hold" -gt "$now" ] && [ "$hold" -le $((now + 3600)) ]; then exit 0; fi ;;
esac

if [ "$now" -ge "$deadline" ]; then
  nl_finish "$dir" done deadline
  exit 0
fi

wrap=0
if [ "$status" = wrapup ]; then
  wrap=1
elif [ "$now" -ge "$softwrap" ]; then
  nl_update "$dir" '.status = "wrapup"' || exit 0
  nl_event "$dir" night "phase wrapup (soft wrap-up time reached)"
  wrap=1
fi

# Progress signature: HEAD, the working tree, and the files the work moves (tasks, decisions, questions, report, current task).
sig=$( {
  GIT_OPTIONAL_LOCKS=0 git -C "$root" rev-parse HEAD 2>/dev/null
  GIT_OPTIONAL_LOCKS=0 git -C "$root" status --porcelain 2>/dev/null
  GIT_OPTIONAL_LOCKS=0 git -C "$root" diff HEAD 2>/dev/null | cksum
  GIT_OPTIONAL_LOCKS=0 git -C "$root" ls-files -o --exclude-standard -z 2>/dev/null | xargs -0 ls -ln 2>/dev/null | head -200
  nl_mtime "$root/tasks.json"; nl_mtime "$dir/DECISIONS.md"; nl_mtime "$dir/QUESTIONS.md"; nl_mtime "$dir/REPORT.md"
  printf '%s\n' "$cur"
} | cksum 2>/dev/null | tr ' ' '-')
[ -n "$sig" ] || exit 0
if [ "$sig" = "$lastsig" ]; then noprog=$((noprog + 1)); else noprog=1; fi
stall=$(nl_default stallBlocks 3)
if [ "$noprog" -ge "$stall" ]; then
  nl_finish "$dir" stalled stalled
  exit 0
fi
blocks=$((blocks + 1))
nl_update "$dir" '.blocks = $b | .noProgress = $p | .lastSig = $s' --argjson b "$blocks" --argjson p "$noprog" --arg s "$sig" || exit 0
nl_event "$dir" stop "blocked the Stop (block $blocks, same-signature count $noprog)"

left=$(( (deadline - now + 59) / 60 ))
until_t=$(nl_fmt "$deadline" '%H:%M')
done_cmd="sh $here/night-state.sh done --session $sid"
if [ "$wrap" = 1 ]; then
  why=""
  [ "$reason" = limit ] && why=" The usage limit was reached, so no new work starts."
  msg="crew-chief night mode, WRAP UP ($left min to the deadline at $until_t).$why Finish the current task and start no new one. Then write night/$sid8/REPORT.md from the report template (done with evidence, decided without asking and how to undo, parked questions with your recommendation, not done and why) and run: $done_cmd"
else
  next=""
  [ -f "$root/tasks.json" ] && next=$(jq -r '[.tasks[]? | select(.status == "todo")] | sort_by(.priority // 99) | .[0] | select(. != null) | "\(.id): \(.title)"' "$root/tasks.json" 2>/dev/null)
  if [ -n "$next" ]; then
    todo="Next todo in tasks.json: $next."
  else
    todo="No todo is left in tasks.json. Closing checklist: run the tests, have a reviewer agent look at your own diff (git diff $sha..HEAD), update the docs, write night/$sid8/REPORT.md, then run: $done_cmd"
  fi
  curline=""
  if [ -n "$cur" ] && [ "$since" -gt 0 ]; then
    park=$(nl_default parkPct 40)
    allowed=$(( (deadline - started) * park / 100 / 60 ))
    curline=" Current task $cur: $(( (now - since) / 60 )) min so far, park it at $allowed min (a task past $park% of the night without progress is parked)."
  fi
  att=$(nl_default attempts 3)
  msg="crew-chief night mode (session $sid8): do not stop, $left min to the deadline at $until_t. $todo$curline Policy: nobody is here, so do not ask; put questions in night/$sid8/QUESTIONS.md with your default and go on. Decide small things alone and log them in night/$sid8/DECISIONS.md with how to undo. $att attempts per task, then park it as blocked with the evidence. A denied command is never worked around. Never push; no Fable subagents."
fi
emit_block "$msg"
exit 0
