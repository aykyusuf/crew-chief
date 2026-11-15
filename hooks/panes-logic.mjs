// Pure helpers for the crew-chief panes (hooks/src/crew-panes.js): the task list, the agent timeline and the
// guard log. Each returns plain data: lines of segments `{ t, tone, bold? }` (tones as in hooks/ui-logic.mjs),
// so the layout is testable without a terminal. Never sees `$`.
import { CONFIG_NAME } from './guard-logic.mjs'
import { t } from './saver-i18n.mjs'
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

// ---- guard log, the Desktop card view ------------------------------------------------------------
// The guard's log holds { at, kind, text } only (hooks/src/guard.js guardLogPush). `text` is written in a few
// known shapes: 'label [rule]' (a deny), 'label (read-only agent)', 'ssh host, host' (held), 'ssh host: why'
// (a warning). guardEntry takes them apart; anything else stays a plain label.

const GUARD_GLYPH = { deny: '✖', held: '◆', warn: '▲' }
const GUARD_CARD_TONE = { deny: 'crit', held: 'warn', warn: 'info' }
const GUARD_KINDS = ['deny', 'held', 'warn']
const READ_ONLY_TAIL = /\s*\(read-only agent\)$/

export function guardEntry(e) {
  let label = String(e?.text ?? '').trim()
  let rule
  let hosts
  let readOnly = false
  const r = label.match(/\s*\[([A-Za-z0-9_.:-]+)\]$/)
  if (r) {
    rule = r[1]
    label = label.slice(0, r.index)
  }
  if (READ_ONLY_TAIL.test(label)) {
    readOnly = true
    label = label.replace(READ_ONLY_TAIL, '')
  }
  const s = label.includes(' · ') ? null : label.match(/^ssh ([^:]+?)(?::\s*(.+))?$/)
  if (s) {
    hosts = s[1].split(/,\s*/).filter(Boolean)
    label = s[2] ? 'ssh: ' + s[2] : '' // bare 'ssh host': the view names it in the reader's language
  }
  return { kind: GUARD_KINDS.includes(e?.kind) ? e.kind : 'warn', at: Number(e?.at) || 0, label: label || (hosts ? '' : '?'), rule, hosts, readOnly }
}

// '12s', '4m', '2h', '3d'; under ten seconds undefined (just now).
export function agoShort(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000)
  if (s < 10) return undefined
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

function hashText(text) {
  let h = 0
  for (const ch of String(text)) h = (Math.imul(h, 31) + ch.codePointAt(0)) | 0
  return (h >>> 0).toString(36)
}

// A key for an entry that stays the same while the log grows or drops its oldest (an index would not).
export function guardEntryKey(e) {
  return 'guard-' + (Number(e?.at) || 0) + '-' + String(e?.kind) + '-' + hashText(e?.text ?? '')
}

// The Desktop pane as plain data. events oldest first (as guardLogList gives them), summary = guardSummary(),
// now in ms, selected = the key of the pressed entry. No reads: everything comes in through the arguments.
export function guardView(events, { summary = {}, now = 0, selected, lang = 'en', maxRows = 20 } = {}) {
  const list = Array.isArray(events) ? events.filter((e) => e && typeof e === 'object') : []
  const state = summary.loaded === false ? 'loading' : summary.on ? 'on' : 'off'
  const chips = GUARD_KINDS.map((kind) => ({ kind, glyph: GUARD_GLYPH[kind], tone: GUARD_CARD_TONE[kind], count: list.filter((e) => e.kind === kind).length, label: t(lang, 'gp_level_' + kind) }))
  const seen = new Map()
  const keyed = list.map((e) => {
    const base = guardEntryKey(e)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { e, key: n === 0 ? base : base + '-' + n }
  })
  const newest = keyed.reverse()
  const rows = newest.slice(0, maxRows).map(({ e, key }) => {
    const x = guardEntry(e)
    const ago = agoShort(now - x.at)
    if (!x.label) x.label = t(lang, 'gp_ssh')
    const row = { key, kind: x.kind, glyph: GUARD_GLYPH[x.kind], tone: GUARD_CARD_TONE[x.kind], level: t(lang, 'gp_level_' + x.kind), label: x.label, rule: x.rule, hosts: x.hosts, readOnly: x.readOnly, ago: ago === undefined ? t(lang, 'gp_now') : t(lang, 'gp_ago', { t: ago }), selected: key === selected }
    if (row.selected) {
      const checks = [t(lang, 'gp_check_' + x.kind)]
      if (x.hosts) checks.push(t(lang, 'gp_check_ssh', { hosts: x.hosts.join(', ') }))
      if (x.readOnly) checks.push(t(lang, 'gp_check_readonly'))
      row.detail = { text: x.label, checks }
    }
    return row
  })
  const empty = rows.length > 0 ? undefined : t(lang, 'gp_empty_' + state)
  return {
    title: t(lang, 'gp_title'),
    state,
    stateLabel: t(lang, 'gp_state_' + state),
    chips,
    rows,
    more: Math.max(0, newest.length - rows.length),
    moreLabel: newest.length > rows.length ? t(lang, 'gp_more', { n: newest.length - rows.length }) : undefined,
    hint: rows.length > 0 ? t(lang, 'gp_hint') : undefined,
    empty,
    footer: { command: state === 'on' ? '/crew-guard off' : '/crew-guard on', label: t(lang, state === 'on' ? 'gp_footer_off' : 'gp_footer_on'), path: '~/.claude/' + CONFIG_NAME },
  }
}

// One agent as a panel line reuses the band's line (name, model, meter, bar, tokens, step).
export const agentLine = agentSegments
export { bar }
