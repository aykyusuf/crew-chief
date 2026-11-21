#!/bin/sh
# crew-chief night mode guard (PreToolUse Bash|Agent|AskUserQuestion, and PermissionRequest).
#
# Acts only while THIS session's night is armed or in wrap-up; every other session, an opening night, and every
# error (no jq, garbage JSON, no pointer) exit 0 at once. While the night runs it denies:
#   - git push, in any form (git -C x push, git -c k=v push, /usr/bin/git push ...), and the user's forbidden list
#     (state.json "forbidden", substring match);
#   - outward commands built in: GitHub writes (gh pr merge/create/comment, gh release ...), deploys and publishes
#     (vercel, netlify, fly, firebase, kubectl apply, helm, terraform apply, npm publish, docker push ...), cloud CLIs
#     (aws, gcloud, az), remote shells and copies (ssh, scp, sftp, rsync to a host), and rm -r outside the repo;
#   - an Agent call that would be the (maxAgents+1)th of the night, and any Agent call naming a Fable model;
#   - AskUserQuestion (nobody is here: the question goes to QUESTIONS.md with a default);
#   - any permission prompt (PermissionRequest), so a prompt never parks the night. The one exception is the night's
#     own night-state.sh script, which the night needs to finish.
# Every deny is also appended to night/<sid8>/events.log. PreToolUse denies with exit 2 and the reason on stderr
# (like fable-gate.sh); PermissionRequest answers with a deny decision on stdout.

input=$(cat)
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
sid=$(printf '%s' "$input" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]+"' | head -n 1 | sed -E 's/.*"([A-Za-z0-9_-]+)"$/\1/')
[ -n "$sid" ] && [ -f "$CLAUDE_PLUGIN_DATA/night/$sid" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
printf '%s' "$input" | jq -e 'type == "object" and .session_id == "'"$sid"'"' >/dev/null 2>&1 || exit 0

here=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
. "$here/night-lib.sh" || exit 0
dir=$(nl_dir_of "$sid")
[ -n "$dir" ] || exit 0
eval "$(jq -r '@sh "status=\(.status // "") owner=\(.session // "") sid8=\(.sid8 // "") spawned=\(.spawned // 0)"' "$dir/state.json" 2>/dev/null)" || exit 0
case "$status" in armed|wrapup) ;; *) exit 0 ;; esac
[ "$owner" = "$sid" ] || exit 0

eval "$(printf '%s' "$input" | jq -r '@sh "event=\(.hook_event_name // "PreToolUse") tool=\(.tool_name // "")"' 2>/dev/null)" || exit 0

short() { printf '%s' "$1" | tr '\n\r' '  ' | cut -c1-120; }

if [ "$event" = PermissionRequest ]; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty | strings' 2>/dev/null)
  if [ "$tool" = Bash ] && [ -n "$cmd" ]; then
    # The night's own state script is always allowed (plain invocation, no shell tricks).
    case "$cmd" in
      *';'*|*'&'*|*'|'*|*'`'*|*'$'*|*'('*|*')'*|*'<'*|*'>'*|*'
'*) ;;
      *)
        first=$(printf '%s' "$cmd" | sed -E 's/^(sh[[:space:]]+)?("([^"]*)"|([^[:space:]]+)).*/\3\4/')
        case "$first" in
          */night-state.sh)
            jq -n '{hookSpecificOutput: {hookEventName: "PermissionRequest", decision: {behavior: "allow"}}}'
            exit 0 ;;
        esac ;;
    esac
  fi
  nl_event "$dir" guard "permission request denied: $tool $(short "$cmd")"
  jq -n --arg m "night mode: nobody is here to approve this, so it is denied. Park the task in night/$sid8/QUESTIONS.md and continue with other work." \
    '{hookSpecificOutput: {hookEventName: "PermissionRequest", decision: {behavior: "deny", message: $m}}}'
  exit 0
fi

deny() { # <event text> <reason for the model>
  nl_event "$dir" guard "$1"
  printf '%s\n' "crew-chief night mode: $2" >&2
  exit 2
}

case "$tool" in
  AskUserQuestion)
    deny "AskUserQuestion denied" "night mode: write this question to night/$sid8/QUESTIONS.md with your default, then continue" ;;

  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty | strings' 2>/dev/null)
    [ -n "$cmd" ] || exit 0
    OPT='(-[Cc][[:space:]]+("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)|--(git-dir|work-tree|namespace|exec-path)[[:space:]]+[^[:space:]]+|--[A-Za-z-]+(=[^[:space:]]*)?|-[A-Za-z])'
    if printf '%s\n' "$cmd" | grep -qE "(^|[^[:alnum:]_.-])git([[:space:]]+$OPT)*[[:space:]]+push([^[:alnum:]_-]|\$)"; then
      deny "git push denied: $(short "$cmd")" "git push is not allowed at night, in any form. Commit locally only; if a push is needed, park it in night/$sid8/QUESTIONS.md as \"ready to run: <command>\". (If the words are only text inside another command, rephrase them.)"
    fi
    forb=$(jq -r '.forbidden[]? | strings | select(length > 0)' "$dir/state.json" 2>/dev/null)
    if [ -n "$forb" ]; then
      oldifs=$IFS; IFS='
'
      for f in $forb; do
        case "$cmd" in
          *"$f"*) IFS=$oldifs; deny "forbidden command denied ($f): $(short "$cmd")" "the user forbade \"$f\" for this night. Do not work around it; park the task in night/$sid8/QUESTIONS.md and continue." ;;
        esac
      done
      IFS=$oldifs
    fi
    # Built-in outward actions (in bypass mode this hook is the only gate; the policy text alone is not enough):
    # GitHub writes, deploys and publishes, remote shells and copies.
    # Command position only: the start, or after ; & | ( `, optionally behind sudo, env, exec, command or VAR=value.
    B='(^|[;&|(`])[[:space:]]*((sudo|env|exec|command|nohup|time)[[:space:]]+|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
    outward="${B}gh[[:space:]]+(pr[[:space:]]+(merge|create|comment|close|review|edit|ready|reopen)|release|repo[[:space:]]+(create|delete|edit|rename|archive|sync)|workflow[[:space:]]+(run|enable|disable)|run[[:space:]]+(rerun|cancel)|issue[[:space:]]+(create|comment|close|edit|delete|reopen)|secret|variable|api[[:space:]].*(-X|--method)[[:space:]]*(POST|PUT|PATCH|DELETE))"
    outward="$outward|${B}(vercel([[:space:]]+(deploy|promote|rollback|remove|env)|[^;&|]*--prod)|netlify[[:space:]]+deploy|fly(ctl)?[[:space:]]+(deploy|scale|secrets)|firebase[[:space:]]+deploy|heroku[[:space:]]|kubectl[[:space:]]+(apply|delete|rollout|scale|patch|edit|replace|create|set|drain)|helm[[:space:]]+(install|upgrade|uninstall|rollback)|terraform[[:space:]]+(apply|destroy|import)|tofu[[:space:]]+(apply|destroy)|pulumi[[:space:]]+(up|destroy)|eas[[:space:]]+(submit|update|build)|fastlane[[:space:]]|(npm|pnpm|yarn|bun)[[:space:]]+publish|cargo[[:space:]]+publish|twine[[:space:]]+upload|gem[[:space:]]+push|docker[[:space:]]+push|(serverless|sls)[[:space:]]+deploy|wrangler[[:space:]]+(deploy|publish|secret)|supabase[[:space:]]+(db[[:space:]]+push|functions[[:space:]]+deploy|secrets)|aws[[:space:]]|gcloud[[:space:]]|az[[:space:]])"
    outward="$outward|${B}(ssh|scp|sftp|mosh)[[:space:]]|${B}rsync[[:space:]][^;&|]*[[:space:]][A-Za-z0-9_.@-]+:"
    if printf '%s\n' "$cmd" | grep -qE "$outward"; then
      deny "outward command denied: $(short "$cmd")" "night mode: commands that act outside this machine or on shared systems (GitHub writes, deploys, publishes, cloud CLIs, ssh/scp/rsync to a host) are not allowed at night. Prepare it and park it in night/$sid8/QUESTIONS.md as \"ready to run: <command>\"."
    fi
    # rm -r of a path outside the repo (absolute, ~ or ..), checked token by token.
    if printf '%s\n' "$cmd" | grep -qE "${B}rm[[:space:]]+([^;&|]*[[:space:]])?-[A-Za-z]*[rR]"; then
      root=$(jq -r '.root // empty' "$dir/state.json" 2>/dev/null)
      set -f
      for tok in $(printf '%s' "$cmd" | sed -nE 's/.*(^|[;&|(`[:space:]])rm[[:space:]]+([^;&|]*).*/\2/p'); do
        tok=$(printf '%s' "$tok" | tr -d "\"'")
        case "$tok" in -*|'') continue ;; esac
        case "$tok" in
          *..*|'~'*|/*)
            case "$tok" in
              *..*) bad=yes ;;
              "$root"/?*) bad=no ;;
              *) bad=yes ;;
            esac
            if [ "$bad" = yes ]; then
              set +f
              deny "rm -r outside the repo denied: $(short "$cmd")" "night mode: recursive deletes are allowed only inside the repo ($root). Park it in night/$sid8/QUESTIONS.md if it is really needed."
            fi ;;
        esac
      done
      set +f
    fi
    exit 0 ;;

  Agent)
    model=$(printf '%s' "$input" | jq -r '.tool_input.model // empty | strings' 2>/dev/null)
    case $(printf '%s' "$model" | tr '[:upper:]' '[:lower:]') in
      *fable*) deny "Agent denied: Fable model ($model)" "no Fable subagents, ever (the user's rule). Use Opus, or do the work yourself." ;;
    esac
    max=$(nl_default maxAgents 20)
    if ! nl_update "$dir" 'if .spawned >= $max then error("cap") else .spawned += 1 end' --argjson max "$max"; then
      now_spawned=$(nl_get "$dir" .spawned)
      case "$now_spawned" in ''|*[!0-9]*) exit 0 ;; esac
      if [ "$now_spawned" -ge "$max" ]; then
        deny "Agent denied: subagent budget of $max used" "the subagent budget of this night ($max) is used. Do it yourself, or park the task."
      fi
    fi
    exit 0 ;;
esac
exit 0
