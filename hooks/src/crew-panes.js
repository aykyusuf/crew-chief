// crew-chief panes. Part of the mod in hooks/register.js (Claude Code 2.1.287+). Nothing here opens by itself:
// each pane opens when the person types its command.
//
//   /crew-panel tasks|agents|guard   a pane with the project's tasks.json, a timeline of this session's subagents,
//                                    or what the command guard stopped; /crew-panel close shuts them
//
// The panes are text lines laid out in hooks/panes-logic.mjs and refreshed every two seconds while one is open.
// A pane is closed with its mark, ctrl+x x, or the command; its timer stops with it. Any failure leaves the
// engine's own drawing.
import { rowTimeline } from './agent-row.mjs'
import { uiLinesTree } from './crew-ui.mjs'
import { guardLogList } from './guard.mjs'
import { findHandoff } from './handoff.mjs'
import { guardPane, taskPane, timelinePane } from './panes-logic.mjs'

const PANEL_IDS = { tasks: 'crew-tasks', agents: 'crew-agents', guard: 'crew-guard' }
const PANEL_ROWS = 12
const PANEL_REFRESH_MS = 2000

let panelTimer
const openPanels = new Set()

function stopTimer(timer) {
  try {
    if (timer) timer.cancel()
  } catch (err) {
    // Already stopped.
  }
}

function panelsStop() {
  stopTimer(panelTimer)
  panelTimer = undefined
  openPanels.clear()
}

// Called when a session ends or a new one starts: timers do not outlive it.
export function panesReset() {
  panelsStop()
}

function panelsStart($) {
  if (panelTimer) return
  panelTimer = $.clock.every(PANEL_REFRESH_MS, () => {
    try {
      $.ui.invalidate('ui.render')
    } catch (err) {
      // Nothing to redraw.
    }
  })
}

const pad2 = (n) => String(n).padStart(2, '0')
const clockLabel = (ms) => {
  const d = new Date(ms)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

async function readTasks($) {
  const h = await findHandoff($)
  if (!h || !h.tasks) return undefined
  try {
    return await $.fs.read(h.tasks)
  } catch (err) {
    return undefined
  }
}

async function panelTree($, e) {
  const columns = typeof e.props?.bodyColumns === 'number' ? e.props.bodyColumns : 100
  const maxLines = PANEL_ROWS - 2
  let pane
  if (e.requestId === PANEL_IDS.tasks) {
    const text = await readTasks($)
    pane = text === undefined ? { header: [{ t: 'tasks ', tone: 'dim' }, { t: 'no tasks.json found for this project', tone: 'dim' }], lines: [] } : taskPane(text, { width: columns, maxLines })
    if (pane.error) pane = { header: [{ t: 'tasks ', tone: 'dim' }, { t: pane.error, tone: 'crit' }], lines: [] }
  } else if (e.requestId === PANEL_IDS.agents) {
    pane = timelinePane(await rowTimeline($), await $.clock.now(), { width: columns, barWidth: Math.max(10, Math.min(30, columns - 62)) })
  } else {
    pane = guardPane(guardLogList(), { width: columns, maxLines, clock: clockLabel })
  }
  const lines = [pane.header, ...pane.lines]
  if (pane.lines.length === 0) lines.push([{ t: e.requestId === PANEL_IDS.guard ? 'nothing stopped or warned yet this session' : 'nothing to show yet', tone: 'dim' }])
  return uiLinesTree($, e, lines)
}

export function registerPanes(on) {
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    try {
      if (!Object.values(PANEL_IDS).includes(e.requestId)) return next(e)
      return await panelTree($, e)
    } catch (err) {
      return next(e)
    }
  })

  // Closed by the person (the mark, ctrl+x x) or by a command: the refresh timer goes when none is left.
  on('ui.close', async ($, e, next) => {
    try {
      if (Object.values(PANEL_IDS).includes(e.id)) {
        openPanels.delete(e.id)
        if (openPanels.size === 0) {
          stopTimer(panelTimer)
          panelTimer = undefined
        }
      }
    } catch (err) {
      // The pane closes either way.
    }
    return next(e)
  })

  on('command.run', { command: 'crew-panel' }, async ($, e) => {
    const word = String(e.args || '').trim().toLowerCase()
    if (word === 'close') {
      for (const id of Object.values(PANEL_IDS)) {
        try {
          await $.ui.close({ id })
        } catch (err) {
          // Not open.
        }
      }
      panelsStop()
      return { text: 'crew-panel: closed.' }
    }
    const id = PANEL_IDS[word]
    if (id === undefined) return { text: 'crew-panel: tasks (tasks.json of this project) | agents (a timeline of this session\'s subagents) | guard (what the command guard stopped) | close.' }
    let opened
    try {
      opened = await $.ui.open({ id, title: word[0].toUpperCase() + word.slice(1), focus: true, closeOnEscape: true, rows: PANEL_ROWS })
    } catch (err) {
      return { text: 'crew-panel: the pane could not be opened (' + String(err && err.message ? err.message : err).slice(0, 120) + ').' }
    }
    if (opened && opened.isPlaced === false) return { text: 'crew-panel: no room for the pane (' + String(opened.reason ?? 'unknown') + ').' }
    openPanels.add(id)
    panelsStart($)
    return { text: `crew-panel: ${word} pane open (refreshes every 2 s; Esc or ctrl+x x closes it).` }
  })
}

// Called from the mod's session.start: the commands exist from the first moment.
export async function panesSessionStart($) {
  panesReset()
  for (const [name, description, argumentHint] of [
    ['crew-panel', 'Open a pane: tasks, agents, guard', '[tasks|agents|guard|close]'],
  ]) {
    try {
      // immediate: the command also runs while a subagent works, which is when the agents pane is wanted.
      await $.command.register({ name, description, argumentHint, immediate: true })
    } catch (err) {
      // The name is taken: the other commands still work.
    }
  }
}
