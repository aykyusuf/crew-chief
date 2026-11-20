#!/bin/sh
# crew-chief security commit gate (PreToolUse hook, matcher: Bash).
#
# When Claude runs `git commit` and the files going into the commit are security-relevant (the risk map in
# scripts/security-map.sh: auth, crypto, secrets, payments, migrations, input reaching a sink, CI, dependencies),
# the first attempt is held back with the list of files and the review to run (crew-chief:security-reviewer at
# the right model and effort). The identical command retried within 4 hours passes, like the command guard,
# so a reviewed or deliberately skipped commit is never blocked twice. Only Claude's own commits pass here;
# commits typed in a terminal do not (that would need a git pre-commit hook, which crew-chief does not install).
# CREW_CHIEF_SECURITY_GATE=off turns it off. Needs jq and CLAUDE_PLUGIN_DATA; without them it does nothing.

input=$(cat)
[ "${CREW_CHIEF_SECURITY_GATE:-on}" = "off" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty | strings' 2>/dev/null)
[ -n "$cmd" ] || exit 0
# `git commit` anywhere in the command (git -C <dir> commit, after && or ;), but not --dry-run.
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)' || exit 0
printf '%s' "$cmd" | grep -qE -- '--dry-run' && exit 0

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$cwd" ] || cwd=$(pwd)
dir=$(printf '%s' "$cmd" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+("([^"]*)"|([^[:space:]]+)).*/\2\3/p')
if [ -n "$dir" ]; then
  case "$dir" in /*) ;; *) dir="$cwd/$dir" ;; esac
else
  dir=$cwd
fi
top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0

# What the commit will contain: the staged files, plus tracked changes when it commits with -a / --all.
files=$(git -C "$top" diff --cached --name-only 2>/dev/null)
if printf '%s' "$cmd" | grep -qE '[[:space:]](-a|--all|-[a-zA-Z]*a[a-zA-Z]*)([[:space:]]|$)'; then
  files=$(printf '%s\n%s' "$files" "$(git -C "$top" diff --name-only 2>/dev/null)" | sort -u)
fi
# A `git add ... && git commit` in one command: the add has not run yet, so its paths are not staged. Count them too.
added=$(printf '%s' "$cmd" | sed -nE 's/.*git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+add[[:space:]]+([^;&|]*).*/\2/p' | tr ' ' '\n' | grep -vE '^$' | grep -vE '^-' | grep -vE "^['\"]?:" )
printf '%s' "$cmd" | grep -qE 'git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+add[[:space:]]+([^;&|]*[[:space:]])?(-A|--all|\.)([[:space:]]|$|;|&)' && added=$(printf '.\n%s' "$added")
if [ -n "$added" ]; then
  more=$(printf '%s\n' "$added" | while IFS= read -r p; do
    p=$(printf '%s' "$p" | tr -d "\"'")
    if [ "$p" = . ] || [ "$p" = -A ] || [ "$p" = --all ]; then p=.; fi
    git -C "$top" status --porcelain --untracked-files=all -- "$p" 2>/dev/null | sed -E 's/^.. //; s/.* -> //'
  done)
  files=$(printf '%s\n%s' "$files" "$more" | sort -u)
fi
files=$(printf '%s\n' "$files" | grep -v '^$' | head -200)
[ -n "$files" ] || exit 0

here=$(dirname "$0")
# shellcheck disable=SC2086
hits=$(printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 sh "$here/security-map.sh" match "$top" 2>/dev/null)
[ -n "$hits" ] || exit 0

state="$CLAUDE_PLUGIN_DATA/security-gate"
# Keyed on the command only: after a review and its fixes the staged diff changes, and the identical retry must still pass.
key=$(printf '%s\n%s' "$top" "$cmd" | cksum 2>/dev/null | tr ' ' '-')
[ -n "$key" ] || exit 0
if [ -f "$state/$key" ] && [ -n "$(find "$state/$key" -mmin -240 2>/dev/null)" ]; then
  exit 0
fi
mkdir -p "$state" 2>/dev/null || exit 0
: > "$state/$key" 2>/dev/null || exit 0
find "$state" -type f -mmin +240 -delete 2>/dev/null

cats=$(printf '%s\n' "$hits" | cut -f1 | sort -u | tr '\n' ' ')
top_hit=no
for c in $cats; do
  case " $(sh "$here/security-map.sh" top) " in *" $c "*) top_hit=yes ;; esac
done
if [ "$top_hit" = yes ]; then
  how="crew-chief:security-reviewer at effort xhigh (Opus)"
else
  how="crew-chief:security-reviewer with model sonnet, effort high (CI and dependency changes only)"
fi
# One line per file: its categories and reasons together.
list=$(printf '%s\n' "$hits" | awk -F '\t' '{ if (!($2 in c)) { order[++n] = $2; c[$2] = $1; r[$2] = $3 } else { if (index("," c[$2] ",", "," $1 ",") == 0) c[$2] = c[$2] "," $1; if (index(r[$2], $3) == 0) r[$2] = r[$2] "; " $3 } } END { for (i = 1; i <= n; i++) print "- " order[i] " (" c[order[i]] ": " r[order[i]] ")" }' | head -12)
n=$(printf '%s\n' "$hits" | cut -f2 | sort -u | wc -l | tr -d ' ')

cat >&2 <<EOF
crew-chief security gate: this commit touches $n security-relevant file(s) [${cats% }]:
$list
Before committing, run $how on the staged diff, name these categories in its brief, and fix what it reports (tell the user what it found). Then retry the identical commit command. If this exact change was already security-reviewed in this conversation, or the user said to skip the review, retry the identical command now: it passes. Do not ask the user just because of this message.
EOF
exit 2
