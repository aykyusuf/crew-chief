// Pure helpers for the agent view pane and the agent-done notices (hooks/src/agent-view.js). Never sees `$`.
//
// The pane draws plain data decided here, testable with plain Node: the count chips, the agent rows grouped
// running first, the selected agent's title, its report as paragraphs (markdown marks taken out), its last
// steps (tool, short argument, a one-line summary of the result), the throttle of the refresh, and the text
// and the go/no-go of the notice when an agent finishes. The band keeps its lines of segments `{ t, tone }`.
import { t } from './saver-i18n.mjs'
import { familyOf, tokenLabel } from './ui-logic.mjs'
import { shortModel } from './row-logic.mjs'

export const VIEW_LIST_MAX = 15 // agents in the list
export const VIEW_LINE_MAX = 160 // characters per line
export const VIEW_REPORT_LINES = 12 // lines of the report (the band's section)
export const VIEW_REPORT_CHARS = 4000 // characters of a report the pane keeps
export const VIEW_REPORT_BLOCKS = 10 // report paragraphs shown before 'show the full report'
export const VIEW_REPORT_FOLD = 900 // characters shown before 'show the full report'
export const VIEW_STEPS = 30 // last tool calls the pane keeps (grouped into rows)
export const VIEW_STEPS_SHOWN = 6 // step rows shown before 'show more'
export const VIEW_TASK_SHORT = 160 // characters of the task shown folded
export const VIEW_NOW_SHORT = 220 // characters of the agent's latest text shown folded
export const VIEW_TASK_MAX = 20000 // characters of the task or the latest text kept (a drawing holds 100000)
export const VIEW_ARG_MAX = 80 // characters of a step's argument (the row also cuts it at the pane's edge)
export const VIEW_FINISHED_MAX = 8 // finished agents listed before 'show N more'
export const VIEW_REFRESH_MS = 1500 // at most one refresh this often
export const NOTIFY_BATCH_MS = 1500 // agents that end this close together share one notice
export const NOTIFY_LIST_MAX = 4 // names in a shared notice

const seg = (text, tone, bold) => (bold ? { t: text, tone, bold: true } : { t: text, tone })

// One line of text that is safe to draw: terminal escape sequences removed whole (a bare control-character
// strip would leave "[31m" behind), other control and direction-override characters dropped, runs of
// whitespace folded.
export function cleanLine(text) {
  return String(text ?? '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '') // CSI: colours, cursor moves
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '') // OSC: titles, links
    .replace(/\u001b[@-_]?/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// cleanLine, then at most `n` characters (the last one an ellipsis when cut).
export function cutLine(text, n = VIEW_LINE_MAX) {
  const s = cleanLine(text)
  return n > 0 && s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s
}

// A block of text as its non-empty lines, each cleaned and cut.
export function textLines(text, n = VIEW_LINE_MAX) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => cutLine(l, n))
    .filter((l) => l !== '')
}

// 215000 -> "3:35", 3725000 -> "1:02:05". Not a usable number -> ''.
export function clockSpan(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

// What a tool call was about, in a few words: the command, the file, the pattern, the address.
export function argSummary(tool, input, n = 100) {
  const i = input && typeof input === 'object' ? input : {}
  const name = String(tool ?? '')
  let out
  if (name === 'Bash') out = str(i.command)
  else if (['Read', 'Edit', 'Write', 'MultiEdit'].includes(name)) out = str(i.file_path)
  else if (name === 'NotebookEdit') out = str(i.notebook_path)
  else if (name === 'Grep') out = str(i.pattern) && i.pattern + (str(i.path) ? ' in ' + i.path : '')
  else if (name === 'Glob') out = str(i.pattern)
  else if (name === 'WebFetch') out = str(i.url)
  else if (name === 'WebSearch') out = str(i.query)
  else if (name === 'Agent' || name === 'Task') out = [str(i.subagent_type), str(i.description)].filter(Boolean).join(': ') || undefined
  else if (name === 'Skill') out = str(i.skill)
  else if (name === 'TodoWrite') out = Array.isArray(i.todos) ? `${i.todos.length} todos` : undefined
  if (out === undefined) {
    for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']) {
      if (str(i[key])) {
        out = i[key]
        break
      }
    }
  }
  if (out === undefined) out = Object.values(i).find((v) => str(v))
  return out === undefined ? '' : cutLine(out, n)
}

// The transcript ($.session.messages({ agentId })) as entries, oldest first:
//   { kind: 'brief' | 'user' | 'text', lines } and { kind: 'tool', tool, arg, result, error, pending }.
// A user message that only carries tool results is skipped: each result already sits on its call.
export function transcriptEntries(messages) {
  const out = []
  let briefSeen = false
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object') continue
    const lines = textLines(m.text)
    if (m.role === 'assistant') {
      if (lines.length > 0) out.push({ kind: 'text', lines, raw: m.text })
      for (const u of Array.isArray(m.toolUses) ? m.toolUses : []) {
        if (!u || typeof u !== 'object') continue
        const answered = typeof u.text === 'string'
        const input = u.input && typeof u.input === 'object' ? u.input : {}
        out.push({
          kind: 'tool',
          id: typeof u.tool_use_id === 'string' ? u.tool_use_id : undefined,
          tool: cutLine(u.tool, 40) || 'tool',
          desc: str(input.description) && cutLine(input.description, 100),
          command: u.tool === 'Bash' && str(input.command) ? input.command : undefined,
          arg: argSummary(u.tool, u.input),
          result: answered ? textLines(u.text)[0] ?? '' : '',
          summary: answered ? resultSummary(u.text) : undefined,
          error: u.isError === true,
          pending: !answered && u.isError !== true,
        })
      }
    } else if (m.role === 'user') {
      if (lines.length === 0) continue
      out.push({ kind: briefSeen ? 'user' : 'brief', lines, raw: m.text })
      briefSeen = true
    }
  }
  return out
}

// The agent's report: the text it handed back (turn.complete's answer, kept by the mod), else its last
// assistant text. Its first `n` lines, and whether more were cut.
export function reportLines(answer, messages, n = VIEW_REPORT_LINES) {
  let text = str(answer)
  if (text === undefined) {
    const list = Array.isArray(messages) ? messages : []
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (m && m.role === 'assistant' && str(m.text)) {
        text = m.text
        break
      }
    }
  }
  const lines = textLines(text)
  return { lines: lines.slice(0, n), more: Math.max(0, lines.length - n) }
}

// ---- the pane ------------------------------------------------------------------------------------------

// Inline markdown taken out of a line: **bold**, __bold__, `code`, [text](url) -> the words alone.
export function mdInline(text) {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\((?:[^)\s]+)\)/g, '$1')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*|__/g, '')
}

// A report as paragraphs to draw wrapped, never cut mid-line: [{ kind: 'heading'|'bullet'|'para'|'code', text }].
// Headings (# x, or a line that is all **x**) are drawn heavier; '- x' / '* x' / '1. x' are bullets; fenced
// code keeps its lines. At most `max` characters in all (the rest is dropped whole, last block cut).
export function reportBlocks(text, max = VIEW_REPORT_CHARS) {
  const out = []
  let used = 0
  let fence = false
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) {
      fence = !fence
      continue
    }
    const line = cleanLine(raw)
    if (line === '' || /^[-*_=]{3,}$/.test(line) || /^\|?[\s:|-]+\|[\s:|-]*$/.test(line)) continue
    let block
    if (fence) block = { kind: 'code', text: line }
    else if (/^#{1,6}\s+/.test(line)) block = { kind: 'heading', text: mdInline(line.replace(/^#{1,6}\s+/, '')) }
    else if (/^(\*\*|__)[^*_]+\1:?$/.test(line)) block = { kind: 'heading', text: mdInline(line) }
    else if (/^[-*+]\s+/.test(line)) block = { kind: 'bullet', text: mdInline(line.replace(/^[-*+]\s+/, '')) }
    else if (/^\d+[.)]\s+/.test(line)) block = { kind: 'bullet', text: mdInline(line), numbered: true }
    else block = { kind: 'para', text: mdInline(line.replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ' · ')) }
    block.text = block.text.trim()
    if (block.text === '') continue
    if (used + block.text.length > max) {
      const room = max - used
      if (room > 20) out.push({ ...block, text: block.text.slice(0, room - 1) + '…' })
      break
    }
    out.push(block)
    used += block.text.length
  }
  return out
}

// The report text to show: what the agent handed back, else its last assistant text.
export function reportText(answer, messages) {
  const text = str(answer)
  if (text !== undefined) return text
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m && m.role === 'assistant' && str(m.text)) return m.text
  }
  return undefined
}

// The report folded: the first `maxBlocks` paragraphs within `maxChars` (one at least), unless `open`.
// { shown, hidden } where `hidden` counts the paragraphs left out.
export function reportFold(blocks, { open = false, maxBlocks = VIEW_REPORT_BLOCKS, maxChars = VIEW_REPORT_FOLD } = {}) {
  const list = Array.isArray(blocks) ? blocks : []
  if (open) return { shown: list, hidden: 0 }
  const shown = []
  let used = 0
  for (const b of list) {
    if (shown.length > 0 && (shown.length >= maxBlocks || used + b.text.length > maxChars)) break
    shown.push(b)
    used += b.text.length
  }
  return { shown, hidden: list.length - shown.length }
}

// Long absolute paths cut to their last two parts: /private/tmp/x/y/tasks/b.output -> …/tasks/b.output.
export function shortPaths(text) {
  return String(text ?? '').replace(/(?:~|\/)(?:[\w.@+-]+\/){3,}[\w.@+-]+/g, (p) => '…/' + p.split('/').slice(-2).join('/'))
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PATH_END = `(?![\\w.@+-])` // a whole path segment: /work is not /workspace

// The project root alone, as a person reads it: ~/crew-chief right under home, else ~/…/crew-chief, or
// …/crew-chief outside home (a bare "." reads as nothing).
export function rootName(root, home) {
  const r = String(root ?? '').replace(/\/+$/, '')
  const base = r.split('/').pop() || r
  const h = String(home ?? '').replace(/\/+$/, '') || (r.match(/^\/(?:Users|home)\/[^/]+/) ?? [''])[0]
  if (h.length > 1 && r.startsWith(h + '/')) return r.slice(h.length + 1).includes('/') ? '~/…/' + base : '~/' + base
  return '…/' + base
}

// Absolute paths in short forms for the pane: a scratchpad or session dir -> …/scratchpad, the project root -> ./
// (the root itself -> rootName), the home dir -> ~ (given, else any /Users/x or /home/x), any other deep absolute
// path -> …/its last two parts. root and home are plain paths without a trailing slash, or absent.
export function tidyPaths(text, { root, home } = {}) {
  let s = String(text ?? '')
  s = s.replace(/(?<![\w.@+-])(?:~|\/)[^\s'"`]*?\/scratchpad(?![\w.@+-])/g, '…/scratchpad')
  const r = typeof root === 'string' ? root.replace(/\/+$/, '') : ''
  if (r.length > 1) {
    s = s.replace(new RegExp(`(?<![\\w.@+/-])${reEscape(r)}/`, 'g'), './')
    s = s.replace(new RegExp(`(?<![\\w.@+/-])${reEscape(r)}${PATH_END}`, 'g'), () => rootName(r, home))
  }
  const h = typeof home === 'string' ? home.replace(/\/+$/, '') : ''
  if (h.length > 1) s = s.replace(new RegExp(`(?<![\\w.@+/-])${reEscape(h)}${PATH_END}`, 'g'), '~')
  s = s.replace(/(?<![\w.@+/-])\/(?:Users|home)\/[\w.@+-]+(?![\w.@+-])/g, '~')
  return s.replace(/(?<![\w.@+~/-])\/(?:[\w.@+-]+\/){3,}[\w.@+-]+/g, (p) => '…/' + p.split('/').slice(-2).join('/'))
}

// A shell command without the leading `cd <dir> &&` (or `;`) it opens with: the step shows what it ran.
export function stripCd(command) {
  let s = String(command ?? '')
  const lead = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/
  while (lead.test(s)) s = s.replace(lead, '')
  return s.trim()
}

// One line kept as written for a Markdown block: paths tidied, escapes and control characters out (a tab
// stays), its indentation kept, trailing blanks gone.
function keepLine(line, paths) {
  return tidyPaths(line, paths)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/\u001b[@-_]?/g, '')
    .replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .trimEnd()
}

// A text folded for the pane: `full` (its lines kept, each cleaned, markdown marks out, paths tidied), `md` (the
// whole text as markdown: paragraphs, bullets, indentation and fences kept, paths tidied; at most one blank line
// in a row), `short` (the opening `n` characters as one line, cut at a word) and `more` (whether `short` leaves
// something out).
export function foldText(text, n, paths = {}) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => mdInline(cleanLine(tidyPaths(l, paths))).trim())
    .filter((l) => l !== '' && !/^[-*_=]{3,}$/.test(l))
  const full = lines.join('\n')
  const md = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => keepLine(l, paths))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const flat = lines.join(' ')
  if (flat.length <= n) return { short: flat, full, md, more: false }
  const cut = flat.slice(0, n)
  const at = cut.lastIndexOf(' ')
  return { short: (at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, '') + '…', full, md, more: true }
}

// Steps in rows: consecutive calls of one tool (none failed) share a row { kind: 'group', id, tool, items, tone, pending },
// a lone call stays { kind: 'tool', ... }. The id of a row is its first call's, so it holds across refreshes.
export function stepGroups(steps) {
  const rows = []
  for (const st of Array.isArray(steps) ? steps : []) {
    const last = rows[rows.length - 1]
    // A failed call stands alone: its error is never folded away.
    const plain = (x) => x.kind === 'group' || x.tone !== 'crit' // a group holds only calls that did not fail
    if (last && last.tool === st.tool && plain(last) && plain(st)) {
      if (last.kind === 'group') last.items.push(st)
      else rows[rows.length - 1] = { kind: 'group', id: last.id, tool: last.tool, items: [last, st] }
    } else rows.push(st)
  }
  for (const g of rows) {
    if (g.kind !== 'group') continue
    g.pending = g.items.some((x) => x.pending)
    g.tone = g.items.some((x) => x.tone === 'crit') ? 'crit' : g.pending ? 'warn' : 'ok'
  }
  return rows
}

// What the engine says about a call in its own words, as plain words: a refusal, a start in the background,
// an exit code, no output. undefined when the text is none of these.
function engineSummary(text, n) {
  const lines = textLines(String(text).replace(/<\/?[a-z_]+>/g, ' '), 400)
  const raw = String(text).split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  const s = lines[0] ?? ''
  const blocked = s.match(/^(?:Error:\s*)?Blocked:\s*(.+)$/i)
  if (blocked) return { key: 'view_res_blocked', vars: { reason: cutLine(shortPaths(blocked[1].split(/(?<=\.)\s/)[0].replace(/\.$/, '')), Math.min(n, 70)) } }
  if (/^Command running in background/i.test(s)) return { key: 'view_res_bg' }
  const exit = s.match(/^(?:Error:\s*)?Exit code (\d+)/i)
  if (exit) return { key: 'view_res_exit', vars: { n: exit[1] }, detail: lines[1] === undefined ? '' : cutLine(shortPaths(lines[1]), Math.min(n, 70)) }
  if (/^\((?:\w+ )?completed with no output\)$/i.test(s)) return { key: 'view_res_no_output' }
  if (s !== raw.trim()) return { text: cutLine(shortPaths(s), n) } // tags taken out
  return undefined
}

// A tool result in a few words, never raw JSON or engine tags: {"success":true,...} -> { ok }, an error field -> its text,
// an array -> its length, other JSON -> its message or its first keys; plain text -> its first line and how
// many more there were. { key, vars } for the words that need translating, or { text, more }.
export function resultSummary(text, n = 140) {
  const raw = String(text ?? '').trim()
  if (raw === '') return { text: '' }
  const said = engineSummary(raw, n)
  if (said !== undefined) return said.text !== undefined ? { ...said, more: Math.max(0, textLines(raw).length - 1) } : said
  if (/^[[{]/.test(raw)) {
    let v
    try {
      v = JSON.parse(raw)
    } catch (err) {
      v = undefined
    }
    if (Array.isArray(v)) return { key: 'view_res_items', vars: { n: v.length } }
    if (v && typeof v === 'object') {
      const err = str(v.error) ?? str(v.error?.message)
      if (v.success === false || v.ok === false || err !== undefined) return { key: 'view_res_failed', detail: err === undefined ? '' : cutLine(err, n) }
      const msg = str(v.message) ?? str(v.result) ?? str(v.text) ?? str(v.output)
      if (msg !== undefined) return { text: cutLine(msg.split(/\r?\n/).find((l) => l.trim() !== '') ?? '', n) }
      if (v.success === true || v.ok === true) return { key: 'view_res_ok' }
      const keys = Object.keys(v).slice(0, 4)
      return { text: keys.length === 0 ? '{}' : '{ ' + keys.join(', ') + (Object.keys(v).length > keys.length ? ', …' : '') + ' }' }
    }
    // Cut short or not JSON after all: the bits that matter, else nothing raw.
    if (/"(?:success|ok)"\s*:\s*false|"error"\s*:\s*"/.test(raw)) return { key: 'view_res_failed', detail: '' }
    if (/"(?:success|ok)"\s*:\s*true/.test(raw)) return { key: 'view_res_ok' }
    const msg = raw.match(/"(?:message|result|text|output)"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (msg && msg[1].trim() !== '') return { text: cutLine(msg[1].replace(/\\n/g, ' ').replace(/\\(.)/g, '$1'), n) }
    const keys = [...raw.matchAll(/"([\w-]{1,30})"\s*:/g)].map((m) => m[1]).slice(0, 4)
    if (keys.length > 0) return { text: '{ ' + keys.join(', ') + ', … }' }
  }
  const lines = textLines(raw, n)
  return { text: shortPaths(lines[0] ?? ''), more: Math.max(0, lines.length - 1) }
}

// A summary as the words the pane draws.
export function summaryText(sum, lang = 'en') {
  if (!sum) return ''
  if (sum.key !== undefined) return t(lang, sum.key, sum.vars ?? {}) + (sum.detail ? ': ' + sum.detail : '')
  return sum.text + (sum.more > 0 ? '  ' + t(lang, 'view_res_lines', { n: sum.more }) : '')
}

const shortName = (name, n = 40) => cutLine(String(name ?? 'agent').replace(/^.*:/, ''), n) || 'agent'
// 'background': its turn ended but it waits on background work it owns (see rowBgWaiting in hooks/src/agent-row.js):
// not finished, so it counts and groups as running, in a calm (dim) look.
const isLive = (status) => status === 'running' || status === 'waiting' || status === 'background'
const PANE_GLYPH = { running: ['●', 'ok'], waiting: ['◌', 'warn'], background: ['◌', 'dim'], done: ['✓', 'ok'], error: ['✗', 'crit'] }

// One row of the pane's list as data: { id, glyph, tone, name, model, family, time, tokens, live, status }.
// row: { id, name, model, effort, status, startMs, endMs?, tokens? } (rowTimeline, newest first).
export function paneRow(row, now) {
  const status = PANE_GLYPH[row.status] ? row.status : 'running'
  const [glyph, tone] = PANE_GLYPH[status]
  const end = typeof row.endMs === 'number' ? row.endMs : now
  return {
    id: row.id,
    status,
    live: isLive(status),
    glyph,
    tone,
    name: shortName(row.name, 28),
    model: row.model ? shortModel(row.model) + (row.effort ? ' · ' + cleanLine(row.effort) : '') : '',
    rawModel: row.model,
    time: typeof row.startMs === 'number' && typeof end === 'number' ? clockSpan(end - row.startMs) : '',
    tokens: tokenLabel(row.tokens),
  }
}

// The counts at the top: running (waiting too), done, failed; only those above zero.
export function paneChips(rows, lang = 'en') {
  const list = Array.isArray(rows) ? rows : []
  const n = (f) => list.filter(f).length
  return [
    { key: 'view_chip_running', n: n((r) => isLive(r.status)), tone: 'ok' },
    { key: 'view_chip_done', n: n((r) => r.status === 'done'), tone: 'dim' },
    { key: 'view_chip_failed', n: n((r) => r.status === 'error'), tone: 'crit' },
  ]
    .filter((c) => c.n > 0)
    .map((c) => ({ text: t(lang, c.key, { n: c.n }), tone: c.tone }))
}

// The list in two groups, running first then finished (each newest first). Finished agents past `max` are
// folded into 'show N more' unless `all`; the selected one always stays in sight.
export function paneGroups(rows, { selected, all = false, max = VIEW_FINISHED_MAX } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const running = list.filter((r) => isLive(r.status))
  const finished = list.filter((r) => !isLive(r.status))
  if (all || finished.length <= max) return { running, finished, hidden: 0 }
  const shown = finished.slice(0, max)
  const pick = finished.find((r) => r.id === selected)
  if (pick !== undefined && !shown.includes(pick)) shown.push(pick)
  return { running, finished: shown, hidden: finished.length - shown.length }
}

// The selected agent as data for the pane:
//   title: { name, status, statusText, tone, time, tokens, calls }
//   deny?: why it cannot be read
//   task?: its brief folded (foldText): { short, full, more }, paths tidied
//   now?: while it runs, its latest narrative (the newest assistant text, never tool output), folded the same way.
//         The rows of $.session.messages({ agentId }) carry only text blocks, no thinking: an agent's thinking is
//         only in the `as: 'api'` form, which the pane does not read (one read per refresh), so none is shown.
//   report?: paragraphs (reportBlocks) once it ended
//   steps: its last `steps` tool calls as rows (stepGroups), oldest first; a call is { kind: 'tool', id, tool,
//          label, arg, command?, summary, tone, pending }: a Bash call's label is its own description and its
//          command (without the leading `cd … &&`) is kept in `command` for an expand; hidden: earlier calls left
//          out; empty: nothing ran yet. `root`/`home` shorten paths (tidyPaths).
export function paneDetail({ name, row, messages, deny, answer, done, calls } = {}, { lang = 'en', now, steps = VIEW_STEPS, root, home } = {}) {
  const r = row ? paneRow(row, now) : undefined
  const status = r?.status ?? (done ? 'done' : 'running')
  const title = {
    name: shortName(name ?? row?.name),
    status,
    statusText: t(lang, 'view_status_' + status),
    tone: PANE_GLYPH[status][1],
    glyph: PANE_GLYPH[status][0],
    rawModel: row?.model,
    model: r?.model ?? '',
    time: r?.time ?? '',
    tokens: r?.tokens ?? '',
    calls: typeof calls === 'number' && calls > 0 ? t(lang, 'agent_calls', { n: calls }) : '',
  }
  const out = { title, steps: [], hidden: 0, empty: false }
  if (deny !== undefined) out.deny = t(lang, 'view_deny', { name: title.name, reason: cutLine(deny, 100) })
  if (done) {
    const blocks = reportBlocks(reportText(answer, deny === undefined ? messages : undefined))
    if (blocks.length > 0) out.report = blocks
  }
  if (deny !== undefined) return out
  const paths = { root, home }
  const tidy = (x) => tidyPaths(x, paths)
  const all = transcriptEntries(messages)
  const brief = all.find((x) => x.kind === 'brief')
  if (brief) out.task = foldText(String(brief.raw).slice(0, VIEW_TASK_MAX), VIEW_TASK_SHORT, paths)
  const said = [...all].reverse().find((x) => x.kind === 'text')
  if (!done && said) out.now = foldText(String(said.raw).slice(0, VIEW_TASK_MAX), VIEW_NOW_SHORT, paths)
  const acts = all.filter((x) => x.kind === 'tool')
  if (acts.length === 0 && !out.report && !out.now) out.empty = true
  const tail = acts.slice(-Math.max(0, steps))
  out.hidden = acts.length - tail.length
  const list = tail.map((x, i) => {
    const handback = /handback/i.test(x.tool)
    const command = x.command !== undefined ? stripCd(tidy(x.command)) : undefined
    const arg = handback ? '' : command !== undefined ? cutLine(command, VIEW_ARG_MAX) : cutLine(tidy(x.arg), VIEW_ARG_MAX)
    const label = x.desc ?? ''
    return {
      kind: 'tool',
      id: x.id ?? 'step-' + (out.hidden + i),
      tool: x.tool,
      label,
      arg: label !== '' && command !== undefined ? '' : arg,
      ...(label !== '' && command !== undefined && command !== '' ? { command: cutLine(command, 600) } : {}),
      summary: x.pending ? t(lang, 'view_running_tool') : handback && !x.error ? t(lang, 'view_handed_back') : tidy(summaryText(x.summary, lang)),
      tone: x.error ? 'crit' : x.pending ? 'warn' : 'ok',
      pending: x.pending,
    }
  })
  out.steps = stepGroups(list)
  return out
}

// Words of the pane kept here until the strings file takes them: the task's toggle and the message field's
// placeholder (the heading above it already names the agent, so the field can stay short where it is narrow).
const PANE_WORDS = {
  en: { task_all: 'Show all', task_less: 'Show less', msg_placeholder: 'Write a message…' },
  tr: { task_all: 'tamamını göster', task_less: 'kısalt', msg_placeholder: 'Mesaj yaz…' },
}
export const paneWord = (lang, key) => (PANE_WORDS[lang] ?? PANE_WORDS.en)[key] ?? PANE_WORDS.en[key]

const STATUS_ICON = { running: ['⠋', 'ok'], waiting: ['◌', 'warn'], background: ['◌', 'dim'], done: ['✓', 'ok'], error: ['✗', 'crit'] }

// One agent of the list: selected mark, status, name, model·effort, how long, tokens.
// row: { id, name, model, effort, status: 'running'|'waiting'|'background'|'done'|'error', startMs, endMs?, tokens? }.
export function agentListLine(row, { now, selected = false } = {}) {
  const [icon, tone] = STATUS_ICON[row.status] ?? STATUS_ICON.running
  const out = [seg(selected ? '▶ ' : '  ', 'info', true), seg(icon + ' ', tone)]
  out.push(seg(cutLine(String(row.name ?? 'agent').replace(/^.*:/, ''), 22).padEnd(22) + ' ', 'info', selected))
  if (row.model) out.push(seg((shortModel(row.model) + (row.effort ? '·' + cleanLine(row.effort) : '')).padEnd(18), familyOf(row.model)))
  const end = typeof row.endMs === 'number' ? row.endMs : now
  const span = typeof row.startMs === 'number' && typeof end === 'number' ? clockSpan(end - row.startMs) : ''
  if (span) out.push(seg(' ' + span.padStart(7), 'dim'))
  const tok = tokenLabel(row.tokens)
  if (tok) out.push(seg(' ' + tok.padStart(5), 'dim'))
  return out
}

// The agent to show: the one picked if it is still listed, else the newest running one, else the newest.
// rows: newest first.
export function pickSelected(rows, selected) {
  const list = Array.isArray(rows) ? rows : []
  if (selected !== undefined && list.some((r) => r.id === selected)) return selected
  return (list.find((r) => isLive(r.status)) ?? list[0])?.id
}

// The refresh throttle: run now when the last one is `minMs` old; else one trailing run, unless one is
// already booked.
export function throttlePlan(lastAt, now, minMs = VIEW_REFRESH_MS, pending = false) {
  if (pending) return { run: 'skip' }
  if (typeof lastAt !== 'number' || now - lastAt >= minMs) return { run: 'now' }
  return { run: 'later', delayMs: Math.max(1, minMs - (now - lastAt)) }
}

// Whether a finished agent run is announced. Only agents $.agent.list named (the engine's own forks for
// compaction or memory carry ids no list names), never a teammate (it ends a turn per message), never twice
// for one run, never a run the person stopped. An error always; otherwise only a run of at least `minSec`.
export function notifyWanted({ known, teammate, reason, durationMs, minSec = 10, already = false }) {
  if (!known || teammate || already) return false
  if (reason === 'aborted') return false
  if (reason === 'error' || reason === 'refusal') return true
  if (typeof durationMs === 'number' && durationMs < minSec * 1000) return false
  return true
}

function facts(item, lang) {
  const parts = [clockSpan(item.durationMs), tokenLabel(item.tokens)]
  if (typeof item.calls === 'number' && item.calls > 0) parts.push(t(lang, 'agent_calls', { n: item.calls }))
  return parts.filter((p) => p !== '').join(' · ')
}

const itemName = (item) => cutLine(String(item.name ?? 'agent').replace(/^.*:/, ''), 40) || 'agent'

// The notice for the runs that ended in one window: "implementer finished: 3:35 · 58k · 14 calls", or for
// several "3 agents finished: implementer 3:35, scanner 0:42 ✗, ...". What is unknown is left out.
// items: [{ name, durationMs?, tokens?, calls?, error? }].
export function notifyText(lang, items) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return ''
  if (list.length === 1) {
    const f = facts(list[0], lang)
    return t(lang, list[0].error ? 'agent_failed' : 'agent_done', { name: itemName(list[0]), facts: f === '' ? '' : ': ' + f })
  }
  const named = list.slice(0, NOTIFY_LIST_MAX).map((i) => [itemName(i), clockSpan(i.durationMs), i.error ? '✗' : ''].filter((p) => p !== '').join(' '))
  if (list.length > NOTIFY_LIST_MAX) named.push(t(lang, 'agent_more', { n: list.length - NOTIFY_LIST_MAX }))
  return t(lang, 'agent_done_many', { n: list.length, list: named.join(', ') })
}

// ---- an agent opened in the band (hooks/src/crew-ui.js draws it, hooks/src/agent-view.js reads it) -----------

export const BAND_OPEN_MAX = 4 // agents open in the band at once; opening a fifth closes the oldest
export const BAND_STEPS = 5 // last steps shown for one agent
export const BAND_LINE_MAX = 120 // characters per line in the band
export const BAND_REPORT_LINES = 6 // lines of a finished agent's report
export const BAND_EXTRA_MAX = 12 // rows the open sections may add to the band at most
export const MESSAGE_MAX = 2000 // characters of a message to an agent

// Opens `id` when it is closed and closes it when open; the list keeps the opening order (oldest first) and
// holds at most `max` ids, the oldest one dropped. A new list; the one given is left alone.
export function toggleOpen(list, id, max = BAND_OPEN_MAX) {
  const now = Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
  if (typeof id !== 'string' || id === '') return now
  if (now.includes(id)) return now.filter((x) => x !== id)
  return [...now, id].slice(-Math.max(1, max))
}

// What one open agent shows under its row, as lines of segments. Most useful first where it gets cut:
//   - `keep: 'head'` (finished): the report with its time, tokens and calls, then its last steps;
//   - `keep: 'tail'` (running): its last steps, oldest first, so a cut drops the oldest.
// A step is one line: the tool, a short argument and the first line of its result; or a '›' line of its text.
export function bandSection({ name, messages, deny, answer, done, durationMs, tokens, calls, error } = {}, { lang = 'en', steps = BAND_STEPS, width = BAND_LINE_MAX, reportMax = BAND_REPORT_LINES } = {}) {
  const lines = []
  const cut = (s) => cutLine(s, width)
  const who = cutLine(String(name ?? 'agent').replace(/^.*:/, ''), 40) || 'agent'
  if (deny !== undefined) lines.push([seg(cut(t(lang, 'view_deny', { name: who, reason: cutLine(deny, 80) })), 'warn')])
  if (done) {
    const parts = [clockSpan(durationMs), tokenLabel(tokens)]
    if (typeof calls === 'number' && calls > 0) parts.push(t(lang, 'agent_calls', { n: calls }))
    const facts = parts.filter((p) => p !== '').join(' · ')
    lines.push([seg((error ? '✗ ' : '✓ ') + t(lang, 'view_report') + (facts ? ' · ' + facts : ''), error ? 'crit' : 'ok', true)])
    const report = reportLines(answer, deny === undefined ? messages : undefined, reportMax)
    for (const l of report.lines) lines.push([seg(cut(l), 'other')])
    if (report.more > 0) lines.push([seg(t(lang, 'view_more_lines', { n: report.more }), 'dim')])
  }
  if (deny === undefined) {
    const tail = transcriptEntries(messages)
      .filter((x) => x.kind === 'tool' || x.kind === 'text')
      .slice(-Math.max(0, steps))
    for (const x of tail) {
      if (x.kind === 'text') {
        lines.push([seg('› ', 'dim'), seg(cut(x.lines[0] ?? ''), 'other')])
        continue
      }
      const head = '• ' + x.tool + (x.arg ? ' ' + x.arg : '')
      const res = x.pending ? t(lang, 'view_running_tool') : x.result
      const text = cut(head + (res ? ' ⎿ ' + res : ''))
      lines.push([seg(text, x.error ? 'crit' : 'dim')])
    }
    if (lines.length === 0) lines.push([seg(t(lang, 'view_empty'), 'dim')])
  }
  return { lines, keep: done ? 'head' : 'tail' }
}

// The rows the open sections may add: what the band has left (`maxRows` less what is already drawn), at most
// BAND_EXTRA_MAX, so the band never pushes the prompt down.
export function bandExtraRows(maxRows, used, cap = BAND_EXTRA_MAX) {
  if (typeof maxRows !== 'number' || !Number.isFinite(maxRows)) return 0
  return Math.max(0, Math.min(cap, Math.floor(maxRows - (Number(used) || 0))))
}

// Fits the open sections into `budget` rows. sections: [{ id, lines, keep, fixed }] in opening order (oldest
// first); `fixed` rows (the buttons, a message field) are never cut. The newest section is served first; an older
// one is shortened (its lines cut, `more` counting what went) or, when even its fixed rows no longer fit, hidden.
// Returns [{ id, lines, more, hidden }] in the order given.
export function fitSections(sections, budget) {
  const list = Array.isArray(sections) ? sections : []
  let room = Math.max(0, Math.floor(Number(budget) || 0))
  const out = new Array(list.length)
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i]
    const lines = Array.isArray(s.lines) ? s.lines : []
    const fixed = Math.max(1, Number(s.fixed) || 1)
    if (room < fixed) {
      out[i] = { id: s.id, lines: [], more: lines.length, hidden: true }
      continue
    }
    const avail = room - fixed
    const shown = lines.length <= avail ? lines : s.keep === 'tail' ? lines.slice(lines.length - avail) : lines.slice(0, avail)
    out[i] = { id: s.id, lines: shown, more: lines.length - shown.length, hidden: false }
    room -= fixed + shown.length
  }
  return out
}

// A message typed in the band, checked before it goes: never empty, at most `max` characters.
// { ok: true, text } (trimmed) or { ok: false, error: 'empty' | 'long' }.
export function checkMessage(text, max = MESSAGE_MAX) {
  const s = typeof text === 'string' ? text.trim() : ''
  if (s === '') return { ok: false, error: 'empty' }
  if (s.length > max) return { ok: false, error: 'long' }
  return { ok: true, text: s }
}

// The send button and what sending means: a running agent reads the message at its next tool turn; a finished
// one is started again (it costs tokens), so its button says so and the person confirms first.
export function sendPlan(done, lang = 'en') {
  return done === true
    ? { label: t(lang, 'band_restart'), confirm: true, noteKey: 'band_note_done' }
    : { label: t(lang, 'band_write'), confirm: false, noteKey: 'band_note_live' }
}

// The system notification is left out when a main turn ended after the first of these runs did: the host
// raises its own notice when the main turn ends, so a second one would only repeat it. The toast stays.
export function nativeWanted({ nativeOn, mainEndedAt, firstEndAt }) {
  if (!nativeOn) return false
  return !(typeof mainEndedAt === 'number' && typeof firstEndAt === 'number' && mainEndedAt >= firstEndAt)
}

// ---- messages sent from the pane -----------------------------------------------------------------------
// Each message the person sends an agent from the pane is a bubble { id, text, at, state, reason?, restarted,
// callsAt, reply? }, kept in memory for the session alone. Its state only moves forward:
//   sending -> delivered ($.session.send said so) -> read (seen in the agent's transcript) -> replied (the
//   agent wrote text after it); failed (the send said no) stays failed.
export const MSG_KEPT = 20 // bubbles kept per agent, newest last
export const MSG_SHOW_LINES = 4 // lines of a bubble's text before '…'
export const MSG_SHOW_CHARS = 320 // characters of a bubble's text before '…'
export const MSG_REPLY_MAX = 140 // characters of the reply's first line
const MSG_RANK = { sending: 0, delivered: 1, read: 2, replied: 3 }

const msgKey = (s) => cleanLine(s).toLowerCase()

// A bubble moved to `state` (never back), the reply added when one is found.
function msgForward(b, state, reply) {
  if (b.state === 'failed' || !(state in MSG_RANK)) return b
  const ahead = MSG_RANK[state] > (MSG_RANK[b.state] ?? 0)
  if (!ahead && !(reply !== undefined && b.reply === undefined && b.state === state)) return b
  return { ...b, state: ahead ? state : b.state, ...(reply !== undefined && b.reply === undefined ? { reply } : {}) }
}

// The bubbles moved by the agent's transcript (SessionMessage[]): a delivered one is read once a user-role
// message after the brief holds its text, in a text block or a tool result (the host frames a peer's message,
// so it is looked for inside),
// replied once an assistant message after that one has text (its first line is the reply). Bubbles are
// matched in order, each to a later message than the one before, so the same text sent twice is two reads.
export function msgTrack(sent, messages) {
  const list = Array.isArray(sent) ? sent : []
  if (!Array.isArray(messages)) return list
  const rows = messages
  const brief = rows.findIndex((m) => m && m.role === 'user' && str(m.text))
  let cursor = brief + 1
  return list.map((b) => {
    if (!b || b.state === 'failed' || b.state === 'sending') return b
    const key = msgKey(b.text)
    if (key === '') return b
    let hit = -1
    for (let i = cursor; i < rows.length; i++) {
      const m = rows[i]
      const texts = m && m.role === 'user' ? [m.text, ...(Array.isArray(m.toolResults) ? m.toolResults.map((r) => r && r.text) : [])] : []
      if (texts.some((x) => typeof x === 'string' && msgKey(x).includes(key))) {
        hit = i
        break
      }
    }
    if (hit < 0) return b
    cursor = hit + 1
    let reply
    for (let i = hit + 1; i < rows.length && reply === undefined; i++) {
      const m = rows[i]
      if (m && m.role === 'assistant') reply = textLines(m.text, MSG_REPLY_MAX)[0]
    }
    return msgForward(b, reply !== undefined ? 'replied' : 'read', reply)
  })
}

// When the transcript cannot be read or does not show the message: a delivered bubble is read once the agent made a tool call after it
// (`calls` above the count when it was sent), replied once its run ended after it (`endedAt`, the answer's
// first line as the reply).
export function msgFallback(sent, { calls, endedAt, answer } = {}) {
  const list = Array.isArray(sent) ? sent : []
  return list.map((b) => {
    if (!b || b.state === 'failed' || b.state === 'sending') return b
    if (typeof endedAt === 'number' && typeof b.at === 'number' && endedAt > b.at) return msgForward(b, 'replied', textLines(answer, MSG_REPLY_MAX)[0])
    if (typeof calls === 'number' && calls > (typeof b.callsAt === 'number' ? b.callsAt : Infinity)) return msgForward(b, 'read')
    return b
  })
}

// Whether a bubble still waits for something the transcript may show.
export const msgPending = (sent) => (Array.isArray(sent) ? sent : []).some((b) => b && (b.state === 'delivered' || b.state === 'read'))

// A bubble's text to draw: its first MSG_SHOW_LINES lines, MSG_SHOW_CHARS characters at most, '…' when cut.
export function msgShown(text, lines = MSG_SHOW_LINES, chars = MSG_SHOW_CHARS) {
  const all = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => cleanLine(l))
    .filter((l) => l !== '')
  let out = all.slice(0, lines).join('\n')
  let cut = all.length > lines
  if (out.length > chars) {
    out = out.slice(0, chars - 1).trimEnd()
    cut = true
  }
  return cut ? out + '…' : out
}

// How long ago, in a few words: 'just now', '3 min ago', '2 h ago'.
export function msgAgo(at, now, lang = 'en') {
  if (typeof at !== 'number' || typeof now !== 'number') return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return t(lang, 'msg_ago_now')
  const m = Math.max(1, Math.round(s / 60))
  if (m < 60) return t(lang, 'msg_ago_min', { n: m })
  return t(lang, 'msg_ago_h', { n: Math.round(m / 60) })
}

const MSG_TONE = { sending: 'dim', delivered: 'info', read: 'ok', replied: 'ok', failed: 'crit' }
const MSG_GLYPH = { sending: '◌', delivered: '✓', read: '✓✓', replied: '✓✓', failed: '✗' }

// The bubbles as the pane draws them, oldest first: { id, text, ago, status, tone, reply }.
export function msgView(sent, { now, lang = 'en' } = {}) {
  return (Array.isArray(sent) ? sent : []).filter(Boolean).map((b) => {
    const state = b.state in MSG_TONE ? b.state : 'sending'
    let status = MSG_GLYPH[state] + ' ' + t(lang, 'msg_state_' + state, { reason: cutLine(b.reason ?? 'unknown', 120) })
    if (b.restarted === true && state !== 'failed' && state !== 'sending') status += ' · ' + t(lang, 'msg_restarted')
    return {
      id: b.id,
      text: msgShown(b.text),
      ago: msgAgo(b.at, now, lang),
      status,
      tone: MSG_TONE[state],
      reply: typeof b.reply === 'string' && b.reply !== '' ? t(lang, 'msg_reply', { text: b.reply }) : undefined,
    }
  })
}

// An agent's name with the Turkish dative ending, for 'implementer'a mesaj yaz…'. Agent names are English
// words: one ending in -er/-or/-ar is said with a back vowel ('a); otherwise the last vowel decides, with a
// buffer y after a vowel.
export function trDative(name) {
  const s = String(name ?? '')
  const low = s.toLocaleLowerCase('tr')
  if (/(er|or|ar)$/.test(low)) return s + "'a"
  const vowels = low.match(/[aeıioöuü]/g)
  const back = vowels ? 'aıou'.includes(vowels[vowels.length - 1]) : true
  return s + "'" + (/[aeıioöuü]$/.test(low) ? 'y' : '') + (back ? 'a' : 'e')
}
