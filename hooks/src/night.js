// Night mode, the mod's side. Part of the mod in hooks/register.js (rules in hooks/night-logic.mjs).
//
// A night is opened by the crew-night skill and run by the shell: scripts/night-state.sh alone writes
// <git root>/night/<sid8>/state.json, and the pointer ${CLAUDE_PLUGIN_DATA}/night/<session id> names that folder.
// No pointer: no night, and this file does nothing beyond one fs.exists. With a night open (status opening, armed
// or wrapup) the mod:
//   - answers crew-chief's own questions by itself (askWithDeadline -> nightQuietAnswer): compaction yes, plain
//     saver (never ultra), everything else its safe "no"; the advisor and handoff offers are not made at all;
//   - in the opening phase only, closes Claude's own AskUserQuestion after night.ask minutes (default 20) with a
//     NO_ANSWER label (nightOpeningDeadline, used by hooks/src/ask.js);
//   - keeps night/<sid8>/hold fresh while a compaction is under way, so the Stop hook lets that turn end;
//   - wakes the session once it sits idle (and after a compaction) with one resume prompt, at most 6 an hour;
//   - starts the wrap-up when the 5-hour or the weekly limit reaches limitPct (95) percent;
//   - runs report-fallback once when the deadline is 2 minutes past and no report came;
//   - /night status|off.
// Every decision it takes by itself is one line in night/<sid8>/events.log ("<ISO time> mod <text>").
import { resolveLang } from './lang.mjs'
import { compactBusy, compactWanted, runningAgents } from './compact-flow.mjs'
import { cfgState } from './config.mjs'
import { resolveDataDir } from './handoff-offer-logic.mjs'
import {
  NIGHT_DEFAULTS,
  NIGHT_IDLE_MS,
  nightArmedStatus,
  nightDefaults,
  nightEventLine,
  nightHoldText,
  nightLimitHit,
  nightNoAnswerLabel,
  nightNudgeAllowed,
  nightNudgeText,
  nightOverStatus,
  nightQuietState,
  nightQuietStatus,
  nightRecentNudges,
  nightStatusText,
  nightText,
  nightWatchdogAction,
  parseNightState,
} from './night-logic.mjs'

const NIGHT_TICK_MS = 60_000
const NIGHT_WAKE_DELAY_MS = 5_000

let nightGen = 0
let nightTimer = null
let nightDataDir // resolved once per module life
let nightCache = null // { dir, mtime, state }
let nightDefaultsCache = null
let nightInFlight = false
let nightLastActivity = 0
let nightNudges = []
let nightCapLogged = false
let nightHoldOn = false
let nightLimitFired = new Set() // night folders whose limit wrap-up the mod already started
let nightFallbackFired = new Set()
let nightOverToasted = new Set()
let nightSeenActive = new Set()
let nightCmdRegistered = false

async function nightTry(fn, fallback) {
  try {
    return await fn()
  } catch (err) {
    return fallback
  }
}

// session.start, session.end, /clear, /resume: timers of the old session stop, the memory goes.
export function nightReset() {
  nightGen += 1
  const timer = nightTimer
  nightTimer = null
  try {
    if (timer) timer.cancel()
  } catch (err) {
    // Already fired.
  }
  nightDataDir = undefined
  nightPointerHit = undefined
  nightCache = null
  nightInFlight = false
  nightLastActivity = 0
  nightNudges = []
  nightCapLogged = false
  nightHoldOn = false
  nightLimitFired = new Set()
  nightFallbackFired = new Set()
  nightOverToasted = new Set()
  nightSeenActive = new Set()
}

// The plugin data folders the hooks may have written the pointer into. The mod cannot always derive the hooks'
// CLAUDE_PLUGIN_DATA: a plugin read straight from a local marketplace folder has no /plugins/cache/ path, so the
// derived guess falls back to "<name>-inline" while the hooks use "<name>-<marketplace>" (seen live 2026-11-21: the
// opening question never closed). So every <config>/plugins/data/<name>-* folder is a candidate; the pointer file is
// named by the session id, so only this session's pointer can match.
async function nightDataDirsOf($) {
  if (nightDataDir !== undefined) return nightDataDir
  const env = await nightTry(() => $.env.get('CLAUDE_PLUGIN_DATA'), undefined)
  const home = await nightTry(() => $.env.get('HOME'), undefined)
  const configDir = await nightTry(() => $.env.get('CLAUDE_CONFIG_DIR'), undefined)
  const base0 = configDir ? String(configDir).replace(/\/+$/, '') : home ? `${String(home).replace(/\/+$/, '')}/.claude` : undefined
  const marketplaces = base0 ? await nightTry(async () => JSON.parse(await $.fs.read(`${base0}/plugins/known_marketplaces.json`)), undefined) : undefined
  const found = resolveDataDir({ env, pluginRoot: $.plugin.root, pluginName: $.plugin.name, home, configDir, marketplaces })
  const dirs = found === undefined ? [] : [found.dir]
  const base = configDir ? String(configDir).replace(/\/+$/, '') : home ? `${String(home).replace(/\/+$/, '')}/.claude` : undefined
  const prefix = String($.plugin.name || '').replace(/[^A-Za-z0-9_-]/g, '-') + '-'
  if (base && prefix !== '-') {
    const entries = await nightTry(() => $.fs.list(`${base}/plugins/data`), [])
    for (const e of entries || []) {
      const dir = `${base}/plugins/data/${e.name}`
      if (e.kind === 'dir' && e.name.startsWith(prefix) && !dirs.includes(dir)) dirs.push(dir)
    }
  }
  nightDataDir = dirs
  return nightDataDir
}

let nightPointerHit // { sid, data } once this session's pointer was found

// This session's night: { sid, dir, state } or undefined. One fs.exists when there is none. state.json is read
// again only when its mtime moved.
async function nightRead($) {
  try {
    const sid = await $.session.id()
    if (typeof sid !== 'string' || sid === '') return undefined
    let data
    if (nightPointerHit && nightPointerHit.sid === sid && (await $.fs.exists(`${nightPointerHit.data}/night/${sid}`))) {
      data = nightPointerHit.data
    } else {
      for (const d of await nightDataDirsOf($)) {
        if (await $.fs.exists(`${d}/night/${sid}`)) {
          data = d
          break
        }
      }
      if (data === undefined) return undefined
      nightPointerHit = { sid, data }
    }
    const pointer = `${data}/night/${sid}`
    const dir = String(await $.fs.read(pointer))
      .trim()
      .replace(/\/+$/, '')
    if (dir === '') return undefined
    const file = `${dir}/state.json`
    const stat = await nightTry(() => $.fs.stat(file), undefined)
    if (!stat) return undefined
    if (nightCache && nightCache.dir === dir && nightCache.mtime === stat.mtimeMs) return { sid, dir, data, state: nightCache.state }
    const state = parseNightState(await $.fs.read(file))
    if (state === undefined) return undefined
    nightCache = { dir, mtime: stat.mtimeMs, state }
    return { sid, dir, data, state }
  } catch (err) {
    return undefined
  }
}

async function nightDefaultsOf($) {
  if (nightDefaultsCache) return nightDefaultsCache
  const text = await nightTry(() => $.fs.read(`${$.plugin.root}/data/night-defaults.json`), undefined)
  nightDefaultsCache = text === undefined ? { ...NIGHT_DEFAULTS } : nightDefaults(text)
  return nightDefaultsCache
}

// One line into events.log. An append through the shell: the hooks append to the same file at the same time.
async function nightEvent($, night, text) {
  try {
    const line = nightEventLine(await $.clock.now(), text)
    await $.process.run(['sh', '-c', 'printf "%s\\n" "$1" >> "$2"', 'sh', line, `${night.dir}/events.log`], { timeoutMs: 5000 })
  } catch (err) {
    // The log is for the report; the night goes on without the line.
  }
}

// scripts/night-state.sh <args>. The night is named three ways so the script can pick it up however it looks:
// cwd = the night's git root, CREW_CHIEF_NIGHT_DIR = the night folder, the session id and the plugin data folder.
async function nightScript($, night, args) {
  const env = { CREW_CHIEF_NIGHT_DIR: night.dir, CREW_CHIEF_SESSION_ID: night.sid, CLAUDE_SESSION_ID: night.sid }
  if (night.data) env.CLAUDE_PLUGIN_DATA = night.data
  const init = { env, timeoutMs: 20_000 }
  if (typeof night.state.root === 'string' && night.state.root !== '') init.cwd = night.state.root
  try {
    return await $.process.run(['sh', `${$.plugin.root}/scripts/night-state.sh`, ...args], init)
  } catch (err) {
    return { exitCode: 1, stdout: '', stderr: String(err && err.message ? err.message : err) }
  }
}

// The open night (opening|armed|wrapup), or undefined. For the offers that are not made at night.
export async function nightQuietNow($) {
  const night = await nightRead($)
  return night && nightQuietState(night.state, await $.clock.now()) ? night : undefined
}

// Called first by askWithDeadline. While a night is open the question is never shown: returns the caller's night
// answer (`night.answer`), or its safe fallback, and logs it. undefined: no night, ask as usual.
// `night.hold`: the answer starts a compaction; the hold file goes up before the yes returns.
export async function nightQuietAnswer($, question, answers, fallback, night) {
  const open = await nightQuietNow($)
  if (!open) return undefined
  const label = night && typeof night.answer === 'string' ? night.answer : fallback
  if (night && night.hold) await nightHoldWrite($, open)
  await nightEvent($, open, `auto-answered a crew-chief question (nobody asked at night): "${String(question).slice(0, 120)}" -> ${String(label)}`)
  return label
}

// Logs an offer that is not made because the night is open.
export async function nightSkipped($, night, what) {
  await nightEvent($, night, `skipped ${what} (night)`)
}

async function nightHoldWrite($, night) {
  try {
    await $.fs.write(`${night.dir}/hold`, nightHoldText(await $.clock.now()))
    nightHoldOn = true
  } catch (err) {
    // Without the hold the Stop hook may block the update turn; the compaction then retries.
  }
}

async function nightHoldClear($, night) {
  nightHoldOn = false
  await nightTry(() => $.process.run(['rm', '-f', `${night.dir}/hold`]), undefined)
}

// While a compaction is under way or due (compactWanted: the turn must be allowed to end first): the hold stays
// fresh. Otherwise: removed.
async function nightHoldRefresh($, night) {
  if (compactBusy() || compactWanted()) await nightHoldWrite($, night)
  else if (nightHoldOn) await nightHoldClear($, night)
}

// ---- the opening interview's deadline (hooks/src/ask.js) --------------------------------------------------------

// night.ask: a value the person set (/crew-config or CREW_CHIEF_NIGHT_ASK_MIN) wins; otherwise askMin from the
// defaults file (20).
async function nightAskMinutes($) {
  const st = await nightTry(() => cfgState($, 'night.ask'), undefined)
  if (st && st.source !== 'default' && typeof st.value === 'number' && st.value > 0) return st.value
  return (await nightDefaultsOf($)).askMin
}

// For Claude's own AskUserQuestion: a deadline entry while this session's night is in its opening phase, else
// undefined (outside a night and after arming, Claude's questions get no deadline from the mod).
export async function nightOpeningDeadline($) {
  const night = await nightRead($)
  if (!night || night.state.status !== 'opening') return undefined
  const min = await nightAskMinutes($)
  return { night, min, ms: min * 60_000, fallback: nightNoAnswerLabel(min), lang: await nightTry(() => resolveLang($), 'en'), announced: false }
}

export async function nightAnnounceExpiry($, d, count) {
  await nightEvent($, d.night, `opening question${count === 1 ? '' : 's'} unanswered for ${d.min} min (${count}): answered NO_ANSWER, to be parked in QUESTIONS.md`)
  await nightTry(() => $.ui.toast(nightText(d.lang, 'ask_expired', { min: d.min }), { timeoutMs: 15000 }), undefined)
}

// ---- activity, the watchdog, the limit stop -----------------------------------------------------------------------

// From the main loop: a prompt or a model request (inFlight), or a finished turn.
export function nightNoteActivity(nowMs, inFlight) {
  nightLastActivity = nowMs
  nightInFlight = inFlight
}

function nightArm($) {
  if (nightTimer) return
  const gen = nightGen
  nightTimer = $.clock.after(NIGHT_TICK_MS, () => nightTick($, gen))
}

async function nightTick($, gen) {
  if (gen !== nightGen) return
  nightTimer = null
  const night = await nightRead($)
  const keep = night ? await nightCheck($, night, undefined, true) : false
  if (keep && gen === nightGen) nightArm($)
}

// One look at the night: hold, end notice, limit, and (`watch`, from the timer) the watchdog; a turn that just ended
// is not idle. Returns whether the watchdog should keep ticking.
async function nightCheck($, night, rateLimits, watch) {
  const st = night.state
  await nightHoldRefresh($, night)
  if (nightOverStatus(st.status)) {
    if (nightSeenActive.has(night.dir)) await nightOver($, night)
    return false
  }
  if (!nightQuietStatus(st.status)) return false
  nightSeenActive.add(night.dir)
  if (!nightArmedStatus(st.status)) return true // opening: keep watching for the arming
  const usage = rateLimits === undefined ? await nightTry(() => $.session.usage(), undefined) : { rateLimits }
  await nightLimit($, night, usage ? usage.rateLimits : undefined)
  if (watch) await nightWatchdog($, night)
  return true
}

async function nightOver($, night) {
  if (nightOverToasted.has(night.dir)) return
  nightOverToasted.add(night.dir)
  const lang = await nightTry(() => resolveLang($), 'en')
  await nightTry(() => $.ui.toast(nightText(lang, 'over', { path: `${night.dir}/REPORT.md` }), { timeoutMs: 20000 }), undefined)
}

// The 5-hour window or the weekly limit at limitPct: the wrap-up starts, once per night.
async function nightLimit($, night, rateLimits) {
  if (night.state.status !== 'armed' || nightLimitFired.has(night.dir)) return
  const d = await nightDefaultsOf($)
  const hit = nightLimitHit(rateLimits, d.limitPct)
  if (!hit) return
  nightLimitFired.add(night.dir)
  const r = await nightScript($, night, ['phase', 'wrapup', '--reason', 'limit'])
  await nightEvent($, night, `limit: ${hit.kind} at ${hit.percent}% (stop at ${d.limitPct}%): wrap-up started` + (r.exitCode === 0 ? '' : ` (night-state.sh failed: ${String(r.stderr || '').trim().slice(0, 120)})`))
  const lang = await nightTry(() => resolveLang($), 'en')
  await nightTry(() => $.ui.toast(nightText(lang, 'limit', { window: hit.kind, percent: hit.percent }), { timeoutMs: 12000 }), undefined)
}

async function nightNudge($, night, reason) {
  const now = await $.clock.now()
  nightNudges = nightRecentNudges(nightNudges, now)
  if (!nightNudgeAllowed(nightNudges, now)) {
    if (!nightCapLogged) {
      nightCapLogged = true
      await nightEvent($, night, `watchdog: ${nightNudges.length} resume prompts in the last hour, no more until the hour has passed`)
    }
    return
  }
  nightCapLogged = false
  nightNudges.push(now)
  nightLastActivity = now // the next nudge waits a full idle period, whether this one started a turn or not
  const idleMin = Math.round(NIGHT_IDLE_MS / 60_000)
  await nightEvent($, night, reason === 'compaction' ? 'compaction finished: resume prompt sent' : `watchdog: idle ${idleMin}+ min, resume prompt sent`)
  try {
    $.prompt.submit({ text: nightNudgeText(night.state, now, reason, night.dir) }).catch(() => {})
  } catch (err) {
    // A session that cannot take a prompt now: the next tick tries again.
  }
}

async function nightWatchdog($, night) {
  const st = night.state
  const action = nightWatchdogAction({
    status: st.status,
    deadline: st.deadline,
    reportDone: Boolean(st.reportDone),
    fallbackDone: nightFallbackFired.has(night.dir),
    nowMs: await $.clock.now(),
    lastActivityMs: nightLastActivity,
    inFlight: nightInFlight,
    compactBusy: compactBusy(),
    agentsRunning: await nightTry(() => runningAgents($), 0),
  })
  if (action === 'nudge') return nightNudge($, night, 'idle')
  if (action !== 'fallback') return
  nightFallbackFired.add(night.dir)
  // `done` past the deadline: status done (reason deadline), the fallback report if Claude wrote none, caffeinate off.
  const r = await nightScript($, night, ['done'])
  await nightEvent($, night, 'deadline + 2 min and the night still open: closed it (done)' + (r.exitCode === 0 ? '' : ` (failed: ${String(r.stderr || '').trim().slice(0, 120)})`))
  await nightOver($, night)
}

// ---- hooks the entry (hooks/src/register.js) calls ----------------------------------------------------------------

export async function nightSessionStart($) {
  nightReset()
  try {
    await $.command.register({ name: 'night', description: 'crew-chief night mode: status, or off (start one with /crew-chief:crew-night)', immediate: true, argumentHint: '[status|off]' })
    nightCmdRegistered = true
  } catch (err) {
    nightCmdRegistered = await nightOwnsCommand($)
  }
  const night = await nightRead($)
  if (night && nightQuietStatus(night.state.status)) {
    nightSeenActive.add(night.dir)
    nightLastActivity = await $.clock.now()
    nightArm($)
  }
}

// A finished main turn and a measurement: the hold, the limit, and the watchdog's timer when a night just armed.
export async function nightTurnComplete($, usage) {
  const night = await nightRead($)
  if (!night) return
  const keep = await nightCheck($, night, usage && Array.isArray(usage.rateLimits) ? usage.rateLimits : [], false)
  if (keep) nightArm($)
}

export async function nightMeasure($, e) {
  const night = await nightRead($)
  if (!night || night.state.status !== 'armed') return
  await nightLimit($, night, e && Array.isArray(e.rateLimits) ? e.rateLimits : undefined)
}

// From compact-flow's afterCompaction (both the direct and the /compact path): the hold comes down and, a few
// seconds later, the session that now sits idle is told to go on.
export async function nightAfterCompaction($) {
  const night = await nightRead($)
  if (!night || !nightArmedStatus(night.state.status)) return
  await nightHoldClear($, night)
  const gen = nightGen
  const at = await $.clock.now()
  $.clock.after(NIGHT_WAKE_DELAY_MS, async () => {
    if (gen !== nightGen) return
    if (nightInFlight && nightLastActivity > at) return // a turn already started
    const now = await nightRead($)
    if (!now || !nightArmedStatus(now.state.status)) return
    await nightNudge($, now, 'compaction')
  })
}

async function nightOwnsCommand($) {
  try {
    const commands = await $.command.list()
    return commands.some((c) => c.name === 'night' && c.source === 'plugin' && /^crew-chief(@|$)/.test(String(c.plugin ?? '')))
  } catch (err) {
    return false
  }
}

export function registerNight(on) {
  on('command.run', { command: 'night' }, async ($, e, next) => {
    if (!nightCmdRegistered) nightCmdRegistered = await nightOwnsCommand($)
    if (!nightCmdRegistered) return next(e)
    const word = String(e.args || '').trim().toLowerCase()
    const night = await nightRead($)
    if (!night) return { text: 'crew-chief night: no night in this session. Start one with /crew-chief:crew-night.' }
    if (word === '' || word === 'status') return { text: nightStatusText(night.state, await $.clock.now(), await nightDefaultsOf($), night.dir) }
    if (word === 'off') {
      if (!nightQuietStatus(night.state.status)) return { text: `crew-chief night: the night is already ${night.state.status}; nothing to turn off.` }
      const r = await nightScript($, night, ['stop', '--reason', 'off'])
      if (r.exitCode !== 0) return { text: `crew-chief night: could not turn it off (night-state.sh exit ${r.exitCode}): ${String(r.stderr || r.stdout || '').trim().slice(0, 200)}` }
      nightCache = null
      if (nightHoldOn) await nightHoldClear($, night)
      const lang = await nightTry(() => resolveLang($), 'en')
      nightOverToasted.add(night.dir) // the toast below says it; no "night over" toast after it
      await nightTry(() => $.ui.toast(nightText(lang, 'off'), { timeoutMs: 8000 }), undefined)
      return { text: `crew-chief night: off. Claude Code is back to normal; the night's files stay in ${night.dir}.` }
    }
    return { text: 'crew-chief night: /night status or /night off. Start a night with /crew-chief:crew-night.' }
  })
}
