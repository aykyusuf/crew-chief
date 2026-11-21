// Pure helpers for the saver mod (hooks/register.js). No Claude Code API in here, so
// tests/saver-logic.test.mjs can run them with plain Node.

export const FIVE_HOUR_DEFAULT = [70, 80, 90]
export const SEVEN_DAY_DEFAULT = [50, 75, 85, 90]
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

// The saver question's memory for one session: { never, windows: { [kind]: { at, seen } }, savedAt }. It is
// kept in the plugin store under ASK_STORE_PREFIX + session id, so a module reload (/reload-plugins runs
// session.start again for the same session) neither forgets "don't ask again" nor asks again for a
// threshold already answered. `at` is the window's reset time in ms (null when unknown), `seen` the
// thresholds already acted on in that window.
export const ASK_STORE_PREFIX = 'saver-ask:'
export const ASK_STATE_STALE_MS = 8 * 24 * 60 * 60 * 1000 // longer than the weekly window
// A window counts as new only when its reset time moves later by this much: a reset moves it by five
// hours or seven days, while the reported time may wobble by seconds between measures.
export const WINDOW_MOVE_MS = 30 * 60 * 1000

export function askStateNew() {
  return { never: false, windows: {} }
}

// A stored value back into a state; anything malformed is a clean slate.
export function askStateRestore(value) {
  const state = askStateNew()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return state
  state.never = value.never === true
  const windows = value.windows !== null && typeof value.windows === 'object' ? value.windows : {}
  for (const [kind, w] of Object.entries(windows)) {
    if (w === null || typeof w !== 'object') continue
    const at = typeof w.at === 'number' && Number.isFinite(w.at) ? w.at : null
    const seen = Array.isArray(w.seen) ? w.seen.filter((n) => typeof n === 'number' && Number.isFinite(n)) : []
    state.windows[kind] = { at, seen }
  }
  return state
}

export function askStateStale(value, now) {
  return value === null || typeof value !== 'object' || typeof value.savedAt !== 'number' || now - value.savedAt > ASK_STATE_STALE_MS
}

// The window that most needs a question, or undefined, and whether `state` changed (so the caller saves
// it). Every threshold at or below the current percent is marked as seen, so crossing 70 and 80 together
// asks once, and never again for 70 in that window. `lists` maps a window kind to its thresholds.
export function askHit(state, rateLimits, lists) {
  let hit
  let changed = false
  for (const w of Array.isArray(rateLimits) ? rateLimits : []) {
    const list = lists[w.kind]
    if (list === undefined) continue
    if (typeof w.percentUsed !== 'number' || Number.isNaN(w.percentUsed)) continue
    const parsed = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : NaN
    const at = Number.isFinite(parsed) ? parsed : null
    let entry = state.windows[w.kind]
    if (entry === undefined) {
      entry = { at, seen: [] }
      state.windows[w.kind] = entry
      changed = true
    } else if (at !== null && entry.at === null) {
      entry.at = at
      changed = true
    } else if (at !== null && at > entry.at + WINDOW_MOVE_MS) {
      entry.at = at
      entry.seen = []
      changed = true
    }
    const reached = list.filter((n) => w.percentUsed >= n)
    const fresh = reached.filter((n) => !entry.seen.includes(n))
    if (fresh.length === 0) continue
    entry.seen = [...new Set([...entry.seen, ...reached])].sort((a, b) => a - b)
    changed = true
    if (hit === undefined || w.percentUsed > hit.percent) hit = { kind: w.kind, percent: w.percentUsed, resetsAt: w.resetsAt }
  }
  return { hit, changed }
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

const SECURITY_AGENT = /(^|:)security-reviewer$/

// crew-chief's own Opus agents. Their model comes from the agent definition, which a tool call does
// not show, so they are named here; any other agent counts only when the call names an Opus or
// Fable model itself.
const HEAVY_AGENT = /(^|:)(implementer-hard|reviewer|security-reviewer|planner|ui-designer)$/

// The effort the saver puts on an Agent tool call, or undefined to leave the call alone. The
// subagent's own `effort:` in its definition beats a rewrite made later at turn.step (seen with
// Claude Code 2.1.310: the hook wrote high -> medium and /tasks still showed high), but an effort
// passed with the call is the more specific one. Only Opus and Fable agents, only downwards:
// an explicit low or medium stays, and a call naming Sonnet or Haiku is never touched.
export function agentCallEffort(input) {
  if (input === null || typeof input !== 'object') return undefined
  const model = typeof input.model === 'string' ? input.model : undefined
  const type = typeof input.subagent_type === 'string' ? input.subagent_type : ''
  const heavy = model !== undefined ? modelTier(model) === 'heavy' : HEAVY_AGENT.test(type)
  if (!heavy) return undefined
  const rank = EFFORT_RANK[input.effort]
  // The security reviewer keeps high under the saver (user, 2026-11-20): only xhigh and max come down to high.
  if (SECURITY_AGENT.test(type)) return rank !== undefined && rank > EFFORT_RANK.high ? 'high' : undefined
  if (input.effort !== undefined && (rank === undefined || rank <= EFFORT_RANK.medium)) return undefined
  return 'medium'
}

// ---- ultra-saver -----------------------------------------------------------------------------

// Ultra-saver keeps subagents off Opus and Fable and at high effort at most; most of them run at their own
// default (medium). The rewrite is made on the Agent tool call, where `model` and `effort` are still the
// caller's to set; a `fork` ignores `model`, so it is left alone.
//   - crew-chief's heavy agents (implementer-hard, reviewer, planner, ui-designer), and any agent that would inherit a heavy main
//     model, run on Sonnet at high at most (medium when no effort was given and no tier default is high);
//   - a call that names Opus or Fable itself, or a reviewer asked for
//     xhigh/max (the routing policy's signal for risky work), is a request for the strong model: `ask` is true and the caller asks the person; on a
//     no (or no answer) the same rewrite as above applies, on a yes the call goes through unchanged;
//   - Sonnet agents get their effort capped at high; Haiku and everything else is untouched.
// `allowHeavy` is the person's standing "yes" for the session (/saver ultra opus on): nothing is rewritten
// except effort above high for Sonnet agents. Returns undefined when the call is left alone, otherwise
// { rewrite: {model?, effort?}, ask: boolean, tier }.
const SONNET_NAMED = /(^|:)(deep-reader|implementer|ui-implementer|ui-tester|ui-scout)$/
const HAIKU_NAMED = /(^|:)(scanner|ui-smoke|mechanic)$/
// Ultra-saver only: these Opus agents get Sonnet at HIGH (not medium) when they are moved off Opus, to make up for the
// smaller model, even though their own default is now medium on Opus.
const HIGH_FIRST = /(^|:)(implementer-hard|reviewer|security-reviewer|planner|ui-designer)$/

export function ultraAgentCall(input, allowHeavy = false, mainModel = undefined) {
  if (input === null || typeof input !== 'object') return undefined
  const type = typeof input.subagent_type === 'string' ? input.subagent_type : ''
  if (type === 'fork') return undefined
  const named = typeof input.model === 'string' && input.model !== ''
  const tier = named
    ? modelTier(input.model)
    : HEAVY_AGENT.test(type)
      ? 'heavy'
      : SONNET_NAMED.test(type)
        ? 'sonnet'
        : HAIKU_NAMED.test(type)
          ? 'other'
          : modelTier(mainModel) // another agent with no model of its own inherits the session's
  const rank = EFFORT_RANK[input.effort]
  if (tier === 'heavy' && !allowHeavy) {
    // The ui-designer is treated like the other heavy agents (user, 2026-11-20): it drops to Sonnet silently
    // unless the call names Opus itself. The rewrite target is always Sonnet, never Fable.
    // The security reviewer always asks before it goes to Sonnet (decision 2026-11-20): a security review is the risky work.
    const strongRequest = named || SECURITY_AGENT.test(type) || (/(^|:)reviewer$/.test(type) && (input.effort === 'xhigh' || input.effort === 'max'))
    const effort = rank === undefined ? (HIGH_FIRST.test(type) ? 'high' : 'medium') : rank > EFFORT_RANK.high ? 'high' : input.effort
    return { rewrite: { model: 'sonnet', effort }, ask: strongRequest, tier }
  }
  if (tier !== 'other' && rank !== undefined && rank > EFFORT_RANK.high && !(tier === 'heavy' && allowHeavy)) {
    return { rewrite: { effort: 'high' }, ask: false, tier }
  }
  return undefined
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
