// Night mode (/crew-chief:crew-night), the mod's side (hooks/src/night.js). Pure functions, no Claude Code API,
// so tests/night-logic.test.mjs can run them with plain Node.
//
// The shell owns the night: scripts/night-state.sh is the only writer of night/<sid8>/state.json. The mod only
// reads it, and while a night is open it keeps crew-chief's own questions quiet, closes the opening interview's
// unanswered questions after night.ask minutes, wakes an idle session, starts the wrap-up at the limit, and writes
// one line per thing it decided by itself into events.log. Epochs in state.json are seconds; the mod's clock is ms.

// data/night-defaults.json; these values stand in when it is missing or a number in it is not usable.
export const NIGHT_DEFAULTS = Object.freeze({
  attempts: 3,
  parkPct: 40,
  maxAgents: 20,
  wrapMin: 30,
  askMin: 20,
  stallBlocks: 3,
  limitPct: 95,
  keepDays: 7,
  keepReportDays: 30,
})

export const NIGHT_STATUSES = ['opening', 'armed', 'wrapup', 'done', 'stalled', 'stopped']
// crew-chief's own questions stay quiet while the night is open (the opening interview included).
const QUIET = new Set(['opening', 'armed', 'wrapup'])
// The night is working: the watchdog, the limit stop and the compaction wake apply.
const ARMED = new Set(['armed', 'wrapup'])

export const NIGHT_HOLD_AHEAD_SEC = 600
export const NIGHT_FALLBACK_GRACE_MS = 2 * 60_000
export const NIGHT_IDLE_MS = 4 * 60_000
export const NIGHT_NUDGES_PER_HOUR = 6
// A turn that showed no sign of life for this long is not "in flight" any more (a lost turn.complete).
export const NIGHT_STALE_TURN_MS = 30 * 60_000

// The defaults file's text -> the numbers in force. Only a positive finite number replaces a default.
export function nightDefaults(text) {
  const out = { ...NIGHT_DEFAULTS }
  let parsed
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : undefined
  } catch (err) {
    parsed = undefined
  }
  if (parsed && typeof parsed === 'object') {
    for (const key of Object.keys(NIGHT_DEFAULTS)) {
      const v = parsed[key]
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[key] = v
    }
  }
  return out
}

// state.json's text -> the object, or undefined when it is not a night state (garbage, no known status).
export function parseNightState(text) {
  if (typeof text !== 'string' || text.trim() === '') return undefined
  let s
  try {
    s = JSON.parse(text)
  } catch (err) {
    return undefined
  }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return undefined
  if (!NIGHT_STATUSES.includes(s.status)) return undefined
  return s
}

export function nightQuietStatus(status) {
  return QUIET.has(status)
}

export function nightArmedStatus(status) {
  return ARMED.has(status)
}

export function nightOverStatus(status) {
  return status === 'done' || status === 'stalled' || status === 'stopped'
}

// The answer an unanswered opening question gets (user decision: the item is parked, never guessed).
export function nightNoAnswerLabel(min) {
  return `NO_ANSWER: nobody answered within ${min} minutes; park it in QUESTIONS.md and continue`
}

// The 5-hour window or the weekly limit at or past `pct` percent: { kind, percent } of the fullest, or undefined.
// Other windows (a gateway's spend limit) are not limits the user asked to stop at.
export function nightLimitHit(rateLimits, pct) {
  if (!Array.isArray(rateLimits) || typeof pct !== 'number') return undefined
  let best
  for (const w of rateLimits) {
    if (!w || (w.kind !== 'five_hour' && w.kind !== 'seven_day')) continue
    if (typeof w.percentUsed !== 'number' || !Number.isFinite(w.percentUsed) || w.percentUsed < pct) continue
    if (best === undefined || w.percentUsed > best.percent) best = { kind: w.kind, percent: w.percentUsed }
  }
  return best
}

// The nudges sent in the last hour; a new one is allowed while fewer than NIGHT_NUDGES_PER_HOUR.
export function nightRecentNudges(times, nowMs) {
  return (Array.isArray(times) ? times : []).filter((t) => typeof t === 'number' && nowMs - t < 3_600_000)
}

export function nightNudgeAllowed(times, nowMs) {
  return nightRecentNudges(times, nowMs).length < NIGHT_NUDGES_PER_HOUR
}

// The watchdog's decision for one tick: 'fallback' (run report-fallback), 'nudge' (resume prompt) or 'none'.
//   status, deadline (s): from state.json; reportDone: state.reportDone; fallbackDone: the mod already ran it;
//   inFlight / lastActivityMs: the main loop; compactBusy: a compaction question, plan or run is under way;
//   agentsRunning: subagents still at work (their results wake the session by themselves).
export function nightWatchdogAction(o) {
  if (!o || !ARMED.has(o.status)) return 'none'
  const now = o.nowMs
  const busy = o.inFlight && now - o.lastActivityMs < NIGHT_STALE_TURN_MS
  const deadlineMs = typeof o.deadline === 'number' ? o.deadline * 1000 : undefined
  if (deadlineMs !== undefined && now >= deadlineMs) {
    if (now >= deadlineMs + NIGHT_FALLBACK_GRACE_MS && !o.reportDone && !o.fallbackDone && !busy) return 'fallback'
    return 'none' // past the deadline the Stop hook owns the end
  }
  if (busy || o.compactBusy || (o.agentsRunning ?? 0) > 0) return 'none'
  return now - o.lastActivityMs >= (o.idleMs ?? NIGHT_IDLE_MS) ? 'nudge' : 'none'
}

// "2h 05m", "12m", "0m".
export function nightLeft(ms) {
  const min = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

function folderOf(state, dir) {
  return typeof state?.dir === 'string' && state.dir !== '' ? state.dir : dir || 'night/'
}

// The resume prompt the watchdog and the compaction wake submit. Never starts with "/" ($.prompt.submit refuses it).
export function nightNudgeText(state, nowMs, reason, dir) {
  const folder = folderOf(state, dir)
  const left = typeof state?.deadline === 'number' ? nightLeft(state.deadline * 1000 - nowMs) : '?'
  const why = reason === 'compaction' ? 'the conversation was just compacted; ' : 'the session went idle; '
  const what =
    state?.status === 'wrapup'
      ? 'It is the wrap-up phase: finish the current task, start nothing new, write REPORT.md from the template and run night-state.sh done.'
      : 'Continue with the next task.'
  return `crew-chief night: ${why}the night is still running, ${left} left. Read ${folder}/NIGHT.md and tasks.json. ${what}`
}

// One events.log line: "<ISO time> mod <text>", on one line.
export function nightEventLine(nowMs, text) {
  const iso = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `${iso} mod ${String(text).replace(/\s+/g, ' ').trim()}`
}

// The hold file's one line: an epoch (s) NIGHT_HOLD_AHEAD_SEC ahead.
export function nightHoldText(nowMs) {
  return `${Math.floor(nowMs / 1000) + NIGHT_HOLD_AHEAD_SEC}\n`
}

function clockOf(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// /night status.
export function nightStatusText(state, nowMs, defaults, dir) {
  const d = defaults ?? NIGHT_DEFAULTS
  const parts = [`crew-chief night: ${state.status}${state.dryRun ? ' (dry run)' : ''}`]
  if (typeof state.deadline === 'number') {
    const ms = state.deadline * 1000
    parts.push(nowMs < ms ? `${nightLeft(ms - nowMs)} left (until ${clockOf(ms)})` : `deadline passed at ${clockOf(ms)}`)
  }
  if (typeof state.softWrap === 'number' && state.status === 'armed' && nowMs < state.softWrap * 1000) parts.push(`wrap-up at ${clockOf(state.softWrap * 1000)}`)
  const cur = state.current
  if (cur && typeof cur.id === 'string' && cur.id !== '') {
    parts.push(`task ${cur.id}` + (typeof cur.since === 'number' ? ` for ${nightLeft(nowMs - cur.since * 1000)}` : ''))
  } else {
    parts.push('no current task')
  }
  parts.push(`stop blocks ${Number(state.blocks) || 0}`)
  parts.push(`no-progress ${Number(state.noProgress) || 0}/${d.stallBlocks}`)
  parts.push(`subagents ${Number(state.spawned) || 0}/${d.maxAgents}`)
  if (typeof state.reason === 'string' && state.reason !== '') parts.push(`reason: ${state.reason}`)
  return parts.join(' · ') + `\nfolder: ${folderOf(state, dir)}`
}

// Toasts, in the two languages the rest of the mod speaks.
const TEXT = {
  en: {
    ask_expired: 'Night: no answer for {min} min. Claude parks the question and goes on.',
    off: 'Night mode is off.',
    over: 'Night over: report at {path}',
    limit: 'Night: {window} limit at {percent}%, wrapping up.',
  },
  tr: {
    ask_expired: 'Gece: {min} dk cevap yok. Claude soruyu bekletmeye alıp devam ediyor.',
    off: 'Gece modu kapatıldı.',
    over: 'Gece bitti: rapor {path}',
    limit: 'Gece: {window} limiti %{percent}, toparlama başladı.',
  },
}

const WINDOW = {
  en: { five_hour: '5-hour', seven_day: 'weekly' },
  tr: { five_hour: '5 saatlik', seven_day: 'haftalık' },
}

export function nightText(lang, key, vars = {}) {
  const table = TEXT[lang] ?? TEXT.en
  const text = table[key] ?? TEXT.en[key] ?? key
  return text.replace(/\{(\w+)\}/g, (m, name) => (name === 'window' ? (WINDOW[lang] ?? WINDOW.en)[vars.window] ?? String(vars.window) : name in vars ? String(vars[name]) : m))
}
