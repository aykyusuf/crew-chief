// The settings a person can change with /crew-config (hooks/src/config.js). Pure functions, no Claude
// Code API, so tests/config-logic.test.mjs can run them with plain Node.
//
// Where a value comes from, strongest first: the environment variable (kept for scripts and for people who
// already use them), the value saved with /crew-config, the default. A value that does not parse is ignored
// at its level and the next level is used, so a typo can never switch a feature off or make it noisy.
import { FIVE_HOUR_DEFAULT, SEVEN_DAY_DEFAULT, parseThresholds } from './saver-logic.mjs'
import { DEFAULTS as HANDOFF_DEFAULTS, MODES as HANDOFF_MODES } from './handoff-nudge-logic.mjs'
import { ARM_FRACTION, ARM_TOKENS, ASK_FRACTION, ASK_TOKENS } from './compact-logic.mjs'
import { ASK_TIMEOUT_MAX_MIN } from './ask-logic.mjs'

const MIN_TOKENS = 10_000

// "250k" -> 250000, "1m" -> 1000000, "300000" -> 300000, anything else -> undefined.
function tokens(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([km]?)\s*$/i.exec(String(text))
  if (!m) return undefined
  const n = Number(m[1]) * (m[2].toLowerCase() === 'm' ? 1_000_000 : m[2].toLowerCase() === 'k' ? 1_000 : 1)
  return Number.isFinite(n) && n >= MIN_TOKENS ? Math.round(n) : undefined
}

function onOff(text) {
  const w = String(text).trim().toLowerCase()
  if (w === 'on' || w === 'true' || w === 'yes') return 'on'
  if (w === 'off' || w === 'false' || w === 'no') return 'off'
  return undefined
}

function whole(min, max) {
  return (text) => {
    const w = String(text).trim()
    if (!/^\d+$/.test(w)) return undefined
    const n = Number(w)
    return n >= min && n <= max ? n : undefined
  }
}

function list(text) {
  // parseThresholds falls back silently; here a bad list must be refused, so check it by hand.
  const parts = String(text)
    .split(',')
    .map((p) => p.trim())
  if (parts.length === 0 || parts.some((p) => !/^\d{1,3}$/.test(p))) return undefined
  const found = parseThresholds(String(text), [])
  return found.length === parts.length ? found : undefined
}

function choice(list) {
  return (text) => {
    const w = String(text).trim().toLowerCase()
    return list.includes(w) ? w : undefined
  }
}

// Like CREW_CHIEF_ASK_TIMEOUT_MIN always was: "off" or "0" is no deadline, a whole number is clamped to the maximum.
function minutes(text) {
  const w = String(text).trim().toLowerCase()
  if (w === 'off' || w === '0') return 0
  if (!/^\d+$/.test(w)) return undefined
  return Math.min(Number(w), ASK_TIMEOUT_MAX_MIN)
}

// key -> { parse, def, env, group, what }. `env` is the variable that overrides the key (and the way the
// value must be spelled there: the environment reads it with the same parser).
export const SETTINGS = {
  'compact.enabled': { group: 'compact', parse: onOff, def: 'on', env: 'CREW_CHIEF_COMPACT', what: 'the whole compact flow (on|off)' },
  'compact.arm': { group: 'compact', parse: tokens, def: ARM_TOKENS, env: 'CREW_CHIEF_COMPACT_ARM', what: 'context size at which Claude is told to propose a compaction at the next phase boundary (for example 300k)' },
  'compact.ask': { group: 'compact', parse: tokens, def: ASK_TOKENS, env: 'CREW_CHIEF_COMPACT_ASK', what: 'context size at which crew-chief asks by itself when Claude never proposed one (for example 500k)' },
  'compact.fallback': { group: 'compact', parse: onOff, def: 'on', what: 'whether crew-chief may ask by itself past compact.ask (off: only when Claude proposes it, or you type /crew-compact)' },
  'compact.reask': { group: 'compact', parse: tokens, def: 100_000, what: 'after "not now", how much the context must grow before the next proposal (for example 150k)' },
  'compact.quiet': { group: 'compact', parse: whole(1, 600), def: 10, what: 'seconds the session must stay quiet after a turn before the question opens' },
  'compact.armpct': { group: 'compact', parse: whole(10, 95), def: Math.round(ARM_FRACTION * 100), what: 'on a small context window, the percent of it that arms the flow (used only while you have not set compact.arm yourself)' },
  'compact.askpct': { group: 'compact', parse: whole(10, 99), def: Math.round(ASK_FRACTION * 100), what: 'on a small context window, the percent of it that asks by itself (used only while you have not set compact.ask yourself)' },
  'saver.ask': { group: 'saver', parse: onOff, def: 'on', env: 'CREW_CHIEF_SAVER', what: 'whether the saver asks at the limit thresholds (on|off; /saver still works)' },
  'saver.five': { group: 'saver', parse: list, def: FIVE_HOUR_DEFAULT, env: 'CREW_CHIEF_SAVER_FIVE_HOUR', what: '5-hour limit percents that raise the saver question (for example 80,95)' },
  'saver.seven': { group: 'saver', parse: list, def: SEVEN_DAY_DEFAULT, env: 'CREW_CHIEF_SAVER_SEVEN_DAY', what: 'weekly limit percents that raise the saver question' },
  'ask.timeout': { group: 'ask', parse: minutes, def: 20, env: 'CREW_CHIEF_ASK_TIMEOUT_MIN', what: `minutes before an unanswered question takes its safe answer (1-${ASK_TIMEOUT_MAX_MIN}, or off)` },
  'handoff.mode': { group: 'handoff', parse: choice(HANDOFF_MODES), def: HANDOFF_DEFAULTS.mode, env: 'CREW_CHIEF_HANDOFF', what: 'keeping STATUS.md / tasks.json / PROGRESS.md current: off, nudge (reminders to Claude) or turn (also one extra turn asking for the update when reminders went unanswered)' },
  'handoff.files': { group: 'handoff', parse: whole(2, 100), def: HANDOFF_DEFAULTS.files, what: 'distinct project files edited since the handoff files were last written before Claude is reminded' },
  'handoff.minutes': { group: 'handoff', parse: whole(5, 600), def: HANDOFF_DEFAULTS.minutes, what: 'minutes of editing after which a third of that many files is enough to remind' },
  'handoff.max': { group: 'handoff', parse: whole(1, 50), def: HANDOFF_DEFAULTS.max, what: 'most reminders per session (rule, decision, commit and limit reminders are counted apart)' },
  'agents.warn': { group: 'band', parse: whole(2, 50), def: 5, what: 'the band notes the cost of watching when more than this many subagents run at once' },
}

export const SETTING_KEYS = Object.keys(SETTINGS)

// "300k" for 300000, "on", "70,80,90", "off" for 0 minutes.
export function formatSetting(key, value) {
  const def = SETTINGS[key]
  if (!def) return String(value)
  if (key === 'ask.timeout') return value === 0 ? 'off' : `${value} min`
  if (key === 'compact.quiet') return `${value} s`
  if (key.endsWith('pct')) return `${value} %`
  if (Array.isArray(value)) return value.join(',')
  if (typeof value === 'number' && value >= 1000) return value % 1_000_000 === 0 ? `${value / 1_000_000}m` : value % 1000 === 0 ? `${value / 1000}k` : String(value)
  return String(value)
}

// For the value kept in the store: a string that parseSetting reads back.
export function storeText(key, value) {
  if (Array.isArray(value)) return value.join(',')
  return String(value)
}

export function parseSetting(key, text) {
  const def = SETTINGS[key]
  if (!def) return { ok: false, error: 'unknown' }
  if (text === undefined || text === null || String(text).trim() === '') return { ok: false, error: 'empty' }
  const value = def.parse(text)
  return value === undefined ? { ok: false, error: 'invalid' } : { ok: true, value }
}

// One key: the value in force and where it came from. A bad value at a level is skipped.
export function resolveSetting(key, envRaw, storedRaw) {
  const def = SETTINGS[key]
  if (!def) return undefined
  const fromEnv = envRaw === undefined || envRaw === null ? undefined : def.parse(envRaw)
  if (fromEnv !== undefined) return { value: fromEnv, source: 'env' }
  const fromStore = storedRaw === undefined || storedRaw === null ? undefined : def.parse(storedRaw)
  if (fromStore !== undefined) return { value: fromStore, source: 'saved' }
  return { value: def.def, source: 'default' }
}

// Two orderings that must hold whatever the person typed: asking by itself comes later than arming.
// Returns a list of plain-language problems for the settings as a whole ("" when fine).
export function checkSettings(values) {
  const problems = []
  if (values['compact.ask'] <= values['compact.arm']) {
    problems.push('compact.ask is not above compact.arm: it will be raised to 1.25 times compact.arm')
  }
  if (values['compact.askpct'] <= values['compact.armpct']) {
    problems.push('compact.askpct is not above compact.armpct: it will be raised to 1.25 times compact.armpct')
  }
  return problems
}

// The env spelling a person can use instead of /crew-config, or '' when the key has none.
export function envName(key) {
  return SETTINGS[key]?.env ?? ''
}
