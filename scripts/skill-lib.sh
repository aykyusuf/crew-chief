#!/bin/sh
# crew-chief shared helpers for the skill hint (skill-hint.sh) and the skill offer (skill-offer.sh).
# Sourced, never run. Needs jq for the plugin list; without it only the plain skill folders are read.

# installed_skills <project dir>: the names of the skills Claude Code can see, one per line.
# Reads project and user skill folders, the folder `npx skills` installs into, and the skills of
# every installed plugin (from installed_plugins.json, so removed plugins in .trash are not counted).
installed_skills() {
  for dir in "$1/.claude/skills" "${HOME:-/nonexistent}/.claude/skills" "${HOME:-/nonexistent}/.agents/skills"; do
    [ -d "$dir" ] || continue
    for entry in "$dir"/*/; do
      [ -f "${entry}SKILL.md" ] || continue
      entry=${entry%/}
      printf '%s\n' "${entry##*/}"
    done
  done
  list="${HOME:-/nonexistent}/.claude/plugins/installed_plugins.json"
  if [ -f "$list" ] && command -v jq >/dev/null 2>&1; then
    # Plugins switched off in the user settings do not count.
    off='[]'
    [ -f "${HOME:-/nonexistent}/.claude/settings.json" ] && off=$(jq -c '[.enabledPlugins // {} | to_entries[] | select(.value == false) | .key]' "${HOME:-/nonexistent}/.claude/settings.json" 2>/dev/null)
    [ -n "$off" ] || off='[]'
    jq -r --argjson off "$off" '.plugins | to_entries[] | select(.key as $k | ($off | index($k)) | not) | .value[]?.installPath // empty' "$list" 2>/dev/null | while IFS= read -r base; do
      for entry in "$base"/skills/*/; do
        [ -f "${entry}SKILL.md" ] || continue
        entry=${entry%/}
        printf '%s\n' "${entry##*/}"
      done
    done
  fi
}
