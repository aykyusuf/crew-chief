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
#   - a category with an "offer" (a plugin skill that is always there, e.g. crew-chief:crew-brief) skips the
#     installed check and gives a closing-line offer instead of a load-this-skill hint; it is made once per
#     PROJECT (line in ${CLAUDE_PLUGIN_DATA}/skill-offers.tsv: project root, category id, time) and not at
#     all when the project already has BRIEF.md or docs/briefs/
#   - a prompt that names a UI file (index.html, *.tsx, *.vue, *.css, ...; scripts/ui-lib.sh ui_names_file) counts as ui-build
#   - a category with "uiPolicy": true (ui-build, ui-redesign) gives the UI rules of data/ui-policy.json (route to
#     crew-chief:ui-implementer, profile, reference step, brief contents) instead of the one-line skill hint
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

# Offer categories that may still be made for this project (no brief yet, not offered before).
proj=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || proj="$cwd"
offers_ok='[]'
if [ -n "${CLAUDE_PLUGIN_DATA:-}" ] && [ "$proj" != "${HOME:-/nonexistent}" ] && [ ! -e "$proj/BRIEF.md" ] && [ ! -d "$proj/docs/briefs" ]; then
  offers_ok=$(printf '%s' "$cats" | jq -r '.[] | select(.offer != null) | .id' 2>/dev/null | while IFS= read -r oid; do
    [ -n "$oid" ] || continue
    if [ -f "$CLAUDE_PLUGIN_DATA/skill-offers.tsv" ] && r="$proj" c="$oid" awk -F '\t' '$1 == ENVIRON["r"] && $2 == ENVIRON["c"] { f = 1 } END { exit !f }' "$CLAUDE_PLUGIN_DATA/skill-offers.tsv" 2>/dev/null; then continue; fi
    printf '%s\n' "$oid"
  done | jq -R -s -c 'split("\n") | map(select(. != ""))' 2>/dev/null)
  [ -n "$offers_ok" ] || offers_ok='[]'
fi

installed=$(installed_skills "$cwd" | sort -u | jq -R -s -c 'split("\n") | map(select(. != ""))' 2>/dev/null)
[ -n "$installed" ] || exit 0

# A prompt that names a UI file (index.html, App.tsx, ...) counts as UI work too (ui-build), even with no UI word in it.
. "$here/ui-lib.sh"
fileui=false
ui_names_file "$prompt" && fileui=true

out=$(printf '%s' "$prompt" | jq -R -s -c --argjson fileui "$fileui" --argjson cats "$cats" --argjson have "$installed" --argjson done "$done_ids" --argjson offers "$offers_ok" '
  def esc: gsub("(?<c>[.*+?^$(){}|\\[\\]\\\\])"; "\\" + .c);
  def lower: gsub("Ç"; "ç") | gsub("Ğ"; "ğ") | gsub("İ"; "i") | gsub("Ö"; "ö") | gsub("Ş"; "ş") | gsub("Ü"; "ü") | ascii_downcase;
  def hit($p): any(.keywords[]?; . as $k | ($k | lower) as $w
    | select(($w | rtrimstr("*")) != "")
    | ($p | test("(?<![[:alnum:]])" + ($w | rtrimstr("*") | esc) + (if ($w | endswith("*")) then "" else "(?![[:alnum:]])" end))));
  (lower) as $p
  | [ $cats | unique_by(.id)[]
      | select((.disabled // false) | not)
      | select(.id as $i | ($done | index($i)) | not)
      | select(.offer == null or (.id as $i | $offers | index($i)))
      | select(hit($p) or ($fileui and .id == "ui-build"))
      | . as $c
      | (if $c.offer != null then $c.offer.skill elif $c.uiPolicy == true then "crew-chief:frontend-design" else ([ $c.prefer[]? | select(. as $s | $have | index($s)) ] | first) end) as $skill
      | select($skill != null)
      | {id: $c.id, label: ($c.label // $c.id), skill: $skill, offer: ($c.offer != null), ui: ($c.uiPolicy == true)} ][0:2]
  | if length == 0 then empty else . end' 2>/dev/null)
[ -n "$out" ] || exit 0

if [ -n "$marker" ]; then
  mkdir -p "${marker%/*}" 2>/dev/null
  printf '%s' "$out" | jq -r '.[].id' >> "$marker" 2>/dev/null
  find "${marker%/*}" -type f -mtime +14 -delete 2>/dev/null
fi

# Remember the offers per project, so they are not made again in another session.
if [ -n "${CLAUDE_PLUGIN_DATA:-}" ]; then
  printf '%s' "$out" | jq -r '.[] | select(.offer) | .id' 2>/dev/null | while IFS= read -r oid; do
    [ -n "$oid" ] || continue
    mkdir -p "$CLAUDE_PLUGIN_DATA" 2>/dev/null
    printf '%s\t%s\t%s\n' "$proj" "$oid" "$(date +%s 2>/dev/null)" >> "$CLAUDE_PLUGIN_DATA/skill-offers.tsv" 2>/dev/null
  done
fi

# A UI category (uiPolicy) gets the UI rules from data/ui-policy.json instead of the one-line skill hint;
# when the policy cannot be read it falls back to that line.
uitext=""
if printf '%s' "$out" | jq -e 'any(.[]; .ui)' >/dev/null 2>&1; then
  pol=$(ui_policy "$root")
  [ -n "$pol" ] && uitext=$(ui_main_text "$cwd" "$pol")
fi

printf '%s' "$out" | jq -c --arg uitext "$uitext" '
  def isui: .ui and $uitext != "";
  def line: if .offer
    then "This starts " + .label + ". Do the work asked first. At the very end of your final answer add exactly ONE short line, in the user\u0027s language, saying /" + .skill + " can write a manager brief first (goal, success criteria, what agents may decide alone). Do not ask about it before starting, do not use a dialog, and do not run the skill unless the user says yes. Skip the line for a small change or an unattended job."
    else "This looks like " + .label + " work: load the " + .skill + " skill (Skill tool) before you start, unless it clearly does not apply." end;
  ([ .[] | select(isui | not) | line ] + (if any(.[]; isui) then [$uitext] else [] end)) as $lines
  | {hookSpecificOutput: {hookEventName: "UserPromptSubmit",
    additionalContext: ("<crew-chief-skill-hint>\n"
      + ($lines | join("\n"))
      + (if any(.[]; (.offer | not) and (isui | not)) then "\nWhen you hand part of it to a subagent, name the skill in the brief." else "" end)
      + "\n</crew-chief-skill-hint>")}}' 2>/dev/null
exit 0
