// crew-chief agent view and agent-done notices. Part of the mod in hooks/register.js (Claude Code 2.1.287+).
//
// On the Desktop app a subagent cannot be opened and watched the way the terminal allows, and its end is easy
// to miss. Two things help:
//   - a notice when a subagent finishes: a toast ("implementer finished: 3:35 · 58k · 14 calls") and the same
//     as a system notification through the person's own channel ($.ui.notify). Runs that end within
//     NOTIFY_BATCH_MS share one notice; a run shorter than notify.min, a run the person stopped, a teammate's
//     turn and the engine's own forks are not announced. /crew-config notify.agent, notify.native, notify.min.
//   - /crew-agents: a pane with this session's subagents (count chips; running ones first, then finished, each
//     row a button) and, for the one picked, a title (status, time, tokens), its report wrapped and folded, its
//     last steps from its transcript ($.session.messages({ agentId })) with each result summarised, and, on the
//     Desktop app, a message field with a send button.
// Reads happen in events (the command, a press, the agents' own turn.step / tool.call / turn.complete,
// throttled to one refresh per VIEW_REFRESH_MS, and a slow tick while the pane is open), never while
// drawing: the pane's hook only draws what the last refresh kept. The transcript is kept in memory for the
// open pane alone; it is never written, stored, logged or sent, and is dropped when the pane closes.
// Any failure leaves the turn, the call and the engine's own drawing alone.
import { resolveLang } from './lang.mjs'
import { cfgGet } from './config.mjs'
import { rowAgentFacts, rowRefreshSurfaces, rowTimeline } from './agent-row.mjs'
import { progressStats } from './progress.mjs'
import { uiAskStart, uiAsking } from './crew-ui.mjs'
import { t } from './saver-i18n.mjs'
import { CARD_LOOK, modelColor } from './panel-art-logic.mjs'
import {
  NOTIFY_BATCH_MS,
  VIEW_LIST_MAX,
  VIEW_REFRESH_MS,
  agentListLine,
  bandSection,
  checkMessage,
  MESSAGE_MAX,
  MSG_KEPT,
  msgFallback,
  msgPending,
  msgTrack,
  msgView,
  nativeWanted,
  notifyText,
  notifyWanted,
  VIEW_FINISHED_MAX,
  paneChips,
  paneDetail,
  paneGroups,
  paneRow,
  pickSelected,
  reportFold,
  sendPlan,
  throttlePlan,
  toggleOpen,
  trDative,
} from './agent-view-logic.mjs'

export const AV_PANE_ID = 'crew-agent-view'
const AV_TICK_MS = 5000 // while the pane is open: durations move, an agent that left the list is seen
const AV_ANSWER_MAX = 4000 // characters of an agent's report kept for the pane
const AV_ANSWERS_KEPT = 30
const AV_CONFIRM_MS = 60_000 // a send that restarts a finished agent waits this long for a yes, then is dropped

function avFresh() {
  return {
    open: false,
    selected: undefined,
    snapshot: undefined, // { chips, rows, detail } as the last refresh left it; what the pane draws
    finishedAll: false, // the pane lists every finished agent, not only the newest VIEW_FINISHED_MAX
    reportOpenFor: undefined, // the agent whose report is shown whole
    detailFor: undefined, // the agent the detail was read for
    detailStale: true,
    selectedLive: false, // the picked agent still runs (the slow tick reads its transcript again)
    paneDrafts: new Map(), // agentId -> what is typed in the pane's message field; never stored, gone with the pane
    paneNotes: new Map(), // agentId -> { kind: 'error', text }: the line under the field when a message is refused
    // agentId -> the bubbles sent from the pane (agent-view-logic msgTrack): in memory for the session alone, never
    // stored, logged or sent anywhere; kept when the pane closes, gone with the session.
    paneSent: new Map(),
    lastRefreshAt: undefined,
    refreshBooked: false,
    tick: undefined,
    ended: new Map(), // agentId -> { reason, answer }: in memory, for the pane's status and report
    announced: new Set(), // agentId|turnId of runs already counted for a notice
    batch: [],
    batchBooked: false,
    mainEndedAt: undefined,
    // Agents opened in the band (a click on their row, hooks/src/crew-ui.js); the same refresh and throttle as
    // the pane. In memory only, gone with the session or a reload of the module.
    band: {
      open: [], // agent ids, oldest first (toggleOpen)
      cache: new Map(), // agentId -> { section, done, name, rowLine, stale }: what the band draws for it
      composing: new Set(), // agents whose message field is shown
      drafts: new Map(), // agentId -> the text being typed, until it is sent or the field closes; never stored
    },
  }
}

let avState = avFresh()
let avLang = 'en' // the language of the last refresh, for the one line drawn without one

function avStopTick() {
  try {
    if (avState.tick) avState.tick.cancel()
  } catch (err) {
    // Already stopped.
  }
  avState.tick = undefined
}

// A new session, /clear, /resume or the session's end: nothing of the last one stays.
export function avReset() {
  avStopTick()
  avState = avFresh()
}

// The pane was closed (its mark, ctrl+x x, Esc, /crew-agents again, /crew-panel close): the transcript goes too.
export function avClosed() {
  avStopTick()
  avState.open = false
  avState.snapshot = undefined
  avState.detailFor = undefined
  avState.detailStale = true
  avState.finishedAll = false
  avState.reportOpenFor = undefined
  avState.paneDrafts.clear()
  avState.paneNotes.clear()
}

// ---- the notice ----------------------------------------------------------------------------------

async function avFlush($) {
  avState.batchBooked = false
  const items = avState.batch
  avState.batch = []
  if (items.length === 0) return
  try {
    const lang = await resolveLang($)
    const text = notifyText(lang, items)
    if (text === '') return
    if ((await cfgGet($, 'notify.agent')) === 'on') $.ui.toast(text, { timeoutMs: 10000 })
    const native = nativeWanted({ nativeOn: (await cfgGet($, 'notify.native')) === 'on', mainEndedAt: avState.mainEndedAt, firstEndAt: Math.min(...items.map((i) => i.endedAt)) })
    if (native) {
      try {
        await $.ui.notify(text, { title: 'crew-chief' })
      } catch (err) {
        // No channel, notifications off, or a hook refused it: the toast has said it.
      }
    }
  } catch (err) {
    // A missed notice is better than a broken turn.
  }
}

async function avAnnounce($, e, now) {
  const toast = (await cfgGet($, 'notify.agent')) === 'on'
  const native = (await cfgGet($, 'notify.native')) === 'on'
  if (!toast && !native) return
  const key = e.agentId + '|' + String(e.turnId)
  const facts = rowAgentFacts(e.agentId) ?? {}
  let known = facts.name !== undefined
  let teammate = facts.teammate === true
  let name = facts.name
  if (!known) {
    // An agent whose first request the mod missed is still named by the list (it may say completed now).
    try {
      const list = await $.agent.list()
      const found = (Array.isArray(list) ? list : []).find((a) => a && a.id === e.agentId)
      if (found) {
        known = true
        teammate = typeof found.teammateId === 'string' && found.teammateId !== ''
        name = found.name || found.type || found.description || 'agent'
      }
    } catch (err) {
      // Unknown: not announced.
    }
  }
  const durationMs = typeof e.durationMs === 'number' ? e.durationMs : typeof facts.startMs === 'number' ? now - facts.startMs : undefined
  const minSec = await cfgGet($, 'notify.min')
  if (!notifyWanted({ known, teammate, reason: e.reason, durationMs, minSec, already: avState.announced.has(key) })) return
  avState.announced.add(key)
  avState.batch.push({ name, durationMs, tokens: facts.tokens, calls: progressStats(e.agentId)?.calls, error: e.reason === 'error' || e.reason === 'refusal', endedAt: now })
  if (avState.batchBooked) return
  avState.batchBooked = true
  try {
    $.clock.after(NOTIFY_BATCH_MS, () => {
      avFlush($)
    })
  } catch (err) {
    avState.batchBooked = false
  }
}

// Called from the mod's turn.complete hook for every turn: the main loop's end is noted (the host raises its
// own notice then), a subagent's run is remembered for the pane and, maybe, announced.
export async function avTurnComplete($, e) {
  try {
    const now = await $.clock.now()
    if (e.agentId === undefined) {
      avState.mainEndedAt = now
      return
    }
    const answer = typeof e.answer === 'string' ? e.answer.slice(0, AV_ANSWER_MAX) : undefined
    avState.ended.delete(e.agentId)
    avState.ended.set(e.agentId, { reason: e.reason, answer, durationMs: typeof e.durationMs === 'number' ? e.durationMs : undefined, at: now })
    while (avState.ended.size > AV_ANSWERS_KEPT) avState.ended.delete(avState.ended.keys().next().value)
    await avAnnounce($, e, now)
    avNote($, e.agentId)
  } catch (err) {
    // The turn ends either way.
  }
}

// ---- the pane ------------------------------------------------------------------------------------

// One refresh for both readers: the pane when it is open, the agents opened in the band. Only from events,
// presses and the pane's tick (throttled by avNote), never while drawing.
async function avRefresh($) {
  try {
    if (!avState.open && avState.band.open.length === 0) return
    const now = await $.clock.now()
    avState.lastRefreshAt = now
    const lang = await resolveLang($)
    avLang = lang
    if (avState.open) await avPaneRefresh($, now, lang)
    if (avState.band.open.length > 0) await avBandRefresh($, now, lang)
    $.ui.invalidate('ui.render')
  } catch (err) {
    // The pane and the band keep what they drew last.
  }
}

async function avPaneRefresh($, now, lang) {
  try {
    // Only agents the list named: the engine's own forks (compaction, memory) make requests too.
    const named = (await rowTimeline($, VIEW_LIST_MAX * 2)).filter((r) => rowAgentFacts(r.id)?.name !== undefined)
    const rows = named.slice(-VIEW_LIST_MAX).reverse().map((r) => {
      const ended = avState.ended.get(r.id)
      const error = r.failed === true || (ended !== undefined && (ended.reason === 'error' || ended.reason === 'refusal'))
      return { ...r, status: error ? 'error' : r.status }
    })
    const selected = pickSelected(rows, avState.selected)
    avState.selected = selected
    let detail = avState.snapshot?.detail
    if (selected === undefined) {
      detail = undefined
    } else if (avState.detailStale || avState.detailFor !== selected || detail === undefined) {
      const row = rows.find((r) => r.id === selected)
      let found
      try {
        found = await $.session.messages({ agentId: selected })
      } catch (err) {
        found = { deny: String(err && err.message ? err.message : err) }
      }
      const ended = avState.ended.get(selected)
      avPaneTrack(selected, found, ended)
      detail = paneDetail(
        {
          name: row?.name ?? rowAgentFacts(selected)?.name,
          row,
          messages: Array.isArray(found) ? found : undefined,
          deny: Array.isArray(found) ? undefined : String(found?.deny ?? 'unknown'),
          answer: ended?.answer,
          done: row ? row.status === 'done' || row.status === 'error' : ended !== undefined,
          calls: progressStats(selected)?.calls,
        },
        { lang, now },
      )
      avState.detailFor = selected
      avState.detailStale = false
    } else {
      // Only the figures move between two reads of the transcript.
      const row = rows.find((r) => r.id === selected)
      if (row) {
        const fresh = paneRow(row, now)
        detail = { ...detail, title: { ...detail.title, time: fresh.time, tokens: fresh.tokens } }
      }
    }
    const picked = rows.find((r) => r.id === selected)
    avState.selectedLive = picked !== undefined && (picked.status === 'running' || picked.status === 'waiting' || picked.status === 'background')
    avState.snapshot = { chips: paneChips(rows, lang), rows: rows.map((r) => paneRow(r, now)), detail }
  } catch (err) {
    // The pane keeps what it drew last.
  }
}

// The picked agent's bubbles moved by what was just read: its transcript when the session can read it, and its
// tool calls and the end of its run since each was sent.
function avPaneTrack(id, found, ended) {
  const sent = avState.paneSent.get(id)
  if (!sent || sent.length === 0) return
  // Both only move a bubble forward: the transcript first, then what the agent did since, for a message the
  // transcript does not show as sent (framed or escaped differently).
  avState.paneSent.set(id, msgFallback(msgTrack(sent, found), { calls: progressStats(id)?.calls, endedAt: ended?.at, answer: ended?.answer }))
}

// An agent did something (a request, a tool call, the end of its run): refresh the open pane, at most once
// per VIEW_REFRESH_MS, the last event never lost. Not awaited by the hooks that call it.
export function avNote($, agentId) {
  // An open agent did something: read it again (a finished one that runs again after a message, too).
  const cached = agentId !== undefined ? avState.band.cache.get(agentId) : undefined
  if (cached) cached.stale = true
  if (!avState.open && avState.band.open.length === 0) return
  if (agentId !== undefined && agentId === avState.selected) avState.detailStale = true
  $.clock
    .now()
    .then((now) => {
      const plan = throttlePlan(avState.lastRefreshAt, now, VIEW_REFRESH_MS, avState.refreshBooked)
      if (plan.run === 'now') return avRefresh($)
      if (plan.run === 'later') {
        avState.refreshBooked = true
        $.clock.after(plan.delayMs, () => {
          avState.refreshBooked = false
          avRefresh($)
        })
      }
      return undefined
    })
    .catch(() => {
      avState.refreshBooked = false
    })
}

// A row was pressed: show that agent (a person's act, so no throttle).
function avSelect($, id) {
  avState.selected = id
  avState.paneNotes.clear()
  avState.detailStale = true
  avRefresh($)
}

// A press that only changes what is shown of the last refresh: no read, a redraw.
function avRedraw($) {
  try {
    $.ui.invalidate('ui.render')
  } catch (err) {
    // Nothing to redraw.
  }
}

// Theme keys for the tones, so the pane follows the theme the person picked; the model colour is the band's.
const AV_TONE = { ok: { color: 'success' }, warn: { color: 'warning' }, crit: { color: 'error' }, info: { color: 'suggestion' }, dim: { dimColor: true } }

// The pane's drawing, from the last refresh only (no reads here). The terminal and VS Code get the same tree;
// a tint marks the picked row on the Desktop app, a ▸ elsewhere. Text wraps: nothing the person needs is cut.
export function avTree($, e) {
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const desktop = e.surface === 'desktop'
  const lang = avLang
  const txt = (s, props = {}) => Text({ wrap: 'wrap', ...props, children: [s] })
  const one = (s, props = {}) => Text({ wrap: 'truncate-end', ...props, children: [s] }) // a name or an argument: one line
  const mute = (s, props = {}) => txt(s, { dimColor: true, ...props })
  const label = (s) => mute(s, { size: 'footnote', weight: 'semibold' })
  // A section's title and, beside it, what the section is, in a few words.
  const heading = (title, hint) => line([one(title, { size: 'footnote', weight: 'semibold' }), ...(hint ? [one(hint, { dimColor: true, size: 'footnote' })] : [])])
  const toned = (tone) => AV_TONE[tone] ?? {}
  const col = (children, props = {}) => Box({ flexDirection: 'column', ...props, children })
  const line = (children, props = {}) => Box({ flexDirection: 'row', alignItems: 'center', gap: 1, ...props, children })
  const linkButton = (key, text, onPress) => Button({ key, plain: true, dimColor: true, onPress, children: [Text({ size: 'footnote', children: [text] })] })
  const snap = avState.snapshot
  // No refresh behind it: the session restarted (/clear, /resume) under a pane that stayed on screen.
  if (!snap) return col([mute(t(lang, 'view_reopen'))], { paddingX: 1 })
  const children = []

  // The counts, as small chips.
  if (snap.chips.length > 0) {
    const chip = (c) => Box({ borderStyle: 'round', borderColor: CARD_LOOK.border, paddingX: 1, children: [one(c.text, { ...toned(c.tone), size: 'footnote', weight: 'medium' })] })
    children.push(line(snap.chips.map(chip), { flexWrap: 'wrap' }))
  } else children.push(mute(t(lang, 'view_none')))

  // The list: running first, then finished; each row one button, its time and tokens at the right edge.
  const selected = avState.selected
  const agentRow = (r) => {
    const on = r.id === selected
    const parts = []
    if (!desktop) parts.push(Text({ color: 'suggestion', weight: 'bold', children: [on ? '▸ ' : '  '] }))
    parts.push(Text({ ...toned(r.tone), children: [r.glyph + ' '] }))
    parts.push(one(r.name, { color: modelColor(r.rawModel), weight: on ? 'bold' : 'medium' }))
    if (r.model) parts.push(one('  ' + r.model, { dimColor: true, size: 'footnote' }))
    // Its group says running or finished; a wait or a failure is said in words too.
    if (r.status === 'waiting' || r.status === 'background' || r.status === 'error') parts.push(one('  ' + t(lang, 'view_status_' + r.status), { ...toned(r.tone), size: 'footnote' }))
    const figures = [r.time, r.tokens].filter((x) => x !== '').join(' · ')
    const look = desktop ? (on ? { backgroundColor: CARD_LOOK.border } : { hover: { backgroundColor: CARD_LOOK.bg } }) : {}
    return Box({
      key: 'row-' + r.id,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 1,
      paddingX: 1,
      ...look,
      children: [Button({ key: 'agent-' + r.id, plain: true, onPress: () => avSelect($, r.id), children: parts }), one(figures || ' ', { dimColor: !on, tabular: true, size: 'footnote' })],
    })
  }
  const groups = paneGroups(snap.rows, { selected, all: avState.finishedAll })
  const finishedTotal = snap.rows.filter((r) => !r.live).length
  if (groups.running.length > 0) children.push(col([label(t(lang, 'view_group_running')), ...groups.running.map(agentRow)]))
  if (groups.finished.length > 0) {
    const list = [label(t(lang, 'view_group_done')), ...groups.finished.map(agentRow)]
    if (groups.hidden > 0 || (avState.finishedAll && finishedTotal > VIEW_FINISHED_MAX)) {
      const more = groups.hidden > 0
      list.push(
        linkButton('pane-more-agents', more ? t(lang, 'view_show_more', { n: groups.hidden }) : t(lang, 'view_show_less'), () => {
          avState.finishedAll = more
          avRedraw($)
        }),
      )
    }
    children.push(col(list))
  }

  // The picked agent: title, task, report, last steps.
  const d = snap.detail
  const id = selected
  const listed = id !== undefined && snap.rows.some((r) => r.id === id)
  if (d && listed) {
    const ti = d.title
    const facts = [ti.model, ti.time, ti.tokens ? t(lang, 'view_tokens', { n: ti.tokens }) : '', ti.calls].filter((x) => x !== '').join(' · ')
    const section = [
      col([
        line([one(ti.name, { color: modelColor(ti.rawModel), weight: 'bold', size: 'heading' }), one(ti.glyph + ' ' + ti.statusText, { ...toned(ti.tone), size: 'footnote', weight: 'medium' })]),
        ...(facts ? [mute(facts, { size: 'footnote', tabular: true })] : []),
      ]),
    ]
    if (d.deny) section.push(txt(d.deny, toned('warn')))
    if (d.task) section.push(col([heading(t(lang, 'view_task'), t(lang, 'view_task_hint')), mute(d.task)]))
    if (d.report) {
      const fold = reportFold(d.report, { open: avState.reportOpenFor === id })
      const paras = fold.shown.map((b) => {
        if (b.kind === 'heading') return txt(b.text, { weight: 'semibold' })
        if (b.kind === 'code') return txt(b.text, { mono: true, dimColor: true })
        if (b.kind === 'bullet') return b.numbered ? txt(b.text) : line([mute('•'), col([txt(b.text)], { flexShrink: 1, flexGrow: 1 })], { alignItems: 'flex-start' })
        return txt(b.text)
      })
      const box = [heading(t(lang, 'view_report'), t(lang, 'view_report_hint')), col(paras, { gap: 'xs' })]
      const folds = reportFold(d.report).hidden > 0
      if (folds) {
        const more = fold.hidden > 0
        box.push(
          linkButton('pane-more-report', more ? t(lang, 'view_report_more', { n: fold.hidden }) : t(lang, 'view_report_less'), () => {
            avState.reportOpenFor = more ? id : undefined
            avRedraw($)
          }),
        )
      }
      section.push(col(box, desktop ? { gap: 'xs', padding: 1, borderStyle: 'round', borderColor: CARD_LOOK.border, backgroundColor: CARD_LOOK.bg } : {}))
    }
    if (d.steps.length > 0) {
      const steps = [heading(t(lang, 'view_steps'), t(lang, 'view_steps_hint'))]
      if (d.hidden > 0) steps.push(mute(t(lang, 'view_earlier', { n: d.hidden }), { size: 'footnote' }))
      for (const st of d.steps) {
        if (st.kind === 'text') {
          steps.push(line([mute('›'), col([txt(st.text, { italic: true })], { flexShrink: 1, flexGrow: 1 })], { alignItems: 'flex-start' }))
          continue
        }
        const top = [one(st.tool, { weight: 'semibold' })]
        if (st.arg) top.push(one(st.arg, { dimColor: true, mono: true, size: 'footnote' }))
        const body = [line(top)]
        if (st.summary) body.push(txt(st.summary, { ...(st.tone === 'ok' ? { dimColor: true } : toned(st.tone)), size: 'footnote' }))
        const mark = Text({ ...toned(st.tone), children: [st.pending ? '◌' : st.tone === 'crit' ? '✗' : '•'] })
        steps.push(line([mark, col(body, { flexShrink: 1, flexGrow: 1 })], { alignItems: 'flex-start' }))
      }
      section.push(col(steps))
    } else if (d.empty) section.push(mute(t(lang, 'view_empty')))
    children.push(col(section, { gap: 1, paddingTop: 1 }))
  }

  // The messages sent to the picked agent from here, oldest first, each a bubble: its text (four lines at most),
  // how long ago, and how far it got (sending, delivered, read, replied; a failure in red with its reason).
  // Drawn from memory: the refreshes moved them, nothing is read here.
  const bubbles = listed ? msgView(avState.paneSent.get(id), { now: avState.lastRefreshAt, lang }) : []
  if (bubbles.length > 0) {
    const rows = [heading(t(lang, 'view_msgs'), t(lang, 'view_msgs_hint'))]
    for (const b of bubbles) {
      const body = [txt(b.text), line([one(b.status, { ...toned(b.tone), size: 'footnote', weight: 'medium' }), ...(b.ago ? [one(b.ago, { dimColor: true, size: 'footnote' })] : [])], { justifyContent: 'space-between' })]
      if (b.reply) body.push(txt(b.reply, { dimColor: true, italic: true, size: 'footnote' }))
      const look = desktop ? { paddingX: 1, borderStyle: 'round', borderColor: b.tone === 'crit' ? 'error' : CARD_LOOK.border, backgroundColor: CARD_LOOK.bg } : { paddingLeft: 2 }
      rows.push(col(body, { key: 'msg-' + b.id, ...look }))
    }
    children.push(col(rows, { gap: 'xs', paddingTop: 1 }))
  }

  // A message to the picked agent (the Desktop app, where a hook knows the field is drawn): one field across the
  // pane, its own submit is the only send control. A finished agent is started again by it: the line under the
  // field and the submit's label ("Restart and send") say so, and that press is the yes; nothing is asked
  // elsewhere. An empty or too long message is said on one more line under it.
  if (listed && desktop && typeof Input === 'function') {
    const done = !avState.selectedLive
    const name = avBandName(id)
    const draft = avState.paneDrafts.get(id)
    const note = avState.paneNotes.get(id)
    const field = Input({
      key: 'pane-msg-' + id,
      placeholder: t(lang, 'view_msg_placeholder', { name: lang === 'tr' ? trDative(name) : name }),
      submitLabel: done ? sendPlan(true, lang).label : t(lang, 'view_msg_send'),
      ...(typeof draft === 'string' ? { value: draft } : {}),
      onInput: (value) => {
        avState.paneDrafts.set(id, typeof value === 'string' ? value : '')
        if (avState.paneNotes.delete(id)) avRedraw($)
      },
      onSubmit: (value) => avPaneSend($, id, value, done),
    })
    // Input is a leaf with no size of its own: the row around it spans the pane and lets it grow.
    const box = [
      heading(t(lang, 'view_msg_title', { name })),
      Box({ key: 'pane-msg-row-' + id, flexDirection: 'row', width: '100%', children: [Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, children: [field] })] }),
      txt(t(lang, done ? 'view_msg_note_done' : 'view_msg_note_live', { name }), { ...(done ? toned('warn') : { dimColor: true }), size: 'footnote' }),
    ]
    if (note) box.push(txt(note.text, { ...toned('crit'), size: 'footnote' }))
    children.push(col(box, { gap: 'xs', paddingTop: 1 }))
  }
  return col(children, { gap: 1, paddingX: 1 })
}

// ---- agents opened in the band -------------------------------------------------------------------

export const avBandName = (id) => String(avState.band.cache.get(id)?.name ?? rowAgentFacts(id)?.name ?? 'agent').replace(/^.*:/, '') || 'agent'

// Reads each open agent that has something new (or was never read); a finished agent is read once and kept
// until it runs again. The band draws what is left here.
async function avBandRefresh($, now, lang) {
  const b = avState.band
  let rows = []
  try {
    rows = await rowTimeline($, 50)
  } catch (err) {
    rows = []
  }
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const id of [...b.open]) {
    const r = byId.get(id)
    const ended = avState.ended.get(id)
    const done = r !== undefined && r.status === 'done'
    const error = r?.failed === true || (ended !== undefined && (ended.reason === 'error' || ended.reason === 'refusal'))
    const prev = b.cache.get(id)
    const name = r?.name ?? rowAgentFacts(id)?.name ?? prev?.name
    const rowLine = r ? agentListLine({ ...r, status: error ? 'error' : r.status }, { now }) : prev?.rowLine
    if (prev && !prev.stale && prev.done === done) {
      b.cache.set(id, { ...prev, name, rowLine })
      continue
    }
    let found
    try {
      found = await $.session.messages({ agentId: id })
    } catch (err) {
      found = { deny: String(err && err.message ? err.message : err) }
    }
    const section = bandSection(
      {
        name,
        messages: Array.isArray(found) ? found : undefined,
        deny: Array.isArray(found) ? undefined : String(found?.deny ?? 'unknown'),
        answer: ended?.answer,
        done,
        error,
        // The host's own figure for a finished run; else what the mod saw of it.
        durationMs: typeof ended?.durationMs === 'number' ? ended.durationMs : r && typeof r.startMs === 'number' ? (typeof r.endMs === 'number' ? r.endMs : now) - r.startMs : undefined,
        tokens: r?.tokens,
        calls: progressStats(id)?.calls,
      },
      { lang },
    )
    b.cache.set(id, { section, done, name, rowLine, stale: false })
  }
}

// What the band needs to draw the open agents; no reads.
export function avBandView() {
  const b = avState.band
  return { open: [...b.open], cache: b.cache, composing: b.composing, lang: avLang }
}

// A row of the band was pressed: open the agent under it, or close it (a person's act: read at once).
export function avBandToggle($, id) {
  const b = avState.band
  const wasOpen = b.open.includes(id)
  b.open = toggleOpen(b.open, id)
  for (const k of [...b.cache.keys()]) if (!b.open.includes(k)) b.cache.delete(k)
  for (const k of [...b.composing]) if (!b.open.includes(k)) b.composing.delete(k)
  for (const k of [...b.drafts.keys()]) if (!b.open.includes(k)) b.drafts.delete(k)
  if (wasOpen) {
    try {
      $.ui.invalidate('ui.render')
    } catch (err) {
      // Nothing to redraw.
    }
    return
  }
  avRefresh($)
}

function avToast($, key, vars) {
  try {
    $.ui.toast(t(avLang, key, vars), { timeoutMs: 8000 })
  } catch (err) {
    // A toast is a courtesy.
  }
}

// The agent's whole transcript in the main view. Called first thing in a press: the host only allows it
// while it answers the person's own input.
export function avBandFullView($, agentId) {
  let asked
  try {
    asked = $.ui.view(agentId === undefined ? {} : { agentId })
  } catch (err) {
    avToast($, 'band_view_deny', { reason: String(err && err.message ? err.message : err).slice(0, 120) })
    return
  }
  Promise.resolve(asked)
    .then((r) => {
      if (r && typeof r.deny === 'string') avToast($, 'band_view_deny', { reason: r.deny.slice(0, 120) })
    })
    .catch((err) => avToast($, 'band_view_deny', { reason: String(err && err.message ? err.message : err).slice(0, 120) }))
}

// The message field of one open agent: shown or hidden (its draft goes with it).
export function avBandCompose($, id) {
  const b = avState.band
  if (b.composing.has(id)) {
    b.composing.delete(id)
    b.drafts.delete(id)
  } else b.composing.add(id)
  try {
    $.ui.invalidate('ui.render')
  } catch (err) {
    // Nothing to redraw.
  }
}

export function avBandDraft(id, value) {
  if (avState.band.composing.has(id)) avState.band.drafts.set(id, typeof value === 'string' ? value : '')
}

export function avBandDraftOf(id) {
  return avState.band.drafts.get(id)
}

// Sends what was typed to the agent ($.session.send). Never an empty message, never more than MESSAGE_MAX
// characters; a finished agent is started again by it, so the person says yes first (the safe answer, first,
// is not to send; no answer within AV_CONFIRM_MS is a no). The text is neither logged nor kept once sent.
export async function avBandSend($, id, value, doneNow) {
  const name = avBandName(id)
  const check = checkMessage(value)
  if (!check.ok) {
    avToast($, check.error === 'empty' ? 'band_empty' : 'band_long', { max: MESSAGE_MAX })
    return
  }
  // The pane says whether its agent still runs; the band's own cache otherwise.
  const done = typeof doneNow === 'boolean' ? doneNow : avState.band.cache.get(id)?.done === true
  const plan = sendPlan(done, avLang)
  if (plan.confirm) {
    const no = t(avLang, 'band_confirm_no')
    const question = t(avLang, 'band_confirm_q', { name })
    if (uiAsking()) {
      avToast($, 'band_confirm_busy')
      return
    }
    // As askWithDeadline does: the surfaces read again when the start-up read gave none, and the dialog when the
    // band cannot ask (a surface it does not cover); a dismissed dialog is a no.
    await rowRefreshSurfaces($)
    const ask = uiAskStart($, question, [no, plan.label])
    let asked
    try {
      asked = ask !== undefined ? ask.promise : $.ui.ask(question, [no, plan.label])
    } catch (err) {
      asked = Promise.resolve(no)
    }
    Promise.resolve(asked).catch(() => {})
    let timer
    let answer
    try {
      answer = await Promise.race([
        Promise.resolve(asked).catch(() => no),
        new Promise((resolve) => {
          timer = $.clock.after(AV_CONFIRM_MS, () => resolve(no))
        }),
      ])
    } finally {
      try {
        if (timer) timer.cancel()
      } catch (err) {
        // Already fired.
      }
      if (ask !== undefined) ask.close()
    }
    if (answer !== plan.label) return
  }
  let sent
  try {
    sent = await $.session.send({ to: { agentId: id }, text: check.text })
  } catch (err) {
    sent = { isDelivered: false, reason: String(err && err.message ? err.message : err) }
  }
  if (sent && sent.isDelivered === true) {
    avState.band.drafts.delete(id)
    avState.band.composing.delete(id)
    avToast($, done ? 'band_sent_done' : 'band_sent', { name })
    avNote($, id)
  } else {
    avToast($, 'band_not_sent', { name, reason: String(sent?.reason ?? 'unknown').slice(0, 120) })
  }
  try {
    $.ui.invalidate('ui.render')
  } catch (err) {
    // Nothing to redraw.
  }
}

// The pane's send: the press on the field's own submit is the person's yes, also for a finished agent (its label
// says it restarts it), so no question is raised in the band. The message becomes a bubble at once (sending),
// then delivered or failed as the send answers; the refreshes move it on (avPaneTrack). The text lives in that
// bubble, in memory for the session alone: never logged, stored or sent anywhere else.
async function avPaneSend($, id, value, done) {
  const notes = avState.paneNotes
  avState.paneDrafts.set(id, typeof value === 'string' ? value : '') // a redraw keeps what was typed until it goes
  const check = checkMessage(value)
  if (!check.ok) {
    notes.set(id, { kind: 'error', text: t(avLang, check.error === 'empty' ? 'view_msg_empty' : 'view_msg_long', { max: MESSAGE_MAX }) })
    avRedraw($)
    return
  }
  notes.delete(id)
  let at
  try {
    at = await $.clock.now()
  } catch (err) {
    at = avState.lastRefreshAt
  }
  const key = 'm' + String(at) + '-' + String((avState.paneSent.get(id) ?? []).length)
  const bubble = { id: key, text: check.text, at, state: 'sending', restarted: done === true, callsAt: progressStats(id)?.calls ?? 0 }
  const set = (patch) => {
    const list = avState.paneSent.get(id) ?? []
    avState.paneSent.set(id, list.map((b) => (b.id === key ? { ...b, ...patch } : b)))
  }
  avState.paneSent.set(id, [...(avState.paneSent.get(id) ?? []), bubble].slice(-MSG_KEPT))
  avState.paneDrafts.set(id, '') // the field empties at once; a failure puts the text back
  avRedraw($)
  let sent
  try {
    sent = await $.session.send({ to: { agentId: id }, text: check.text })
  } catch (err) {
    sent = { isDelivered: false, reason: String(err && err.message ? err.message : err) }
  }
  if (sent && sent.isDelivered === true) {
    set({ state: 'delivered' })
    if (avState.selected === id) avState.detailStale = true
    avNote($, id)
  } else {
    set({ state: 'failed', reason: String(sent?.reason ?? 'unknown').slice(0, 120) })
    if (!avState.paneDrafts.get(id)) avState.paneDrafts.set(id, check.text)
  }
  avRedraw($)
}

async function avPaneOpen($) {
  try {
    const list = await $.ui.panes()
    return (Array.isArray(list) ? list : []).some((p) => p && p.id === AV_PANE_ID)
  } catch (err) {
    return false
  }
}

export function registerAgentView(on) {
  on('command.run', { command: 'crew-agents' }, async ($, e) => {
    const word = String(e.args || '').trim().toLowerCase()
    // The same command again (or `close`) closes it: no second command to remember.
    if (word === 'close' || (await avPaneOpen($))) {
      try {
        await $.ui.close({ id: AV_PANE_ID })
      } catch (err) {
        // Not open.
      }
      avClosed()
      return { text: 'crew-agents: closed.' }
    }
    const opened = await avOpenPane($)
    if (!opened.ok) return { text: opened.deny === 'room' ? 'crew-agents: no room for the pane (' + opened.reason + ').' : 'crew-agents: the pane could not be opened (' + opened.reason + ').' }
    return { text: 'crew-agents: open. Click an agent to look inside; it refreshes while agents work. Esc, ctrl+x x or /crew-agents again closes it. Nothing it shows is stored.' }
  })
}

// Opens the agents pane (the command, or a press on a band row): { ok } or { ok: false, deny: 'room'|'error', reason }.
async function avOpenPane($) {
  avState.open = true
  avState.detailStale = true
  await avRefresh($) // the first drawing has its data
  let opened
  try {
    opened = await $.ui.open({ id: AV_PANE_ID, title: 'Agents', focus: true, closeOnEscape: true })
  } catch (err) {
    avClosed()
    return { ok: false, deny: 'error', reason: String(err && err.message ? err.message : err).slice(0, 120) }
  }
  if (opened && opened.isPlaced === false) {
    avClosed()
    return { ok: false, deny: 'room', reason: String(opened.reason ?? 'unknown') }
  }
  avStopTick()
  try {
    // The list's times move; a running agent's transcript is read again, a finished one's is not.
    avState.tick = $.clock.every(AV_TICK_MS, () => {
      // A running agent, or a message of the picked one not yet seen answered: its transcript is read again.
      if (avState.selectedLive || msgPending(avState.paneSent.get(avState.selected))) avState.detailStale = true
      avNote($, undefined)
    })
  } catch (err) {
    // The agents' own events still refresh it.
  }
  return { ok: true }
}

// A band row was pressed (the user's pick, 2026-11-15): that agent's steps and report open in the side pane,
// not under the row. An open pane just switches to it.
export async function avBandOpenPane($, id) {
  avState.selected = id
  avState.detailStale = true
  if (avState.open && (await avPaneOpen($))) {
    avRefresh($)
    return
  }
  const opened = await avOpenPane($)
  if (!opened.ok) avToast($, 'band_pane_deny', { reason: opened.reason.slice(0, 120) })
}

// Called from the mod's session.start: the command exists from the first moment.
export async function avSessionStart($) {
  avReset()
  try {
    avLang = await resolveLang($) // the band draws its buttons in it before any refresh
  } catch (err) {
    avLang = 'en'
  }
  try {
    // immediate: the command also runs while a subagent works, which is when it is wanted.
    await $.command.register({ name: 'crew-agents', description: 'Look inside this session\'s subagents: what each did, its tool calls, its report', argumentHint: '[close]', immediate: true })
  } catch (err) {
    // The name is taken: the notices still work.
  }
}
