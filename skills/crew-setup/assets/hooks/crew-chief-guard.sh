#!/bin/sh
# crew-chief read-only guard (PreToolUse hook, matcher: Bash).
#
# Blocks Bash commands that modify files, git state, or installed software when
# they come from one of crew-chief's read-only agents (scanner, deep-reader,
# reviewer, ui-smoke). Reading, listing, and running tests stay allowed.
#
# Usage:
#   readonly-guard.sh            plugin hook: acts only when agent_type is
#                                crew-chief:scanner, :deep-reader, :reviewer, or :ui-smoke
#   readonly-guard.sh --project  project settings hook (/crew-setup install):
#                                acts when agent_type is scanner, deep-reader,
#                                reviewer, or ui-smoke
#   readonly-guard.sh --always   acts on every call it receives (for a hook in
#                                an agent's own frontmatter)
#
# Exit 0 = allow, exit 2 = block (Claude Code shows stderr to the agent).
# Reads the hook input with jq when available, otherwise with sed. Everything
# runs from this one file.

input=$(cat)

# Print a top-level string field of the hook input ("agent_type") or the
# command of a Bash call ("tool_input.command").
field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r ".$1 // empty" 2>/dev/null
    return
  fi
  name=${1##*.}
  printf '%s' "$input" | tr '\n' ' ' |
    sed -nE 's/.*"'"$name"'"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' |
    sed -e 's/\\"/"/g' -e 's/\\\\/\\/g'
}

case "$1" in
  --always) ;;
  --project)
    case "$(field agent_type)" in
      scanner|deep-reader|reviewer|ui-smoke) ;;
      *) exit 0 ;;
    esac ;;
  *)
    case "$(field agent_type)" in
      crew-chief:scanner|crew-chief:deep-reader|crew-chief:reviewer|crew-chief:ui-smoke) ;;
      *) exit 0 ;;
    esac ;;
esac

cmd=$(field tool_input.command)
[ -z "$cmd" ] && exit 0
cmd=${cmd#rtk }

block() {
  echo "Blocked by crew-chief: this agent is read-only ($1). Report what you needed to the caller instead of working around it." >&2
  exit 2
}

# Drop harmless redirections (to /dev/null, fd duplication) before looking for writes.
stripped=$(printf '%s' "$cmd" | sed -E 's#[0-9&]?>>?[[:space:]]*/dev/null##g; s#[0-9]?>&[0-9]##g')

writers='rm|rmdir|mv|cp|chmod|chown|ln|truncate|dd|tee|touch|mkdir|kill|pkill|killall'
installers='brew|apt|apt-get|yum|pip|pip3|npm|pnpm|yarn|bun|cargo|gem'
printf '%s' "$cmd" | grep -qE "(^|[;&|(\`[:space:]])($writers|$installers)([[:space:]]|\$)" && block "file or package change"
printf '%s' "$cmd" | grep -qE 'go[[:space:]]+(get|install|mod)|curl[^|]*[[:space:]]-[a-zA-Z]*[oO]' && block "download or install"
printf '%s' "$cmd" | grep -qE 'git[[:space:]]+([^|;&]*[[:space:]])?(commit|push|checkout|switch|branch|reset|rebase|merge|stash|add|rm|mv|tag|clean|restore|apply|cherry-pick|pull|fetch|init|clone)([[:space:]]|$)' && block "git write"
printf '%s' "$cmd" | grep -qE 'sed[[:space:]]+(-[a-zA-Z]*i|--in-place)|perl[[:space:]]+-[a-zA-Z]*i' && block "in-place edit"
printf '%s' "$stripped" | grep -q '>' && block "output redirection"
exit 0
