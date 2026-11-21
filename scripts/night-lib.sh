#!/bin/sh
# crew-chief night mode: shared helpers, sourced by night-state.sh, night-stop.sh and night-guard.sh. POSIX sh.
# Needs jq for everything that touches state.json; the hooks check for jq before they source this file.
#
# Layout: <git root>/night/<sid8>/ holds state.json (written only through nl_update / night-state.sh), NIGHT.md,
# QUESTIONS.md, DECISIONS.md, REPORT.md, events.log, hold. A pointer file ${CLAUDE_PLUGIN_DATA}/night/<session id>
# holds the absolute path of that folder, so a hook of any other session stops after one `[ -f ]`.
# CREW_CHIEF_NOW (epoch seconds) replaces the clock; it exists for the tests.

NL_HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
NL_DEFAULTS="$NL_HERE/../data/night-defaults.json"

nl_now() {
  case "${CREW_CHIEF_NOW:-}" in
    ''|*[!0-9]*) date +%s ;;
    *) printf '%s\n' "$CREW_CHIEF_NOW" ;;
  esac
}

# nl_fmt <epoch> <date format> [-u]: GNU date wants -d @N, BSD date wants -r N.
nl_fmt() {
  date $3 -d "@$1" +"$2" 2>/dev/null || date $3 -r "$1" +"$2" 2>/dev/null
}

nl_iso() { nl_fmt "$1" '%Y-%m-%dT%H:%M:%SZ' -u; }

# nl_mtime <file>: epoch of the last change, 0 when the file is missing. GNU stat first: BSD has no -c.
nl_mtime() {
  [ -e "$1" ] || { echo 0; return; }
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

# nl_default <key> <fallback>
nl_default() {
  _v=$(jq -r ".$1 // empty" "$NL_DEFAULTS" 2>/dev/null)
  case "$_v" in ''|*[!0-9]*) _v=$2 ;; esac
  printf '%s\n' "$_v"
}

# nl_quick_sid: first "session_id" in the hook input, found without jq. Callers verify it with jq afterwards.
nl_quick_sid() {
  printf '%s' "$1" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]+"' | head -n 1 | sed -E 's/.*"([A-Za-z0-9_-]+)"$/\1/'
}

# nl_dir_of <session id>: the night folder of that session, empty when it has none.
nl_dir_of() {
  case "$1" in ''|*[!A-Za-z0-9_-]*) return 0 ;; esac
  [ -n "${CLAUDE_PLUGIN_DATA:-}" ] || return 0
  [ -f "$CLAUDE_PLUGIN_DATA/night/$1" ] || return 0
  _d=$(head -n 1 "$CLAUDE_PLUGIN_DATA/night/$1" 2>/dev/null)
  [ -n "$_d" ] && [ -f "$_d/state.json" ] && printf '%s\n' "$_d"
  return 0
}

nl_get() { jq -r "$2 // empty" "$1/state.json" 2>/dev/null; }

nl_lock() {
  _i=0
  while ! mkdir "$1/.lock" 2>/dev/null; do
    _i=$((_i + 1))
    if [ "$_i" -gt 30 ]; then rmdir "$1/.lock" 2>/dev/null; mkdir "$1/.lock" 2>/dev/null; break; fi
    sleep 0.1
  done
}
nl_unlock() { rmdir "$1/.lock" 2>/dev/null; }

# nl_update <dir> <jq filter> [jq args...]: read-modify-write state.json under a lock, atomic mv.
nl_update() {
  _ud=$1; _uf=$2; shift 2
  nl_lock "$_ud"
  _ut="$_ud/state.json.$$"
  if jq "$@" "$_uf" "$_ud/state.json" > "$_ut" 2>/dev/null && [ -s "$_ut" ]; then
    mv "$_ut" "$_ud/state.json"; _urc=0
  else
    rm -f "$_ut"; _urc=1
  fi
  nl_unlock "$_ud"
  return $_urc
}

# nl_event <dir> <source> <text>: one line in events.log, append only.
nl_event() {
  _t=$(printf '%s' "$3" | tr '\n\r' '  ')
  printf '%s %s %s\n' "$(nl_iso "$(nl_now)")" "$2" "$_t" >> "$1/events.log" 2>/dev/null
  return 0
}

# nl_caff_start <seconds>: prints the pid of a background caffeinate, nothing when there is no caffeinate.
# Started in a session of its own (setsid through perl, which macOS ships) with no stdin/stdout/stderr, so the Bash tool
# that ran `arm` does not wait for it (seen live 2026-11-21: arm hung 120 s and went to the background). The pid stays the
# caffeinate pid (exec).
nl_caff_start() {
  command -v caffeinate >/dev/null 2>&1 || return 0
  if command -v perl >/dev/null 2>&1; then
    ( perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' caffeinate -i -t "$1" </dev/null >/dev/null 2>&1 & echo $! )
  else
    ( caffeinate -i -t "$1" </dev/null >/dev/null 2>&1 & echo $! )
  fi
}

# nl_caff_stop <pid>: only kills a pid that is still a caffeinate process.
nl_caff_stop() {
  case "$1" in ''|0|*[!0-9]*) return 0 ;; esac
  ps -p "$1" -o command= 2>/dev/null | grep -q caffeinate && kill "$1" 2>/dev/null
  return 0
}

# nl_summary <root>: night/SUMMARY.md, a short index across the sessions of this repo.
nl_summary() {
  _nd="$1/night"
  [ -d "$_nd" ] || return 0
  _st="$_nd/SUMMARY.md.$$"
  {
    printf '# Nights in this repo (updated %s)\n\n' "$(nl_fmt "$(nl_now)" '%Y-%m-%d %H:%M')"
    for _s in "$_nd"/*/state.json; do
      [ -f "$_s" ] || continue
      _sd=$(dirname "$_s")
      _row=$(jq -r '[.sid8, .status, (.reason // ""), (.deadline // 0)] | @tsv' "$_s" 2>/dev/null) || continue
      [ -n "$_row" ] || continue
      _sid=$(printf '%s' "$_row" | cut -f1); _stat=$(printf '%s' "$_row" | cut -f2)
      _rs=$(printf '%s' "$_row" | cut -f3); _dl=$(printf '%s' "$_row" | cut -f4)
      _line="- $_sid: $_stat"
      [ -n "$_rs" ] && _line="$_line ($_rs)"
      case "$_dl" in ''|0|*[!0-9]*) ;; *) _line="$_line, deadline $(nl_fmt "$_dl" '%Y-%m-%d %H:%M')" ;; esac
      [ -f "$_sd/REPORT.md" ] && _line="$_line, report: night/$_sid/REPORT.md"
      printf '%s\n' "$_line"
    done
  } > "$_st" 2>/dev/null && mv "$_st" "$_nd/SUMMARY.md" 2>/dev/null || rm -f "$_st"
  return 0
}

# nl_report_fallback <dir>: a script-made REPORT.md when the agent wrote none (missing or older than the night).
nl_report_fallback() {
  _d=$1
  _started=$(nl_get "$_d" .started); _started=${_started:-0}
  if [ -f "$_d/REPORT.md" ] && [ "$(nl_mtime "$_d/REPORT.md")" -ge "$_started" ]; then
    return 0
  fi
  _root=$(nl_get "$_d" .root); _sha=$(nl_get "$_d" .startSha)
  _status=$(nl_get "$_d" .status); _reason=$(nl_get "$_d" .reason); _ended=$(nl_get "$_d" .ended)
  _sid8=$(nl_get "$_d" .sid8)
  [ -n "$_ended" ] && [ "$_ended" != 0 ] || _ended=$(nl_now)
  case "$_status:$_reason" in
    stalled:*) _v="ended: stalled at $(nl_fmt "$_ended" '%H:%M'): the session kept stopping without any change" ;;
    *:limit) _v="ended early at $(nl_fmt "$_ended" '%H:%M'): usage limit" ;;
    stopped:*) _v="ended at $(nl_fmt "$_ended" '%H:%M'): stopped by the user" ;;
    *:early) _v="finished early at $(nl_fmt "$_ended" '%H:%M')" ;;
    *) _v="ended at the deadline, $(nl_fmt "$_ended" '%H:%M')" ;;
  esac
  _rt="$_d/REPORT.md.$$"
  {
    printf 'AUTO-GENERATED: the agent wrote no report\n\n'
    printf '# Night report %s\n\nVerdict: %s (status %s).\n\n' "$_sid8" "$_v" "$_status"
    printf '## NEEDS YOU\n\n'
    if [ -s "$_d/QUESTIONS.md" ]; then cat "$_d/QUESTIONS.md"; else printf 'No questions were recorded.\n'; fi
    printf '\n## Done\n\n'
    if [ -n "$_sha" ] && [ -n "$_root" ]; then
      _log=$(git -C "$_root" log --oneline "$_sha..HEAD" 2>/dev/null | head -50)
      if [ -n "$_log" ]; then printf 'Commits since the start (%s):\n\n%s\n' "$_sha" "$_log"; else printf 'No commits since the start (%s).\n' "$_sha"; fi
    else
      printf 'Not a git repository or no start commit: no commit list.\n'
    fi
    printf '\n## Decided without asking\n\n'
    if [ -s "$_d/DECISIONS.md" ]; then cat "$_d/DECISIONS.md"; else printf 'DECISIONS.md is empty.\n'; fi
    if [ -s "$_d/events.log" ]; then
      _ev=$(grep -E ' (mod|guard|plugin|compact|saver) ' "$_d/events.log" 2>/dev/null | tail -30)
      [ -n "$_ev" ] && printf '\nWhat the plugin decided by itself (night/%s/events.log):\n\n%s\n' "$_sid8" "$_ev"
    fi
    printf '\n## Not done and why\n\n'
    _open=""
    [ -n "$_root" ] && [ -f "$_root/tasks.json" ] && _open=$(jq -r '.tasks[]? | select(.status != "done") | "- \(.id): \(.title) [\(.status)]"' "$_root/tasks.json" 2>/dev/null | head -30)
    if [ -n "$_open" ]; then printf 'Tasks not marked done in tasks.json:\n\n%s\n' "$_open"; else printf 'No open tasks found in tasks.json.\n'; fi
    printf '\n## How to undo\n\n'
    if [ -n "$_sha" ]; then printf 'The repository was at %s when the night started: `git log %s..HEAD` lists everything done since. Nothing was pushed.\n' "$_sha" "$_sha"; else printf 'Nothing was pushed.\n'; fi
  } > "$_rt" 2>/dev/null && mv "$_rt" "$_d/REPORT.md" || rm -f "$_rt"
  nl_event "$_d" night "report-fallback: REPORT.md was script-made"
  return 0
}

# nl_finish <dir> <status: done|stalled|stopped> <reason>: close a night: state, report, caffeinate, summary.
nl_finish() {
  _d=$1
  _pid=$(nl_get "$_d" .caffeinatePid)
  nl_update "$_d" '.status = $s | .reason = $r | .ended = ($n | tonumber) | .caffeinatePid = 0 | .reportDone = true' \
    --arg s "$2" --arg r "$3" --arg n "$(nl_now)"
  nl_report_fallback "$_d"
  nl_caff_stop "$_pid"
  nl_summary "$(nl_get "$_d" .root)"
  nl_event "$_d" night "night ended: $2 ($3)"
  return 0
}

# nl_cleanup <root>: finished nights lose their working files after keepDays and the report after keepReportDays.
# Only ever touches fixed file names inside <root>/night/<folder>/; never an opening, armed or wrapup night.
nl_cleanup() {
  _nd="$1/night"
  [ -d "$_nd" ] || return 0
  _now=$(date +%s)  # real clock: it is compared with file mtimes, which are real
  _keep=$(( $(nl_default keepDays 7) * 86400 )); _keepr=$(( $(nl_default keepReportDays 30) * 86400 ))
  _changed=0
  for _d in "$_nd"/*/; do
    _d=${_d%/}
    [ -d "$_d" ] && [ ! -L "$_d" ] || continue
    if [ -f "$_d/state.json" ]; then
      case "$(nl_get "$_d" .status)" in done|stalled|stopped) ;; *) continue ;; esac
      if [ $((_now - $(nl_mtime "$_d/state.json"))) -gt "$_keep" ]; then
        rm -f "$_d/state.json" "$_d/NIGHT.md" "$_d/QUESTIONS.md" "$_d/events.log" "$_d/hold"; _changed=1
      fi
    fi
    [ -f "$_d/state.json" ] && continue
    # No state.json left: the folder holds only the report files (and maybe leftovers). Age them by their own mtime.
    _newest=0
    for _f in REPORT.md DECISIONS.md; do
      [ -f "$_d/$_f" ] && [ "$(nl_mtime "$_d/$_f")" -gt "$_newest" ] && _newest=$(nl_mtime "$_d/$_f")
    done
    if [ "$_newest" -eq 0 ] || [ $((_now - _newest)) -gt "$_keepr" ]; then
      rm -f "$_d/REPORT.md" "$_d/DECISIONS.md"; rmdir "$_d" 2>/dev/null; _changed=1
    fi
  done
  [ "$_changed" = 1 ] && nl_summary "$1"
  # Pointers of long-gone sessions (a night lasts one day at most).
  if [ -n "${CLAUDE_PLUGIN_DATA:-}" ] && [ -d "$CLAUDE_PLUGIN_DATA/night" ]; then
    find "$CLAUDE_PLUGIN_DATA/night" -maxdepth 1 -type f -mtime +"$(nl_default keepReportDays 30)" -delete 2>/dev/null
  fi
  return 0
}
