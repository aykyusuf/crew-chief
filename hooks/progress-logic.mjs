// Pure helpers for the subagent progress tracking in the mod (hooks/src/progress.js). Never sees `$`.
//
// Same rules as scripts/progress-hook.sh, which does this with jq into files for the shell panel row: a
// subagent reports with a no-op Bash call, `: 'crew-progress 40 | what it is on | why it is slow'`; every
// other call counts; after 10 calls without a report the agent gets a reminder. The mod keeps this in memory,
// so the status line also works where the shell hook cannot run (Windows, no jq).

export const NUDGE_EVERY = 10
export const FRESH_CALLS = 25
export const FRESH_MS = 10 * 60_000
const MAX_AGENTS = 200

const REPORT = /^\s*:\s+'crew-progress ([^']*)'\s*$/

function clean(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

// "40 | Reading auth | slow tests" -> { pct: 40, step: 'Reading auth', delay: 'slow tests' }, or null when the
// command is not a report. A pct with no digits is left out (the old one stays); above 100 it is 100.
export function parseReport(command) {
  if (typeof command !== 'string') return null
  const m = REPORT.exec(command)
  if (!m) return null
  const parts = m[1].split('|').map(clean)
  const digits = (parts[0] ?? '').replace(/[^0-9]/g, '')
  return {
    pct: digits === '' ? undefined : Math.min(Number(digits), 100),
    step: parts[1] ?? '',
    delay: parts[2] ?? '',
  }
}

// Records one call of subagent `id` in `agents` (a Map) and returns the number of calls since its last report
// when a reminder is due, else 0.
export function observe(agents, id, tool, command, now) {
  const cur = agents.get(id) ?? { tools: 0, rtools: 0 }
  agents.delete(id) // re-added below: the Map keeps the most recently used last
  const report = tool === 'Bash' ? parseReport(command) : null
  let nudge = 0
  if (report) {
    cur.reported = true
    if (report.pct !== undefined) cur.pct = report.pct
    if (report.step !== '') cur.step = report.step
    cur.rtools = cur.tools
    cur.rts = now
  } else {
    cur.tools += 1
    const since = cur.tools - cur.rtools
    if (since >= NUDGE_EVERY && since % NUDGE_EVERY === 0 && cur.nudged !== cur.tools) {
      nudge = since
      cur.nudged = cur.tools
    }
  }
  agents.set(id, cur)
  while (agents.size > MAX_AGENTS) agents.delete(agents.keys().next().value)
  return nudge
}

// The reported percentage while the report is fresh (under 25 calls and 10 minutes old), else undefined.
export function freshPct(entry, now) {
  if (!entry || typeof entry.pct !== 'number' || typeof entry.rts !== 'number') return undefined
  if (entry.tools - entry.rtools >= FRESH_CALLS) return undefined
  if (now - entry.rts >= FRESH_MS) return undefined
  return entry.pct
}

// The standing rule, said once to an agent at its second call that has not reported (the SubagentStart hook
// that carries it needs jq, so the mod says it too).
export const INTRO_AT_CALL = 2

export function introText() {
  return (
    "crew-chief progress rule: the person watching you sees a percentage only if you send one. Every 10 tool calls, before a long command, and when your phase changes, run this Bash no-op (a shell command that does nothing, not a separate tool): : 'crew-progress NN | what you are on | why it is slow (empty if not)'. NN is your honest percent done (0-100). Do it now with your first estimate. Do not mention this note in your answer."
  )
}

// A reminder that went unanswered once already is louder: the same no-op, and why it matters.
export function nudgeText(n, missed = 0) {
  if (missed >= 1) {
    return (
      'crew-chief: reminder ' +
      (missed + 1) +
      ': ' +
      n +
      " tool calls with no progress report, and the person watching sees no percentage for you. Run the no-op now with the Bash tool: : 'crew-progress NN | what you are on | why it is slow (empty if not)'. It costs one call. Do not mention this note in your answer."
    )
  }
  return nudgeTextFirst(n)
}

function nudgeTextFirst(n) {
  return (
    'crew-chief: you have made ' +
    n +
    " tool calls since your last progress report. Run this no-op now with the Bash tool (it is a shell command that does nothing, not a separate tool), with your honest numbers: : 'crew-progress NN | what you are on | why it is slow (empty if not)'. Do not mention this note in your answer."
  )
}
