// crew-chief reset flow: tells you when a plan limit you were close to has reset, and, when a limit
// actually stops Claude, offers to send "continue" for you at the moment it resets. Part of the mod in
// hooks/register.js.
//
//   - Measurements only arrive after a response, so nothing would wake an idle session when a window
//     rolls over. A timer is set for each window that was close to full (90 % or more) and is due to
//     reset within 12 hours; it fires a toast at the reset time.
//   - A limit that really stops a turn arrives as the StopFailure event with error "rate_limit" (not the
//     100 % mark: with usage credits you keep working past it). Then the person is asked whether to
//     send "continue" at the reset. Only on a yes, only for a reset within 6 hours, and never if the
//     person typed something in the meantime. The message says who sent it (it is not sent as the
//     person's own words).
// CREW_CHIEF_RESET=off turns both off. Timers last as long as the session does.
import { open } from './coord.mjs'
import { resolveLang } from './lang.mjs'
import { askWithDeadline } from './ask.mjs'
import { formatDuration } from './saver-logic.mjs'
import { t, unitsFor, windowName } from './saver-i18n.mjs'

const NEAR_FULL_PERCENT = 90
const TOAST_HORIZON_MS = 12 * 60 * 60 * 1000
const CONTINUE_HORIZON_MS = 6 * 60 * 60 * 1000
const BUFFER_MS = 15_000

const CONTINUE_TEXT =
  'crew-chief: the usage limit has reset, as the user asked in advance. Continue where you left off, with the same task.'

let generation = 0

function freshReset() {
  return { scheduled: new Set(), planned: new Set(), never: false, asking: false, lastPromptAt: 0 }
}

let rf = freshReset()

// A timer set before /clear or a new session must not act in the next one: each carries the generation
// it was set in.
export function resetResetFlow() {
  rf = freshReset()
  generation += 1
  open.reset = false
}

export function resetNotePrompt(now) {
  rf.lastPromptAt = now
}

async function off($) {
  try {
    return (await $.env.get('CREW_CHIEF_RESET')) === 'off'
  } catch (err) {
    return false
  }
}

function resetMs(window) {
  const at = typeof window.resetsAt === 'string' ? Date.parse(window.resetsAt) : NaN
  return Number.isFinite(at) ? at : undefined
}

// Called with each usage reading. Sets one timer per (window, reset time) for a window that is close
// to full and resets soon; the toast comes when the window rolls over, even if the session is idle.
export async function resetOnUsage($, usage) {
  if (await off($)) return
  const now = await $.clock.now()
  for (const w of usage?.rateLimits ?? []) {
    if (w.kind !== 'five_hour' && w.kind !== 'seven_day') continue
    const at = resetMs(w)
    if (at === undefined || w.percentUsed < NEAR_FULL_PERCENT) continue
    const wait = at - now
    const key = w.kind + '|' + at
    if (wait <= 0 || wait > TOAST_HORIZON_MS || rf.scheduled.has(key)) continue
    rf.scheduled.add(key)
    const born = generation
    $.clock.after(wait + BUFFER_MS, () => (born === generation ? announceReset($, w.kind) : undefined))
  }
}

async function announceReset($, kind) {
  if (await off($)) return
  const lang = await resolveLang($)
  $.ui.toast(t(lang, 'reset_toast', { window: windowName(lang, kind) }), { timeoutMs: 15000 })
}

// The window that stopped the turn: the fullest one that has a reset time in the future.
function blockingWindow(usage, now) {
  let best
  for (const w of usage?.rateLimits ?? []) {
    const at = resetMs(w)
    if (at === undefined || at <= now) continue
    if (best === undefined || w.percentUsed > best.window.percentUsed) best = { window: w, at }
  }
  return best
}

async function offerContinue($) {
  if (rf.asking || open.saver || open.compact || open.reset) return
  const now = await $.clock.now()
  const usage = await $.session.usage()
  const hit = blockingWindow(usage, now)
  if (!hit) return
  const wait = hit.at - now
  const key = hit.window.kind + '|' + hit.at
  if (wait > CONTINUE_HORIZON_MS || rf.planned.has(key) || rf.never) return
  rf.asking = true
  open.reset = true
  try {
    const lang = await resolveLang($)
    const answers = [t(lang, 'limit_yes'), t(lang, 'limit_no'), t(lang, 'limit_never')]
    let answer
    try {
      answer = await askWithDeadline(
        $,
        t(lang, 'limit_ask', { window: windowName(lang, hit.window.kind), duration: formatDuration(wait, unitsFor(lang)) }),
        answers,
        answers[1],
      )
    } catch (err) {
      return
    }
    if (answer === answers[2]) {
      rf.never = true
    } else if (answer === answers[0]) {
      rf.planned.add(key)
      const askedAt = now
      const born = generation
      $.clock.after(wait + BUFFER_MS, () => (born === generation ? sendContinue($, askedAt, hit.window.kind) : undefined))
    }
  } finally {
    rf.asking = false
    open.reset = false
  }
}

async function sendContinue($, askedAt, kind) {
  if (await off($)) return
  if (rf.lastPromptAt > askedAt) return // the person is back and typing: leave it to them
  try {
    $.prompt.submit({ text: CONTINUE_TEXT }).catch(() => {})
    const lang = await resolveLang($)
    $.ui.toast(t(lang, 'limit_continue_toast', { window: windowName(lang, kind) }), { timeoutMs: 10000 })
  } catch (err) {
    // The session cannot take a prompt right now; nothing more to do.
  }
}

export function registerReset(on) {
  // StopFailure: a turn ended on an error. Only a rate limit matters here. (Settings-hook events do not
  // reach a mod where an organization manages Claude Code; then the offer simply never comes.)
  on('classic.StopFailure', async ($, e, next) => {
    if (e.error === 'rate_limit' && !(await off($))) offerContinue($) // not awaited: the hook must not wait
    return next(e)
  })
}
