#!/bin/sh
# crew-chief UserPromptSubmit hook: when the prompt is about a kind of work that has a known good
# skill, and that skill is installed, remind Claude to load it first.
#
# Why: Claude picks skills from one-line descriptions that get cut when many are installed, so a
# matching skill is sometimes never loaded. This adds a one-line hint to the prompt (hook output
# "additionalContext"); it is advice, not enforcement.
#
# Rules:
#   - a category in data/skill-catalog.json matches when one of its keywords is a whole word in the prompt
#     (a keyword ending in * matches as a word prefix, so arayüz* also matches arayüzü); the first
#     installed skill from its "prefer" list is hinted
#   - at most two hints per prompt, and each category once per session (marker in ${CLAUDE_PLUGIN_DATA})
#   - nothing for slash commands, an empty prompt, or when no preferred skill is installed
#   - your own categories go in ~/.claude/crew-chief-skills.json ({"categories": [...]}, same shape as
#     the catalog; the same id replaces the shipped one, "disabled": true removes it)
#   - CREW_CHIEF_SKILL_HINTS=off turns it off
# Needs jq; without it this does nothing. Never blocks, prints only the hook JSON.

input=$(cat)
[ "${CREW_CHIEF_SKILL_HINTS:-on}" = "off" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

here=$(dirname "$0")
root="${CLAUDE_PLUGIN_ROOT:-$here/..}"
catalog="$root/data/skill-catalog.json"
[ -f "$catalog" ] || exit 0
. "$here/skill-lib.sh"

prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null)
case "$prompt" in ''|/*) exit 0 ;; esac
session=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$cwd" ] || cwd=$(pwd)

user="${HOME:-/nonexistent}/.claude/crew-chief-skills.json"
if [ -f "$user" ] && jq -e '.categories | type == "array"' "$user" >/dev/null 2>&1; then
  cats=$(jq -c -s '(.[0].categories + .[1].categories)' "$user" "$catalog" 2>/dev/null)
else
  cats=$(jq -c '.categories' "$catalog" 2>/dev/null)
fi
[ -n "$cats" ] || exit 0

marker=""
done_ids='[]'
if [ -n "$session" ] && [ -n "${CLAUDE_PLUGIN_DATA:-}" ]; then
  case "$session" in *[!A-Za-z0-9_-]*) session="" ;; esac
  if [ -n "$session" ]; then
    marker="$CLAUDE_PLUGIN_DATA/skill-hints/$session"
    [ -f "$marker" ] && done_ids=$(jq -R -s -c 'split("\n") | map(select(. != ""))' "$marker" 2>/dev/null)
    [ -n "$done_ids" ] || done_ids='[]'
  fi
fi

installed=$(installed_skills "$cwd" | sort -u | jq -R -s -c 'split("\n") | map(select(. != ""))' 2>/dev/null)
[ -n "$installed" ] || exit 0

out=$(printf '%s' "$prompt" | jq -R -s -c --argjson cats "$cats" --argjson have "$installed" --argjson done "$done_ids" '
  def esc: gsub("(?<c>[.*+?^$(){}|\\[\\]\\\\])"; "\\" + .c);
  def lower: gsub("Ç"; "ç") | gsub("Ğ"; "ğ") | gsub("İ"; "i") | gsub("Ö"; "ö") | gsub("Ş"; "ş") | gsub("Ü"; "ü") | ascii_downcase;
  def hit($p): any(.keywords[]?; . as $k | ($k | lower) as $w
    | select(($w | rtrimstr("*")) != "")
    | ($p | test("(?<![[:alnum:]])" + ($w | rtrimstr("*") | esc) + (if ($w | endswith("*")) then "" else "(?![[:alnum:]])" end))));
  (lower) as $p
  | [ $cats | unique_by(.id)[]
      | select((.disabled // false) | not)
      | select(.id as $i | ($done | index($i)) | not)
      | select(hit($p))
      | . as $c
      | ([ $c.prefer[]? | select(. as $s | $have | index($s)) ] | first) as $skill
      | select($skill != null)
      | {id: $c.id, label: ($c.label // $c.id), skill: $skill} ][0:2]
  | if length == 0 then empty else . end' 2>/dev/null)
[ -n "$out" ] || exit 0

if [ -n "$marker" ]; then
  mkdir -p "${marker%/*}" 2>/dev/null
  printf '%s' "$out" | jq -r '.[].id' >> "$marker" 2>/dev/null
  find "${marker%/*}" -type f -mtime +14 -delete 2>/dev/null
fi

printf '%s' "$out" | jq -c '
  {hookSpecificOutput: {hookEventName: "UserPromptSubmit",
    additionalContext: ("<crew-chief-skill-hint>\n"
      + (map("This looks like " + .label + " work: load the " + .skill + " skill (Skill tool) before you start, unless it clearly does not apply.") | join("\n"))
      + "\nWhen you hand part of it to a subagent, name the skill in the brief.\n</crew-chief-skill-hint>")}}' 2>/dev/null
exit 0
