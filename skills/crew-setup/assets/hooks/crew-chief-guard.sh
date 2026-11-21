#!/bin/sh
# crew-chief read-only guard (PreToolUse hook, matcher: Bash|Write|Edit|NotebookEdit|MultiEdit).
#
# Blocks Bash commands that modify files, git state, or installed software when
# they come from one of crew-chief's read-only agents (scanner, deep-reader,
# reviewer, security-reviewer, verifier, critic, planner, ui-smoke, ui-designer, ui-scout). Reading, listing, and running tests stay allowed.
#
# File tools: the only write a read-only agent may make is a Write into the crew-chief
# reports folder, ${TMPDIR:-/tmp}/crew-chief-reports (a long report goes there, a short
# summary goes back to the caller). Any other path, any Edit, a relative path, a dot
# segment, or a symlink out of the folder is blocked.
# The one exception is ui-designer: its design spec is a Write of a .md file under .crew-chief/design/
# in the project (the hook input's cwd or its git root), with the same path checks; it may not write
# to the reports folder, and Edit stays blocked.
# The same goes for ui-scout, with .crew-chief/refs/ and the file types .md .png .jpg .jpeg .webp (its
# REFS.md and screenshots). Its one Bash write is a headless Chrome screenshot into that folder: a single
# simple command with allow-listed flags and an http(s) URL (see scout_chrome); everything else it
# runs is checked like any other read-only agent's commands.
#
# Usage:
#   readonly-guard.sh            plugin hook: acts only when agent_type is
#                                crew-chief:scanner, :deep-reader, :reviewer, :security-reviewer, :ui-smoke, :planner, :ui-designer, or :ui-scout
#   readonly-guard.sh --project  project settings hook (/crew-setup install):
#                                acts when agent_type is scanner, deep-reader, planner,
#                                reviewer, security-reviewer, ui-smoke, ui-designer, or ui-scout
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
      scanner|deep-reader|reviewer|security-reviewer|verifier|critic|ui-smoke|planner|ui-designer|ui-scout) ;;
      *) exit 0 ;;
    esac ;;
  *)
    case "$(field agent_type)" in
      crew-chief:scanner|crew-chief:deep-reader|crew-chief:reviewer|crew-chief:security-reviewer|crew-chief:verifier|crew-chief:critic|crew-chief:ui-smoke|crew-chief:planner|crew-chief:ui-designer|crew-chief:ui-scout) ;;
      *) exit 0 ;;
    esac ;;
esac

tool=$(field tool_name)
agent=$(field agent_type)
agent=${agent#crew-chief:}

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

# ui-designer's design spec: Write of <project>/.crew-chief/design/<name>.md and nothing else. The project is the
# hook input's cwd (CLAUDE_PROJECT_DIR when there is none) or its git root. The nearest existing folder of the
# target is resolved physically (so a symlinked .crew-chief or design folder that leads out is caught) and
# the rest of the path, which has no dot segments, must stay under .crew-chief/design.
# in_project_folder <absolute path> <folder under the project>: succeeds when the path stays under
# <project>/<folder>/. The project is the hook input's cwd (CLAUDE_PROJECT_DIR when there is none) or its git
# root. The nearest existing folder of the target is resolved physically (so a symlinked .crew-chief or
# subfolder that leads out is caught) and the rest of the path, which has no dot segments, must stay under
# the folder. On failure it sets scope_why.
in_project_folder() {
  scope_why=""
  _t=$1
  _sub=$2
  case "$_t" in /*) ;; *) scope_why="the path must be absolute"; return 1 ;; esac
  case "$_t" in */../*|*/..|*/./*|*/.) scope_why="no dot segments in the path"; return 1 ;; esac
  [ -L "$_t" ] && { scope_why="the target is a symlink"; return 1; }
  proj=$(field cwd)
  [ -n "$proj" ] || proj=${CLAUDE_PROJECT_DIR:-}
  [ -n "$proj" ] && [ -d "$proj" ] || { scope_why="the project folder is unknown"; return 1; }
  roots=$(cd "$proj" 2>/dev/null && pwd -P)
  top=$(git -C "$proj" rev-parse --show-toplevel 2>/dev/null) && roots="$roots
$(cd "$top" 2>/dev/null && pwd -P)"
  anc=$(dirname "$_t")
  rest=${_t#"$anc"}
  while [ ! -d "$anc" ]; do
    [ -L "$anc" ] && { scope_why="a path component is a dangling symlink"; return 1; }
    next=$(dirname "$anc")
    rest=${_t#"$next"}
    anc=$next
  done
  real=$(cd "$anc" 2>/dev/null && pwd -P) || { scope_why="the folder is unavailable"; return 1; }
  resolved="$real$rest"
  oldifs=$IFS
  IFS='
'
  for r in $roots; do
    case "$resolved" in "$r/$_sub"/?*) IFS=$oldifs; return 0 ;; esac
  done
  IFS=$oldifs
  scope_why="outside $_sub/"
  return 1
}

# A read-only agent with one folder it may write: ui-designer its design spec, ui-scout its reference notes
# and screenshots. $1 = folder under the project, $2 = allowed extensions (space separated), $3 = what it writes.
scoped_write() {
  deny() {
    echo "Blocked by crew-chief: this agent is read-only ($1). It may write only $3 (a $2 file) under $4/ in the project." >&2
    exit 2
  }
  _sub=$1
  _exts=$2
  _what=$3
  denyw() { deny "$1" "$_exts" "$_what" "$_sub"; }
  [ "$tool" = "Write" ] || denyw "only Write of $_what is allowed"
  target=$(field tool_input.file_path)
  target=$(printf '%s' "$target" | tr -s '/')
  lc=$(printf '%s' "$target" | tr 'A-Z' 'a-z')
  okext=no
  for e in $_exts; do
    case "$lc" in *."$e") okext=yes ;; esac
  done
  [ "$okext" = yes ] || denyw "the file type must be one of: $_exts"
  in_project_folder "$target" "$_sub" || denyw "$scope_why"
  exit 0
}

# ui-scout's one Bash write: a headless Chrome screenshot into <project>/.crew-chief/refs/. Only called for
# ui-scout with a command that starts with a Chrome or Chromium binary; everything else it runs goes through
# the normal read-only checks below. The command must be that one simple command: no pipes, redirects,
# command substitution, backslashes or several lines, only allow-listed flags, http(s) URLs, exactly one
# --screenshot=<path> into refs, and a throwaway --user-data-dir under the temp folder (without it Chrome
# would hand the page to the user's running browser).
scout_chrome() {
  cdeny() {
    echo "Blocked by crew-chief: ui-scout may run only one simple headless Chrome command ($1): --headless[=new] --user-data-dir=<temp folder>/<name> --screenshot=<project>/.crew-chief/refs/<name>.png, optional --window-size=W,H --hide-scrollbars --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader --use-gl=angle --virtual-time-budget=N --force-device-scale-factor=N, then an http(s) URL; no pipes, redirects or other flags." >&2
    exit 2
  }
  c=$1
  case "$c" in *"$nl"*|*';'*|*'&'*|*'|'*|*'<'*|*'>'*|*'`'*|*'$'*|*'\'*|*'('*|*')'*) cdeny "no shell operators, substitution or newlines" ;; esac
  n=$(printf '%s' "$c" | grep -o -e '--screenshot' | wc -l | tr -d ' ')
  [ "$n" = 1 ] || cdeny "exactly one --screenshot"
  shot=$(printf '%s' "$c" | sed -nE 's/.*--screenshot=("([^"]*)"|'"'"'([^'"'"']*)'"'"'|([^[:space:]"'"'"']*)).*/\2\3\4/p')
  [ -n "$shot" ] || cdeny "--screenshot=<path> is missing a path"
  c=$(printf '%s' "$c" | sed -E 's/--screenshot=("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]*)//')
  shot=$(printf '%s' "$shot" | tr -s '/')
  lc=$(printf '%s' "$shot" | tr 'A-Z' 'a-z')
  case "$lc" in *.png|*.jpg|*.jpeg|*.webp) ;; *) cdeny "the screenshot must be a .png, .jpg or .webp file" ;; esac
  in_project_folder "$shot" ".crew-chief/refs" || cdeny "screenshot: $scope_why"
  headless=no
  udd=no
  urls=0
  set -f
  for tok in $c; do
    case "$tok" in
      --headless|--headless=new|--headless=old) headless=yes ;;
      --user-data-dir=/*)
        d=$(printf '%s' "${tok#--user-data-dir=}" | tr -s '/')
        case "$d" in */../*|*/..|*/./*|*/.) cdeny "no dot segments in --user-data-dir" ;; esac
        tmp=$(printf '%s' "${TMPDIR:-/tmp}" | tr -s '/')
        tmp=${tmp%/}
        case "$d" in "$tmp"/?*|/tmp/?*|/private/tmp/?*|/var/folders/?*) udd=yes ;; *) cdeny "--user-data-dir must be under the temp folder" ;; esac ;;
      --hide-scrollbars|--disable-gpu|--no-sandbox|--no-first-run|--disable-extensions|--no-default-browser-check|--run-all-compositor-stages-before-draw|--use-angle=swiftshader|--enable-unsafe-swiftshader|--use-gl=angle) ;;
      --window-size=[0-9]*,[0-9]*|--virtual-time-budget=[0-9]*|--force-device-scale-factor=[0-9]*|--timeout=[0-9]*) ;;
      http://[A-Za-z0-9]*|https://[A-Za-z0-9]*|\"http://[A-Za-z0-9]*|\"https://[A-Za-z0-9]*|"'http://"[A-Za-z0-9]*|"'https://"[A-Za-z0-9]*) urls=$((urls + 1)) ;;
      *) cdeny "flag or argument not allowed: $tok" ;;
    esac
  done
  set +f
  [ "$headless" = yes ] || cdeny "--headless is required"
  [ "$udd" = yes ] || cdeny "--user-data-dir is required"
  [ "$urls" = 1 ] || cdeny "exactly one http(s) URL is required"
  exit 0
}

# ui-scout's other Bash write: this plugin's own scripts/ui-shot.mjs (real mobile emulation over the DevTools
# protocol; plain headless Chrome cannot lay a page out below ~500 px). Exactly
#   node <this plugin>/scripts/ui-shot.mjs <http(s) url> <project>/.crew-chief/refs <slug> [--webgl] [--wait=N]
# with the script path matching this plugin's own copy, no shell operators, and the out dir inside refs.
# in_reports_folder <dir>: the dir is the crew-chief reports folder or inside it (physically, no symlinks out).
in_reports_folder() {
  scope_why=""
  _rd=$(printf '%s' "${TMPDIR:-/tmp}" | tr -s '/')
  _rd="${_rd%/}/crew-chief-reports"
  case "$1" in /*) ;; *) scope_why="the path must be absolute"; return 1 ;; esac
  case "$1" in */../*|*/..|*/./*|*/.) scope_why="no dot segments in the path"; return 1 ;; esac
  mkdir -p "$_rd" 2>/dev/null && chmod 700 "$_rd" 2>/dev/null
  [ -d "$_rd" ] && [ ! -L "$_rd" ] && [ -O "$_rd" ] || { scope_why="the reports folder is not usable"; return 1; }
  _phys=$(cd "$_rd" 2>/dev/null && pwd -P) || { scope_why="the reports folder is unavailable"; return 1; }
  _anc=$1
  while [ ! -d "$_anc" ]; do
    [ -L "$_anc" ] && { scope_why="a path component is a dangling symlink"; return 1; }
    _anc=$(dirname "$_anc")
  done
  _real=$(cd "$_anc" 2>/dev/null && pwd -P) || { scope_why="the folder is unavailable"; return 1; }
  case "$_real" in "$_phys"|"$_phys"/*) return 0 ;; esac
  scope_why="it must be the reports folder $_rd or a folder in it"
  return 1
}

scout_shot() {
  sdeny() {
    echo "Blocked by crew-chief: the screenshot script runs only as: node $shot_script <url> <out dir> <slug> [--webgl] [--wait=N]; ui-scout: an http(s) url and <project>/.crew-chief/refs; critic: http(s) or file:// and the crew-chief reports folder ($1)." >&2
    exit 2
  }
  c=$1
  case "$c" in *"$nl"*|*';'*|*'&'*|*'|'*|*'<'*|*'>'*|*'`'*|*'$'*|*'\'*|*'('*|*')'*|*'"'*|*"'"*) sdeny "no shell operators, quotes, substitution or newlines after the script path" ;; esac
  set -f
  # shellcheck disable=SC2086
  set -- $c
  set +f
  [ $# -ge 3 ] && [ $# -le 5 ] || sdeny "url, out dir and slug are required"
  out=$(printf '%s' "$2" | tr -s '/')
  out=${out%/}
  if [ "$agent" = critic ]; then
    # critic: also local pages (file://), screenshots only into the reports folder.
    case "$1" in http://[A-Za-z0-9]*|https://[A-Za-z0-9]*|file:///*) ;; *) sdeny "the url must be http(s) or file://" ;; esac
    in_reports_folder "$out" || sdeny "out dir: $scope_why"
  else
    case "$1" in http://[A-Za-z0-9]*|https://[A-Za-z0-9]*) ;; *) sdeny "the url must be http(s)" ;; esac
    in_project_folder "$out/x.png" ".crew-chief/refs" || sdeny "out dir: $scope_why"
  fi
  case "$3" in .*|*/*) sdeny "bad slug" ;; esac
  printf '%s' "$3" | grep -qE '^[A-Za-z0-9._-]+$' || sdeny "bad slug"
  shift 3
  for tok in "$@"; do
    case "$tok" in --webgl|--wait=[0-9]|--wait=[0-9]*[0-9]) ;; *) sdeny "argument not allowed: $tok" ;; esac
    case "$tok" in --wait=*[!0-9]*) sdeny "argument not allowed: $tok" ;; esac
  done
  exit 0
}

case "$tool" in
  Write|Edit|NotebookEdit|MultiEdit)
    [ "$agent" = "ui-designer" ] && scoped_write ".crew-chief/design" "md" "its design spec"
    [ "$agent" = "ui-scout" ] && scoped_write ".crew-chief/refs" "md png jpg jpeg webp" "its reference notes and screenshots"
    file_write ;;
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

# ui-scout may run one narrow headless Chrome command (see scout_chrome); anything else goes through the checks below.
if [ "$agent" = "ui-scout" ]; then
  scout_bin=
  case "$cmd" in
    '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" '*) scout_bin='"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ' ;;
    "'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' "*) scout_bin="'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' " ;;
    '"/Applications/Chromium.app/Contents/MacOS/Chromium" '*) scout_bin='"/Applications/Chromium.app/Contents/MacOS/Chromium" ' ;;
    "'/Applications/Chromium.app/Contents/MacOS/Chromium' "*) scout_bin="'/Applications/Chromium.app/Contents/MacOS/Chromium' " ;;
    google-chrome\ *|google-chrome-stable\ *|chromium\ *|chromium-browser\ *|chrome\ *|/usr/bin/google-chrome\ *|/usr/bin/google-chrome-stable\ *|/usr/bin/chromium\ *|/usr/bin/chromium-browser\ *|/snap/bin/chromium\ *|/opt/google/chrome/chrome\ *) scout_bin="${cmd%% *} " ;;
  esac
  [ -n "$scout_bin" ] && scout_chrome "${cmd#"$scout_bin"}"
  shot_script="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)/ui-shot.mjs"
  # macOS paths are case-insensitive and the same folder can reach us spelled two ways: compare in lower case.
  lcmd=$(printf '%s' "$cmd" | tr 'A-Z' 'a-z')
  for pre in "node $shot_script " "node \"$shot_script\" " "node '$shot_script' "; do
    lpre=$(printf '%s' "$pre" | tr 'A-Z' 'a-z')
    case "$lcmd" in "$lpre"*) scout_shot "$(printf '%s' "$cmd" | sed "s/^.\{${#pre}\}//")" ;; esac
  done
  printf '%s' "$cmd" | grep -qE '(^|[[:space:]])--(screenshot|print-to-pdf|headless|user-data-dir|remote-debugging|dump-dom)' && block "browser flags only in the one plain headless Chrome command"
fi

# critic may run the same screenshot script, into the reports folder only (see scout_shot).
if [ "$agent" = "critic" ]; then
  shot_script="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)/ui-shot.mjs"
  lcmd=$(printf '%s' "$cmd" | tr 'A-Z' 'a-z')
  for pre in "node $shot_script " "node \"$shot_script\" " "node '$shot_script' "; do
    lpre=$(printf '%s' "$pre" | tr 'A-Z' 'a-z')
    case "$lcmd" in "$lpre"*) scout_shot "$(printf '%s' "$cmd" | sed "s/^.\{${#pre}\}//")" ;; esac
  done
fi
# The screenshot script writes files: only ui-scout, only its exact form above.
printf '%s' "$cmd" | grep -q 'ui-shot\.mjs' && block "the screenshot script is only for ui-scout, in its one exact form"

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
