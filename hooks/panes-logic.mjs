// Pure helpers for the crew-chief panes (hooks/src/crew-panes.js): the task list, the agent timeline and the
// guard log. Each returns plain data: lines of segments `{ t, tone, bold? }` (tones as in hooks/ui-logic.mjs),
// so the layout is testable without a terminal. Never sees `$`.
import { agentSegments, bar, effortMeter, familyOf, tokenLabel } from './ui-logic.mjs'

const seg = (t, tone, bold) => (bold ? { t, tone, bold: true } : { t, tone })

function clip(text, n) {
  const s = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim()
  return n > 0 && s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s
}

// ---- tasks ---------------------------------------------------------------------------------------

const TASK_ICON = { todo: ['○', 'dim'], in_progress: ['◐', 'warn'], done: ['●', 'ok'], blocked: ['✖', 'crit'] }
const TASK_ORDER = { in_progress: 0, blocked: 1, todo: 2, done: 3 }

// tasks.json text -> { header, lines } or { error }. Ordered: in progress, blocked, todo (by priority), done.
export function taskPane(text, { width = 100, maxLines = 12 } = {}) {
  let data
  try {
    data = JSON.parse(String(text))
  } catch (err) {
    return { error: 'tasks.json is not valid JSON' }
  }
  const tasks = Array.isArray(data?.tasks) ? data.tasks.filter((t) => t && typeof t === 'object') : []
  const count = (s) => tasks.filter((t) => t.status === s).length
  const header = [seg('tasks ', 'dim'), seg(String(tasks.length), 'info', true)]
  for (const s of ['in_progress', 'blocked', 'todo', 'done']) {
    if (count(s) > 0) header.push(seg('  ' + TASK_ICON[s][0] + ' ' + count(s), TASK_ICON[s][1]))
  }
  const sorted = [...tasks].sort((a, b) => (TASK_ORDER[a.status] ?? 2) - (TASK_ORDER[b.status] ?? 2) || (Number(a.priority) || 9) - (Number(b.priority) || 9))
  const lines = []
  const shown = sorted.length > maxLines ? maxLines - 1 : sorted.length
  for (const t of sorted.slice(0, shown)) {
    const [icon, tone] = TASK_ICON[t.status] ?? ['?', 'dim']
    const id = clip(t.id ?? '', 20)
    const room = Math.max(8, width - id.length - 6)
    lines.push([seg(icon + ' ', tone), seg(id + '  ', 'info', true), seg(clip(t.title ?? '', room), t.status === 'done' ? 'dim' : 'other')])
  }
  if (sorted.length > shown) lines.push([seg(`+${sorted.length - shown} more`, 'dim')])
  return { header, lines }
}

// ---- agent timeline ------------------------------------------------------------------------------

function span(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// rows: [{ name, model, effort, status: 'running'|'waiting'|'done', startMs, endMs?, tokens?, pct?, step? }], now in ms.
// One line per agent: name, model and effort, a bar of when it ran inside the whole span, how long, its status.
export function timelinePane(rows, now, { width = 100, barWidth = 24 } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.startMs === 'number')
  if (list.length === 0) return { header: [seg('agents ', 'dim'), seg('none yet', 'dim')], lines: [] }
  const t0 = Math.min(...list.map((r) => r.startMs))
  const t1 = Math.max(now, ...list.map((r) => r.endMs ?? now))
  const total = Math.max(1, t1 - t0)
  const header = [seg('agents ', 'dim'), seg(String(list.length), 'info', true), seg(`  over ${span(total)}`, 'dim')]
  const lines = list.map((r) => {
    const from = Math.floor(((r.startMs - t0) / total) * barWidth)
    const to = Math.max(from + 1, Math.ceil((((r.endMs ?? now) - t0) / total) * barWidth))
    const cells = Array.from({ length: barWidth }, (_, i) => (i >= from && i < to ? '█' : '░'))
    const tone = r.status === 'done' ? 'dim' : r.status === 'waiting' ? 'warn' : 'ok'
    const meter = effortMeter(r.effort)
    const out = [seg(clip(String(r.name ?? 'agent').replace(/^.*:/, ''), 16).padEnd(16) + ' ', 'info', true)]
    out.push(seg(clip(String(r.model ?? '').replace(/^claude-/, '').replace(/-([0-9]+)-([0-9]+)(-[0-9]{8})?$/, '-$1.$2'), 11).padEnd(11), familyOf(r.model)))
    out.push(seg(meter ? ' ' + meter.glyph : '      ', meter ? meter.tone : 'dim'))
    out.push(seg(' ' + cells.slice(0, from).join(''), 'dim'), seg(cells.slice(from, to).join(''), tone), seg(cells.slice(to).join(''), 'dim'))
    out.push(seg(' ' + span((r.endMs ?? now) - r.startMs).padStart(6), 'dim'), seg(' ' + r.status, tone))
    const tok = tokenLabel(r.tokens)
    if (tok) out.push(seg(' ' + tok, 'dim'))
    if (typeof r.pct === 'number' && r.status !== 'done') out.push(seg(` ${Math.round(r.pct)}%`, 'info'))
    return out
  })
  return { header, lines }
}

// ---- guard log -----------------------------------------------------------------------------------

const GUARD_TONE = { held: 'warn', deny: 'crit', warn: 'info' }

// events: [{ at, kind: 'held'|'deny'|'warn', text }], newest last; `clock(ms)` formats a time ('21:04').
export function guardPane(events, { width = 100, maxLines = 12, clock = () => '' } = {}) {
  const list = Array.isArray(events) ? events : []
  const count = (k) => list.filter((e) => e.kind === k).length
  const header = [seg('guard ', 'dim'), seg(`${count('held')} held`, 'warn'), seg(`  ${count('deny')} denied`, 'crit'), seg(`  ${count('warn')} warned`, 'info')]
  const shown = list.slice(-maxLines).reverse()
  const lines = shown.map((e) => [seg(clock(e.at) + '  ', 'dim'), seg(String(e.kind).padEnd(5) + ' ', GUARD_TONE[e.kind] ?? 'dim', true), seg(clip(e.text, Math.max(10, width - 16)), 'other')])
  return { header, lines }
}

// One agent as a panel line reuses the band's line (name, model, meter, bar, tokens, step).
export const agentLine = agentSegments
export { bar }
