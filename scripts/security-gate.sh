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

# How much changed in the risky files: lines added + removed against HEAD (staged and unstaged), a file not in HEAD
# counts as new with all its lines. Small, plain edits (most commits) are not stopped: a review there rarely finds
# anything (Anthropic's code review numbers: under 50 changed lines about a third of reviews find something, 0.5
# issues on average), and the cost is real.
lines=0
newfiles=0
for f in $(printf '%s\n' "$hits" | cut -f2 | sort -u); do
  if git -C "$top" cat-file -e "HEAD:$f" 2>/dev/null; then
    c=$(git -C "$top" diff HEAD --numstat -- "$f" 2>/dev/null | awk '{ a += ($1 ~ /^[0-9]+$/ ? $1 : 0) + ($2 ~ /^[0-9]+$/ ? $2 : 0) } END { print a + 0 }')
  else
    newfiles=$((newfiles + 1))
    c=$(wc -l < "$top/$f" 2>/dev/null | tr -d ' ')
  fi
  case "$c" in ''|*[!0-9]*) c=0 ;; esac
  lines=$((lines + c))
done
cats=$(printf '%s\n' "$hits" | cut -f1 | sort -u | tr '\n' ' ')
heavy=no
case " $cats " in *" migrations "*|*" secrets "*) heavy=yes ;; esac
# One line per file: its categories and reasons together.
list=$(printf '%s\n' "$hits" | awk -F '\t' '{ if (!($2 in c)) { order[++n] = $2; c[$2] = $1; r[$2] = $3 } else { if (index("," c[$2] ",", "," $1 ",") == 0) c[$2] = c[$2] "," $1; if (index(r[$2], $3) == 0) r[$2] = r[$2] "; " $3 } } END { for (i = 1; i <= n; i++) print "- " order[i] " (" c[order[i]] ": " r[order[i]] ")" }' | head -12)
n=$(printf '%s\n' "$hits" | cut -f2 | sort -u | wc -l | tr -d ' ')

# Small is not the same as harmless: a removed permission check or user input added to a query is two lines. So the
# changed lines themselves (added and removed) are matched against the content rules; any hit means a real look.
risky_lines=$(for f in $(printf '%s\n' "$hits" | cut -f2 | sort -u); do git -C "$top" diff HEAD -U0 -- "$f" 2>/dev/null; done | grep -E '^[-+]' | grep -vE '^(\+\+\+|---) ' | sed 's/^[-+]//' | sh "$here/security-map.sh" content 2>/dev/null | cut -f1 | sort -u | tr '\n' ' ')
# Every commit that touches these files is held once (user, 2026-11-21: the hold is cheap, the review is Claude's
# call). Size and the risky patterns in the changed lines only shape the hint in the message.
if [ "$lines" -lt 10 ] && [ "$newfiles" -eq 0 ] && [ "$heavy" = no ] && [ -z "$risky_lines" ]; then
  hint="It looks small and plain (no risky pattern in the changed lines): most likely no review is needed; say so in one line and retry."
else
  hint=""
fi

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

newnote=""
[ "$newfiles" -gt 0 ] && newnote=", $newfiles of them new"
[ -n "$risky_lines" ] && newnote="$newnote; the changed lines themselves touch: ${risky_lines% }"
cat >&2 <<EOF
crew-chief security check (held once; retry the identical command to commit): this commit changes about $lines line(s) in $n security-relevant file(s)$newnote [${cats% }]:
$list
Decide first whether a security review is worth it. Most commits do not need one.${hint:+ $hint}
- No review (say so in one line, then retry the commit): the change in these files is mechanical or local (renames, formatting, comments, log or UI text, tests, a refactor that keeps behaviour), or this exact change was already reviewed in this conversation, or the user said to skip it.
- Review when the change alters behaviour at a trust boundary: who may access or change what (auth, permissions, sessions, tokens), how money, prices, balances or rates are calculated or moved, how outside input reaches SQL, a shell, a file path or HTML, secrets or crypto, or a migration that changes or drops data.
If you review, use crew-chief:security-reviewer at the smallest setting that fits (pass model and effort on the Agent call):
- model sonnet, effort medium: one focused question on a small change (is this new query parameterised, is this check still applied).
- model opus, effort medium: a real logic change in one area. The usual choice.
- model opus, effort high: several risky files at once, a new endpoint or permission, money calculations, or a migration that moves or deletes data.
- effort xhigh: only for a large change that spans auth, money and data together right before it ships, or when the user asks. xhigh costs about 2.5 times high for a small gain; never use it by default.
Name the categories above in the brief, fix what it finds and tell the user, then retry the identical commit command. Do not ask the user because of this message.
EOF
exit 2
