// Pure helpers for the crew-ui band (hooks/src/crew-ui.js). Never sees `$`.
//
// The band is a few lines drawn above the prompt. Everything here returns plain data: a line is an array of
// segments `{ t: text, tone, bold? }`, where `tone` is a meaning (ok, warn, hot, crit, dim, info, opus, ...)
// and the drawing part maps it to a colour. That keeps the layout testable without a terminal.
//
//   ctx 52% 520k/1M   5h 4% ~4h20m   7d 96% ~6d13h   guard on · 1 held   [1] compact
//   deep-reader  Sonnet 5.5 ● ● ○ ○ ○ Medium ▓▓▓░░░ 40%  12k  reading auth
import { BAR_WIDTH, effortWord, FACE_SIZE, modelLabel } from './panel-art-logic.mjs'

const EFFORT_STEP = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }
const EFFORT_TONE = ['dim', 'ok', 'warn', 'hot', 'crit', 'max']
const RAINBOW = ['rb0', 'rb1', 'rb2', 'rb3', 'rb4'] // the five dots of max, red to magenta

// ●○○○○ low, ●●○○○ medium, ●●●○○ high, ●●●●○ xhigh, ●●●●● max (a rainbow where colour is drawn). Full-height
// glyphs so they sit on the text line.
// No effort (a model without the parameter) -> undefined: nothing is drawn.
export function effortMeter(effort) {
  const step = EFFORT_STEP[String(effort ?? '').toLowerCase()]
  if (step === undefined) return undefined
  return { glyph: '●'.repeat(step) + '○'.repeat(5 - step), tone: EFFORT_TONE[step], label: String(effort).toLowerCase(), rainbow: step === 5 }
}

// pct 0..100 -> '▓▓▓░░░' of `width` cells; a number that is not a number draws nothing.
export function bar(pct, width = 6) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return ''
  const filled = Math.max(0, Math.min(width, Math.round((Math.max(0, Math.min(100, pct)) / 100) * width)))
  return '▓'.repeat(filled) + '░'.repeat(width - filled)
}

export function familyOf(model) {
  const m = String(model ?? '').toLowerCase()
  for (const f of ['opus', 'sonnet', 'haiku', 'fable']) if (m.includes(f)) return f
  return 'other'
}

// 950 -> '950', 41234 -> '41k', 1_250_000 -> '1.2M'.
export function tokenLabel(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return ''
  if (n >= 1_000_000) return Math.floor(n / 100_000) / 10 + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'k'
  return String(Math.floor(n))
}

// 'in 4h20m' style, from an ISO timestamp and `now` in ms; past or unreadable -> ''.
export function untilLabel(iso, now) {
  const at = Date.parse(iso)
  if (!Number.isFinite(at) || typeof now !== 'number') return ''
  const s = Math.floor((at - now) / 1000)
  if (s <= 0) return ''
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `~${d}d${h}h`
  if (h > 0) return `~${h}h${String(m).padStart(2, '0')}m`
  return `~${m}m`
}

const toneFor = (pct, warnAt, critAt) => (pct >= critAt ? 'crit' : pct >= warnAt ? 'warn' : 'ok')

// One rate-limit window: { label: '5h', percent: 4, tone, reset: '~4h20m' }, or undefined without a reading.
export function windowChip(rateLimits, kind, now) {
  const w = (Array.isArray(rateLimits) ? rateLimits : []).find((r) => r && r.kind === kind)
  if (!w || typeof w.percentUsed !== 'number') return undefined
  const percent = Math.round(w.percentUsed)
  return { label: kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind, percent, tone: toneFor(percent, 70, 90), reset: untilLabel(w.resetsAt, now) }
}

const SPARK = '▁▂▃▄▅▆▇█'

// 0..100 values -> one block per value ('▁▂▃▅▇'), the last `width` of them; fewer than 3 values -> ''.
export function sparkline(values, width = 12) {
  const list = (Array.isArray(values) ? values : []).filter((v) => typeof v === 'number' && Number.isFinite(v)).slice(-width)
  if (list.length < 3) return ''
  return list.map((v) => SPARK[Math.max(0, Math.min(SPARK.length - 1, Math.floor((Math.max(0, Math.min(100, v)) / 100) * SPARK.length)))]).join('')
}

// The context: { percent, tokens: '520k', window: '1M', tone, past, spark } where `past` says the compaction
// threshold (`askAt` tokens) has been reached and `spark` is the graph of `history` (percent per turn), or ''.
export function ctxChip(context, askAt, history) {
  if (!context || typeof context.tokens !== 'number' || typeof context.window !== 'number' || context.window <= 0) return undefined
  const percent = Math.round((context.tokens / context.window) * 100)
  return { percent, tokens: tokenLabel(context.tokens), window: tokenLabel(context.window), tone: toneFor(percent, 50, 75), past: typeof askAt === 'number' && context.tokens >= askAt, spark: sparkline(history) }
}

// One toast per crossing instead of a chip that stays: `prev` is { past, high } from the last turn, `chip` the
// ctxChip now. Returns the new state and whether to say something (a threshold was newly crossed; falling below
// one, as after a compaction, re-arms it).
export function ctxAlert(chip, prev) {
  const was = prev ?? { past: false, high: false }
  if (!chip) return { state: { past: false, high: false }, fire: false }
  const state = { past: chip.past === true, high: chip.percent >= 70 }
  return { state, fire: (state.past && !was.past) || (state.high && !was.high) }
}

// The Spinner word for a model family: a fixed, calm word instead of the engine's random one (opt-in).
export function spinnerWord(model) {
  const family = familyOf(model)
  return { opus: 'Pondering', sonnet: 'Working', haiku: 'Skimming', fable: 'Dreaming' }[family]
}

// 'sonnet ●●○○○': the model family and the effort meter, for the plain-text spots (the turn line, the spinner)
// that cannot take colour. No model known -> ''.
export function modelChip(model, effort) {
  const family = familyOf(model)
  if (family === 'other' && !model) return ''
  const meter = effortMeter(effort)
  return (family === 'other' ? String(model).replace(/^claude-/, '').slice(0, 14) : family) + (meter ? ' ' + meter.glyph : '')
}

// The one thing worth saying after the prompt's hint line: the most pressing window or the context, else ''.
export function tailText(facts) {
  const loud = [facts.five, facts.week].filter((w) => w && w.percent >= 70).sort((a, b) => b.percent - a.percent)[0]
  if (loud) return `${loud.label} ${loud.percent}%${loud.reset ? ' ' + loud.reset : ''}`
  if (facts.ctx && (facts.ctx.past || facts.ctx.percent >= 70)) return `ctx ${facts.ctx.percent}%`
  return ''
}

// What to add to the footer's mode labels: the saver while it is on, the guard once it has stopped something.
export function modeLabels(facts) {
  const parts = []
  if (facts.saver) parts.push(facts.saver === 'ultra' ? 'ultra-saver on' : 'saver on')
  if (facts.guard && facts.guard.held > 0) parts.push(`guard ${facts.guard.held} held`)
  return parts.length > 0 ? ['crew-chief: ' + parts.join(' · ')] : []
}

const seg = (t, tone, bold) => (bold ? { t, tone, bold: true } : { t, tone })

// Quiet mode: only what is worth a look. The windows from 70 %, the guard once it has stopped
// something, the saver while a window is high, the compact key when compaction is due. Everything fine -> the
// band has nothing to say (and, with no agent running, is not drawn at all).
export function quietFacts(facts) {
  const loud = (w) => (w && w.percent >= 70 ? w : undefined)
  const five = loud(facts.five)
  const week = loud(facts.week)
  return {
    ctx: undefined, // the context is said once, in a toast (ctxAlert), not drawn all the time
    five,
    week,
    guard: facts.guard && facts.guard.held > 0 ? facts.guard : undefined,
    saver: facts.saver === 'ultra' || (facts.saver && (five || week)) ? facts.saver : false,
    compactKey: facts.compactKey,
    busy: facts.busy,
    more: facts.more,
  }
}

// The status line of the band: context, windows, guard, saver, and the compact key when it applies.
// facts: { ctx, five, week, guard: { on, held } | undefined, saver: boolean, compactKey: boolean, more: string }
// `more`: the agents past the cards' room ('+2 more', said in the person's language by the caller), first in the row.
// keyHint: whether the compact key names its shortcut ('[1] compact'); the shortcut only works while the band has
// focus, so outside the terminal (Desktop, VS Code, mobile) the caller leaves it out.
export function statusSegments(facts, keyHint = true) {
  const out = []
  const gap = () => out.length > 0 && out.push(seg('   ', 'dim'))
  if (typeof facts.more === 'string' && facts.more !== '') out.push(seg(facts.more, 'info', true))
  if (facts.ctx) {
    gap()
    out.push(seg('ctx ', 'dim'))
    if (facts.ctx.spark) out.push(seg(facts.ctx.spark + ' ', facts.ctx.tone))
    out.push(seg(`${facts.ctx.percent}%`, facts.ctx.tone, true), seg(` ${facts.ctx.tokens}/${facts.ctx.window}`, 'dim'))
  }
  for (const w of [facts.five, facts.week]) {
    if (!w) continue
    gap()
    out.push(seg(`${w.label} `, 'dim'), seg(`${w.percent}%`, w.tone, true))
    if (w.reset) out.push(seg(` ${w.reset}`, 'dim'))
  }
  if (facts.guard) {
    gap()
    out.push(seg('guard ', 'dim'), facts.guard.on ? seg('on', 'ok') : seg('off', 'crit'))
    if (facts.guard.on && facts.guard.held > 0) out.push(seg(` · ${facts.guard.held} held`, 'warn'))
  }
  if (facts.saver) {
    gap()
    // `badge`: outside the terminal the band draws it as a small picture (a leaf, or the shield of ultra).
    out.push({ ...seg(facts.saver === 'ultra' ? 'ultra-saver on' : 'saver on', 'info'), badge: facts.saver === 'ultra' ? 'ultra' : 'save' })
  }
  if (typeof facts.busy === 'number') {
    gap()
    out.push(seg(`${facts.busy} agents running`, 'warn'), seg(' · more than you can follow', 'dim'))
  }
  if (facts.compactKey) {
    gap()
    out.push({ ...seg(keyHint ? '[1] compact' : 'compact', 'info', true), key: 'compact' })
  }
  return out
}

function clip(text, n) {
  const s = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim()
  return n > 0 && s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s
}

// One subagent: name, model family+version, effort meter, progress bar, tokens, current step.
// agent: { name, model, effort, tokens, pct, step }
// 4m12s, 38s, 1h05m: how long something has run.
export function elapsedLabel(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 1000) return ''
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function agentSegments(agent, width = 100) {
  const out = [seg(clip(String(agent.name ?? 'agent').replace(/^.*:/, ''), 18).padEnd(18), 'info', true), seg(' ', 'dim')]
  if (agent.fresh) out.push(seg('first run ', 'warn'))
  // `unknown`: the agent has run a while and its model never reached us (it started before the mod loaded), so
  // no model or effort is drawn rather than a "starting" that stays.
  if (!agent.unknown) {
    // 'Sonnet 5.5 ● ● ○ ○ ○ Medium': the full model name, the five effort dots apart, the effort word.
    out.push(seg(modelLabel(agent.model), familyOf(agent.model)))
    const meter = effortMeter(agent.effort)
    if (meter && meter.rainbow) out.push(seg(' ', 'dim'), ...RAINBOW.flatMap((tone, i) => (i === 0 ? [seg('●', tone)] : [seg(' ', 'dim'), seg('●', tone)])), seg(' ', 'dim'), seg(effortWord(agent.effort), 'max', true))
    else if (meter) out.push(seg(' ' + meter.glyph.split('').join(' ') + ' ', meter.tone), seg(effortWord(agent.effort), 'dim'))
  }
  if (typeof agent.pct === 'number') {
    const b = bar(agent.pct)
    const filled = b.indexOf('░') === -1 ? b.length : b.indexOf('░')
    out.push(seg(' ', 'dim'), seg(b.slice(0, filled), 'ok'), seg(b.slice(filled), 'dim'), seg(` ${Math.round(agent.pct)}%`, 'info', true))
  }
  const tok = tokenLabel(agent.tokens)
  if (tok) out.push(seg('  ' + tok, 'dim'))
  // What is known for sure is how long an agent has run (its tool call count is not shown).
  const elapsed = elapsedLabel(agent.elapsedMs)
  if (elapsed) out.push(seg('  ' + elapsed, 'dim'))
  const used = out.reduce((n, s) => n + s.t.length, 0)
  const room = width - used - 2
  if (agent.step && room >= 8) out.push(seg('  ' + clip(agent.step, room), 'dim'))
  return out
}

// All lines of the band, at most `maxLines`: the status line first, then one line per agent; agents that do
// not fit become "+N more". No facts and no agents -> [] (the band draws nothing).
export function bandLines({ status, agents, maxLines = 4, width = 100 }) {
  return bandRows({ status, agents, maxLines, width }).map((r) => r.line)
}

// The same lines, each with what it is: { kind: 'status' | 'agent' | 'more', line, agent? }. The band draws an
// agent's line as a picture where it can (hooks/panel-art-logic.mjs) and as the line of segments elsewhere.
export function bandRows({ status, agents, maxLines = 4, width = 100 }) {
  const rows = []
  if (status.length > 0) rows.push({ kind: 'status', line: status })
  const room = Math.max(0, maxLines - rows.length)
  const list = Array.isArray(agents) ? agents : []
  const shown = list.length > room ? Math.max(0, room - 1) : list.length
  for (const a of list.slice(0, shown)) rows.push({ kind: 'agent', agent: a, line: agentSegments(a, width) })
  if (list.length > shown && room > 0) rows.push({ kind: 'more', line: [seg(`+${list.length - shown} more agents`, 'dim')] })
  return rows
}

// Sample content for `/crew-ui demo on`: every part of the band at once, so a style can be judged without
// waiting for a busy session.
export function demoContent(now) {
  const rl = [
    { kind: 'five_hour', percentUsed: 41, resetsAt: new Date(now + (3 * 3600 + 5 * 60) * 1000).toISOString() },
    { kind: 'seven_day', percentUsed: 96, resetsAt: new Date(now + (5 * 86400 + 13 * 3600) * 1000).toISOString() },
  ]
  return {
    facts: {
      ctx: ctxChip({ tokens: 520_000, window: 1_000_000 }, 400_000),
      five: windowChip(rl, 'five_hour', now),
      week: windowChip(rl, 'seven_day', now),
      guard: { on: true, held: 2 },
      saver: true,
      compactKey: true,
    },
    agents: [
      // Every look of a row at once: a fresh estimate, a stale one (`artPct` with `artStale`), none, an agent type
      // and a model the art does not know.
      { id: 'demo-1', name: 'deep-reader', model: 'claude-sonnet-5-5', effort: 'medium', tokens: 48_100, pct: 40, artPct: 40, elapsedMs: 130_000, step: 'reading auth module' },
      { id: 'demo-2', name: 'implementer-hard', model: 'claude-opus-5-5', effort: 'high', tokens: 212_000, artPct: 62, artStale: true, elapsedMs: 252_000, step: 'running the test suite' },
      { id: 'demo-3', name: 'scanner', model: 'claude-haiku-5-5', effort: 'low', tokens: 9_300, pct: 90, artPct: 90, step: 'grep routes' },
      { id: 'demo-4', name: 'Explore', model: 'claude-fable-5-2', effort: 'max', tokens: 31_000, elapsedMs: 41_000 },
    ],
  }
}

export const lineText = (line) => line.map((s) => s.t).join('')

// ---- the status line at the foot of the band (Desktop app, ui.statusline) ---------------------------------
//   work   |   main   |   5h: %4 ~4h 20m   |   7d: %47 ~3d 16h   |   ctx:12%   |   116k   |   Haiku 5.5 ●●○○○ Medium
// Segments carry a hex `color` of their own (the colours of the line people already know); the separators are dim.

export const STATUS_LINE_SEP = '   |   '
const STATUS_LINE_HEX = { folder: '#ff3030', branch: '#2ecc40', five: '#ffd75f', week: '#5fffff', ctx: '#ff8700', model: '#ff5fff' }
// The Desktop app warms a session up in ~/.claude/spares/spare-XXXX before it moves into the project: that
// folder is never named.
const SPARE_DIR = /\/\.claude\/spares\//

// The folder to name for a working directory: its last part, '' for a spare one or none.
export function placeFolder(cwd) {
  const s = typeof cwd === 'string' ? cwd : ''
  if (s === '' || SPARE_DIR.test(s)) return ''
  return s.split('/').filter(Boolean).pop() ?? ''
}

// 116k, 1.2M, 950 (rounded down, as the line always showed it).
function lineTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return n >= 1000 ? `${Math.floor(n / 1000)}k` : String(Math.floor(n))
}

// '~3d16h' -> '~3d 16h', '~4h20m' -> '~4h 20m', '~12m' stays.
const spacedReset = (reset) => String(reset ?? '').replace(/^(~\d+[dh])(\d)/, '$1 $2')

// info: { folder, branch, five, week (windowChip), ctx (ctxChip), tokens (number), model, effort }; what is
// missing is left out. Nothing at all -> [].
export function statusLineSegments(info) {
  const i = info ?? {}
  const parts = []
  if (i.folder) parts.push({ t: String(i.folder), tone: 'other', color: STATUS_LINE_HEX.folder })
  if (i.branch) parts.push({ t: String(i.branch), tone: 'other', color: STATUS_LINE_HEX.branch })
  for (const [w, hex] of [
    [i.five, STATUS_LINE_HEX.five],
    [i.week, STATUS_LINE_HEX.week],
  ]) {
    if (!w || typeof w.percent !== 'number') continue
    const reset = spacedReset(w.reset)
    parts.push({ t: `${w.label}: %${w.percent}${reset ? ' ' + reset : ''}`, tone: 'other', color: hex })
  }
  if (i.ctx && typeof i.ctx.percent === 'number') parts.push({ t: `ctx:${i.ctx.percent}%`, tone: 'other', color: STATUS_LINE_HEX.ctx })
  const tok = lineTokens(i.tokens)
  if (tok) parts.push({ t: tok, tone: 'other' })
  const meter = effortMeter(i.effort)
  const tail = [i.model ? modelLabel(i.model) : '', meter ? meter.glyph : '', meter ? effortWord(i.effort) : ''].filter(Boolean).join(' ')
  if (tail) parts.push({ t: tail, tone: 'other', color: STATUS_LINE_HEX.model })
  const out = []
  for (const p of parts) {
    if (out.length > 0) out.push({ t: STATUS_LINE_SEP, tone: 'dim' })
    out.push(p)
  }
  return out
}

// ---- agent cards on Desktop: the width one needs, and how many share a row ---------------------------------
//
// Measured in cells, generously: a Desktop cell is a little wider than an average letter of the proportional
// font, so one cell per letter leaves room; the dots are wider than letters, and a picture of N px takes N/7
// cells. A card is: frame (border and padding) | face | two lines of text | tokens/time column | the button,
// one gap between each. Line 1: name, model, dots, effort word (and the 'first run' tag where it fits). Line 2:
// the bar, the estimate (sized at 'no estimate' always) and a short piece of the step, the one thing that shrinks.
// The row count depends only on what stays put while an agent runs (name, model, effort, the button's label),
// never on tokens, time, the step or the tag, so cards do not jump between rows (a jump remounts the pictures).
export const CARD_CELLS = { frame: 4, gap: 1, rowGap: 2, figs: 7, pct: 11, stepMin: 6, tag: 9, dot: 1.4, pxPerCell: 7, maxPerRow: 4, stretch: 1.5 }

export function textCells(s) {
  let n = 0
  for (const ch of String(s ?? '')) n += ch === '●' || ch === '○' ? CARD_CELLS.dot : 1
  return n
}

// Parts laid out in a row with one gap between those that are drawn.
const inRow = (parts) => {
  const drawn = parts.filter((p) => p > 0)
  return drawn.reduce((a, b) => a + b, 0) + CARD_CELLS.gap * Math.max(0, drawn.length - 1)
}
const pxCells = (px) => Math.ceil(px / CARD_CELLS.pxPerCell)

// c: agentCardText's answer. tag: with the 'first run' tag after the name.
export function cardLine1Cells(c, tag = false) {
  const dots = c && c.dots ? String(c.dots).replace(/ /g, '') : ''
  return inRow([textCells(c?.name), textCells(c?.model), textCells(dots), textCells(c?.effort), tag ? CARD_CELLS.tag : 0])
}

export function cardLine2Cells() {
  return inRow([pxCells(BAR_WIDTH), CARD_CELLS.pct, CARD_CELLS.stepMin])
}

// Everything in a card but its two lines of text.
const cardChrome = (buttonLabel) => CARD_CELLS.frame + inRow([pxCells(FACE_SIZE), 1, CARD_CELLS.figs, textCells(buttonLabel)]) - 1

// The cells one card needs for all of its text on one line each (the step at its shortest).
export function cardNeedCells(c, buttonLabel = '') {
  return cardChrome(buttonLabel) + Math.max(cardLine1Cells(c), cardLine2Cells())
}

// The room the two lines get in a cell `cell` wide (for the tag: drawn only where it fits).
export function cardTextRoom(cell, buttonLabel = '') {
  return cell - cardChrome(buttonLabel)
}

// How the cards share the band: `fit` is how many of the widest card fit side by side (one to maxPerRow); the
// rows are balanced (5 in rows of 3 -> 3 and 2); a row of fewer cards than `per` is filled out with empty cells.
// Empty cells are added beyond the balanced count only where a card would otherwise stretch past `stretch`
// times its need (one agent alone in a wide band takes half of it, not all). per: cells in a row; cell: the
// width of one; minWidth: the narrowest a card may be drawn (never wider than the band).
// count (optional): the cells to lay out when not one per need (a '+N more' cell, or fewer cards than needs).
// fit: how many of the widest card fit side by side.
export function cardGrid(columns, needs, count) {
  const cols = typeof columns === 'number' && columns > 0 ? columns : 100
  const list = Array.isArray(needs) ? needs.filter((n) => typeof n === 'number' && n > 0) : []
  const need = list.length > 0 ? Math.max(...list) : 1
  const gap = CARD_CELLS.rowGap
  const fit = Math.max(1, Math.min(CARD_CELLS.maxPerRow, Math.floor((cols + gap) / (need + gap))))
  const cellAt = (p) => (cols - gap * (p - 1)) / p
  const n = Number.isInteger(count) && count >= 0 ? count : list.length
  let per = n === 0 ? fit : Math.ceil(n / Math.ceil(n / fit))
  while (per < fit && cellAt(per) > need * CARD_CELLS.stretch) per++
  const cell = cellAt(per)
  return { per, fit, cell, need, minWidth: Math.max(1, Math.floor(Math.min(need, cell))) }
}

// The rows of agent cards the band has room for (Desktop): what maxRows leaves after the frame, the status
// line, the status row and a question, one card row taking `rowRows` rows and one more for the gap between two.
// At least `min` rows (1 by default; 0 while a question is shown: its rows come first, the cards get what is
// left). room: { maxRows, frame, line, status, question } in rows.
export function cardRowsFit({ maxRows, frame = 0, line = 0, status = 0, question = 0 } = {}, rowRows = 3, min = 1) {
  const rows = typeof maxRows === 'number' && Number.isFinite(maxRows) ? maxRows : 0
  const left = rows - frame - line - status - question
  return Math.max(min, Math.floor((left + 1) / (rowRows + 1)))
}

// The rows a plugin question takes in the band, so the cards are budgeted around it (it is never cut off).
// q: { text, answers, look } as uiAskStart keeps it. desk: the Desktop card (a frame, the head, the facts, the
// answers, which wrap); else the terminal's strip (the text, which wraps, and one row of buttons). columns: the
// band's width inside its own frame. Generous: a row too many costs a card row, a row too few cuts the question.
export function questionRows(q, desk, columns) {
  if (!q) return 0
  const cols = Math.max(10, typeof columns === 'number' && columns > 0 ? columns : 100)
  const lines = (n, room) => Math.max(1, Math.ceil(n / Math.max(1, room)))
  const answers = Array.isArray(q.answers) ? q.answers : []
  if (!desk) return lines(String(q.text ?? '').length + 20, cols) + 1
  const c = q.look && q.look.kind === 'card' ? q.look : {}
  const inner = cols - 4 // the card's border and padding
  const topic = typeof c.topic === 'string' ? c.topic : ''
  const line = typeof c.question === 'string' && c.question !== '' ? c.question : String(q.text ?? '')
  const head = topic !== '' ? 1 : lines(line.length + 16, inner)
  const facts = (Array.isArray(c.facts) && c.facts.some((f) => typeof f === 'string' && f !== '')) || (typeof c.note === 'string' && c.note !== '') ? 1 : 0
  const labels = Array.isArray(c.labels) ? c.labels : []
  let rows = 1
  let used = 0
  answers.forEach((a, i) => {
    const w = textCells(typeof labels[i] === 'string' && labels[i] !== '' ? labels[i] : a) + 6 // its padding and hotkey badge
    if (used > 0 && used + 1 + w > inner) {
      rows++
      used = 0
    }
    used += (used > 0 ? 1 : 0) + w
  })
  // The frame's two rows, and one for the gap between the card and what follows it.
  return 2 + head + facts + rows + 1
}

// Which of `needs` (one per agent, in order) the band draws as cards in `cardRows` rows of the grid, `max`
// cards at most: { grid, cells, shown, more, rows }. Every cell that fits holds a card (no row of cards is ever
// cut in half); the agents past them (`more`) are said by a small '+N more' chip in the status row, never in a
// card's cell. The grid is laid out for `cells` cells: drawn with it, the cards take at most `cardRows` rows.
// cardRows 0 (a question took the room): no card at all, every agent is in `more`. rows: the band rows the
// cards take after the status row (for bandRows). Pure: the same agents and room give the same layout.
export function cardBudget(columns, needs, cardRows, max = 6) {
  const list = Array.isArray(needs) ? needs : []
  const n = list.length
  const asked = Number(cardRows)
  const rows = Number.isFinite(asked) ? Math.max(0, Math.floor(asked)) : 1
  const top = Math.max(1, Math.floor(Number(max) || 1))
  const all = cardGrid(columns, list)
  if (rows === 0 || n === 0) return { grid: all, cells: 0, shown: 0, more: n, rows: 0 }
  if (n <= top && Math.ceil(n / all.per) <= rows) return { grid: all, cells: n, shown: n, more: 0, rows: n }
  const cells = Math.min(top, all.fit * rows, n)
  const grid = cardGrid(columns, list, cells)
  return { grid, cells, shown: cells, more: n - cells, rows: cells }
}

// ---- performance mode (/crew-perf, the toggle at the end of the Desktop status line) -------------------------
//
// panel.perf is a scope: off, agents (the agent pictures stand still), theme (the desktop theme stands still,
// through ~/.claude/perf-mode.json) or all (both). /crew-perf <args>: '' asks which one (PERF_ASK); a scope, or
// on (all), sets it; undefined for anything else, so a typo never switches it.
export const PERF_SCOPES = ['all', 'agents', 'theme', 'off']
export const PERF_ASK = 'ask'
export function perfArg(args) {
  const w = String(args ?? '').trim().toLowerCase()
  if (w === '') return PERF_ASK
  if (w === 'on') return 'all'
  return PERF_SCOPES.includes(w) ? w : undefined
}

// What a scope stills: { agents, theme }.
export function perfParts(scope) {
  return { agents: scope === 'agents' || scope === 'all', theme: scope === 'theme' || scope === 'all' }
}

// The question's choices, in order: all, agents, theme, and off only while something is on. `current` is the
// index of the scope in force (-1 when off).
export function perfChoices(scope) {
  const scopes = scope === 'agents' || scope === 'theme' || scope === 'all' ? [...PERF_SCOPES] : PERF_SCOPES.slice(0, 3)
  return { scopes, current: scopes.indexOf(scope) }
}

// The toggle draws the glyph alone: dim when off, a small a / t after it for agents or theme alone, lit for all.
export const PERF_ICON = '⚡'
// The Desktop app draws a plain Button's label as its text (seen live 2026-11-15), so the label is the glyph itself.
export const PERF_LABEL = PERF_ICON
export function perfIcon(scope) {
  if (scope === 'agents') return { text: PERF_ICON + 'a', lit: true, bold: false }
  if (scope === 'theme') return { text: PERF_ICON + 't', lit: true, bold: false }
  if (scope === 'all') return { text: PERF_ICON, lit: true, bold: true }
  return { text: PERF_ICON, lit: false, bold: false }
}

// The compact key on the Desktop status line, beside the toggle and in its style: a glyph alone would not say
// what it does, so a down arrow (shrink) and the word the line already uses for the context. The label is the
// same text; the terminal keeps its own '[1] compact' key with the shortcut.
export const COMPACT_ICON = '⇣ ctx'
export const COMPACT_LABEL = COMPACT_ICON
