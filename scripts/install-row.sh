#!/bin/sh
# crew-chief SessionStart hook (startup only): puts the agent panel row (model, effort,
# tokens per subagent) into the user's own settings.json.
#
# Why: a subagentStatusLine shipped in a plugin's settings.json is read by Claude Code but
# does not reach the agent panel (checked on 2.1.296: the same command renders from the
# user's settings.json and not from the plugin's). So the plugin installs it there itself.
#
# Safe by construction:
#   - never touches an existing subagentStatusLine that is not crew-chief's own
#   - installs once; if the user later removes the key it is not added back
#   - keeps one backup (settings.json.crew-chief-bak), validates the JSON before writing, and
#     writes in place so a symlinked settings.json (dotfiles) stays a symlink
#   - does nothing without jq, with an unreadable or invalid settings.json, or when
#     CLAUDE_CONFIG_DIR points somewhere other than ~/.claude
#   - CREW_CHIEF_ROW=off disables it
# Prints one line (added to the session context) only when it installs.

cat >/dev/null 2>&1
[ "${CREW_CHIEF_ROW:-on}" = "off" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
[ -n "${HOME:-}" ] || exit 0
src="${CLAUDE_PLUGIN_ROOT:-}/scripts/subagent-row.sh"
[ -f "$src" ] || exit 0
if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ "$CLAUDE_CONFIG_DIR" != "$HOME/.claude" ]; then exit 0; fi

cfg="$HOME/.claude"
dest="$cfg/crew-chief-subagent-row.sh"
settings="$cfg/settings.json"
marker="$cfg/.crew-chief-row-installed"
want='"$HOME/.claude/crew-chief-subagent-row.sh"'
mkdir -p "$cfg" 2>/dev/null || exit 0

if [ -f "$settings" ]; then
  jq -e 'type == "object"' "$settings" >/dev/null 2>&1 || exit 0
  current=$(jq -r '.subagentStatusLine.command // empty' "$settings" 2>/dev/null)
else
  current=""
fi

copy_script() {
  tmp="$dest.tmp.$$"
  cp "$src" "$tmp" 2>/dev/null && chmod +x "$tmp" 2>/dev/null && mv "$tmp" "$dest" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

if [ "$current" = "$want" ]; then
  # Ours: keep the copy in step with the plugin version.
  cmp -s "$src" "$dest" 2>/dev/null || copy_script
  exit 0
fi
[ -n "$current" ] && exit 0                 # the user's own command: leave it alone
[ -f "$marker" ] && exit 0                  # installed before and removed since: respect that
jq -e '.subagentStatusLine != null' "$settings" >/dev/null 2>&1 && exit 0   # some other shape: leave it alone

copy_script || exit 0
[ -f "$settings" ] || printf '{}\n' > "$settings" || exit 0
[ -f "$settings.crew-chief-bak" ] || cp "$settings" "$settings.crew-chief-bak" 2>/dev/null
new="$settings.tmp.$$"
if jq --arg c "$want" '. + {subagentStatusLine: {type: "command", command: $c}}' "$settings" > "$new" 2>/dev/null \
   && jq -e '.subagentStatusLine.command' "$new" >/dev/null 2>&1; then
  cat "$new" > "$settings" && rm -f "$new" && : > "$marker"
  echo "crew-chief: added the agent panel row (model, effort, tokens per subagent) to ~/.claude/settings.json as subagentStatusLine. Undo: delete that key, or set CREW_CHIEF_ROW=off. Backup: ~/.claude/settings.json.crew-chief-bak."
else
  rm -f "$new"
fi
exit 0
