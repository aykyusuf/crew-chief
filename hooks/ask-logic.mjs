// The deadline on the mod's own questions (hooks/src/ask.js). Pure functions, no Claude Code API, so
// tests/ask-logic.test.mjs can run them with plain Node.
//
// A question the person does not answer would otherwise stay open for good: a long job left running
// overnight stalls until morning. After the deadline the question counts as answered with a safe
// default, which is always the flow's own decline ("not now", "no", "cancel"): never the yes, and never
// a "don't ask again", which would switch a feature off for good without anyone choosing it.
import { MESSAGES } from './saver-i18n.mjs'

export const ASK_TIMEOUT_DEFAULT_MIN = 20
export const ASK_TIMEOUT_MAX_MIN = 30

// CREW_CHIEF_ASK_TIMEOUT_MIN: minutes before an unanswered question takes its default. "off" or "0" means
// no deadline; a whole number from 1 up is clamped to 30; anything else (empty, negative, "abc", "2.5")
// is the default, 20. Returns milliseconds, 0 for no deadline.
export function parseAskTimeout(raw) {
  if (raw === undefined || raw === null) return ASK_TIMEOUT_DEFAULT_MIN * 60_000
  const text = String(raw).trim().toLowerCase()
  if (text === 'off' || text === '0') return 0
  if (!/^\d+$/.test(text)) return ASK_TIMEOUT_DEFAULT_MIN * 60_000
  const min = Math.min(Number(text), ASK_TIMEOUT_MAX_MIN)
  return (min < 1 ? ASK_TIMEOUT_DEFAULT_MIN : min) * 60_000
}

// Every "don't ask again" label, in every language.
export const NEVER_LABELS = new Set(
  Object.values(MESSAGES).flatMap((lang) =>
    Object.entries(lang)
      .filter(([key]) => key.endsWith('_never'))
      .map(([, label]) => label),
  ),
)

// The label an unanswered question resolves to, or undefined when `fallback` is not safe (then the question
// gets no deadline). Safe means: one of the offered answers, not the first one (every question in the mod
// offers its yes first), and not a "don't ask again".
export function pickFallback(answers, fallback) {
  if (!Array.isArray(answers) || answers.length < 2 || typeof fallback !== 'string') return undefined
  const at = answers.indexOf(fallback)
  if (at < 1) return undefined
  if (NEVER_LABELS.has(fallback)) return undefined
  return fallback
}

export function minutesLabel(ms) {
  return Math.max(1, Math.round(ms / 60_000))
}
