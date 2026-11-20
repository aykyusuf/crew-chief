#!/bin/sh
# crew-chief PreToolUse hook (matcher Write|Edit|MultiEdit): the project has no UI profile yet, and a UI file is about
# to be written. Text alone did not stop the main session from writing index.html in Claude's default look, so this
# denies that write ONCE (exit 2, the reason on stderr goes to the model): set the profile, ask for a reference image,
# hand the UI code to crew-chief:ui-implementer. The denied call is remembered (cksum of tool + file path in
# ${CLAUDE_PLUGIN_DATA}/ui-gate, four hours, the same folder and TTL as ui-brief-check.sh), so the identical retry
# passes; a tiny fix to an existing UI file is that retry.
#
# A UI file is .tsx .jsx .vue .svelte .css .scss .html, or a .dart file whose content (or the existing file) looks like
# a Flutter widget. Once .crew-chief/ui-profile.json exists (in the working directory or its git root) it never denies.
# Writes into a .crew-chief/ folder, and writes by crew-chief:ui-implementer itself, always pass.
#
# CREW_CHIEF_UI_GATE=off turns it off (the same switch as the Agent gate). Needs jq and ${CLAUDE_PLUGIN_DATA}; without
# them, or when the input cannot be parsed, it lets the call through. It never blocks by accident.

input=$(cat)
[ "${CREW_CHIEF_UI_GATE:-on}" = "off" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0

here=$(dirname "$0")
root="${CLAUDE_PLUGIN_ROOT:-$here/..}"
. "$here/ui-lib.sh"

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)
case "$tool" in Write|Edit|MultiEdit) ;; *) exit 0 ;; esac
fpath=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$fpath" ] || exit 0

# The ui-implementer is where UI code is meant to go; the agent type is in the hook input of a subagent's call.
case "$(printf '%s' "$input" | jq -r '.agent_type // empty' 2>/dev/null)" in
  ui-implementer|crew-chief:ui-implementer) exit 0 ;;
esac

# The plugin's own files (profile, references) are never held back.
case "$fpath" in .crew-chief/*|*/.crew-chief/*) exit 0 ;; esac

ui_file_path_is_ui "$fpath" || exit 0

# A .dart file counts only when it looks like a widget: what is being written, or what the file already holds.
case "$fpath" in
  *.dart|*.DART)
    body=$(printf '%s' "$input" | jq -r '[.tool_input.content, .tool_input.new_string, (.tool_input.edits[]?.new_string)] | map(select(type == "string")) | join("\n")' 2>/dev/null)
    if [ -f "$fpath" ]; then body="$body
$(head -c 20000 "$fpath" 2>/dev/null)"; fi
    ui_dart_is_widget "$body" || exit 0
    ;;
esac

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$cwd" ] || cwd=$(pwd)
pol=$(ui_policy "$root") || exit 0
[ -n "$pol" ] || exit 0
[ -n "$(ui_profile_path "$cwd" "$pol")" ] && exit 0

# Denied once per tool + file path.
dir="$CLAUDE_PLUGIN_DATA/ui-gate"
key="w-$(printf '%s\n%s' "$tool" "$fpath" | cksum 2>/dev/null | tr ' ' '-')"
[ "$key" != "w-" ] || exit 0
if [ -f "$dir/$key" ] && [ -n "$(find "$dir/$key" -mmin -240 2>/dev/null)" ]; then
  exit 0
fi
mkdir -p "$dir" 2>/dev/null || exit 0
: > "$dir/$key" 2>/dev/null || exit 0
find "$dir" -type f -mmin +240 -delete 2>/dev/null

pfrel=$(printf '%s' "$pol" | jq -r '.profileFile // ".crew-chief/ui-profile.json"' 2>/dev/null)
[ -n "$pfrel" ] || pfrel=".crew-chief/ui-profile.json"
echo "crew-chief UI: this project has no UI profile yet. Before writing UI files: set the profile ($pfrel: infer from the project or ask the user), ask for a reference image (3 choices), then hand the UI code to crew-chief:ui-implementer with the profile, extra skills and reference paths. If this is only a tiny fix to an existing UI file, retry the same call." >&2
exit 2
