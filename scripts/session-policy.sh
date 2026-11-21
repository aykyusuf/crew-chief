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
  # The mod asks the same question as a dialog and leaves a marker (a unix time) while it is loaded: stay quiet then.
  if [ -f "$CLAUDE_PLUGIN_DATA/mod-offer-active" ]; then
    marker=$(tr -d ' \r\n' < "$CLAUDE_PLUGIN_DATA/mod-offer-active" 2>/dev/null)
    now=$(date +%s 2>/dev/null)
    case "$marker$now" in
      ''|*[!0-9]*) ;;
      *) [ $((now - marker)) -lt 1209600 ] && return 0 ;;
    esac
  fi
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
    "This project ($root) has no session handoff files. Do the user's first request first. Do NOT ask about this before starting, and never use AskUserQuestion or any other dialog for it: it must not hold up their work." \
    'At the very end of your final answer to that first request, add exactly ONE short line, in the user'"'"'s language, offering it, for example: "I can set up handoff files (STATUS.md, tasks.json, PROGRESS.md) so a new session continues where this one stopped. Say yes to set them up." Nothing more about it in that answer.' \
    'Skip the line entirely, and record nothing, when the first request describes a long autonomous or unattended job (overnight, all night, until done, in the background, a loop, every N minutes, a schedule, "I am leaving", "I am going to sleep") or the run is non-interactive.' \
    "When you do add the line, record it as offered with Bash right before writing that final answer, exactly one line, so it pauses for a week and is not repeated next session just because it was ignored: printf '%s\\tlater\\t%s\\n' '$root' \"\$(date +%s)\" >> '$state'. Create the directory first if needed: mkdir -p '$CLAUDE_PLUGIN_DATA'." \
    'If the user then asks what it is, explain briefly: three small files let a new session pick up where the last one stopped instead of rediscovering the project: STATUS.md (now, next, open questions, failed attempts), tasks.json (task list where only status and evidence change), PROGRESS.md (dated log). This follows Anthropic'"'"'s engineering guidance for long-running agents, "Effective harnesses for long-running agents" (anthropic.com/engineering/effective-harnesses-for-long-running-agents, Nov 2025): a progress file, a JSON task list whose status field is the only thing that changes (models alter JSON less readily than Markdown), and reading git log plus the progress file at session start.' \
    'What would change: only those three files are created (nothing existing is overwritten), and a marked start/end routine block is added to CLAUDE.md (rest untouched). Nothing is committed. After a yes, the plan and a preview are shown and the files are written in the same turn (it waits for another yes only when equivalent files already exist).' \
    "If the user then says yes, run the crew-chief:crew-handoff skill, which records it as installed. If they say never (not for this project), record it with Bash, exactly one line: printf '%s\\tnever\\n' '$root' >> '$state'. Anything else: leave the later record as it is." \
    '</crew-chief-handoff-offer>'
}

# Once per 7 days per project (startup only): ask Claude to do one consistency pass over the handoff files while it
# reads them anyway. The shell records the check itself (handoff-checks.tsv, root TAB unix time), so the record
# does not depend on Claude remembering to write it. Size facts are measured here, cheaply, and only the ones
# over their limit are printed. Advisory only.
# A project with a security risk map (.crew-chief/security-map.json) gets it rescanned in the background once it
# is more than 7 days old, so files added outside Claude's writes are not missed. Startup only; never waits.
security_rescan() {
  [ "$source" = "startup" ] || return 0
  [ -n "$cwd" ] && [ -d "$cwd" ] || return 0
  root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || return 0
  map="$root/.crew-chief/security-map.json"
  [ -f "$map" ] || return 0
  [ -n "$(find "$map" -mtime +7 2>/dev/null)" ] || return 0
  ( sh "$(dirname "$0")/security-map.sh" scan "$root" >/dev/null 2>&1 & ) 2>/dev/null
  return 0
}

# Night mode: at the first start after a night ended, its report is shown once (night/<sid8>/REPORT.md).
night_report() {
  [ "$source" = "startup" ] || return 0
  [ -n "$cwd" ] && [ -d "$cwd" ] && [ -n "${CLAUDE_PLUGIN_DATA:-}" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || root=$cwd
  [ -d "$root/night" ] || return 0
  shown="$CLAUDE_PLUGIN_DATA/night-reports-shown.tsv"
  for st in "$root"/night/*/state.json; do
    [ -f "$st" ] || continue
    case "$(jq -r '.status // empty' "$st" 2>/dev/null)" in done|stalled|stopped) ;; *) continue ;; esac
    rep="$(dirname "$st")/REPORT.md"
    [ -f "$rep" ] || continue
    grep -qxF "$rep" "$shown" 2>/dev/null && continue
    printf '%s\n' "$rep" >> "$shown" 2>/dev/null
    printf '%s\n' '<crew-chief-night-report>' \
      "A night run ended and its report is waiting: $rep. Before anything else in your first answer, give the user its verdict line and the 'Needs you' items (short), then do what they asked." \
      '</crew-chief-night-report>'
  done
  return 0
}

handoff_check() {
  [ "$source" = "startup" ] || return 0
  [ -n "$cwd" ] && [ -d "$cwd" ] && [ -n "${CLAUDE_PLUGIN_DATA:-}" ] || return 0
  root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || root=$cwd
  [ -n "$root" ] || return 0
  case "$root" in
    "$HOME"|/|/tmp|/tmp/*|/private/tmp|/private/tmp/*|/private/var/folders/*|/var/folders/*) return 0 ;;
  esac
  hdir=
  for d in "$cwd" "$root" "$root"/*/; do
    d=${d%/}
    if [ -f "$d/STATUS.md" ] || [ -f "$d/tasks.json" ]; then hdir=$d; break; fi
  done
  [ -n "$hdir" ] || return 0
  checks="$CLAUDE_PLUGIN_DATA/handoff-checks.tsv"
  now=$(date +%s 2>/dev/null)
  case "$now" in ''|*[!0-9]*) return 0 ;; esac
  if [ -f "$checks" ]; then
    last=$(r="$root" awk -F '\t' '$1 == ENVIRON["r"] { last = $2 } END { print last }' "$checks" 2>/dev/null | tr -d '\r')
    case "$last" in
      ''|*[!0-9]*) ;;
      *) [ $((now - last)) -lt 604800 ] && return 0 ;;
    esac
  fi
  mkdir -p "$CLAUDE_PLUGIN_DATA" 2>/dev/null || return 0
  printf '%s\t%s\n' "$root" "$now" >> "$checks" 2>/dev/null || return 0

  facts=
  if [ -f "$hdir/STATUS.md" ]; then
    n=$(wc -c < "$hdir/STATUS.md" 2>/dev/null | tr -d ' ')
    case "$n" in ''|*[!0-9]*) ;; *) [ "$n" -gt 6144 ] && facts="$facts
- STATUS.md is $((n / 1024)) KB (limit 6 KB: it should describe the present only)." ;; esac
  fi
  if [ -f "$root/CLAUDE.md" ]; then
    n=$(wc -l < "$root/CLAUDE.md" 2>/dev/null | tr -d ' ')
    case "$n" in ''|*[!0-9]*) ;; *) [ "$n" -gt 200 ] && facts="$facts
- CLAUDE.md has $n lines (Anthropic's guide: under 200)." ;; esac
  fi
  if [ -f "$hdir/PROGRESS.md" ]; then
    cutoff=$(date -v-60d +%Y-%m-%d 2>/dev/null || date -d '60 days ago' +%Y-%m-%d 2>/dev/null)
    case "$cutoff" in
      [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9])
        n=$(c="$cutoff" awk '
          /^[ \t]*([-*][ \t]+|##+[ \t]+)?[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ {
            match($0, /[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/)
            if ((substr($0, RSTART, RLENGTH) "") < (ENVIRON["c"] "")) old++
          }
          END { print old + 0 }' "$hdir/PROGRESS.md" 2>/dev/null)
        case "$n" in ''|*[!0-9]*) ;; *) [ "$n" -gt 0 ] && facts="$facts
- PROGRESS.md has $n entries older than 60 days (/crew-tidy archive moves them)." ;; esac ;;
      *)
        n=$(wc -c < "$hdir/PROGRESS.md" 2>/dev/null | tr -d ' ')
        case "$n" in ''|*[!0-9]*) ;; *) [ "$n" -gt 40960 ] && facts="$facts
- PROGRESS.md is $((n / 1024)) KB (/crew-tidy archive moves old entries)." ;; esac ;;
    esac
  fi
  if [ -f "$hdir/tasks.json" ]; then
    n=$(wc -c < "$hdir/tasks.json" 2>/dev/null | tr -d ' ')
    case "$n" in ''|*[!0-9]*) ;; *) [ "$n" -gt 61440 ] && facts="$facts
- tasks.json is $((n / 1024)) KB (limit 60 KB: finished tasks can be archived)." ;; esac
  fi

  printf '%s\n' \
    '<crew-chief-handoff-check>' \
    "This project's handoff files ($hdir) have not been checked in the last 7 days (once a week per project; advisory only, never blocking)." \
    'While you do the session-start reading you do anyway (STATUS.md, tasks.json, git log -15), do ONE consistency pass, with no extra commands: does STATUS.md "Now" / "Next" agree with the recent git log and the tasks.json statuses? Is any task in_progress with stale or missing evidence?' \
    "Do the user's request first; do not delay or interrupt it for this. At the end of your first answer, report what you found in at most 3 lines (say nothing at all when everything is consistent). Do not edit the files for this unless the user asks."
  if [ -n "$facts" ]; then
    printf '%s\n' "Size facts measured at session start:$facts" 'Mention them in the same lines; "/crew-tidy" gives the detail and "/crew-tidy archive" moves old PROGRESS.md entries.'
  fi
  printf '%s\n' '</crew-chief-handoff-check>'
}

if [ -n "$cwd" ] && [ -f "$cwd/CLAUDE.md" ] && grep -q '<!-- crew-chief:start' "$cwd/CLAUDE.md"; then
  echo "crew-chief: the routing policy is in this project's CLAUDE.md. The plugin's agents are also available as crew-chief:<tier>; prefer the project's own copies (bare names) so routing stays consistent."
  handoff_offer
  handoff_check
  security_rescan
  night_report
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
  '- crew-chief:deep-reader (sonnet/medium): read-only analysis across several files, root cause from code, code plus web research (read-only; a long report goes to a file in the crew-chief reports folder and a short summary comes back).' \
  '- crew-chief:implementer (sonnet/medium): changes where files, change, and check are all specified.' \
  '- crew-chief:ui-implementer (sonnet/medium): UI code (components, styles, pages, screens, Flutter widgets, SwiftUI views) with the design skills preloaded; UI code goes here, not to implementer. Pass model and effort on every UI call (the UI hint carries the table, data/ui-policy.json; sonnet/medium is only the default, never Fable unless the user asks). The brief names the project UI profile (.crew-chief/ui-profile.json), the extra skills to load and the reference image paths; a UI brief without them, or sent to another writing agent, is held back once.' \
  '- crew-chief:mechanic (haiku/low): rote edits in named files with a verify command (renames, same line in many files, applying a given diff); anything needing judgement goes to implementer.' \
  '- crew-chief:implementer-hard (opus/medium; high after a failed attempt or for risky work): multi-module, algorithmic, or unknown-root-cause work.' \
  '- crew-chief:planner (opus/medium; high for a large or risky change): read-only plan for a multi-module change before implementer-hard: files, order, risks, a testable done condition; no edits.' \
  '- crew-chief:ui-designer (opus/high): read-only design spec for big UI work (3+ screens, a new site, a redesign), written to .crew-chief/design/<slug>.md; no code. ui-implementer then builds from the spec (sonnet/high).' \
  '- crew-chief:ui-scout (sonnet/medium): design reference scout, used when the user picks "find some" at the reference step: it researches what matters in this kind of project, finds 3-4 live sites and open galleries, looks at them in a browser, and writes screenshots and REFS.md to .crew-chief/refs/ (no code; inspiration only). Never run it and ui-tester on the same browser at the same time.' \
  '- crew-chief:ui-smoke (haiku/low): quick read-only check that a page or screen is up, shows given text, or logs errors; no screenshots.' \
  '- crew-chief:ui-tester (sonnet/medium): multi-step browser, emulator, or simulator checks with screenshots; reports pass/fail with evidence; never two UI agents on the same device or browser at once.' \
  '- crew-chief:reviewer (opus/medium): independent review before a commit or PR of a significant or risky change; effort high for risky changes, xhigh only for security, data loss, concurrency, money, or shipping code; large diffs go to /code-review.' \
  '- crew-chief:verifier (sonnet/high, read-only): checks a task'\''s done_when or a claim independently and tries to refute it; give it the criteria and the location, not the author'\''s conclusion. Use before calling a task done.' \
  '- crew-chief:researcher (sonnet/medium, read-only): web research with sources: claims that each carry a URL, an access date and a verbatim quote; the brief names the role (research, verify, counter-evidence). The result goes to a JSON file in the crew-chief reports folder.' \
  '- crew-chief:critic (opus/medium, read-only): strict grader for visual or quality-sensitive results against a rubric (screenshots, renders, documents); one clear defect blocks the top grade. Use when an author agent called its own visual work fine.' \
  '- crew-chief:security-reviewer (opus/high, read-only, security-audit skill preloaded): security review before committing changes to auth, crypto, secrets, payments, migrations or input reaching SQL/shell/path sinks (effort xhigh there; model sonnet, effort high for CI or dependency changes only). /crew-chief:security runs it; a gate holds back the first git commit of such files (the identical retry passes).' \
  '' \
  'Rules:' \
  '- Delegate only when the work is self-contained AND (it can run in parallel OR its output would flood your context OR a cheaper tier can do it). Otherwise do it yourself.' \
  '- Brief subagents fully: goal, files, definition of done, check to run, and any constraint the user gave in this conversation (do not modify X, no commits). They do not see this conversation.' \
  '- If your own model is Fable, your context is the most expensive: hand reading and searching (more than two or three files, logs, web pages) to scanner or deep-reader, ask for findings and not file dumps, and keep your context for decisions.' \
  '- Never start a subagent on a Fable model unless the user asked for Fable (use Opus).' \
  '- If a tier reports "stopped", escalate one step: implementer -> implementer-hard -> main session.' \
  '- The Agent tool'\''s model and effort parameters override a tier'\''s defaults for one call; use them when the user names a model or effort ("give this to Sonnet at medium").' \
  '- User overrides win and last until they say otherwise: "do it yourself" = solo; "use agents" = delegate; "X directly with Opus" = X stays in the main session.' \
  '- Subagents cannot see your skill list. When a task needs a skill, name it in the brief; every tier except scanner, mechanic and ui-smoke can load it with the Skill tool. For skill-heavy work you may use general-purpose, but pass model explicitly, because it otherwise inherits the main model.' \
  '- For polling, waiting, scheduling, workflows, or agent teams, load the crew-chief:crew-routing skill first.' \
  '</crew-chief-policy>'
handoff_offer
handoff_check
security_rescan
night_report
