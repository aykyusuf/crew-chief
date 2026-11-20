#!/bin/sh
# crew-chief PreToolUse hook (matcher Agent): a UI task must go to crew-chief:ui-implementer, and its brief must
# name the UI profile (see data/ui-policy.json). A call that is a UI task and either goes to another writing agent
# (implementer, implementer-hard, mechanic, general-purpose, or no type) or does not mention the profile is
# denied ONCE (exit 2, the reason on stderr goes to the model). The denied brief is remembered (cksum of
# subagent_type + prompt in ${CLAUDE_PLUGIN_DATA}/ui-gate, four hours), so the identical retry passes.
#
# A UI task is one whose description or brief has a UI keyword (the catalog categories marked "uiPolicy", Turkish
# too) or names UI files (.tsx .jsx .vue .svelte .css .scss .html, a Dart UI file, SwiftUI). Read-only agents
# (scanner, deep-reader, reviewer, planner, ui-smoke, ui-tester, Explore), crew-chief:ui-designer (the read-only
# designer is the agent a big UI job starts with, so it is always allowed), crew-chief:ui-scout (the reference
# scout writes no code and runs before the first screen, so it is always allowed) and
# agents this plugin does not know pass untouched.
#
# CREW_CHIEF_UI_GATE=off turns it off. Needs jq and ${CLAUDE_PLUGIN_DATA}; without them, or when the input
# cannot be parsed, it lets the call through. It never blocks by accident.

input=$(cat)
[ "${CREW_CHIEF_UI_GATE:-on}" = "off" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0

here=$(dirname "$0")
root="${CLAUDE_PLUGIN_ROOT:-$here/..}"
. "$here/ui-lib.sh"

atype=$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null)
prompt=$(printf '%s' "$input" | jq -r '.tool_input.prompt // empty' 2>/dev/null)
desc=$(printf '%s' "$input" | jq -r '.tool_input.description // empty' 2>/dev/null)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$cwd" ] || cwd=$(pwd)
[ -n "$prompt" ] || exit 0

case "$atype" in
  ''|implementer|implementer-hard|mechanic|general-purpose|crew-chief:implementer|crew-chief:implementer-hard|crew-chief:mechanic) writer=yes ;;
  ui-implementer|crew-chief:ui-implementer) writer=ui ;;
  ui-designer|crew-chief:ui-designer|ui-scout|crew-chief:ui-scout) exit 0 ;;
  *) exit 0 ;;
esac

pol=$(ui_policy "$root") || exit 0
[ -n "$pol" ] || exit 0

# Is it a UI task? Calls to ui-implementer always are.
if [ "$writer" != "ui" ]; then
  ui_is_task "$root" "$desc
$prompt" || exit 0
fi

# Does the brief name the profile? "UI profile", the profile file's folder, or a profile id (shipped or the project's own).
pf=$(ui_profile_path "$cwd" "$pol")
named=no
if printf '%s' "$prompt" | grep -Eiq 'ui[ _-]?profile|\.crew-chief/'; then
  named=yes
else
  ids=$(printf '%s' "$pol" | jq -r '(.profiles | keys[]), (.aliases // {} | keys[])' 2>/dev/null)
  [ -n "$pf" ] && ids="$ids
$(jq -r '.profile // empty' "$pf" 2>/dev/null)"
  for id in $ids; do
    [ -n "$id" ] && printf '%s' "$prompt" | grep -qiF -e "$id" && { named=yes; break; }
  done
fi
[ "$writer" = "ui" ] && [ "$named" = "yes" ] && exit 0

# Denied once per identical brief.
dir="$CLAUDE_PLUGIN_DATA/ui-gate"
key=$(printf '%s\n%s' "$atype" "$prompt" | cksum 2>/dev/null | tr ' ' '-')
[ -n "$key" ] || exit 0
if [ -f "$dir/$key" ] && [ -n "$(find "$dir/$key" -mmin -240 2>/dev/null)" ]; then
  exit 0
fi
mkdir -p "$dir" 2>/dev/null || exit 0
: > "$dir/$key" 2>/dev/null || exit 0
find "$dir" -type f -mmin +240 -delete 2>/dev/null

{
  if [ "$writer" = "yes" ]; then
    echo "Held back once by crew-chief: this is a UI task, and UI code goes to crew-chief:ui-implementer (it has the design skills preloaded), not to ${atype:-an agent without a type}."
  else
    echo "Held back once by crew-chief: this UI brief does not name the UI profile."
  fi
  if [ -n "$pf" ]; then
    echo "The project's profile ($pf):"
    ui_profile_text "$pf" "$pol"
  else
    echo "There is no UI profile yet: first infer it from the project (three / @react-three/fiber -> immersive; motion / gsap -> lively; DESIGN.md) or ask the user once with AskUserQuestion (list the profiles neutrally: no recommended option, no warning that one is too heavy; follow the pick), and write .crew-chief/ui-profile.json."
  fi
  echo "Re-send the brief to crew-chief:ui-implementer naming the profile, the extra skills it must load (crew-chief:design-taste-frontend too for a landing page, portfolio or redesign) and the reference image paths (.crew-chief/refs/). If the profile file has a pages entry for the page, name that page's effective profile. If you are sure this is not UI work, send the same call again and it passes."
} >&2
exit 2
