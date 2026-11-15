// crew-chief crew-ui: a band above the prompt with what a long session needs at a glance. Part of the mod in
// hooks/register.js (Claude Code 2.1.287+). On by default and quiet (it draws nothing while there is nothing to say);
// /crew-ui off turns it off. It never writes to settings.json (the person's own status line is left alone).
//
// In the terminal, with a status line of the person's own set, the quiet band leaves out the context and the
// limits (that line has them); on the Desktop app, or with `/crew-ui full`, they are shown.
// Quiet mode (the default) shows only what is worth a look (the context is not drawn: a toast says once when it
// passes the compaction size or 70 %); `/crew-ui full` shows everything all the time (on Desktop without the graph):
//   ctx 52% 520k/1M   5h 4% ~4h20m   7d 96% ~5d13h   guard on · 1 held   saver on   [ 1 compact ]
//   deep-reader        sonnet-5.5 ●●○○○ medium ▓▓░░░░ 40%  12k  reading auth
//
// The band is raised on the terminal and the Desktop app only (not VS Code, which keeps the status line of
// hooks/src/agent-row.js). One hook draws the band, so another plugin's band and this one compete; a survey
// always wins (hasSurvey). The layout is pure (hooks/ui-logic.mjs); this file reads the data and draws.
//   - data: $.session.usage (context, windows), the subagents of agent-row.js and progress.js, the guard and
//     the saver, and the compaction threshold of compact-flow.js;
//   - redraw: uiTouch() asks for one after a turn, a measurement or an agent change ($.ui.invalidate folds
//     bursts, ten a second at most);
//   - the compact key shows only when compaction is advised (past the "ask" size). Its hotkey is a digit, the
//     one key a band answers from an empty composer without being focused; so it must not exist all the time,
//     or the first digit someone types would press it. Pressing it asks the usual question (/crew-compact).
// The extras (on by default with the band, `/crew-ui extras off`): plain text added to the engine's own lines,
// which take no colour: the model and effort after the spinner word and before the turn line, a note in the
// footer's mode labels, a limit note after the prompt hint. Nothing is replaced, only added.
// CREW_CHIEF_UI=on|off beats the saved choice. Any failure draws nothing (the engine's own band).
import { rowBandRows, rowSurfaces } from './agent-row.mjs'
import { resolveLang } from './lang.mjs'
import { cfgGet, cfgSet, cfgState } from './config.mjs'
import { t } from './saver-i18n.mjs'
import { compactAskAt, compactBandPress, compactKeyDue, runningAgents } from './compact-flow.mjs'
import { guardSummary } from './guard.mjs'
import { agentBar, agentCardText, agentFace, artElapsed, artTokens, CARD_LOOK, saverBadge, SAVER_LOOK } from './panel-art-logic.mjs'
import { avBandCompose, avBandDraft, avBandDraftOf, avBandFullView, avBandName, avBandOpenPane, avBandSend, avBandView } from './agent-view.mjs'
import { BAND_EXTRA_MAX, bandExtraRows, fitSections, sendPlan } from './agent-view-logic.mjs'
import { bandRows, cardBudget, cardGrid, cardRowsFit, cardLine1Cells, cardNeedCells, cardTextRoom, CARD_CELLS, ctxAlert, ctxChip, demoContent, modeLabels, modelChip, COMPACT_ICON, COMPACT_LABEL, PERF_ICON, PERF_LABEL, perfNext, placeFolder, quietFacts, spinnerWord, statusLineSegments, statusSegments, tailText, windowChip } from './ui-logic.mjs'

const UI_STORE_KEY = 'crew_ui'
const UI_MODE_KEY = 'crew_ui_mode' // 'quiet' (default) or 'full'
const UI_STYLE_KEY = 'crew_ui_style' // boxed (default), plain (theme colours), color (hex), pills
const UI_STYLES = ['plain', 'color', 'pills', 'boxed']
const UI_WORDS_KEY = 'crew_ui_words' // 'on' or 'off' (default): calm spinner words by model
const UI_NOTICE_KEY = 'crew_ui_notice' // set once the first-run notice was shown
const UI_EXTRAS_KEY = 'crew_ui_extras' // 'on' (default) or 'off': the small touches outside the band
const UI_MAX_LINES = 8 // lines of the band at most; the engine's room (maxRows, half the terminal) is the other limit
const UI_DEFAULT_ROWS = 6 // when the engine does not say
const UI_SURFACES = ['terminal', 'desktop']

// Tones are meanings; these are the theme keys the surfaces know (any other colour string is the surface's
// own business, so only theme keys are used).
const UI_TONES = {
  ok: { color: 'success' },
  warn: { color: 'warning' },
  hot: { color: 'claude' },
  crit: { color: 'error' },
  info: { color: 'suggestion' },
  dim: { dimColor: true },
  opus: { color: 'planMode' },
  sonnet: { color: 'permission' },
  haiku: { color: 'success' },
  fable: { color: 'merged' },
  max: { color: 'planMode' },
  rb0: { color: 'error' },
  rb1: { color: 'claude' },
  rb2: { color: 'warning' },
  rb3: { color: 'success' },
  rb4: { color: 'suggestion' },
  other: {},
}

let uiOn = false
let uiFull = false
let uiExtras = true
let uiStyle = 'boxed'
let uiStatusLine = { at: -Infinity, has: false } // is the person's own status line set (read at most once a minute)
let uiDemo = false // sample content, not saved
let uiWords = false
let uiCtxHistory = [] // the context percent after each main turn, for the graph
let uiCtxState = { past: false, high: false } // which context thresholds the last turn was past (for the one toast)
let uiQuestion // { text, answers, resolve }: the one question the band is asking
const UI_ASK_MAX = 4 // answers that fit digit hotkeys
const UI_CARD_FACTS = 4 // facts a question card shows at most (compact-logic.mjs cardFacts cuts them to this too)
let uiMain = { model: undefined, effort: undefined } // the main loop's last request
const UI_CARDS_MAX = 6 // cells of agent cards at most, the '+N more' chip included (cardBudget)
const UI_CARD_ROW_ROWS = 3 // rows one row of agent cards takes (two lines and its frame), for the band's budget
let uiArtMemo = new Map() // agent id -> what its drawing showed last and when it changed (for the rolling digits)
// The status line at the foot of the band on the Desktop app (ui.statusline): the folder, the git branch and the
// session's model, read on events (session start, a main turn's start and end), never while drawing.
let uiPlace = { folder: '', branch: '', model: undefined }

// Whether the band replaces the status line of agent-row.js: only where the band is drawn.
export function uiCovers(surfaces) {
  return uiOn && Array.isArray(surfaces) && surfaces.length > 0 && surfaces.every((s) => UI_SURFACES.includes(s))
}

async function safeStoreGet($, key) {
  try {
    return await $.store.get(key)
  } catch (err) {
    return undefined
  }
}

async function uiReadChoice($) {
  const env = String((await $.env.get('CREW_CHIEF_UI')) ?? '').trim().toLowerCase()
  if (env === 'on' || env === 'off') return { on: env === 'on', source: 'CREW_CHIEF_UI' }
  let saved
  try {
    saved = await $.store.get(UI_STORE_KEY)
  } catch (err) {
    saved = undefined
  }
  // On unless the person turned it off: the quiet band draws nothing while there is nothing to say.
  return { on: saved !== 'off', source: saved === undefined ? 'default' : 'saved choice' }
}

// Called after each finished main turn with the usage: one more point for the context graph, and one toast
// the first time the context passes the compaction size or 70 % (again only after it has dropped below, e.g.
// after a compaction). Never from a render. Also reads the status line's folder, branch and model again (a
// checkout or a move between turns); the mod has one turn.complete hook, which calls this.
export async function uiNoteContext($, usage) {
  await uiRefreshPlace($)
  const c = usage?.context
  if (!c || typeof c.tokens !== 'number' || typeof c.window !== 'number' || c.window <= 0) return
  uiCtxHistory = [...uiCtxHistory, Math.round((c.tokens / c.window) * 100)].slice(-24)
  try {
    if (!uiOn) return
    const chip = ctxChip(c, await compactAskAt($, usage), uiCtxHistory)
    const { state, fire } = ctxAlert(chip, uiCtxState)
    uiCtxState = state
    if (fire) $.ui.toast(t(await resolveLang($), 'ctx_toast', { tokens: chip.tokens, percent: chip.percent }), { timeoutMs: 12000 })
  } catch (err) {
    // The toast is a courtesy.
  }
}

// Called from the mod's turn.step hook with the main loop's request: the model and effort the turn runs on.
export function uiNoteMainStep(e) {
  if (typeof e.model === 'string' && e.model !== '') uiMain = { model: e.model, effort: e.effort }
}

// Reads the folder, branch and model for the status line. Skipped while the band or the line is off, and in a
// session that draws in the terminal only (the line is drawn on the Desktop app).
async function uiRefreshPlace($) {
  try {
    if (!uiOn || (await cfgGet($, 'ui.statusline')) !== 'on') return
    const surfaces = await $.session.surfaces()
    if (Array.isArray(surfaces) && surfaces.length > 0 && !surfaces.includes('desktop')) return
    const folder = placeFolder(await $.session.cwd())
    let model
    try {
      model = await $.session.model()
    } catch (err) {
      model = undefined
    }
    let branch = ''
    try {
      const r = await $.process.run(['git', 'symbolic-ref', '--short', 'HEAD'], { timeoutMs: 3000 })
      branch = r.exitCode === 0 ? String(r.stdout ?? '').trim() : ''
    } catch (err) {
      branch = '' // not a repository, a detached head, or no git
    }
    uiPlace = { folder, branch, model: typeof model === 'string' && model !== '' ? model : undefined }
    uiTouch($)
  } catch (err) {
    // The line keeps what it had.
  }
}

async function uiMainChip($) {
  let model = uiMain.model
  if (!model) {
    try {
      model = await $.session.model()
    } catch (err) {
      model = undefined
    }
  }
  return modelChip(model, uiMain.effort)
}

// Rewrites one prop of the engine's own drawing; the engine keeps drawing everything else.
function uiRewrite(next, e, props) {
  return next({ ...e, props: { ...e.props, ...props } })
}

// The plugin's questions go to the band, as buttons, when it can show them: no dialog opens and nothing holds
// the turn (the deadline of ask.js still applies). `undefined` -> the caller opens the usual dialog. Only the
// plugin's own questions come here; Claude's AskUserQuestion is never touched.
// `look` (optional) dresses a question outside the terminal: { kind: 'card', topic, question, facts: [], note,
// labels, quiet, accent } the question card's parts (a topic, a short line, up to four facts, a note, short
// labels for the answers' buttons, the index of the quiet answer and of the accented one). Without it the card
// shows `text`. The terminal and the dialog always show `text`. The answers, their order, keys and what they
// do never change with it.
export function uiAskStart($, text, answers, look) {
  try {
    if (!uiCovers(rowSurfaces()) || uiQuestion !== undefined) return undefined
    if (!Array.isArray(answers) || answers.length < 1 || answers.length > UI_ASK_MAX) return undefined
    let resolve
    const promise = new Promise((r) => {
      resolve = r
    })
    const question = { text: String(text), answers: [...answers], resolve, look }
    uiQuestion = question
    try {
      $.ui.invalidate('ui.render')
    } catch (err) {
      // The band draws on the next event.
    }
    resolveLang($)
      .then((lang) => $.ui.toast(t(lang, 'band_ask_toast', { keys: answers.map((a, i) => i + 1).join(', ') }), { timeoutMs: 15000 }))
      .catch(() => {})
    return {
      promise,
      close() {
        if (uiQuestion === question) {
          uiQuestion = undefined
          uiTouchNow($)
        }
      },
    }
  } catch (err) {
    return undefined
  }
}

function uiTouchNow($) {
  try {
    $.ui.invalidate('ui.render')
  } catch (err) {
    // Nothing to redraw.
  }
}

// A redraw soon; $.ui.invalidate folds bursts. Free while the band is off.
export function uiTouch($) {
  if (!uiOn) return
  try {
    $.ui.invalidate('ui.render')
  } catch (err) {
    // The band is cosmetic.
  }
}

// The band is on by default, which changes what an updated install shows: say so once, in a toast (never a
// question), and only where the band can be drawn.
async function uiFirstNotice($, choice) {
  try {
    if (!choice.on || choice.source !== 'default') return
    if ((await safeStoreGet($, UI_NOTICE_KEY)) !== undefined) return
    const surfaces = await $.session.surfaces()
    if (!Array.isArray(surfaces) || surfaces.length === 0 || !surfaces.every((s) => UI_SURFACES.includes(s))) return
    await $.store.set(UI_NOTICE_KEY, 'shown')
    const lang = await resolveLang($)
    $.ui.toast(t(lang, 'ui_default_toast'), { timeoutMs: 20000 })
  } catch (err) {
    // The notice is a courtesy.
  }
}

export async function uiSessionStart($) {
  try {
    const choice = await uiReadChoice($)
    uiOn = choice.on
    uiFull = (await safeStoreGet($, UI_MODE_KEY)) === 'full'
    uiExtras = (await safeStoreGet($, UI_EXTRAS_KEY)) !== 'off'
    uiWords = (await safeStoreGet($, UI_WORDS_KEY)) === 'on'
    uiCtxHistory = []
    uiCtxState = { past: false, high: false }
    uiArtMemo = new Map()
    const savedStyle = await safeStoreGet($, UI_STYLE_KEY)
    uiStyle = UI_STYLES.includes(savedStyle) ? savedStyle : 'boxed'
    uiStatusLine = { at: -Infinity, has: false }
    uiPlace = { folder: '', branch: '', model: undefined }
    // Not awaited: the git read must not hold up the session's start.
    uiRefreshPlace($).catch(() => {})
    // Not awaited either: other mods read the shared perf file, the session's start does not wait for it.
    perfFileWrite($, true).catch(() => {})
    await uiFirstNotice($, choice)
    await $.command.register({ name: 'crew-ui', description: 'Show or hide the crew-chief band above the prompt', immediate: true, argumentHint: '[on|off|quiet|full|style <name>|panel capsule|cat|text|demo on|demo off|words on|words off|extras on|extras off|status]' })
  } catch (err) {
    // The name is taken, or an older Claude Code: the band can still be switched with CREW_CHIEF_UI.
  }
  try {
    await $.command.register({ name: 'crew-perf', description: 'Switch performance mode for the agent pictures (fully still, or moving)', immediate: true, argumentHint: '[on|off]' })
  } catch (err) {
    // The name is taken, or an older Claude Code: /crew-config set panel.perf and the status line toggle still work.
  }
}

// /crew-perf and the toggle on the status line: panel.perf as /crew-config saves it, the band redrawn at once.
// args '' toggles. { text, changed }: one short line in the person's language; the environment variable, when
// set, wins and nothing is changed.
async function uiPerfSet($, args) {
  const lang = await resolveLang($)
  const st = await cfgState($, 'panel.perf')
  if (st.source === 'env') return { text: t(lang, 'perf_env', { value: st.value }), changed: false }
  const next = perfNext(args, st.value)
  if (next === undefined) return { text: t(lang, 'perf_bad'), changed: false }
  const r = await cfgSet($, 'panel.perf', next)
  if (!r.ok) return { text: t(lang, 'perf_store'), changed: false }
  await perfFileWrite($)
  try {
    $.ui.invalidate('ui.render')
  } catch (err) {
    // Nothing to redraw.
  }
  try {
    $.ui.toast(t(lang, r.value === 'on' ? 'perf_toast_on' : 'perf_toast_off'), { timeoutMs: 4000 })
  } catch (err) {
    // The toast is a courtesy; the drawing and the command's answer say it too.
  }
  return { text: t(lang, r.value === 'on' ? 'perf_on' : 'perf_off'), changed: true }
}

// The shared performance-mode file other mods read (desktop-themes draws its light scenes while it is on):
// ~/.claude/perf-mode.json = {"on": true|false, "at": <iso>}, the value in force (the environment wins).
// Written whenever panel.perf changes; at session start (`onlyIfStale`) only when the file says otherwise, a
// missing file counting as off. A failed write never fails the toggle.
export async function perfFileWrite($, onlyIfStale = false) {
  try {
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
    if (!home) return false
    const on = (await cfgGet($, 'panel.perf')) === 'on'
    const path = `${home}/.claude/perf-mode.json`
    if (onlyIfStale) {
      const exists = await $.fs.exists(path).catch(() => false)
      if (!exists && !on) return false
      if (exists) {
        const was = await $.fs.read(path).then((text) => JSON.parse(text).on === true, () => undefined)
        if (was === on) return false
      }
    }
    const at = new Date(await $.clock.now()).toISOString()
    await $.fs.write(path, JSON.stringify({ on, at }) + '\n')
    return true
  } catch (err) {
    return false
  }
}

// A press on the toggle: uiPerfSet toasts the change; here a toast only when nothing could change.
async function uiPerfPress($) {
  try {
    const r = await uiPerfSet($, '')
    if (!r.changed) $.ui.toast(r.text, { timeoutMs: 8000 })
  } catch (err) {
    // The toggle is a convenience; /crew-perf still works.
  }
}

// Hex colours for the styles other than `plain` (which keeps to theme keys, the one thing every surface knows).
const UI_HEX = {
  ok: '#4ade80',
  warn: '#facc15',
  hot: '#fb923c',
  crit: '#f87171',
  info: '#7dd3fc',
  dim: '#6b7280',
  opus: '#c084fc',
  sonnet: '#60a5fa',
  haiku: '#34d399',
  fable: '#f472b6',
  max: '#e879f9',
  rb0: '#f87171',
  rb1: '#fb923c',
  rb2: '#facc15',
  rb3: '#4ade80',
  rb4: '#e879f9',
  other: '#d1d5db',
}
const UI_PILL_TEXT = '#0b1020'
const UI_LILAC = '#e08ef0' // a question the band is asking: a band of this colour, and, in the boxed style, its frame
const UI_FAMILIES = ['sonnet', 'opus', 'haiku', 'fable', 'other']

// A status line is chips separated by a gap segment of three spaces; pills turns each chip into one coloured
// block (the tone of its value on a background), the other styles keep the segments as they are.
function uiChips(line) {
  const chips = []
  let cur = []
  for (const s of line) {
    if (s.t === '   ' && s.tone === 'dim') {
      if (cur.length > 0) chips.push(cur)
      cur = []
    } else cur.push(s)
  }
  if (cur.length > 0) chips.push(cur)
  return chips
}

// The rolling digits need what each agent's drawing showed before and when it changed; one entry per agent id,
// removed once the agent leaves the band.
function uiArtPrev(agents, now) {
  const seen = new Set()
  const out = new Map()
  for (const a of agents) {
    if (!a || typeof a.id !== 'string') continue
    seen.add(a.id)
    const tokens = artTokens(a.tokens)
    const time = artElapsed(a.elapsedMs)
    const m = uiArtMemo.get(a.id)
    if (!m) {
      uiArtMemo.set(a.id, { tokens, time, prevTokens: undefined, prevTime: undefined, tokensAt: -Infinity, timeAt: -Infinity })
    } else {
      if (m.tokens !== tokens) Object.assign(m, { prevTokens: m.tokens, tokens, tokensAt: now })
      if (m.time !== time) Object.assign(m, { prevTime: m.time, time, timeAt: now })
    }
    const m2 = uiArtMemo.get(a.id)
    out.set(a.id, { tokens: m2.prevTokens, tokensAt: m2.tokensAt, time: m2.prevTime, timeAt: m2.timeAt })
  }
  for (const id of [...uiArtMemo.keys()]) if (!seen.has(id)) uiArtMemo.delete(id)
  return out
}

// What a card shows (the drawn text and the width measured for the grid both come from here, so they agree):
// until the agent's first request names its model the card shows none (no 'starting', no hollow dots).
function uiCardAgent(agent) {
  return { ...agent, pct: typeof agent.artPct === 'number' ? agent.artPct : agent.pct, stale: agent.artStale === true }
}
function uiCardText(a) {
  const c = agentCardText(a)
  return typeof a.model === 'string' && a.model !== '' ? c : { ...c, model: '', dots: '', effort: '' }
}

// rows: bandRows (hooks/ui-logic.mjs). art: { Svg, style, now, prev } where pictures may be drawn (not the
// terminal, panel.style not text, the surface has Svg), else undefined: then everything is the line of text.
// band: { view, fits, lang, viewing, canInput } where an agent row opens on a click (panel.click, not the
// terminal), else undefined. An Svg takes no press, so a picture row gets a small ▸/▾ button at its end; a row
// of text is itself the button.
// perf: { on } on the Desktop status line, where its end holds the performance mode toggle; else undefined.
function uiTree($, e, rows, onCompact, style, question, art, band, line, perf) {
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const hex = style !== 'plain'
  const look = (tone) => (hex ? { color: UI_HEX[tone] ?? UI_HEX.other } : UI_TONES[tone] ?? {})
  const text = (s) => {
    const props = { ...(typeof s.color === 'string' ? { color: s.color } : look(s.tone)), wrap: 'truncate-end', children: [s.t] }
    if (s.bold) props.weight = 'bold'
    return Text(props)
  }
  const badge = (s) => {
    const b = saverBadge(s.badge, art.now)
    return art.Svg({ source: b.source, alt: b.alt, width: b.width, height: b.height })
  }
  // '[1] compact' is a button with the shortcut '1'; without the hint (not the terminal) it is just 'compact'.
  const button = (s) => {
    const hint = s.t.startsWith('[1] ')
    return Button({ label: hint ? '1 compact' : 'compact', ...(hint ? { hotkey: '1' } : {}), variant: 'primary', onPress: onCompact })
  }
  const piece = (s) => (s.key === 'compact' ? button(s) : s.badge && art ? badge(s) : text(s))
  const pill = (chip) => {
    const key = chip.find((s) => s.key === 'compact')
    if (key) return button(key)
    const b = chip.find((s) => s.badge)
    if (b && art) return badge(b)
    const value = chip.find((s) => s.tone !== 'dim') ?? chip[0]
    const bg = UI_HEX[value.tone] ?? UI_HEX.other
    return Text({ backgroundColor: bg, color: UI_PILL_TEXT, weight: 'bold', wrap: 'truncate-end', children: [' ' + chip.map((s) => s.t).join('') + ' '] })
  }
  const rowId = (r) => (r.kind === 'agent' && typeof r.agent?.id === 'string' ? r.agent.id : r.kind === 'ended' ? r.id : undefined)
  const isOpen = (id) => band !== undefined && band.view.open.includes(id)
  const arrow = (id) => Text({ ...look('info'), weight: 'bold', children: [isOpen(id) ? '▾ ' : '▸ '] })
  // No hotkey: digits answer the band's questions and the compact key. Focus (ctrl+x tab, Tab) and Enter work.
  // A press opens the agent in the side pane (/crew-agents). The Desktop app draws a plain Button's label as its
  // text, so the label is the short hint itself; the agent's name is in the row beside it.
  const opener = (id, children) =>
    Button({ key: 'open-' + id, plain: true, label: t(band.lang, 'band_open_hint'), onPress: () => avBandOpenPane($, id), children })
  const detailButton = (id) => opener(id, [Text({ ...look('info'), weight: 'bold', children: [t(band.lang, 'band_open_hint')] })])
  // One agent as a card: the character, two lines of Text (name, model, effort and the 'first run' tag where it
  // fits; the bar, the estimate, the step), tokens and time in a fixed column, and the details button. Nothing
  // wraps: every Text but the step sits in a Box that does not shrink; the step alone is cut short. The cells of
  // a row are one width (cardGrid in hooks/ui-logic.mjs), so the figures and the button sit at one x in every
  // card. Only the two small pictures are Svg, and neither holds a clock, so the face's motion runs on (see
  // agentFace in hooks/panel-art-logic.mjs; panel.perf keeps it fully still).
  const cardText = uiCardText
  const cardAgent = uiCardAgent
  const openLabel = band !== undefined ? t(band.lang, 'band_open_hint') : ''
  const fixed = (key, text) => Box({ key, flexShrink: 0, children: [text] })
  const card = (agent, id, grid) => {
    const a = cardAgent(agent)
    const c = cardText(a)
    // An agent waiting on its own background work (rowBandRows: bgWait) stands fully still, as in
    // performance mode, for its card alone: it is not finished, only resting.
    // No clock: the face's source is the same on every drawing, so its frame is never loaded again (blank while
    // it loads); the phase is the agent's own (agentFace).
    const face = agentFace(a, { style: art.style, perf: art.perf || a.bgWait === true })
    const bar = agentBar(a)
    const k = id ?? agent.id
    const dim = (t) => Text({ color: CARD_LOOK.mute, children: [t] })
    const line1 = [fixed('name', Text({ color: c.color, weight: 'bold', children: [c.name] }))]
    if (c.model) line1.push(fixed('model', dim(c.model)))
    if (c.dots) line1.push(fixed('dots', Text({ color: c.color, children: [c.dots.replace(/ /g, '')] })))
    if (c.effort) line1.push(fixed('effort', dim(c.effort)))
    // The 'first run' tag: after the effort where the cell has room for it, else left out (the estimate already
    // says 'no estimate').
    // A small calm tag for an agent waiting on its background work, in the same room ('first run' gives way to it).
    const tagFits = cardLine1Cells(c, true) <= cardTextRoom(grid.cell, id !== undefined ? openLabel : '')
    if (a.bgWait === true && a.bgTag && tagFits) line1.push(fixed('bgwait', Text({ color: CARD_LOOK.mute, children: [a.bgTag] })))
    else if (c.fresh && tagFits) line1.push(fixed('fresh', Text({ color: CARD_LOOK.warn, weight: 'bold', children: ['first run'] })))
    // Each picture sits in a Box keyed by the agent (an Svg takes no key): a redraw finds the same element at the
    // same place and the Desktop app keeps the image, so its animation runs on instead of starting over.
    // A moving face is drawn in a frame (isInteractive), not as an image: measured live on 2026-11-15, the app
    // loaded the image again about every 2 s from the band's last drawing, so the motion jumped back. A frame is
    // loaded again only when its markup changes (blank while it loads), so the face's source never changes
    // between drawings of the same agent; a still face stays a plain image.
    const svg = (p, frame = false) => art.Svg({ source: p.source, alt: p.alt, width: p.width, height: p.height, ...(frame ? { isInteractive: true } : {}) })
    const pic = (name, p, frame = false) => Box({ key: name + '-' + k, flexShrink: 0, children: [svg(p, frame)] })
    // The bar is still (nothing in it moves), so a new 5% step may load it again without a visible jump.
    const line2 = [pic('agentbar', bar)]
    line2.push(fixed('pct', Text({ color: c.hasPct ? CARD_LOOK.ink : CARD_LOOK.mute, ...(c.hasPct ? { weight: 'bold' } : {}), children: [c.pct] })))
    // The step: the one piece that gives way, cut short at the card's edge.
    if (c.step) line2.push(Box({ key: 'step', flexShrink: 1, flexGrow: 1, minWidth: 0, children: [Text({ color: CARD_LOOK.mute, wrap: 'truncate-end', children: [c.step] })] }))
    // A fixed width, right-aligned: tokens and time end at the same x in every card, the button after them.
    const figures = Box({ key: 'figs', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', width: CARD_CELLS.figs, flexShrink: 0, children: [fixed('tokens', Text({ color: CARD_LOOK.ink, weight: 'bold', children: [c.tokens || ' '] })), fixed('time', dim(c.time || ' '))] })
    // minWidth 0: a long step is cut short instead of pushing the figures and the button out.
    const lineBox = (children) => Box({ flexDirection: 'row', alignItems: 'center', gap: 1, minWidth: 0, children })
    const children = [
      pic('agentface', face, !(art.perf || a.bgWait === true)),
      Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0, children: [lineBox(line1), lineBox(line2)] }),
      figures,
    ]
    if (id !== undefined) children.push(Box({ key: 'open', flexShrink: 0, children: [detailButton(id)] }))
    return Box({ key: 'agentrow-' + k, ...cardFrame(CARD_LOOK.border, grid), backgroundColor: CARD_LOOK.bg, children })
  }
  // The frame every cell of the grid shares (cards and the empty fillers): width 0 and an equal grow, so the
  // cells of a row split it evenly whatever they hold; the same border, padding and least width, so a filler is
  // exactly as wide as a card.
  const cardFrame = (borderColor, grid) => ({ flexDirection: 'row', alignItems: 'center', gap: 1, borderStyle: 'round', borderColor, paddingX: 1, width: 0, minWidth: grid.minWidth, flexGrow: 1, flexShrink: 1 })
  const row = (r) => {
    const id = band !== undefined ? rowId(r) : undefined
    if (r.kind === 'agent' && art) return card(r.agent, id, grid)
    if (id !== undefined) return opener(id, [arrow(id), ...r.line.map(text)])
    if (style === 'pills' && r.kind === 'status') return Box({ flexDirection: 'row', gap: 1, children: uiChips(r.line).map(pill) })
    return Box({ flexDirection: 'row', ...(art ? { alignItems: 'center' } : {}), children: r.line.map(piece) })
  }
  const answerPress = (q, answer) => () => {
    if (uiQuestion === q) {
      uiQuestion = undefined
      q.resolve(answer)
      uiTouchNow($)
    }
  }
  const askBlock = () => {
    const q = question
    const buttons = q.answers.map((answer, i) =>
      Button({
        key: 'ask-' + (i + 1),
        label: `${i + 1} ${answer}`,
        hotkey: String(i + 1),
        variant: i === 0 ? 'primary' : 'secondary',
        onPress: answerPress(q, answer),
      }),
    )
    return Box({
      flexDirection: 'column',
      children: [Text({ backgroundColor: UI_LILAC, color: UI_PILL_TEXT, weight: 'bold', wrap: 'wrap', children: [' crew-chief asks: ' + q.text + ' '] }), Box({ flexDirection: 'row', gap: 2, children: buttons })],
    })
  }
  // A plugin question outside the terminal: a quiet card in the agent cards' look (a faint frame, a see-through
  // fill), three rows at most so the status line under it stays in view. Row one: a lilac mark, 'crew-chief'
  // muted, the topic in bold, the short question. Row two: the facts as small chips, then what happens next in
  // one muted line, cut short at the edge. Row three: the answers as normal Buttons, the first (the recommended
  // one) primary, the others secondary, the `quiet` one (don't ask again) a dim plain button at the end; the
  // `accent` one's text in the saver's ultra colour. The labels are `labels[i]` or the answers themselves: a
  // desktop draws a Button's label as its text and its hotkey as a small badge. Same answers, keys, hotkeys and
  // order as the terminal's strip; a press answers with the answer, never the label. A question with no card
  // form (look.kind 'card': { topic, question, facts, note, labels, quiet, accent }) shows its plain text.
  const questionCard = () => {
    const q = question
    const c = q.look && q.look.kind === 'card' ? q.look : {}
    const topic = typeof c.topic === 'string' ? c.topic : ''
    const line = typeof c.question === 'string' && c.question !== '' ? c.question : q.text
    const facts = Array.isArray(c.facts) ? c.facts.filter((f) => typeof f === 'string' && f !== '').slice(0, UI_CARD_FACTS) : []
    const note = typeof c.note === 'string' ? c.note : ''
    const labels = Array.isArray(c.labels) ? c.labels : []
    const quiet = Number.isInteger(c.quiet) && c.quiet > 0 ? c.quiet : -1
    const accent = Number.isInteger(c.accent) && c.accent > 0 ? c.accent : -1
    const mute = (s) => Text({ color: CARD_LOOK.mute, children: [s] })
    const fixedText = (key, el) => Box({ key, flexShrink: 0, children: [el] })
    const head = Box({
      key: 'ask-head',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 1,
      minWidth: 0,
      children: [
        fixedText('ask-mark', Text({ color: UI_LILAC, children: ['◆'] })),
        fixedText('ask-from', mute('crew-chief')),
        ...(topic !== '' ? [fixedText('ask-dot', mute('·')), fixedText('ask-topic', Text({ color: CARD_LOOK.ink, weight: 'bold', children: [topic] }))] : []),
        Box({ key: 'ask-line', flexShrink: 1, minWidth: 0, children: [Text({ color: CARD_LOOK.ink, wrap: topic !== '' ? 'truncate-end' : 'wrap', children: [line] })] }),
      ],
    })
    const chips = facts.map((f, i) => fixedText('ask-fact-' + i, Text({ color: CARD_LOOK.mute, backgroundColor: CARD_LOOK.border, children: [' ' + f + ' '] })))
    const info = [...chips, ...(note !== '' ? [Box({ key: 'ask-note', flexShrink: 1, minWidth: 0, children: [Text({ color: CARD_LOOK.mute, wrap: 'truncate-end', children: [note] })] })] : [])]
    const buttons = q.answers.map((answer, i) => {
      const label = typeof labels[i] === 'string' && labels[i] !== '' ? labels[i] : answer
      const base = { key: 'ask-' + (i + 1), label, hotkey: String(i + 1), onPress: answerPress(q, answer) }
      if (i === quiet) return Button({ ...base, plain: true, dimColor: true })
      const tint = i === accent ? { children: [Text({ color: SAVER_LOOK.ultra.text, children: [label] })] } : {}
      return Button({ ...base, variant: i === 0 ? 'primary' : 'secondary', ...tint })
    })
    return Box({
      key: 'ask-card',
      flexDirection: 'column',
      gap: 'xs',
      borderStyle: 'round',
      borderColor: CARD_LOOK.border,
      backgroundColor: CARD_LOOK.bg,
      paddingX: 1,
      children: [
        head,
        ...(info.length > 0 ? [Box({ key: 'ask-facts', flexDirection: 'row', alignItems: 'center', gap: 1, minWidth: 0, children: info })] : []),
        Box({ key: 'ask-answers', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 1, children: buttons }),
      ],
    })
  }
  const desk = e.surface !== 'terminal'
  const ask = () => (desk ? questionCard() : askBlock())
  // Under an open agent: its last steps (or its report), then Full view and the message button, and the field.
  const section = (id) => {
    const fit = band.fits.get(id)
    if (!fit || fit.hidden) return []
    const lang = band.lang
    const entry = band.view.cache.get(id)
    const plan = sendPlan(entry?.done === true, lang)
    const composing = band.view.composing.has(id)
    const out = fit.lines.map((line, i) => Box({ key: 'sec-' + id + '-' + i, flexDirection: 'row', paddingLeft: 2, children: line.map(text) }))
    const write = composing ? t(lang, 'band_cancel') : plan.label
    out.push(
      Box({
        key: 'ctl-' + id,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 1,
        paddingLeft: 2,
        children: [
          Button({ key: 'full-' + id, label: t(lang, 'band_full'), variant: 'secondary', onPress: () => avBandFullView($, id) }),
          // Without a text field on this surface, writing goes through the full view: the prompt's next Enter goes to the agent.
          Button({ key: 'write-' + id, label: write, variant: 'secondary', onPress: () => (band.canInput ? avBandCompose($, id) : avBandFullView($, id)) }),
          Text({ dimColor: true, wrap: 'truncate-end', children: [fit.more > 0 ? t(lang, 'band_more', { n: fit.more }) : t(lang, 'band_view_hint')] }),
        ],
      }),
    )
    if (composing && band.canInput) {
      const draft = avBandDraftOf(id)
      out.push(
        Input({
          key: 'msg-' + id,
          placeholder: t(lang, plan.noteKey, { name: avBandName(id) }),
          submitLabel: plan.confirm ? plan.label : t(lang, 'band_send'),
          autoFocus: true,
          ...(typeof draft === 'string' ? { value: draft } : {}),
          onInput: (value) => avBandDraft(id, value),
          onSubmit: (value) => {
            avBandSend($, id, value)
          },
        }),
      )
    }
    return out
  }
  const back = () =>
    Box({
      key: 'view-back-row',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 1,
      children: [
        Button({ key: 'view-back', label: t(band.lang, 'band_back'), variant: 'primary', onPress: () => avBandFullView($, undefined) }),
        Text({ dimColor: true, wrap: 'truncate-end', children: [t(band.lang, 'band_viewing', { name: avBandName(band.viewing) })] }),
      ],
    })
  const drawn = []
  // Cards that follow each other form a grid: rows of `per` cells, every cell the same width, the last row
  // filled out with empty cells so the columns line up. How many share a row comes from the width the widest
  // card needs (cardGrid), worked out once for every card in the band, so all of them are one width and the
  // buttons sit at one x. Keys are by the group's order among card groups and the row's index, never by what is
  // drawn before them (the status line comes and goes; a key that moved with it made every picture load again).
  const needOf = (r) => cardNeedCells(cardText(cardAgent(r.agent)), band !== undefined && rowId(r) !== undefined ? openLabel : '')
  const gridFor = (list) => cardGrid(art?.columns, list.map(needOf))
  const shown = art ? rows.filter((r) => r.kind === 'agent' && !(band !== undefined && rowId(r) !== undefined && isOpen(rowId(r)))) : []
  // The render lays the cards out once for the band's room (cardBudget) and hands the grid over: the same one
  // that decided how many cards fit, so the rows drawn are the rows budgeted.
  const grid = art?.grid ?? gridFor(shown)
  const per = grid.per
  let cards = []
  let groups = 0
  const flush = () => {
    if (cards.length > 0) {
      const g = groups++
      const lines = []
      for (let i = 0; i < cards.length; i += per) {
        const cells = cards.slice(i, i + per)
        for (let j = cells.length; j < per; j++) cells.push(Box({ key: `agentfill-${g}-${i / per}-${j}`, ...cardFrame('rgba(0,0,0,0)', grid) }))
        lines.push(Box({ key: `agentline-${g}-${i / per}`, flexDirection: 'row', gap: 'md', children: cells }))
      }
      drawn.push(Box({ key: 'agentcards-' + g, flexDirection: 'column', gap: 'md', children: lines }))
    }
    cards = []
  }
  for (const r of rows) {
    const id = band !== undefined ? rowId(r) : undefined
    if (r.kind === 'agent' && art && !(id !== undefined && isOpen(id))) {
      cards.push(card(r.agent, id, grid))
      continue
    }
    // The agents past the room: a '+N more' chip in the last cell of the grid, not a row of its own under it.
    // With one card to a row (or no empty cell left) it stays a line of text under the cards.
    if (r.kind === 'more' && art && cards.length > 0 && per > 1 && cards.length % per !== 0) {
      cards.push(Box({ key: 'agentmore', ...cardFrame(CARD_LOOK.border, grid), justifyContent: 'center', children: [Text({ color: CARD_LOOK.mute, wrap: 'truncate-end', children: [r.line.map((x) => x.t).join('')] })] }))
      continue
    }
    flush()
    drawn.push(row(r))
    if (id !== undefined && isOpen(id)) drawn.push(...section(id))
  }
  flush()
  const top = band !== undefined && band.viewing !== undefined ? [back()] : []
  // Pictures get room between them (the cards sat edge to edge); lines of text stay tight.
  const content = [...top, ...(question ? [ask()] : []), ...drawn]
  const frame = (key, children) => {
    const body = Box({ ...(style !== 'boxed' ? key : {}), flexDirection: 'column', ...(art ? { gap: 'sm' } : {}), children })
    if (style !== 'boxed') return body
    // The terminal's strip asks in lilac, frame and all; on Desktop the question is its own card, the frame stays quiet.
    return Box({ ...key, borderStyle: 'round', borderColor: question && !desk ? UI_LILAC : UI_HEX.dim, paddingX: 1, flexDirection: 'column', children: [body] })
  }
  if (!Array.isArray(line) || line.length === 0) return frame({}, content)
  // The status line is the band's last row, under the frame, right above the prompt; with nothing else to say
  // the band is that line alone (no empty frame). The wrapper and both parts keep their keys from one drawing
  // to the next, so the pictures in the frame stay where they were.
  // Its right end holds the performance mode toggle (Desktop only): the ⚡ alone, dim when off, lit when on; the
  // label names it. Before it, while compaction is advised and no agent is on the band, the compact key in the
  // same small style (no hotkey: the Desktop band is not focused; the terminal keeps its '1 compact').
  const compactKey = perf && perf.compact
    ? [
        Button({
          key: 'band-compact',
          plain: true,
          label: COMPACT_LABEL,
          hover: { color: '#ffffff' },
          onPress: onCompact,
          children: [Text({ color: UI_HEX.info, children: [COMPACT_ICON] })],
        }),
      ]
    : []
  const toggle = perf
    ? [
        ...compactKey,
        Button({
          key: 'band-perf',
          plain: true,
          label: PERF_LABEL,
          ...(perf.on ? {} : { dimColor: true }),
          hover: { color: '#ffffff' },
          onPress: () => uiPerfPress($),
          children: [Text({ color: perf.on ? UI_HEX.warn : UI_HEX.dim, ...(perf.on ? { weight: 'bold' } : {}), children: [PERF_ICON] })],
        }),
      ]
    : []
  const segs = Box({ key: 'band-statusline-text', flexDirection: 'row', alignItems: 'center', flexGrow: 1, flexShrink: 1, children: line.map(text) })
  const foot = Box({ key: 'band-statusline', flexDirection: 'row', alignItems: 'center', gap: 'sm', children: [segs, ...toggle] })
  return Box({ key: 'band-with-line', flexDirection: 'column', ...(art ? { gap: 'sm' } : {}), children: [...(content.length > 0 ? [frame({ key: 'band-body' }, content)] : []), foot] })
}

// Whether the band is asking one of the plugin's questions now (it asks one at a time).
export function uiAsking() {
  return uiQuestion !== undefined
}

export function uiLilac() {
  return UI_LILAC
}

// One segment (hooks/ui-logic.mjs) as a Text in the band's colours; for the panes.
export function uiSegmentText($, e) {
  const { Text } = $.ui.resolve(e)
  const hex = uiStyle !== 'plain'
  const look = (tone) => (hex ? { color: UI_HEX[tone] ?? UI_HEX.other } : UI_TONES[tone] ?? {})
  return (s) => {
    const props = { ...look(s.tone), wrap: 'truncate-end', children: [s.t] }
    if (s.bold) props.weight = 'bold'
    return Text(props)
  }
}

// Lines of segments as one column of rows, in the band's colours; for the panes.
export function uiLinesTree($, e, lines) {
  const { Box } = $.ui.resolve(e)
  const text = uiSegmentText($, e)
  return Box({ flexDirection: 'column', children: lines.map((line) => Box({ flexDirection: 'row', children: line.map(text) })) })
}

// Whether the person has a status line of their own (settings.json `statusLine`). It most likely shows the
// context and the limits already, so the band leaves those out of it in the terminal (the Desktop app has no
// such line, and `/crew-ui full` shows everything).
async function uiHasStatusLine($) {
  const now = await $.clock.now()
  if (now - uiStatusLine.at < 60_000) return uiStatusLine.has
  let has = false
  try {
    const value = await $.settings.read({ key: 'statusLine' })
    has = value !== undefined && value !== null && typeof value === 'object' && typeof value.command === 'string' && value.command !== ''
  } catch (err) {
    has = false
  }
  uiStatusLine = { at: now, has }
  return has
}

async function uiFacts($, saverOn) {
  const now = await $.clock.now()
  const usage = await $.session.usage()
  const askAt = await compactAskAt($, usage)
  const guard = guardSummary()
  return {
    tokens: usage?.context?.tokens,
    ctx: ctxChip(usage?.context, askAt, uiCtxHistory),
    five: windowChip(usage?.rateLimits, 'five_hour', now),
    week: windowChip(usage?.rateLimits, 'seven_day', now),
    guard: guard.loaded ? { on: guard.on, held: guard.held } : undefined,
    saver: saverOn,
  }
}

export function registerUi(on, saverOn) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (!uiOn || e.props?.hasSurvey === true) return next(e)
      const question = uiQuestion
      const demo = uiDemo ? demoContent(await $.clock.now()) : undefined
      const facts = demo ? demo.facts : await uiFacts($, saverOn())
      if (!demo) facts.compactKey = facts.ctx?.past === true && question === undefined && compactKeyDue(facts.tokens)
      const columns = typeof e.props?.bodyColumns === 'number' ? e.props.bodyColumns : 100
      // The room the engine gives the band, less the frame (boxed: two rows) and a question (the strip and its buttons).
      const rows = typeof e.props?.maxRows === 'number' ? e.props.maxRows : UI_DEFAULT_ROWS
      const maxLines = Math.max(1, Math.min(UI_MAX_LINES, rows - (uiStyle === 'boxed' ? 2 : 0) - (question ? 4 : 0)))
      if (!demo && !uiFull && e.surface === 'terminal' && (await uiHasStatusLine($))) {
        // The compact key was decided above from the context; only the figures the status line has are left out.
        facts.ctx = undefined
        facts.five = undefined
        facts.week = undefined
      }
      // On the Desktop app the band ends with the status line (ui.statusline): it takes the context and the
      // windows, so the status row leaves them out instead of showing them twice.
      let line
      let perf
      if (e.surface === 'desktop' && (await cfgGet($, 'ui.statusline')) === 'on') {
        perf = { on: (await cfgGet($, 'panel.perf')) === 'on' }
        line = statusLineSegments({ folder: uiPlace.folder, branch: uiPlace.branch, five: facts.five, week: facts.week, ctx: facts.ctx, tokens: facts.tokens, model: uiMain.model ?? uiPlace.model, effort: uiMain.effort })
        facts.ctx = undefined
        facts.five = undefined
        facts.week = undefined
      }
      // The sparkline of blocks is large outside the terminal (Desktop): there the context is the figures only.
      if (e.surface !== 'terminal' && facts.ctx?.spark) facts.ctx = { ...facts.ctx, spark: '' }
      const agents = demo ? demo.agents : await rowBandRows($)
      // Past agents.warn running at once, say so: attention, not tokens, is what runs out first.
      const warnAt = await cfgGet($, 'agents.warn')
      facts.busy = Array.isArray(agents) && agents.length > warnAt ? agents.length : undefined
      // No compact key while a subagent is on the band or runs (pending, running, or waiting: the band draws all
      // three, the running count alone missed the last): pressing it could only say "wait"; it comes back after.
      if (!demo && facts.compactKey && ((Array.isArray(agents) && agents.length > 0) || (await runningAgents($)) > 0)) facts.compactKey = false
      // With the Desktop status line the key sits at its end, beside the performance toggle, not in the frame.
      if (perf && line && line.length > 0) {
        perf.compact = facts.compactKey === true
        facts.compactKey = false
      }
      // Cards sit two or three to a row outside the terminal, so more agents fit than lines of text would.
      const panel = await cfgGet($, 'panel.style')
      const cardsDrawn = e.surface !== 'terminal' && panel !== 'text' && typeof $.ui.resolve(e).Svg === 'function'
      const lines = line && line.length > 0 ? Math.max(1, maxLines - 1) : maxLines
      const status = statusSegments(uiFull || demo ? facts : quietFacts(facts), e.surface === 'terminal')
      // Outside the terminal the cards are laid out once per drawing for the room the engine gives (maxRows): the
      // frame, the status line, the status row and a question first, then whole rows of cards (UI_CARD_ROW_ROWS
      // each), the agents past them a '+N more' chip in the last cell. It depends on nothing but the agents, that
      // room and what is drawn around the cards, so the same agents get the same layout on every drawing, and the
      // status line at the band's foot is never pushed out of view by a half-cut row of cards.
      let cap = lines
      let cardLayout
      if (cardsDrawn && Array.isArray(agents) && agents.length > 0) {
        const clickOn = !demo && (await cfgGet($, 'panel.click')) === 'on'
        const openLabel = clickOn ? t(avBandView().lang, 'band_open_hint') : ''
        const needs = agents.map((a) => cardNeedCells(uiCardText(uiCardAgent(a)), clickOn && typeof a?.id === 'string' ? openLabel : ''))
        const statusRows = status.length > 0 ? 1 : 0
        const cardRows = cardRowsFit({ maxRows: rows, frame: uiStyle === 'boxed' ? 2 : 0, line: line && line.length > 0 ? 1 : 0, status: statusRows, question: question ? 4 : 0 }, UI_CARD_ROW_ROWS)
        cardLayout = cardBudget(columns, needs, cardRows, UI_CARDS_MAX)
        cap = statusRows + cardLayout.rows
      }
      const bandList = bandRows({ status, agents, maxLines: cap, width: columns })
      // A click on an agent row opens what it does under it (not the terminal; panel.click). What is drawn was
      // read by hooks/src/agent-view.js on an event or a press; nothing is read here.
      let band
      if (!demo && e.surface !== 'terminal' && (await cfgGet($, 'panel.click')) === 'on') {
        const view = avBandView()
        const viewing = typeof e.props?.view?.agentId === 'string' && e.props.view.agentId !== '' ? e.props.view.agentId : undefined
        const live = new Set(bandList.filter((r) => r.kind === 'agent').map((r) => r.agent?.id))
        // An open agent that has finished leaves the live rows: it keeps a line of its own while it is open.
        const before = bandList.length
        for (const id of view.open) {
          const c = view.cache.get(id)
          if (!live.has(id) && c && Array.isArray(c.rowLine)) bandList.push({ kind: 'ended', id, line: c.rowLine })
        }
        const shown = new Set(bandList.map((r) => (r.kind === 'agent' ? r.agent?.id : r.kind === 'ended' ? r.id : undefined)))
        // A mobile app may get an empty Box for an Input it did not declare, and a hook cannot tell: the field is
        // drawn on the Desktop app only; elsewhere Write opens the full view.
        const canInput = e.surface === 'desktop' && typeof $.ui.resolve(e).Input === 'function'
        const specs = view.open
          .filter((id) => shown.has(id))
          .map((id) => {
            const sec = view.cache.get(id)?.section ?? { lines: [[{ t: t(view.lang, 'band_reading'), tone: 'dim' }]], keep: 'head' }
            return { id, lines: sec.lines, keep: sec.keep, fixed: 1 + (canInput && view.composing.has(id) ? 1 : 0) }
          })
        const used = bandList.length + (uiStyle === 'boxed' ? 2 : 0) + (question ? 4 : 0) + (viewing ? 1 : 0)
        // The finished agents' own lines count toward the 12 rows the open agents may add in all.
        const fits = new Map(fitSections(specs, bandExtraRows(rows, used, Math.max(0, BAND_EXTRA_MAX - (bandList.length - before)))).map((f) => [f.id, f]))
        band = { view, fits, lang: view.lang, viewing, canInput }
      }
      if (bandList.length === 0 && question === undefined && band?.viewing === undefined && !(line && line.length > 0)) return next(e)
      // Pictures outside the terminal (panel.style capsule or cat), where the surface draws Svg.
      const { Svg } = $.ui.resolve(e)
      let art
      if (cardsDrawn) {
        const now = await $.clock.now()
        // panel.perf on: the characters stand fully still.
        const perf = (await cfgGet($, 'panel.perf')) === 'on'
        art = { Svg, style: panel, perf, now, prev: uiArtPrev(Array.isArray(agents) ? agents : [], now), columns, grid: cardLayout?.grid }
      }
      return uiTree($, e, bandList, () => compactBandPress($), uiStyle, question, art, band, line, perf)
    } catch (err) {
      return next(e)
    }
  })

  // The status line's folder, branch and model: read again at a main turn's start while the folder is not known
  // yet (the first read can fall in the Desktop app's spare folder); after every main turn see uiNoteContext.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && uiPlace.folder === '') await uiRefreshPlace($)
    return next(e)
  })

  // The small touches: plain text added to the engine's own drawing (no colour there). Each leaves the
  // drawing alone when it has nothing to add, and any failure draws the engine's own.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    try {
      if (!uiOn || !uiExtras || typeof e.props?.suffix !== 'string') return next(e)
      const chip = await uiMainChip($)
      const word = uiWords && e.props.message === null ? spinnerWord(uiMain.model) : undefined
      if (chip === '' && word === undefined) return next(e)
      return uiRewrite(next, e, { ...(word !== undefined ? { word } : {}), suffix: chip === '' ? e.props.suffix : e.props.suffix + ' ' + chip })
    } catch (err) {
      return next(e)
    }
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    try {
      if (!uiOn || !uiExtras || e.props?.isExpanded === true || typeof e.props?.word !== 'string') return next(e)
      const chip = await uiMainChip($)
      return chip === '' ? next(e) : uiRewrite(next, e, { word: chip + ' · ' + e.props.word })
    } catch (err) {
      return next(e)
    }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    try {
      if (!uiOn || !uiExtras || !Array.isArray(e.props?.modes)) return next(e)
      const labels = modeLabels(await uiFacts($, saverOn()))
      return labels.length === 0 ? next(e) : uiRewrite(next, e, { modes: [...e.props.modes, ...labels] })
    } catch (err) {
      return next(e)
    }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    try {
      if (!uiOn || !uiExtras || e.props?.isDraft === true) return next(e)
      const tail = tailText(await uiFacts($, saverOn()))
      return tail === '' ? next(e) : uiRewrite(next, e, { tail })
    } catch (err) {
      return next(e)
    }
  })

  on('command.run', { command: 'crew-perf' }, async ($, e) => {
    return { text: (await uiPerfSet($, e.args)).text }
  })

  on('command.run', { command: 'crew-ui' }, async ($, e) => {
    const word = String(e.args || '').trim().toLowerCase()
    const choice = await uiReadChoice($)
    if (word === 'on' || word === 'off') {
      try {
        await $.store.set(UI_STORE_KEY, word)
      } catch (err) {
        // Kept for this session only.
      }
      const envWins = choice.source === 'CREW_CHIEF_UI'
      uiOn = envWins ? choice.on : word === 'on'
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      if (envWins && choice.on !== (word === 'on')) {
        return { text: `crew-ui: CREW_CHIEF_UI=${choice.on ? 'on' : 'off'} is set in the environment and wins; your choice (${word}) is saved for when it is unset.` }
      }
      return { text: word === 'on' ? 'crew-ui: the band is on (terminal and Desktop app; VS Code keeps its status line). Turn it off with /crew-ui off. Nothing in settings.json was changed.' : 'crew-ui: the band is off.' }
    }
    if (word === 'words on' || word === 'words off') {
      uiWords = word === 'words on'
      try {
        await $.store.set(UI_WORDS_KEY, uiWords ? 'on' : 'off')
      } catch (err) {
        // Kept for this session only.
      }
      return { text: uiWords ? 'crew-ui: words on: the spinner says Pondering (Opus), Working (Sonnet), Skimming (Haiku) instead of the engine\'s random word.' : 'crew-ui: words off: the engine picks the spinner word.' }
    }
    if (word.startsWith('style')) {
      const name = word.slice(5).trim()
      if (!UI_STYLES.includes(name)) return { text: `crew-ui: style is ${uiStyle}; choose one of ${UI_STYLES.join(', ')} (plain: theme colours; color: hex colours; pills: coloured blocks for the status line; boxed: a rounded frame). Try /crew-ui demo on first.` }
      uiStyle = name
      try {
        await $.store.set(UI_STYLE_KEY, name)
      } catch (err) {
        // Kept for this session only.
      }
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      return { text: `crew-ui: style ${name}.` }
    }
    if (word === 'panel' || word.startsWith('panel ')) {
      const name = word.slice(5).trim()
      const now = await cfgGet($, 'panel.style')
      if (!['capsule', 'cat', 'text'].includes(name)) return { text: `crew-ui: panel is ${now}; choose capsule (a yellow capsule buddy), cat (a blue point kitten) or text (the plain line). Outside the terminal each running subagent is drawn as a small picture; the terminal always gets the line. Same as /crew-config set panel.style <name>.` }
      const r = await cfgSet($, 'panel.style', name)
      if (!r.ok) return { text: 'crew-ui: the plugin store is not available here, so the panel style cannot be saved (set CREW_CHIEF_PANEL_STYLE instead).' }
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      if (r.source === 'env') return { text: `crew-ui: panel ${name} is saved, but CREW_CHIEF_PANEL_STYLE=${r.value} is set in the environment and wins.` }
      return { text: `crew-ui: panel ${name}${name === 'text' ? ': the plain line everywhere, no pictures.' : ': outside the terminal each running subagent is drawn as a ' + (name === 'cat' ? 'blue point kitten' : 'capsule buddy') + '. The terminal keeps the line.'}` }
    }
    if (word === 'demo on' || word === 'demo off') {
      uiDemo = word === 'demo on'
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      return { text: uiDemo ? 'crew-ui: demo on: the band shows sample content (three agents, limits, guard, the compact key) so styles can be judged. /crew-ui demo off to stop; /crew-ui style plain|color|pills|boxed to change the look.' : 'crew-ui: demo off.' }
    }
    if (word === 'extras on' || word === 'extras off') {
      uiExtras = word === 'extras on'
      try {
        await $.store.set(UI_EXTRAS_KEY, uiExtras ? 'on' : 'off')
      } catch (err) {
        // Kept for this session only.
      }
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      return { text: uiExtras ? 'crew-ui: extras on: the model and effort next to the spinner and the turn line, crew-chief notes in the mode line, a limit note after the prompt hint.' : 'crew-ui: extras off: only the band is drawn.' }
    }
    if (word === 'full' || word === 'quiet') {
      uiFull = word === 'full'
      try {
        await $.store.set(UI_MODE_KEY, word)
      } catch (err) {
        // Kept for this session only.
      }
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      return { text: uiFull ? 'crew-ui: full mode: the context, both limit windows and the guard are always shown.' : 'crew-ui: quiet mode: the band shows only what is worth a look (a running subagent, a limit or the context from 70 %, something the guard stopped, a compaction due).' }
    }
    const surfaces = await $.session.surfaces()
    return {
      text: `crew-ui: the band is ${uiOn ? 'on' : 'off'} (${choice.source}), ${uiFull ? 'full' : 'quiet'} mode. Surfaces here: ${Array.isArray(surfaces) && surfaces.length > 0 ? surfaces.join(', ') : 'none'}; the band is drawn on ${UI_SURFACES.join(' and ')}. /crew-ui on | off | quiet | full | style <name> | panel capsule|cat|text | demo on | words on | extras on | extras off.`,
    }
  })
}
