// Pure helpers for the agent row status line (hooks/src/agent-row.js). Never sees `$`.
//
// The row is one line, `name model·effort tokens | name model·effort tokens`, drawn with $.ui.status so it
// also reaches surfaces that cannot run the shell panel row (scripts/subagent-row.sh): the Desktop app,
// VS Code, and terminals without jq.

export const ROW_MAX = 190
const NAME_MAX = 32

function clean(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

// Same rules as `short_model` in scripts/subagent-row.sh: claude-opus-5-5 -> opus-5.5,
// claude-haiku-4-5-20251001 -> haiku-4.5, claude-sonnet-5-5[1m] -> sonnet-5.5; nothing yet -> starting.
export function shortModel(model) {
  if (model === undefined || model === null || model === '') return 'starting'
  return clean(model)
    .replace(/^claude-/, '')
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-([0-9]+)-([0-9]+)(-[0-9]{8})?$/, '-$1.$2')
}

// 950 -> "950", 41234 -> "41.2k", 1250000 -> "1.2M" (cut, not rounded, like the shell row). Not a positive
// number -> "".
export function kilo(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return ''
  if (n >= 1_000_000) return Math.floor(n / 100_000) / 10 + 'M'
  if (n >= 1000) return Math.floor(n / 100) / 10 + 'k'
  return String(Math.floor(n))
}

// What a request's usage says the agent holds now: input, cache writes, cache reads and output of its
// latest request (the size of its context). Not a running sum: every
// request re-reads the whole context, so a sum would grow with the number of requests, not the work.
export function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') return undefined
  const total = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .map((k) => Number(usage[k]) || 0)
    .reduce((a, b) => a + b, 0)
  return total > 0 ? total : undefined
}

function agentName(a) {
  const name = clean(a?.name ?? 'agent').replace(/^.*:/, '')
  const shown = name === '' ? 'agent' : name
  return shown.length > NAME_MAX ? shown.slice(0, NAME_MAX - 1) + '…' : shown
}

// level 0: name model·effort tokens; 1: no tokens; 2: no effort either.
function piece(a, level) {
  const model = shortModel(a?.model)
  const effort = a?.effort === undefined || a?.effort === null || a?.effort === '' ? 'default' : clean(a.effort)
  const tok = level === 0 ? kilo(a?.tokens) : ''
  const pct = level <= 1 && typeof a?.pct === 'number' && Number.isFinite(a.pct) ? ' ~' + Math.max(0, Math.min(100, Math.round(a.pct))) + '%' : ''
  return agentName(a) + ' ' + model + (level <= 1 ? '·' + effort : '') + pct + (tok ? ' ' + tok : '')
}

// The line for `agents` ([{ name, model, effort, tokens, pct }]) within maxChars: drops the tokens first, then the
// effort, then whole agents from the end ("+2 more"). No agents -> undefined (the line is cleared).
export function formatRow(agents, maxChars = ROW_MAX) {
  if (!Array.isArray(agents) || agents.length === 0) return undefined
  for (const level of [0, 1, 2]) {
    const line = agents.map((a) => piece(a, level)).join(' | ')
    if (line.length <= maxChars) return line
  }
  const parts = agents.map((a) => piece(a, 2))
  for (let keep = parts.length - 1; keep >= 1; keep--) {
    const line = parts.slice(0, keep).join(' | ') + ' | +' + (parts.length - keep) + ' more'
    if (line.length <= maxChars) return line
  }
  const more = parts.length > 1 ? ' +' + (parts.length - 1) + ' more' : ''
  const room = Math.max(1, maxChars - more.length)
  const first = parts[0].length <= room ? parts[0] : parts[0].slice(0, Math.max(0, room - 1)) + '…'
  return (first + more).slice(0, maxChars)
}

export function rowMode(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === 'off' || v === 'on' ? v : 'auto'
}

// Windows sets OS=Windows_NT in every process; there is no platform call in the mod API.
export function platformFromOs(osVar) {
  return osVar === 'Windows_NT' ? 'win32' : 'other'
}

function onlyTerminal(surfaces) {
  return Array.isArray(surfaces) && surfaces.length > 0 && surfaces.every((s) => s === 'terminal')
}

// True when rowWanted's answer depends on whether jq exists (so the caller runs `jq --version` only then).
export function jqMatters({ mode, surfaces }) {
  return rowMode(mode) === 'auto' && onlyTerminal(surfaces)
}

// CREW_CHIEF_ROW_MOD: off never; on always; auto (default) when a surface is not the terminal (Desktop,
// VS Code, mobile, ...) or when the terminal's shell panel row cannot draw (no jq; Windows is no different:
// the shell panel row works there once jq is installed). Never with
// no surface at all (-p, SDK, cloud): nothing would show.
export function rowWanted({ mode, surfaces, hasJq }) {
  const m = rowMode(mode)
  if (m === 'off') return false
  if (!Array.isArray(surfaces) || surfaces.length === 0) return false
  if (m === 'on') return true
  if (!onlyTerminal(surfaces)) return true
  return hasJq === false
}
