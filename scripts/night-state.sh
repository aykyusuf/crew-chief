#!/bin/sh
# crew-chief night mode: the one writer of night/<sid8>/state.json. POSIX sh; needs jq.
#
#   night-state.sh open   --session <id>
#   night-state.sh arm    --session <id> (--until HH:MM | --hours N) [--git commit-per-task|none|branch:<name>] [--outward closed|open]
#                         [--forbid "<cmd>"]... [--dry-run]
#   night-state.sh resume --session <id> [--from <sid8>]     (back to the ORIGINAL deadline, never extended)
#   night-state.sh get [field]       phase <opening|armed|wrapup> [--reason r]     task <id>
#   night-state.sh done              stop [--reason r]       report-fallback       cleanup
#   night-state.sh event <source> <text>                     (appends one line to events.log)
#
# --session may be left out when CLAUDE_SESSION_ID is set or exactly one night is running in this repo.
# CREW_CHIEF_NOW (epoch seconds) replaces the clock for the tests.

here=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
. "$here/night-lib.sh"

die() { printf 'night-state: %s\n' "$1" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || die "jq is required"

cmd=${1:-}
[ -n "$cmd" ] || die "usage: night-state.sh open|arm|resume|get|phase|task|done|stop|report-fallback|event|cleanup"
shift

SID=""; UNTIL=""; HOURS=""; GITP=""; OUTWARD=""; FORBID=""; DRY=0; REASON=""; FROM=""; POS=""; NPOS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --session) [ $# -ge 2 ] || die "--session needs a value"; SID=$2; shift 2 ;;
    --until) [ $# -ge 2 ] || die "--until needs a value"; UNTIL=$2; shift 2 ;;
    --hours) [ $# -ge 2 ] || die "--hours needs a value"; HOURS=$2; shift 2 ;;
    --git) [ $# -ge 2 ] || die "--git needs a value"; GITP=$2; shift 2 ;;
    --outward) [ $# -ge 2 ] || die "--outward needs a value"; OUTWARD=$2; shift 2 ;;
    --forbid) [ $# -ge 2 ] || die "--forbid needs a value"; if [ -n "$2" ]; then FORBID="$FORBID$2
"; fi; shift 2 ;;
    --reason) [ $# -ge 2 ] || die "--reason needs a value"; REASON=$2; shift 2 ;;
    --from) [ $# -ge 2 ] || die "--from needs a value"; FROM=$2; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) NPOS=$((NPOS + 1)); if [ "$NPOS" -eq 1 ]; then POS=$1; else POS="$POS $1"; fi; shift ;;
  esac
done

[ -n "$SID" ] || SID=${CLAUDE_SESSION_ID:-}
case "$SID" in *[!A-Za-z0-9_-]*) die "bad session id" ;; esac
SID8=$(printf '%s' "$SID" | cut -c1-8)

if ROOT=$(git rev-parse --show-toplevel 2>/dev/null) && [ -n "$ROOT" ]; then :; else ROOT=$(pwd); fi

# Add `night/` to .git/info/exclude once (never .gitignore); nothing to do outside a git repository.
ns_exclude() {
  git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || return 0
  _p=$(git -C "$ROOT" rev-parse --git-path info/exclude 2>/dev/null) || return 0
  case "$_p" in /*) ;; *) _p="$ROOT/$_p" ;; esac
  mkdir -p "$(dirname "$_p")" 2>/dev/null || return 0
  grep -qxE '/?night/?' "$_p" 2>/dev/null && return 0
  if [ -s "$_p" ] && [ "$(tail -c 1 "$_p" | wc -l | tr -d ' ')" = 0 ]; then printf '\n' >> "$_p"; fi
  printf 'night/\n' >> "$_p"
  return 0
}

# The night folder this call is about: the session's folder in this repo, else its pointer, else the one running night here.
ns_dir() {
  if [ -n "$SID" ]; then
    if [ -f "$ROOT/night/$SID8/state.json" ] && [ "$(nl_get "$ROOT/night/$SID8" .session)" = "$SID" ]; then _r="$ROOT/night/$SID8"; else _r=$(nl_dir_of "$SID"); fi
    printf '%s\n' "$_r"
    return 0
  fi
  _r=""; _n=0
  for _s in "$ROOT"/night/*/state.json; do
    [ -f "$_s" ] || continue
    case "$(nl_get "$(dirname "$_s")" .status)" in opening|armed|wrapup) _r=$(dirname "$_s"); _n=$((_n + 1)) ;; esac
  done
  [ "$_n" -eq 1 ] && printf '%s\n' "$_r"
  return 0
}

need_dir() {
  DIR=$(ns_dir)
  [ -n "$DIR" ] || die "no night found for this session; run open or arm first (pass --session <id>)"
}

# Without the pointer no hook sees the night (it would only look armed): a missing data folder or a failed write is fatal.
ns_pointer() { # <session id> <dir>
  [ -n "${CLAUDE_PLUGIN_DATA:-}" ] || die "CLAUDE_PLUGIN_DATA is not set: the hooks could not see this night. Run it as CLAUDE_PLUGIN_DATA=<plugin data folder> night-state.sh ... (the crew-night skill does)."
  mkdir -p "$CLAUDE_PLUGIN_DATA/night" 2>/dev/null || die "cannot create $CLAUDE_PLUGIN_DATA/night"
  { printf '%s\n' "$2" > "$CLAUDE_PLUGIN_DATA/night/$1.$$" && mv "$CLAUDE_PLUGIN_DATA/night/$1.$$" "$CLAUDE_PLUGIN_DATA/night/$1"; } 2>/dev/null || die "cannot write the night pointer in $CLAUDE_PLUGIN_DATA/night"
}

# ns_open_state: create the folder, pointer, exclude line and a state in status opening.
ns_open_state() {
  nl_cleanup "$ROOT"
  ns_exclude
  DIR="$ROOT/night/$SID8"
  mkdir -p "$DIR" || die "cannot create $DIR"
  _now=$(nl_now)
  _sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)
  _tmp="$DIR/state.json.$$"
  jq -n --arg session "$SID" --arg sid8 "$SID8" --arg root "$ROOT" --arg dir "$DIR" --arg sha "$_sha" --argjson now "$_now" '{
    status: "opening", session: $session, sid8: $sid8, root: $root, dir: $dir, started: $now, deadline: 0, softWrap: 0,
    git: "commit-per-task", forbidden: [], blocks: 0, noProgress: 0, lastSig: "", current: {id: "", since: 0},
    spawned: 0, reason: "", caffeinatePid: 0, startSha: $sha, reportDone: false, dryRun: false, ended: 0
  }' > "$_tmp" && mv "$_tmp" "$DIR/state.json" || { rm -f "$_tmp"; die "cannot write state.json"; }
  ns_pointer "$SID" "$DIR"
  nl_summary "$ROOT"
}

fmt_local() { nl_fmt "$1" '%Y-%m-%d %H:%M %Z'; }

case "$cmd" in
  open)
    [ -n "$SID" ] || die "open needs --session <id>"
    DIR=$(ns_dir)
    if [ -n "$DIR" ]; then
      case "$(nl_get "$DIR" .status)" in
        opening) echo "night already opening: $DIR"; exit 0 ;;
        armed|wrapup) die "a night is already running for this session" ;;
      esac
    fi
    ns_open_state
    nl_event "$DIR" night "opening: interview started"
    echo "night opening: $DIR"
    ;;

  arm)
    [ -n "$SID" ] || die "arm needs --session <id>"
    now=$(nl_now)
    wrap=$(nl_default wrapMin 30)
    if [ "$DRY" = 1 ]; then
      deadline=$((now + 1200)); softwrap=$((now + 900))
    else
      if [ -n "$UNTIL" ] && [ -n "$HOURS" ]; then die "use --until or --hours, not both"; fi
      if [ -n "$UNTIL" ]; then
        printf '%s' "$UNTIL" | grep -qE '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' || die "--until wants HH:MM (24 hour clock)"
        cur=$(nl_fmt "$now" '%H %M %S') || die "cannot read the clock"
        delta=$(awk -v c="$cur" -v t="$UNTIL" 'BEGIN { split(c, a, " "); split(t, b, ":"); d = (b[1] * 3600 + b[2] * 60) - (a[1] * 3600 + a[2] * 60 + a[3]); if (d <= 0) d += 86400; print d }')
      elif [ -n "$HOURS" ]; then
        printf '%s' "$HOURS" | grep -qE '^[0-9]+(\.[0-9]+)?$' || die "--hours wants a number"
        delta=$(awk -v h="$HOURS" 'BEGIN { if (h > 0 && h <= 24) printf "%d", h * 3600; else print 0 }')
        [ "$delta" -gt 0 ] || die "--hours must be above 0 and at most 24"
      else
        die "arm needs --until HH:MM or --hours N (or --dry-run)"
      fi
      [ "$delta" -ge 60 ] || die "the deadline is less than a minute away"
      deadline=$((now + delta))
      softwrap=$((deadline - wrap * 60))
      [ "$softwrap" -ge "$now" ] || softwrap=$now
    fi
    case "$GITP" in
      ''|commit-per-task|none) ;;
      branch:*) printf '%s' "${GITP#branch:}" | grep -qE '^[A-Za-z0-9._/-]+$' || die "bad branch name in --git" ;;
      *) die "--git wants commit-per-task, none or branch:<name>" ;;
    esac
    # Outward actions tonight (push, deploy, CI, server writes): closed = denied by the night guard (default);
    # open = allowed, each one logged, the command guard's first-attempt stop still applies (user, 2026-11-21).
    case "$OUTWARD" in ''|closed) OUTWARD=closed ;; open) ;; *) die "--outward wants open or closed" ;; esac

    DIR=$(ns_dir)
    if [ -n "$DIR" ]; then
      case "$(nl_get "$DIR" .status)" in
        armed|wrapup) die "this session already has a running night (use resume after a stop; the deadline is never extended)" ;;
        opening) nl_cleanup "$ROOT"; ns_exclude ;;
        *) ns_open_state ;;
      esac
    else
      ns_open_state
    fi
    [ -n "$GITP" ] || GITP=$(nl_get "$DIR" .git)
    forb=$(printf '%s' "$FORBID" | jq -R -s -c 'split("\n") | map(select(length > 0))')
    sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)
    pid=$(nl_caff_start $((deadline - now + 600)))
    nl_update "$DIR" '.status = "armed" | .started = $now | .deadline = $dl | .softWrap = $sw | .git = $git | .outward = $outward | .forbidden = $forb
      | .startSha = $sha | .dryRun = $dry | .blocks = 0 | .noProgress = 0 | .lastSig = "" | .spawned = 0 | .reason = ""
      | .ended = 0 | .reportDone = false | .caffeinatePid = ($pid | tonumber? // 0) | .current = {id: "", since: 0}' \
      --argjson now "$now" --argjson dl "$deadline" --argjson sw "$softwrap" --arg git "$GITP" --arg outward "$OUTWARD" --argjson forb "$forb" \
      --arg sha "$sha" --argjson dry "$([ "$DRY" = 1 ] && echo true || echo false)" --arg pid "${pid:-0}" \
      || die "cannot write state.json"
    ns_pointer "$SID" "$DIR"
    nl_summary "$ROOT"
    nl_event "$DIR" night "armed: deadline $(fmt_local "$deadline"), git $GITP, outward $OUTWARD$([ "$DRY" = 1 ] && echo ', dry run')"
    echo "night armed: $DIR"
    echo "deadline: $(fmt_local "$deadline") (epoch $deadline); wrap-up from $(fmt_local "$softwrap")"
    echo "git: $GITP; forbidden: $(printf '%s' "$forb" | jq -r 'if length == 0 then "none" else join(", ") end')"
    [ -n "$pid" ] && [ "$pid" != 0 ] && echo "caffeinate: pid $pid keeps the machine awake until 10 min after the deadline"
    ;;

  resume)
    [ -n "$SID" ] || die "resume needs --session <id>"
    now=$(nl_now)
    DIR=$(ns_dir)
    if [ -z "$DIR" ]; then
      if [ -n "$FROM" ]; then
        printf '%s' "$FROM" | grep -qE '^[A-Za-z0-9_-]+$' || die "bad --from"
        [ -f "$ROOT/night/$FROM/state.json" ] || die "no night folder night/$FROM"
        DIR="$ROOT/night/$FROM"
      else
        n=0
        for s in "$ROOT"/night/*/state.json; do
          [ -f "$s" ] || continue
          d=$(dirname "$s")
          case "$(nl_get "$d" .status)" in armed|wrapup|stalled|stopped) ;; *) continue ;; esac
          [ "$(nl_get "$d" .deadline)" -gt "$now" ] 2>/dev/null || continue
          DIR=$d; n=$((n + 1))
        done
        [ "$n" -ge 1 ] || die "no night to resume here (none is unfinished before its deadline)"
        [ "$n" -eq 1 ] || die "several nights can be resumed here; pass --from <sid8> (see night/SUMMARY.md)"
      fi
    fi
    status=$(nl_get "$DIR" .status)
    case "$status" in armed|wrapup|stalled|stopped) ;; opening) die "this night is still opening; use arm" ;; *) die "this night is $status; nothing to resume" ;; esac
    deadline=$(nl_get "$DIR" .deadline); softwrap=$(nl_get "$DIR" .softWrap)
    [ "$deadline" -gt "$now" ] 2>/dev/null || die "the original deadline has passed ($(fmt_local "${deadline:-0}")); it is never extended"
    new=armed; [ "$now" -ge "$softwrap" ] && new=wrapup
    oldsession=$(nl_get "$DIR" .session)
    nl_caff_stop "$(nl_get "$DIR" .caffeinatePid)"
    pid=$(nl_caff_start $((deadline - now + 600)))
    nl_update "$DIR" '.status = $st | .session = $session | .blocks = 0 | .noProgress = 0 | .lastSig = "" | .reason = "" | .ended = 0
      | .reportDone = false | .caffeinatePid = ($pid | tonumber? // 0)' \
      --arg st "$new" --arg session "$SID" --arg pid "${pid:-0}" || die "cannot write state.json"
    if [ -n "$oldsession" ] && [ "$oldsession" != "$SID" ] && [ -n "${CLAUDE_PLUGIN_DATA:-}" ]; then rm -f "$CLAUDE_PLUGIN_DATA/night/$oldsession"; fi
    ns_pointer "$SID" "$DIR"
    nl_summary "$(nl_get "$DIR" .root)"
    nl_event "$DIR" night "resumed ($status -> $new), original deadline $(fmt_local "$deadline")"
    echo "night resumed: $DIR; deadline stays $(fmt_local "$deadline") (epoch $deadline)"
    ;;

  get)
    DIR=$(ns_dir)
    [ -n "$DIR" ] || exit 0
    if [ -n "$POS" ]; then
      printf '%s' "$POS" | grep -qE '^[A-Za-z0-9_.]+$' || die "bad field name"
      jq -r ".$POS as \$v | if \$v == null then empty elif (\$v | type) == \"object\" or (\$v | type) == \"array\" then (\$v | tojson) else (\$v | tostring) end" "$DIR/state.json" 2>/dev/null || true
    else
      cat "$DIR/state.json"
    fi
    ;;

  phase)
    case "$POS" in
      opening)
        DIR=$(ns_dir)
        if [ -z "$DIR" ]; then
          [ -n "$SID" ] || die "phase opening needs --session <id>"
          ns_open_state; echo "night opening: $DIR"; exit 0
        fi
        [ "$(nl_get "$DIR" .status)" = opening ] || die "cannot go back to opening"
        ;;
      armed|wrapup)
        need_dir
        case "$(nl_get "$DIR" .status)" in
          armed|wrapup) ;;
          opening) die "the night is not armed yet: run arm first" ;;
          *) die "the night is already over" ;;
        esac
        nl_update "$DIR" '.status = $p | .reason = (if ($r | length) > 0 then $r else .reason end)' --arg p "$POS" --arg r "$REASON" || die "cannot write state.json"
        nl_event "$DIR" night "phase $POS${REASON:+ ($REASON)}"
        ;;
      *) die "phase wants opening, armed or wrapup" ;;
    esac
    ;;

  task)
    [ -n "$POS" ] || die "task needs an id"
    need_dir
    nl_update "$DIR" 'if .current.id == $id then . else .current = {id: $id, since: ($n | tonumber)} end' --arg id "$POS" --arg n "$(nl_now)" || die "cannot write state.json"
    ;;

  done)
    need_dir
    status=$(nl_get "$DIR" .status)
    case "$status" in armed|wrapup) ;; opening) die "the night is not armed; use stop" ;; *) echo "night already $status"; exit 0 ;; esac
    now=$(nl_now)
    r=$(nl_get "$DIR" .reason)
    if [ "$now" -ge "$(nl_get "$DIR" .deadline)" ]; then r=deadline; elif [ -z "$r" ]; then r=early; fi
    nl_finish "$DIR" done "$r"
    echo "night done ($r): $DIR/REPORT.md"
    ;;

  stop)
    need_dir
    status=$(nl_get "$DIR" .status)
    case "$status" in opening|armed|wrapup) ;; *) echo "night already $status"; exit 0 ;; esac
    [ -n "$REASON" ] || REASON=off
    if [ "$status" = opening ]; then
      nl_update "$DIR" '.status = "stopped" | .reason = $r | .ended = ($n | tonumber)' --arg r "$REASON" --arg n "$(nl_now)" || die "cannot write state.json"
      nl_summary "$(nl_get "$DIR" .root)"
      nl_event "$DIR" night "stopped while opening ($REASON)"
    else
      nl_finish "$DIR" stopped "$REASON"
    fi
    echo "night stopped ($REASON): $DIR"
    ;;

  report-fallback)
    need_dir
    nl_report_fallback "$DIR"
    echo "$DIR/REPORT.md"
    ;;

  event)
    [ -n "$POS" ] || exit 0
    DIR=$(ns_dir)
    [ -n "$DIR" ] || exit 0
    src=${POS%% *}
    txt=""; [ "$src" != "$POS" ] && txt=${POS#* }
    nl_event "$DIR" "$src" "$txt"
    ;;

  cleanup)
    nl_cleanup "$ROOT"
    ;;

  *) die "unknown subcommand: $cmd" ;;
esac
exit 0
