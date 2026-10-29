// crew-chief agent row: one status line with every running subagent's model, effort and tokens. Part of the
// mod in hooks/register.js (Claude Code 2.1.287+).
//
//   scanner haiku-5.5·low 12.4k | implementer opus-5.5·medium 48.1k
//
// The shell panel row (scripts/subagent-row.sh) only reaches a terminal with jq. This line, drawn with
// $.ui.status, also reaches the Desktop app, VS Code and terminals without jq (Windows). The host puts its
// own mark and the plugin's name before it.
//   - model and effort: from each subagent request (turn.step), after the saver's cap was applied;
//   - tokens: the latest request's input + cache + output (its context size), not a running sum;
//   - names and who still runs: $.agent.list() (pending, running, waiting), minus the agents whose turn
//     ended; the line is cleared when none is left.
// CREW_CHIEF_ROW_MOD=auto (default) draws it when a surface is not the terminal, or when the terminal's
// panel row cannot draw (Windows, or no jq: `jq --version` is run once a session to find out);
// `on` always (with a surface), `off` never. Any failure leaves the line alone and the turn untouched.
import { resolveLang } from './lang.mjs'
import { t } from './saver-i18n.mjs'
import { uiCovers, uiTouch } from './crew-ui.mjs'
import { progressInfo, progressPct } from './progress.mjs'
import { formatRow, jqMatters, platformFromOs, rowWanted, usageTokens } from './row-logic.mjs'

const ROW_LIVE = ['pending', 'running', 'waiting']
const ROW_RECHECK_MS = 60_000
const ROW_DRAW_DELAY_MS = 50

function freshRow() {
  return {
    agents: new Map(), // agentId -> { model, effort, tokens }
    done: new Set(), // agents whose turn ended (the list can still say running for a moment)
    wanted: undefined,
    surfaces: undefined, // as last read, for the band
    checkedAt: undefined,
    hasJq: undefined, // probed once a session (rowJq)
    jqAnswer: undefined, // the promise of that one probe
    shown: false, // this module pinned a line
    lastText: undefined,
    drawPending: false,
  }
}

let rowState = freshRow()

async function rowProbeJq($) {
  try {
    const r = await $.process.run(['jq', '--version'], { timeoutMs: 3000 })
    return r.exitCode === 0
  } catch (err) {
    return false // cannot start: not installed
  }
}

// `jq --version` runs once a session however many places ask (the draw decision, the progress reminder,
// the install hint): they all share this one answer.
function rowJq($) {
  if (!rowState.jqAnswer) {
    rowState.jqAnswer = rowProbeJq($).then((has) => {
      rowState.hasJq = has
      return has
    })
  }
  return rowState.jqAnswer
}

// Without jq the agent panel below the prompt (scripts/subagent-row.sh) stays the host's own: no model, no
// effort. Said once, as a toast, never as a question: the person decides whether they want it.
async function rowJqHint($) {
  try {
    const surfaces = await $.session.surfaces()
    rowState.surfaces = surfaces
    if (!Array.isArray(surfaces) || surfaces.length === 0) return
    if ((await $.env.get('CREW_CHIEF_ROW')) === 'off') return
    if (await $.store.get('jq_hint')) return
    if (await rowJq($)) return
    await $.store.set('jq_hint', 'shown')
    const lang = await resolveLang($)
    const windows = platformFromOs(await $.env.get('OS')) === 'win32'
    const install = windows ? 'winget install jqlang.jq (then open a new terminal)' : 'brew install jq (macOS) or your package manager'
    $.ui.toast(t(lang, 'row_jq_hint', { install }), { timeoutMs: 20000 })
  } catch (err) {
    // A missing hint is no problem.
  }
}

// True when the shell progress hook cannot work here (no jq), so the mod sends the progress reminders itself.
// `jq --version` is run once a session, the first time it matters.
export async function rowShellHookDead($) {
  try {
    return (await rowJq($)) === false
  } catch (err) {
    return false // unknown: the shell hook keeps the job, so nobody is reminded twice
  }
}

// Decided at session start and again at most every ROW_RECHECK_MS (a Desktop or VS Code client can attach).
async function rowCheckWanted($, force) {
  let now
  try {
    now = await $.clock.now()
  } catch (err) {
    return false
  }
  if (!force && rowState.checkedAt !== undefined && now - rowState.checkedAt < ROW_RECHECK_MS) return rowState.wanted === true
  let wanted = false
  try {
    const mode = await $.env.get('CREW_CHIEF_ROW_MOD')
    const surfaces = await $.session.surfaces()
    const platform = platformFromOs(await $.env.get('OS'))
    let hasJq = rowState.hasJq
    if (hasJq === undefined && jqMatters({ mode, surfaces, platform })) hasJq = await rowJq($)
    wanted = rowWanted({ mode, surfaces, platform, hasJq })
  } catch (err) {
    wanted = false
  }
  rowState.wanted = wanted
  rowState.checkedAt = now
  return wanted
}

function rowClear($) {
  if (!rowState.shown) return
  rowState.shown = false
  rowState.lastText = undefined
  try {
    $.ui.status(undefined)
  } catch (err) {
    // Nothing to clear then.
  }
}

function rowAgentName(a) {
  if (typeof a.teammateId === 'string' && a.teammateId !== '') return a.teammateId.replace(/@.*$/, '')
  return a.type || a.description || 'agent'
}

async function rowDraw($) {
  try {
    if (!(await rowCheckWanted($, false))) {
      rowClear($)
      return
    }
    // The band (hooks/src/crew-ui.js) says the same where it is drawn: no second line then.
    if (uiCovers(rowState.surfaces)) {
      rowClear($)
      return
    }
    let list
    try {
      list = await $.agent.list()
    } catch (err) {
      list = []
    }
    const rows = []
    for (const a of Array.isArray(list) ? list : []) {
      if (!a || !ROW_LIVE.includes(a.status) || rowState.done.has(a.id)) continue
      const info = rowState.agents.get(a.id) ?? {}
      rows.push({ name: rowAgentName(a), model: info.model, effort: info.effort, tokens: info.tokens, pct: await progressPct($, a.id) })
    }
    const text = formatRow(rows)
    if (text === undefined) {
      rowClear($)
      return
    }
    if (text === rowState.lastText && rowState.shown) return
    $.ui.status(text)
    rowState.shown = true
    rowState.lastText = text
    $.ui.log('crew-chief: agent row = ' + text, { to: 'debug' })
  } catch (err) {
    // A missing line is better than a broken turn.
  }
}

// The surfaces as last read (for the band's questions).
export function rowSurfaces() {
  return rowState.surfaces
}

// The live subagents for the band: name, model, effort, tokens and the fresh progress report.
export async function rowBandRows($) {
  let list
  try {
    list = await $.agent.list()
  } catch (err) {
    list = []
  }
  const rows = []
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || !ROW_LIVE.includes(a.status) || rowState.done.has(a.id)) continue
    const info = rowState.agents.get(a.id) ?? {}
    const prog = await progressInfo($, a.id)
    rows.push({ name: rowAgentName(a), model: info.model, effort: info.effort, tokens: info.tokens, pct: prog?.pct, step: prog?.step })
  }
  return rows
}

// Every subagent of this session for the timeline pane: when it started, when it ended, its model, effort and
// tokens, and whether it still runs or waits. Newest last, at most `max`.
export async function rowTimeline($, max = 10) {
  let list
  try {
    list = await $.agent.list()
  } catch (err) {
    list = []
  }
  const live = new Map((Array.isArray(list) ? list : []).filter((a) => a && typeof a.id === 'string').map((a) => [a.id, a]))
  const rows = []
  for (const [id, info] of rowState.agents) {
    if (typeof info.startMs !== 'number') continue
    const a = live.get(id)
    if (a) info.name = rowAgentName(a)
    const done = info.endMs !== undefined || rowState.done.has(id)
    const prog = done ? undefined : await progressInfo($, id)
    rows.push({
      name: info.name ?? 'agent',
      model: info.model,
      effort: info.effort,
      tokens: info.tokens,
      status: done ? 'done' : a && a.status === 'waiting' ? 'waiting' : 'running',
      startMs: info.startMs,
      endMs: done ? info.endMs ?? info.startMs : undefined,
      pct: prog?.pct,
      step: prog?.step,
    })
  }
  rows.sort((x, y) => x.startMs - y.startMs)
  return rows.slice(-max)
}

// At most one redraw waits at a time; several requests in a burst draw once.
function rowSchedule($) {
  if (rowState.drawPending) return
  rowState.drawPending = true
  try {
    $.clock.after(ROW_DRAW_DELAY_MS, () => {
      rowState.drawPending = false
      rowDraw($)
    })
  } catch (err) {
    rowState.drawPending = false
  }
}

// Skip the timer while the line is known to be unwanted (rechecked every ROW_RECHECK_MS).
async function rowMaybeSchedule($) {
  if (rowState.wanted === false && !rowState.shown && rowState.checkedAt !== undefined) {
    const now = await $.clock.now()
    if (now - rowState.checkedAt < ROW_RECHECK_MS) return
  }
  rowSchedule($)
}

// Called by the turn.step hook in register.js with the request as it goes out (the saver's cap applied).
export async function rowStepStart($, request) {
  try {
    if (request.agentId === undefined) return
    const prev = rowState.agents.get(request.agentId) ?? {}
    rowState.agents.set(request.agentId, { ...prev, model: request.model, effort: request.effort, startMs: prev.startMs ?? (await $.clock.now()) })
    rowState.done.delete(request.agentId)
    uiTouch($)
    await rowMaybeSchedule($)
  } catch (err) {
    // Never in the way of a request.
  }
}

// ...and with its result: the tokens of the agent's latest request.
export async function rowStepEnd($, request, result) {
  try {
    if (request.agentId === undefined) return
    const tokens = usageTokens(result?.usage)
    if (tokens === undefined) return
    const prev = rowState.agents.get(request.agentId) ?? {}
    rowState.agents.set(request.agentId, { ...prev, tokens })
    uiTouch($)
    await rowMaybeSchedule($)
  } catch (err) {
    // Never in the way of a request.
  }
}

// The host takes one hook per event from a module (no second unmatched session.start, session.end or
// turn.complete), so register.js calls these from its own hooks.
export function rowSessionStart($) {
  rowClear($) // a line left from before /clear or /resume
  rowState = freshRow()
  // Not awaited: `jq --version` must not hold the session's start.
  rowCheckWanted($, true).catch(() => {})
  rowJqHint($).catch(() => {})
}

export function rowSessionEnd($) {
  rowClear($)
  rowState = freshRow()
}

// A subagent's turn ended: off the line now, even if the list still says running. The main turn's end
// is a second chance to clear a line that nothing else redraws.
export async function rowTurnComplete($, e) {
  try {
    if (e.agentId !== undefined) {
      rowState.done.add(e.agentId)
      const info = rowState.agents.get(e.agentId)
      if (info && info.endMs === undefined) rowState.agents.set(e.agentId, { ...info, endMs: await $.clock.now() })
    }
    uiTouch($)
    if (rowState.shown || e.agentId !== undefined) await rowMaybeSchedule($)
  } catch (err) {
    // The turn ends either way.
  }
}
