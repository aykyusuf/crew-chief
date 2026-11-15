// crew-chief panes. Part of the mod in hooks/register.js (Claude Code 2.1.287+). Nothing here opens by itself:
// each pane opens when the person types its command.
//
//   /crew-panel tasks|agents|guard   a pane with the project's tasks.json, a timeline of this session's subagents,
//                                    or what the command guard stopped; /crew-panel close shuts them
//   /crew-guard log                  the guard pane too (the same toggle as /crew-panel guard)
//
// The panes are text lines laid out in hooks/panes-logic.mjs and refreshed every two seconds while one is open.
// On the Desktop app the guard pane is drawn as cards instead (guardView): a header with the guard's state and
// counts, one card per entry newest first, and a pressed card opens to its detail and what to check.
// A pane is closed with its mark, ctrl+x x, or the command; its timer stops with it. Any failure leaves the
// engine's own drawing.
import { rowTimeline } from './agent-row.mjs'
import { AV_PANE_ID, avClosed, avTree } from './agent-view.mjs'
import { uiLinesTree } from './crew-ui.mjs'
import { guardLogList, guardSummary } from './guard.mjs'
import { findHandoff } from './handoff.mjs'
import { resolveLang } from './lang.mjs'
import { CARD_LOOK } from './panel-art-logic.mjs'
import { guardPane, guardView, taskPane, timelinePane } from './panes-logic.mjs'
import { t } from './saver-i18n.mjs'

const PANEL_IDS = { tasks: 'crew-tasks', agents: 'crew-agents', guard: 'crew-guard' }
const PANEL_ROWS = 12
const PANEL_REFRESH_MS = 2000

let panelTimer
const openPanels = new Set()
// What the guard pane draws from besides the guard's own log: the time of the last refresh, the language
// resolved when the pane was opened, the pressed entry. Kept here so drawing reads nothing.
let paneNow = 0
let paneLang = 'en'
let guardSelected

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
  guardSelected = undefined
}

// Called when a session ends or a new one starts: timers do not outlive it.
export function panesReset() {
  panelsStop()
}

function panelsStart($) {
  if (panelTimer) return
  panelTimer = $.clock.every(PANEL_REFRESH_MS, async () => {
    try {
      paneNow = await $.clock.now()
    } catch (err) {
      // The last time stands; the panes still redraw.
    }
    try {
      $.ui.invalidate('ui.render')
    } catch (err) {
      // Nothing to redraw.
    }
  })
}

// The ids of this plugin's panes the engine has open (its record, which survives a reload of the module).
async function openPaneIds($) {
  try {
    const list = await $.ui.panes()
    return (Array.isArray(list) ? list : []).map((pane) => pane && pane.id).filter((id) => typeof id === 'string')
  } catch (err) {
    return []
  }
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

// Theme keys for the tones guardView hands out: the cards take the person's theme, no fixed palette.
const GUARD_COLOR = { crit: 'error', warn: 'warning', info: 'suggestion', ok: 'success', dim: 'inactive' }

// A card was pressed: open it, or close it when it was open already (a person's act: redrawn at once).
function guardPick($, key) {
  guardSelected = guardSelected === key ? undefined : key
  try {
    $.ui.invalidate('ui.render')
  } catch (err) {
    // Drawn at the next refresh.
  }
}

// The guard pane on the Desktop app, from state only: the guard's log and summary, paneNow, paneLang.
function guardTree($, e) {
  const { Box, Button, Text } = $.ui.resolve(e)
  // Ink and mute are theme keys (they follow a light or dark theme); the card fill and frame are see-through greys.
  const L = { bg: CARD_LOOK.bg, border: CARD_LOOK.border, ink: 'text', mute: 'inactive' }
  const lang = paneLang
  const v = guardView(guardLogList(), { summary: guardSummary(), now: paneNow, selected: guardSelected, lang })
  const txt = (s, props = {}) => Text({ wrap: 'truncate-end', ...props, children: [s] })
  const para = (s, props = {}) => Text({ wrap: 'wrap', ...props, children: [s] })
  const small = (s, color, extra = {}) => txt(s, { color, size: 'footnote', ...extra })
  const chip = (children, borderColor) => Box({ flexDirection: 'row', alignItems: 'center', gap: 1, borderStyle: 'round', borderColor, paddingX: 1, flexShrink: 0, children })
  const spacer = () => Box({ flexGrow: 1, flexShrink: 1, minWidth: 0 })
  const stateColor = v.state === 'on' ? GUARD_COLOR.ok : v.state === 'off' ? GUARD_COLOR.dim : GUARD_COLOR.warn

  const header = Box({
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 1,
    children: [
      txt(v.title, { color: L.ink, weight: 'bold', size: 'heading' }),
      chip([txt('●', { color: stateColor }), small(v.stateLabel, L.ink, { weight: 'medium' })], L.border),
      spacer(),
      ...v.chips.map((c) => {
        const live = c.count > 0
        return chip([txt(c.glyph, { color: live ? GUARD_COLOR[c.tone] : L.mute }), txt(String(c.count), { color: live ? L.ink : L.mute, weight: 'bold', tabular: true }), small(c.label, L.mute)], live ? GUARD_COLOR[c.tone] : L.border)
      }),
    ],
  })

  const card = (r) => {
    const tone = GUARD_COLOR[r.tone]
    const top = Box({
      flexDirection: 'row',
      alignItems: 'center',
      gap: 1,
      minWidth: 0,
      children: [
        Button({ key: r.key, plain: true, label: r.label, onPress: () => guardPick($, r.key), children: [Text({ color: tone, weight: 'bold', children: [r.glyph + ' '] }), Text({ color: L.ink, weight: 'semibold', wrap: 'truncate-end', children: [r.label] })] }),
        spacer(),
        small(r.ago, L.mute, { tabular: true }),
      ],
    })
    const meta = [small(r.level, tone, { weight: 'medium' })]
    if (r.rule) meta.push(small(t(lang, 'gp_rule'), L.mute), small(r.rule, L.ink, { mono: true }))
    if (r.hosts) meta.push(small(t(lang, 'gp_host'), L.mute), small(r.hosts.join(', '), L.ink, { mono: true }))
    if (r.readOnly) meta.push(small(t(lang, 'gp_readonly'), L.mute))
    const children = [top, Box({ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 1, minWidth: 0, children: meta })]
    if (r.detail) {
      children.push(
        Box({
          flexDirection: 'column',
          marginTop: 1,
          gap: 1,
          children: [
            para(r.detail.text, { color: L.ink, mono: true, size: 'footnote' }),
            txt(t(lang, 'gp_check_title'), { color: L.mute, size: 'caption', weight: 'semibold' }),
            ...r.detail.checks.map((c) => para('› ' + c, { color: L.ink, size: 'footnote' })),
          ],
        }),
      )
    }
    return Box({ key: 'card-' + r.key, flexDirection: 'column', borderStyle: 'round', borderColor: r.selected ? tone : L.border, backgroundColor: L.bg, paddingX: 1, hover: { borderColor: tone }, children })
  }

  const children = [header]
  if (v.hint) children.push(txt(v.hint, { color: L.mute, size: 'caption' }))
  if (v.empty) children.push(Box({ flexDirection: 'row', alignItems: 'center', gap: 1, borderStyle: 'round', borderColor: L.border, backgroundColor: L.bg, paddingX: 1, paddingY: 1, children: [txt('●', { color: stateColor }), para(v.empty, { color: L.ink })] }))
  for (const r of v.rows) children.push(card(r))
  if (v.moreLabel) children.push(small(v.moreLabel, L.mute))
  const f = v.footer
  children.push(Box({ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 1, marginTop: 1, children: [small(f.command, L.ink, { mono: true }), small(f.label, L.mute), small('·', L.mute), small(t(lang, 'gp_config'), L.mute), small(f.path, L.mute, { mono: true })] }))
  return Box({ flexDirection: 'column', gap: 1, children })
}

export function registerPanes(on) {
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    try {
      // The agent view of /crew-agents (hooks/src/agent-view.js) draws in this same hook.
      if (e.requestId === AV_PANE_ID) return avTree($, e)
      if (!Object.values(PANEL_IDS).includes(e.requestId)) return next(e)
      if (e.requestId === PANEL_IDS.guard && e.surface === 'desktop') return guardTree($, e)
      return await panelTree($, e)
    } catch (err) {
      return next(e)
    }
  })

  // Closed by the person (the mark, ctrl+x x) or by a command: the refresh timer goes when none is left.
  on('ui.close', async ($, e, next) => {
    try {
      if (e.id === AV_PANE_ID) avClosed()
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
      // Every pane of ours the engine has open, whatever this module remembers (it may have been reloaded).
      const ids = new Set([...Object.values(PANEL_IDS), ...(await openPaneIds($)).filter((id) => id.startsWith('crew-'))])
      for (const id of ids) {
        try {
          await $.ui.close({ id })
        } catch (err) {
          // Not open.
        }
      }
      panelsStop()
      avClosed()
      return { text: 'crew-panel: closed.' }
    }
    return panelToggle($, word)
  })

  // /crew-guard log opens the guard pane; every other /crew-guard word goes on to the guard (hooks/src/guard.js).
  on('command.run', { command: 'crew-guard' }, async ($, e, next) => {
    if (String(e.args || '').trim().toLowerCase() !== 'log') return next(e)
    return panelToggle($, 'guard')
  })
}

// /crew-panel <word> and /crew-guard log: open the pane, or close it when it is open already.
async function panelToggle($, word) {
  const id = PANEL_IDS[word]
  // The same command again closes its pane: no second command to remember.
  if (id !== undefined && (await openPaneIds($)).includes(id)) {
    try {
      await $.ui.close({ id })
    } catch (err) {
      // Gone already.
    }
    openPanels.delete(id)
    if (openPanels.size === 0) panelsStop()
    return { text: `crew-panel: ${word} pane closed.` }
  }
  if (id === undefined) return { text: 'crew-panel: tasks (tasks.json of this project) | agents (a timeline of this session\'s subagents) | guard (what the command guard stopped) | close.' }
  // Read now, not while drawing: the guard pane's clock and language.
  try {
    paneNow = await $.clock.now()
    paneLang = await resolveLang($)
  } catch (err) {
    // The last ones stand.
  }
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
