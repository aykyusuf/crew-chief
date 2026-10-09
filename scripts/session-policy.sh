#!/bin/sh
# crew-chief SessionStart hook: prints the routing policy, which Claude Code adds
# to the session context. Runs on startup, resume, clear, and compact so the
# policy survives context resets. Keep it short: it is paid for on every session.
#
# The project directory comes from the hook input ("cwd"), not the environment.
# If /crew-setup already wrote the policy into that project's CLAUDE.md, the
# policy is not added a second time.

input=$(tr '\n' ' ')
field() { printf '%s' "$input" | sed -nE "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\".*/\\1/p"; }
cwd=$(field cwd)
source=$(field source)

# Session handoff offer (see skills/crew-handoff). Printed at most once per project, only on a fresh
# start, only in a git repository that has no handoff-like files yet, and only when the answer can be
# remembered outside the repository (CLAUDE_PLUGIN_DATA). Never writes anything itself.
handoff_offer() {
  [ "$source" = "startup" ] || return 0
  [ "${CREW_CHIEF_HANDOFF_OFFER:-on}" = "off" ] && return 0
  [ -n "$cwd" ] && [ -d "$cwd" ] && [ -n "${CLAUDE_PLUGIN_DATA:-}" ] || return 0
  root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || return 0
  [ -n "$root" ] || return 0
  case "$root" in
    *\'*) return 0 ;;  # a quote in the path would break the printed commands
    "$HOME"|/|/tmp|/tmp/*|/private/tmp|/private/tmp/*|/private/var/folders/*|/var/folders/*) return 0 ;;
  esac
  # Existing handoff files under any common name, at the root or one level down: stay quiet.
  for name in tasks.json STATUS.md PROGRESS.md HANDOFF.md claude-progress.txt feature_list.json durum.md ilerleme.md; do
    for hit in "$root/$name" "$root"/*/"$name"; do
      [ -e "$hit" ] && return 0
    done
  done
  [ -f "$root/CLAUDE.md" ] && grep -q 'crew-chief:handoff' "$root/CLAUDE.md" && return 0
  case "$CLAUDE_PLUGIN_DATA" in *\'*) return 0 ;; esac
  state="$CLAUDE_PLUGIN_DATA/handoff-offers.tsv"
  if [ -f "$state" ]; then
    # Root via ENVIRON, not -v: -v would interpret backslashes in the path. The last line wins.
    line=$(r="$root" awk -F '\t' '$1 == ENVIRON["r"] { last = $0 } END { print last }' "$state" 2>/dev/null | tr -d '\r')
    case "$line" in
      *"	installed"*|*"	never"*) return 0 ;;
      *"	later	"*)
        when=${line##*	}
        now=$(date +%s 2>/dev/null)
        # Arithmetic only on plain digits: anything else (a date, a decimal) would end the hook with an error.
        case "$when$now" in
          ''|*[!0-9]*) ;;
          *) [ $((now - when)) -lt 604800 ] && return 0 ;;
        esac ;;
    esac
  fi
  printf '%s\n' \
    '<crew-chief-handoff-offer>' \
    "This project ($root) has no session handoff files. Ask the user ONCE, in their language, at the start of your first reply (AskUserQuestion if available; if you cannot ask, for example in a non-interactive run, skip this entirely). Then carry on with whatever they asked." \
    'Say what it is and why, briefly: three small files let a new session pick up where the last one stopped instead of rediscovering the project: STATUS.md (now, next, open questions, failed attempts), tasks.json (task list where only status and evidence change), PROGRESS.md (dated log). This follows Anthropic'"'"'s engineering guidance for long-running agents, "Effective harnesses for long-running agents" (anthropic.com/engineering/effective-harnesses-for-long-running-agents, Nov 2025): a progress file, a JSON task list whose status field is the only thing that changes (models alter JSON less readily than Markdown), and reading git log plus the progress file at session start.' \
    'Say exactly what would change: only those three files are created (nothing existing is overwritten), and a marked start/end routine block is added to CLAUDE.md (rest untouched). Nothing is committed. A preview is shown before anything is written.' \
    'Options: "Set it up" (recommended) / "Not now" / "Never for this project".' \
    "Record the answer with Bash, exactly one line: set up -> run the crew-chief:crew-handoff skill, which records it; not now -> printf '%s\\tlater\\t%s\\n' '$root' \"\$(date +%s)\" >> '$state'; never -> printf '%s\\tnever\\n' '$root' >> '$state'. Create the directory first if needed: mkdir -p '$CLAUDE_PLUGIN_DATA'." \
    '</crew-chief-handoff-offer>'
}

if [ -n "$cwd" ] && [ -f "$cwd/CLAUDE.md" ] && grep -q '<!-- crew-chief:start' "$cwd/CLAUDE.md"; then
  echo "crew-chief: the routing policy is in this project's CLAUDE.md. The plugin's agents are also available as crew-chief:<tier>; prefer the project's own copies (bare names) so routing stays consistent."
  handoff_offer
  exit 0
fi

printf '%s\n' \
  '<crew-chief-policy>' \
  'crew-chief is installed. The user chose this session'\''s model and effort; you decide who does each piece of work.' \
  '' \
  'Mode: auto (the user can switch with /crew-chief:crew-mode or by saying so).' \
  '- auto: route by the table below.' \
  '- solo: do everything in the main session; spawn no subagents.' \
  '- delegate: actively hand independent pieces to the tiers below, in parallel where possible.' \
  '' \
  'Tiers (agent type, default model/effort):' \
  '- main session: back-and-forth with the user, design or product decisions, planning, tightly coupled work, quick fixes.' \
  '- crew-chief:scanner (haiku/low): mechanical lookups, filtering long logs or test output.' \
  '- crew-chief:deep-reader (sonnet/medium): read-only analysis across several files, root cause from code.' \
  '- crew-chief:implementer (sonnet/medium): changes where files, change, and check are all specified.' \
  '- crew-chief:implementer-hard (opus/high): multi-module, algorithmic, or unknown-root-cause work.' \
  '- crew-chief:ui-smoke (haiku/low): quick read-only check that a page or screen is up, shows given text, or logs errors; no screenshots.' \
  '- crew-chief:ui-tester (sonnet/medium): multi-step browser, emulator, or simulator checks with screenshots; reports pass/fail with evidence; never two UI agents on the same device or browser at once.' \
  '- crew-chief:reviewer (opus/high): independent review before a commit or PR of a significant or risky change; effort xhigh only for security, data loss, concurrency, money, or shipping code; large diffs go to /code-review.' \
  '' \
  'Rules:' \
  '- Delegate only when the work is self-contained AND (it can run in parallel OR its output would flood your context OR a cheaper tier can do it). Otherwise do it yourself.' \
  '- Brief subagents fully: goal, files, definition of done, check to run, and any constraint the user gave in this conversation (do not modify X, no commits). They do not see this conversation.' \
  '- If a tier reports "stopped", escalate one step: implementer -> implementer-hard -> main session.' \
  '- The Agent tool'\''s model and effort parameters override a tier'\''s defaults for one call; use them when the user names a model or effort ("give this to Sonnet at medium").' \
  '- User overrides win and last until they say otherwise: "do it yourself" = solo; "use agents" = delegate; "X directly with Opus" = X stays in the main session.' \
  '- For polling, waiting, scheduling, workflows, or agent teams, load the crew-chief:crew-routing skill first.' \
  '</crew-chief-policy>'
handoff_offer
