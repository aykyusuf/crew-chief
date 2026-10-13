#!/bin/sh
# crew-chief read-only guard (PreToolUse hook, matcher: Bash|Write|Edit|NotebookEdit|MultiEdit).
#
# Blocks Bash commands that modify files, git state, or installed software when
# they come from one of crew-chief's read-only agents (scanner, deep-reader,
# reviewer, ui-smoke). Reading, listing, and running tests stay allowed.
#
# File tools: the only write a read-only agent may make is a Write into the crew-chief
# reports folder, ${TMPDIR:-/tmp}/crew-chief-reports (a long report goes there, a short
# summary goes back to the caller). Any other path, any Edit, a relative path, a dot
# segment, or a symlink out of the folder is blocked.
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
# Reads the hook input with jq when available, otherwise with sed (which turns JSON \n escapes back
# into line breaks, so a second line of a command is still checked). Everything
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
  # JSON escapes are decoded in one pass: an escaped backslash is parked in a placeholder first, so a
  # literal backslash followed by n in the command is not mistaken for a line break.
  park=$(printf '\001')
  printf '%s' "$input" | tr '\n' ' ' |
    sed -nE 's/.*"'"$name"'"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' |
    sed -e "s/\\\\\\\\/$park/g" -e 's/\\n/\
/g' -e 's/\\t/	/g' -e 's/\\"/"/g' -e "s/$park/\\\\/g"
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

tool=$(field tool_name)

# A Write to the reports folder is the one file write a read-only agent may do.
file_write() {
  rd=$(printf '%s' "${TMPDIR:-/tmp}" | tr -s '/')
  rd="${rd%/}/crew-chief-reports"
  deny() {
    echo "Blocked by crew-chief: this agent is read-only ($1). It may write reports only under $rd." >&2
    exit 2
  }
  [ "$tool" = "Write" ] || deny "only Write into the reports folder is allowed"
  target=$(field tool_input.file_path)
  target=$(printf '%s' "$target" | tr -s '/')   # TMPDIR often ends in a slash, so paths may hold //
  case "$target" in /*) ;; *) deny "the path must be absolute" ;; esac
  case "$target" in */../*|*/..|*/./*|*/.) deny "no dot segments in the path" ;; esac
  [ -L "$rd" ] && deny "the reports folder is a symlink"
  mkdir -p "$rd" 2>/dev/null && chmod 700 "$rd" 2>/dev/null
  [ -d "$rd" ] && [ -O "$rd" ] || deny "the reports folder is not owned by you"
  phys=$(cd "$rd" 2>/dev/null && pwd -P) || deny "the reports folder is unavailable"
  case "$target" in "$rd"/*|"$phys"/*) ;; *) deny "outside the reports folder" ;; esac
  [ -L "$target" ] && deny "the target is a symlink"
  anc=$(dirname "$target")
  while [ ! -d "$anc" ]; do
    [ -L "$anc" ] && deny "a path component is a dangling symlink"
    anc=$(dirname "$anc")
  done
  real=$(cd "$anc" 2>/dev/null && pwd -P) || deny "the folder is unavailable"
  case "$real" in "$phys"|"$phys"/*) ;; *) deny "the path resolves outside the reports folder" ;; esac
  exit 0
}

case "$tool" in
  Write|Edit|NotebookEdit|MultiEdit) file_write ;;
esac

cmd=$(field tool_input.command)
[ -z "$cmd" ] && exit 0
cmd=${cmd#rtk }

# The progress report (a no-op the progress hook reads) is allowed whatever words its text holds.
# It must be the whole command: grep works line by line, so a second line would slip through.
nl='
'
case "$cmd" in
  *"$nl"*) ;;
  *) printf '%s' "$cmd" | grep -qE "^:[[:space:]]+'crew-progress [^']*'[[:space:]]*\$" && exit 0 ;;
esac

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
