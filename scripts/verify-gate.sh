#!/bin/sh
# crew-chief verification gate (ONERILER-26 item 5).
#
#   verify-gate.sh record   PostToolUse on Bash and Agent: a test, build or check command, or a verifier/reviewer agent,
#                           counts as verification for this session (a time stamp in the plugin data folder).
#   verify-gate.sh gate     PreToolUse on Bash: Claude's `git commit` with no verification since the last commit.
#
# Mode (CREW_CHIEF_VERIFY_GATE, else "verify.gate" in <project>/.claude/crew-chief.json, else observe):
#   off      nothing;
#   observe  the commit runs; Claude gets a note to say in the commit message what verified it ("Verified: ...");
#   enforce  the commit is held back; after two holds in this session it passes (the user may have a reason).
# Needs jq and CLAUDE_PLUGIN_DATA; without them it does nothing. Never blocks in observe mode.

mode_arg=$1
input=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0

sid=$(printf '%s' "$input" | jq -r '.session_id // empty | strings' 2>/dev/null)
case "$sid" in ''|*[!A-Za-z0-9_-]*) exit 0 ;; esac
dir="$CLAUDE_PLUGIN_DATA/verify"
mark="$dir/$sid"
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)

# Commands that exercise the code. Plain reads (cat, ls, grep) and installs do not count.
CHECK='(^|[;&|(`[:space:]])((npm|pnpm|yarn|bun)[[:space:]]+(run[[:space:]]+)?(test|check|lint|typecheck|build|e2e|verify)|npx[[:space:]]+(jest|vitest|playwright|tsc|eslint)|(jest|vitest|pytest|tox|nox|phpunit|rspec|mocha|ava)([[:space:]]|$)|python3?[[:space:]]+(-m[[:space:]]+(pytest|unittest)|[^[:space:]]*test[^[:space:]]*\.py)|node[[:space:]]+--test|go[[:space:]]+(test|vet|build)|cargo[[:space:]]+(test|check|clippy|build)|swift[[:space:]]+(test|build)|xcodebuild[[:space:]].*test|flutter[[:space:]]+(test|analyze)|dart[[:space:]]+(test|analyze)|gradle(w)?[[:space:]].*(test|check)|\./gradlew[[:space:]].*(test|check)|mvn[[:space:]].*(test|verify)|make[[:space:]]+(test|check)|claude[[:space:]]+plugin[[:space:]]+(test|validate)|tsc([[:space:]]|$)|ruff|mypy|eslint)'

case "$mode_arg" in
  record)
    hit=no
    case "$tool" in
      Bash)
        cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty | strings' 2>/dev/null)
        printf '%s\n' "$cmd" | grep -qE "$CHECK" && hit=yes ;;
      Agent|Task)
        t=$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // empty | strings' 2>/dev/null)
        case "$t" in *verifier|*reviewer|*security-reviewer|*ui-tester|*critic) hit=yes ;; esac ;;
    esac
    if [ "$hit" = yes ]; then
      mkdir -p "$dir" 2>/dev/null && date +%s > "$mark.$$" 2>/dev/null && mv "$mark.$$" "$mark" 2>/dev/null
      find "$dir" -type f -mtime +7 -delete 2>/dev/null
    fi
    exit 0 ;;
  gate) ;;
  *) exit 0 ;;
esac

[ "$tool" = Bash ] || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty | strings' 2>/dev/null)
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit([[:space:]]|$)' || exit 0
printf '%s' "$cmd" | grep -qE -- '--dry-run' && exit 0

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$cwd" ] || cwd=$(pwd)
top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0

mode=${CREW_CHIEF_VERIFY_GATE:-}
if [ -z "$mode" ] && [ -f "$top/.claude/crew-chief.json" ]; then
  mode=$(jq -r '."verify.gate" // empty | strings' "$top/.claude/crew-chief.json" 2>/dev/null)
fi
case "$mode" in off|observe|enforce) ;; *) mode=observe ;; esac
[ "$mode" = off ] && exit 0

# A "Verified:" line in the commit message is the author's own statement: nothing to add.
printf '%s' "$cmd" | grep -qiE 'verified:' && exit 0

last=$(git -C "$top" log -1 --format=%ct 2>/dev/null)
case "$last" in ''|*[!0-9]*) last=0 ;; esac
seen=$(cat "$mark" 2>/dev/null)
case "$seen" in ''|*[!0-9]*) seen=0 ;; esac
[ "$seen" -gt "$last" ] && exit 0

note="crew-chief verification gate: no test, build or check has run in this session since the last commit. Run the project's check now if there is one; then add a line to the commit message saying what verified it, e.g. \"Verified: npm test (42 passed)\" or \"Verified: not run (docs only)\"."
if [ "$mode" = observe ]; then
  jq -nc --arg t "$note" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $t}}'
  exit 0
fi

count_file="$dir/$sid.holds"
mkdir -p "$dir" 2>/dev/null
n=$(cat "$count_file" 2>/dev/null)
case "$n" in ''|*[!0-9]*) n=0 ;; esac
if [ "$n" -ge 2 ]; then
  exit 0
fi
printf '%s\n' $((n + 1)) > "$count_file" 2>/dev/null
echo "$note (enforce mode: held $((n + 1)) of 2; after two holds in this session the commit passes)" >&2
exit 2
