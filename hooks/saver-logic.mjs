// Pure helpers for the saver mod (hooks/register.js). No Claude Code API in here, so
// tests/saver-logic.test.mjs can run them with plain Node.

export const FIVE_HOUR_DEFAULT = [70, 80, 90]
export const SEVEN_DAY_DEFAULT = [50, 75, 85, 90]
export const CONTEXT_TOAST_TOKENS = 150_000
export const SESSION_AGE_TOAST_MS = 8 * 60 * 60 * 1000

const EFFORT_RANK = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 }

// "70, 80,90" -> [70, 80, 90]. Anything that is not a whole number from 1 to 100 is dropped;
// when nothing usable is left (or the variable is unset) the fallback list is used.
export function parseThresholds(text, fallback) {
  if (typeof text !== 'string' || text.trim() === '') return [...fallback]
  const found = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d{1,3}$/.test(part))
    .map(Number)
    .filter((n) => n >= 1 && n <= 100)
  const unique = [...new Set(found)].sort((a, b) => a - b)
  return unique.length > 0 ? unique : [...fallback]
}

// Which thresholds a window has newly crossed. `seen` holds keys for thresholds already acted on.
// `top` is the highest new one (ask once for it); `crossed` lists the keys of every threshold at or
// below the percent, so the caller can mark them all and never ask for the lower ones later.
export function crossing(percent, thresholds, seen, keyPrefix) {
  if (typeof percent !== 'number' || Number.isNaN(percent)) return { top: undefined, crossed: [] }
  const reached = thresholds.filter((t) => percent >= t)
  const fresh = reached.filter((t) => !seen.has(keyPrefix + t))
  return {
    top: fresh.length > 0 ? Math.max(...fresh) : undefined,
    crossed: reached.map((t) => keyPrefix + t),
  }
}

// 'claude-opus-5-5' / 'opus' -> 'heavy'; sonnet -> 'sonnet'; everything else -> 'other'.
export function modelTier(model) {
  const name = typeof model === 'string' ? model.toLowerCase() : ''
  if (name.includes('opus') || name.includes('fable')) return 'heavy'
  if (name.includes('sonnet')) return 'sonnet'
  return 'other'
}

// The saver's effort ceiling for a subagent request. Opus and Fable run at medium at most,
// Sonnet at high at most (no xhigh or max), everything else is left alone. A missing or numeric
// effort is never touched.
export function capEffort(model, effort) {
  const rank = EFFORT_RANK[effort]
  if (rank === undefined) return { effort, capped: false }
  const tier = modelTier(model)
  const ceiling = tier === 'heavy' ? 'medium' : tier === 'sonnet' ? 'high' : undefined
  if (ceiling === undefined || rank <= EFFORT_RANK[ceiling]) return { effort, capped: false }
  return { effort: ceiling, capped: true, from: effort, tier }
}

// 6_300_000 -> "1h 45m", 90_000 -> "2m" (rounded up), 1 ms -> "1m", zero or invalid -> "<1m".
// `units` renames the letters (see unitsFor in saver-i18n.mjs).
export function formatDuration(ms, units = { d: 'd', h: 'h', m: 'm', lt: '<1m' }) {
  if (typeof ms !== 'number' || !(ms > 0)) return units.lt
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 1) return units.lt
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days > 0) return `${days}${units.d} ${hours}${units.h}`
  if (hours > 0) return `${hours}${units.h} ${rest}${units.m}`
  return `${rest}${units.m}`
}

export function tokensLabel(n) {
  if (typeof n !== 'number') return '?'
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

// ---- advisor offer -------------------------------------------------------------------------

export const ADVISOR_LATER_MS = 7 * 24 * 60 * 60 * 1000

// 'claude-sonnet-5-5' -> 'sonnet'. Used to pick the advisor and to name the model in a message.
export function modelFamily(model) {
  const name = typeof model === 'string' ? model.toLowerCase() : ''
  for (const family of ['fable', 'opus', 'sonnet', 'haiku']) {
    if (name.includes(family)) return family
  }
  return 'other'
}

// Whether and how to offer the advisor for this main model. Sonnet and Haiku get the usual offer
// (a stronger model on call); Opus and Fable get the "second opinion" wording, with the advisor
// Claude Code accepts for them (Opus 5+ or Fable for Opus, only Fable for Fable). Unknown models
// get nothing: the pairing rules are not known.
export function advisorPlan(model) {
  const family = modelFamily(model)
  if (family === 'sonnet' || family === 'haiku') return { family, advisor: 'opus', kind: 'standard' }
  if (family === 'opus') return { family, advisor: 'opus', kind: 'second' }
  if (family === 'fable') return { family, advisor: 'fable', kind: 'second' }
  return undefined
}

// What is stored under the `advisor` key: 'never' and 'answered' end the offers for good,
// 'later:<ms>' pauses them until that time, anything else (including nothing) allows one.
export function advisorOfferAllowed(stored, now) {
  if (stored === 'never' || stored === 'answered') return false
  if (typeof stored === 'string' && stored.startsWith('later:')) {
    const until = Number(stored.slice('later:'.length))
    // A pause longer than a week was written with a clock that has since moved back: ignore it.
    return Number.isFinite(until) ? now >= until || until - now > ADVISOR_LATER_MS : true
  }
  return true
}

// An environment variable that switches something on: set, and not 0/false/no/off.
export function isEnvFlag(value) {
  if (typeof value !== 'string') return false
  const v = value.trim().toLowerCase()
  return v !== '' && !['0', 'false', 'no', 'off'].includes(v)
}
