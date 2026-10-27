#!/bin/sh
# crew-chief SessionStart hook (startup only): when the project is of a kind that has well-regarded
# skills (data/skill-catalog.json) and none of the preferred ones is installed, tell Claude to offer
# them ONCE. The offer is opt-in: nothing is installed unless the user says yes, and the install
# command comes from the catalog, with the source shown first.
#
# How it decides:
#   - the project root is the git root (never HOME or a temp directory)
#   - a category applies when one of its "detect" entries is present (a file or glob, optionally
#     containing a pattern), and none of its "prefer" skills is installed
#   - per project and category the answer is remembered in ${CLAUDE_PLUGIN_DATA}/skill-offers.tsv
#     (`never` and `installed` are final, `later` pauses for a week)
#   - at most two categories are offered per session start
# CREW_CHIEF_SKILL_OFFER=off turns it off. Needs jq; without it this does nothing.
# Prints one context block, only when there is something to offer.

input=$(cat)
[ "${CREW_CHIEF_SKILL_OFFER:-on}" = "off" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
case "$CLAUDE_PLUGIN_DATA" in *\'*) exit 0 ;; esac

here=$(dirname "$0")
root_plugin="${CLAUDE_PLUGIN_ROOT:-$here/..}"
catalog="$root_plugin/data/skill-catalog.json"
[ -f "$catalog" ] || exit 0
. "$here/skill-lib.sh"

[ "$(printf '%s' "$input" | jq -r '.source // empty' 2>/dev/null)" = "startup" ] || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$cwd" ] && [ -d "$cwd" ] || exit 0
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$root" ] || exit 0
case "$root" in
  *\'*) exit 0 ;;  # a quote in the path would break the printed commands
  "$HOME"|/|/tmp|/tmp/*|/private/tmp|/private/tmp/*|/private/var/folders/*|/var/folders/*) exit 0 ;;
esac

state="$CLAUDE_PLUGIN_DATA/skill-offers.tsv"
now=$(date +%s 2>/dev/null)
installed=$(installed_skills "$root" | sort -u | jq -R -s -c 'split("\n") | map(select(. != ""))' 2>/dev/null)
[ -n "$installed" ] || installed='[]'

# Categories with nothing preferred installed, as "id<TAB>file<TAB>pattern" detect lines.
candidates=$(jq -r --argjson have "$installed" '
  .categories[]
  | select(((.recommend // []) | length) > 0)
  | select([.prefer[]? | select(. as $s | $have | index($s))] | length == 0)
  | .id as $id | .detect[]? | [$id, .file, (.grep // "")] | join("\t")' "$catalog" 2>/dev/null)
[ -n "$candidates" ] || exit 0

paused() {  # paused <category id>: 0 when the user said never/installed, or later within a week
  [ -f "$state" ] || return 1
  line=$(r="$root" c="$1" awk -F '\t' '$1 == ENVIRON["r"] && $2 == ENVIRON["c"] { last = $0 } END { print last }' "$state" 2>/dev/null | tr -d '\r')
  case "$line" in
    *"	never"*|*"	installed"*) return 0 ;;
    *"	later	"*)
      when=${line##*	}
      case "$when$now" in ''|*[!0-9]*) return 1 ;; esac
      [ $((now - when)) -lt 604800 ] && return 0 ;;
  esac
  return 1
}

tab=$(printf '\t')
ids=$(printf '%s\n' "$candidates" | while IFS="$tab" read -r id file pattern; do
  [ -n "$id" ] && [ -n "$file" ] || continue
  case "$file" in (/*|*..*) continue ;; esac
  # The file entry may be a glob such as *.xcodeproj, expanded relative to the project root.
  ( cd "$root" 2>/dev/null || exit 0
    for f in $file; do
      [ -e "$f" ] || continue
      if [ -z "$pattern" ] || grep -qE "$pattern" "$f" 2>/dev/null; then printf '%s\n' "$id"; break; fi
    done )
done | sort -u)
[ -n "$ids" ] || exit 0

# A category with "minFiles" is only offered in a project with at least that many tracked files.
enough() {  # enough <category id>
  need=$(jq -r --arg id "$1" '.categories[] | select(.id == $id) | .minFiles // 0' "$catalog" 2>/dev/null)
  case "$need" in ''|*[!0-9]*) need=0 ;; esac
  [ "$need" -le 0 ] && return 0
  have=$(git -C "$root" ls-files 2>/dev/null | wc -l | tr -d ' ')
  case "$have" in ''|*[!0-9]*) have=0 ;; esac
  [ "$have" -ge "$need" ]
}

chosen=""
count=0
for id in $ids; do
  enough "$id" || continue
  paused "$id" && continue
  chosen="$chosen $id"
  count=$((count + 1))
  [ "$count" -ge 2 ] && break
done
[ -n "$chosen" ] || exit 0

verified=$(jq -r '.verified // ""' "$catalog" 2>/dev/null)
list=$(jq -r --arg ids "$chosen" '
  ($ids | split(" ") | map(select(. != ""))) as $want
  | .categories[] | select(.id as $i | $want | index($i))
  | "- " + (.label // .id) + " (category id: " + .id + "):\n"
    + ([.recommend[] | "    * " + .name + " from " + .source + ": " + .why
        + (if (.risk // "") != "" then " Note: " + .risk else "" end)
        + "\n      install: " + .install] | join("\n"))' "$catalog" 2>/dev/null)
[ -n "$list" ] || exit 0

printf '%s\n' \
  '<crew-chief-skill-offer>' \
  "This project ($root) looks like work that has well-regarded Claude Code skills, and none of the preferred ones is installed. Ask the user ONCE, in their language, at the start of your first reply (AskUserQuestion if available; if you cannot ask, for example in a non-interactive run, skip this entirely). Then carry on with whatever they asked." \
  "Say briefly what skills are (instruction packs Claude loads when a task matches) and why these help here. Show, for each skill: its name, where it comes from, what it does, and the install command exactly as listed below. The list was checked on ${verified:-an unknown date}; if that is more than 90 days ago, say so and offer to look for newer ones on the web first." \
  'Candidates:' \
  "$list" \
  'Say exactly what would change: the listed command downloads those skills onto this machine (user level) and nothing in the project is touched. Skills are instructions Claude follows, so tell the user to glance at the source before saying yes. Install nothing without a clear yes, and run only the listed commands as written.' \
  'Options per category: "Install" / "Not now" / "Never for this project". After an install, say a restart (or /reload-plugins where it applies) may be needed before Claude sees the new skills.' \
  "Record each answer with Bash, exactly one line per category: install -> printf '%s\\t%s\\tinstalled\\n' '$root' '<category id>' >> '$state' (after the install succeeded); not now -> printf '%s\\t%s\\tlater\\t%s\\n' '$root' '<category id>' \"\$(date +%s)\" >> '$state'; never -> printf '%s\\t%s\\tnever\\n' '$root' '<category id>' >> '$state'. Create the directory first if needed: mkdir -p '$CLAUDE_PLUGIN_DATA'." \
  '</crew-chief-skill-offer>'
exit 0
