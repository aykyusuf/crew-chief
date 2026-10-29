// crew-chief questions with a deadline. Part of the mod in hooks/register.js (Claude Code 2.1.287+).
//
// $.ui.ask has no timeout, so a question nobody answers (a long job left running overnight) would stay open
// for good. Every question the mod asks goes through askWithDeadline, which notes the question's text here.
// $.ui.ask opens the dialog as a tool.call of AskUserQuestion that this mod's own hooks see; the hook below
// races that call against a timer, and when the timer wins it returns the flow's safe default as the
// answer: the engine closes the dialog and $.ui.ask resolves to that label, exactly as if it was clicked.
// (That hook is only reached while the asking hook still runs; see askWithDeadline for the other case.)
// Only questions noted here are raced: an AskUserQuestion that Claude raises itself passes through.
// CREW_CHIEF_ASK_TIMEOUT_MIN sets the minutes (default 20, at most 30; "off" or "0" = no deadline).
import { uiAskStart } from './crew-ui.mjs'
import { resolveLang } from './lang.mjs'
import { t } from './saver-i18n.mjs'
import { minutesLabel, parseAskTimeout, pickFallback } from './ask-logic.mjs'

// question text -> { fallback, ms, lang, announced }
const deadlines = new Map()
const EXPIRED = Symbol('expired')

// Asks like $.ui.ask (same answer, same rejection when dismissed or when nobody can be asked), but an
// unanswered question resolves to `fallback` after the deadline. Two things enforce it:
//   - the sibling hook in registerAsk closes the dialog with that answer. It is only reached while the
//     hook that asks is still running (a $ call made after its hook returned skips this mod's own hooks);
//   - the race below, so the flow moves on with the default in every case, even when the dialog could
//     not be closed (then a late click on it changes nothing).
export async function askWithDeadline($, question, answers, fallback) {
  let entry
  try {
    const ms = parseAskTimeout(await $.env.get('CREW_CHIEF_ASK_TIMEOUT_MIN'))
    const label = pickFallback(answers, fallback)
    if (ms > 0 && label === undefined) {
      $.ui.log('crew-chief: no safe default for a question, it has no deadline: ' + String(fallback), { to: 'debug' })
    }
    if (ms > 0 && label !== undefined) {
      // Two questions with the same text at once share the first one's entry.
      entry = deadlines.get(question) ?? { fallback: label, ms, lang: await resolveLang($), question, announced: false }
    }
  } catch (err) {
    entry = undefined // no deadline then; the question itself still goes out
  }
  if (entry === undefined) {
    const band = uiAskStart($, question, answers)
    if (band === undefined) return $.ui.ask(question, answers)
    try {
      return await band.promise
    } finally {
      band.close()
    }
  }
  const owner = !deadlines.has(question)
  if (owner) deadlines.set(question, entry)
  let timer
  const band = uiAskStart($, question, answers)
  try {
    const asked = band !== undefined ? band.promise : $.ui.ask(question, answers)
    asked.catch(() => {}) // dismissed after the deadline: nobody is listening any more
    const expired = new Promise((resolve) => {
      timer = $.clock.after(entry.ms, () => resolve(EXPIRED))
    })
    const first = await Promise.race([asked, expired])
    if (first !== EXPIRED) return first
    announceExpiry($, entry)
    return entry.fallback
  } finally {
    try {
      if (timer) timer.cancel()
    } catch (err) {
      // Already fired.
    }
    if (band !== undefined) band.close() // an expired question leaves the band
    if (owner && deadlines.get(question) === entry) deadlines.delete(question)
  }
}

function deadlineFor(e) {
  const qs = Array.isArray(e.questions) ? e.questions : []
  if (qs.length !== 1 || !qs[0] || typeof qs[0].question !== 'string') return undefined
  return deadlines.get(qs[0].question)
}

// Once per question, whichever of the two deadlines comes first.
function announceExpiry($, d) {
  if (d.announced) return
  d.announced = true
  try {
    const min = minutesLabel(d.ms)
    $.ui.log('crew-chief: question unanswered for ' + min + ' min, answered "' + d.fallback + '": ' + d.question.slice(0, 120), { to: 'debug' })
    $.ui.toast(t(d.lang, 'ask_expired_toast', { min, answer: d.fallback }), { timeoutMs: 15000 })
  } catch (err) {
    // The default answer stands either way.
  }
}

export function registerAsk(on) {
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    let d
    try {
      d = deadlineFor(e)
    } catch (err) {
      d = undefined
    }
    if (d === undefined) return next(e)
    let timer
    let answered
    try {
      const expired = new Promise((resolve) => {
        timer = $.clock.after(d.ms, () => resolve(EXPIRED))
      })
      answered = next(e)
      answered.catch(() => {})
      const first = await Promise.race([answered.then((r) => ({ r })), expired])
      if (first === EXPIRED) {
        announceExpiry($, d)
        return { result: { questions: e.questions, answers: { [d.question]: d.fallback }, afkTimeoutMs: d.ms } }
      }
      return first.r
    } catch (err) {
      // A dismissed dialog rejects `answered`: pass that on unchanged. Anything else: no deadline.
      return answered !== undefined ? answered : next(e)
    } finally {
      try {
        if (timer) timer.cancel()
      } catch (err) {
        // Already fired.
      }
    }
  })
}
