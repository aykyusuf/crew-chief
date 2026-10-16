// Pure helpers for the compact flow (hooks/compact-flow.mjs). No Claude Code API in here, so
// tests/compact-logic.test.mjs can run them with plain Node.

// ---- thresholds ----------------------------------------------------------------------------

// Official docs give no recommended compaction point (only the default, about 967k on a 1M model).
// Third-party reports put the drop in quality at 300-400k tokens, "highly task dependent", or at
// 60-80 % of a 200k window. So the thresholds are absolute tokens, scaled down on small windows.
export const ARM_TOKENS = 250_000
export const ASK_TOKENS = 400_000
export const ARM_FRACTION = 0.6
export const ASK_FRACTION = 0.85

// "250k" -> 250000, "1m" -> 1000000, "300000" -> 300000, anything else -> undefined.
export function parseTokens(text) {
  if (typeof text !== 'string') return undefined
  const m = /^\s*(\d+(?:\.\d+)?)\s*([km]?)\s*$/i.exec(text)
  if (!m) return undefined
  const n = Number(m[1]) * (m[2].toLowerCase() === 'm' ? 1_000_000 : m[2].toLowerCase() === 'k' ? 1_000 : 1)
  return Number.isFinite(n) && n >= 10_000 ? Math.round(n) : undefined
}

// The two points: `arm` (tell Claude to propose a checkpoint at a phase boundary) and `ask` (Claude
// did not, so ask the person between turns). `ask` is always above `arm`.
export function compactThresholds(windowTokens, overrides = {}) {
  const win = typeof windowTokens === 'number' && windowTokens > 0 ? windowTokens : undefined
  let arm = overrides.arm ?? (win ? Math.min(ARM_TOKENS, Math.round(win * ARM_FRACTION)) : ARM_TOKENS)
  let ask = overrides.ask ?? (win ? Math.min(ASK_TOKENS, Math.round(win * ASK_FRACTION)) : ASK_TOKENS)
  if (ask <= arm) ask = Math.round(arm * 1.25)
  return { arm, ask }
}

// ---- the brief for the summarizer -----------------------------------------------------------

export const FOCUS_MARKER = '[crew-chief compaction brief]'

// Written to stand on its own. The documented API replaces the default summary prompt with
// `instructions`; Claude Code's own /compact keeps it (checked live on 2.1.300: the default sections
// were still in the summary). Either way nothing may be missing, so every default section is named.
// The verification rules follow the one documented failure of compaction in Claude Code: output of a
// killed process written into a summary as a finished result.
export const FOCUS_BLOCK = [
  FOCUS_MARKER,
  'Write the summary as a working state that lets the next turn continue without asking anything again. It must be complete on its own: cover every section below even if no other instructions exist. Prefer completeness over brevity; drop repeated tool output, never facts.',
  'Sections, in this order:',
  '1. Primary request and intent: what the user wants overall and what they asked most recently, in their own words where the wording matters.',
  '2. Constraints and rules the user stated (do not modify X, no commits, language or style, "ask before ..."): copy each one VERBATIM with its scope. Never merge, shorten or drop one. If a rule was later changed or withdrawn, say that.',
  '3. Decisions and why: every choice made, the reason, and the options ruled out.',
  '4. Key technical concepts and facts needed later.',
  '5. Files and code: exact paths and names touched or in play, what changed in each, and the short snippets still needed.',
  '6. Errors and fixes: what failed, the cause, what fixed it.',
  '7. Verification status: for every command, test or process give its exit code and what was actually observed. Mark a result CONFIRMED only when it was read back from a file or store after the process ended (name it). Anything seen only in terminal output, or from a non-zero exit, a timeout or a killed process, is UNCONFIRMED; never write it as completed.',
  '8. All user messages that carry instructions (not tool output), in order.',
  '9. Done, in progress and not started: task ids or names from STATUS.md or tasks.json when the project has them. Refer to those files by path instead of copying them.',
  '10. Pending tasks and the immediate next step, tied to the latest request.',
  'Do not call tools; answer with the summary text only.',
].join('\n')

// The person's own /compact text (if any) stays first and untouched; the brief follows it. Adding it
// twice is a no-op, so a second hook or a retry cannot double it.
export function withFocus(userText, extra = '') {
  const own = typeof userText === 'string' ? userText.trim() : ''
  if (own.includes(FOCUS_MARKER)) return own
  const block = extra === '' ? FOCUS_BLOCK : FOCUS_BLOCK + '\n' + extra
  return own === '' ? block : own + '\n\n' + block
}

// What a process list says to the summarizer: dev servers and watchers keep running through a compaction,
// and the only risk is that nobody remembers them and starts a second one.
export function backgroundNote(tasks) {
  const list = (Array.isArray(tasks) ? tasks : []).slice(0, 5).map((t) => String(t).slice(0, 100))
  if (list.length === 0) return ''
  return 'Background processes running right now (dev servers, watchers, long jobs): ' + list.join('; ') + '. Say in the summary that they are running, with their ids and commands, so nobody starts them a second time.'
}

// ---- STATUS.md and tasks.json ---------------------------------------------------------------

const SECTION_KEYS = [
  ['constraints', /^(constraints?|k[ıi]s[ıi]tlar|k[ıi]s[ıi]tlamalar)\b/i],
  ['now', /^(now|[şs]u an|[şs]imdi)\b/i],
  ['next', /^(next|s[ıi]rada|s[ıi]radaki)\b/i],
  ['decisions', /^(decisions?|kararlar)\b/i],
  ['failed', /^(failed|ba[şs]ar[ıi]s[ıi]z)\b/i],
]

// { constraints: [...], now: [...], ... }: the non-empty lines under each known `##` heading. A
// template placeholder (`...`, `<what>`) or a table header row is not content.
export function parseStatus(md) {
  const out = { constraints: [], now: [], next: [], decisions: [], failed: [] }
  if (typeof md !== 'string') return out
  let current
  for (const raw of md.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(raw)
    if (heading) {
      const title = heading[1].trim()
      const hit = SECTION_KEYS.find(([, re]) => re.test(title))
      current = hit ? hit[0] : undefined
      continue
    }
    if (!current) continue
    const line = raw.trim()
    if (line === '' || /^\|?[\s:|-]+\|?$/.test(line)) continue
    if (/^[-*]?\s*(\.\.\.|…)\s*$/.test(line) || /^[-*\d.\s]*<[^>]*>/.test(line)) continue
    if (/^\|\s*topic\s*\|/i.test(line) || /^\|\s*konu\s*\|/i.test(line)) continue
    out[current].push(line)
  }
  return out
}

// tasks.json -> the tasks that are not finished: { id, title, status, doneWhen }. Anything that does
// not parse gives an empty list (the caller says nothing rather than guess).
export function openTasks(jsonText) {
  let data
  try {
    data = JSON.parse(jsonText)
  } catch (err) {
    return []
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.tasks) ? data.tasks : []
  return list
    .filter((t) => t && typeof t === 'object' && ['todo', 'in_progress', 'blocked'].includes(t.status))
    .map((t) => ({ id: String(t.id ?? ''), title: String(t.title ?? ''), status: t.status, doneWhen: String(t.done_when ?? '') }))
}

// Strings that identify a line without needing the same wording: `code`, "quoted", ids like AUTH-01,
// paths. When a line has none, its longest words are used (and half of them must appear).
export function anchorsOf(line) {
  const text = String(line)
  const strong = []
  for (const m of text.matchAll(/`([^`]{2,})`/g)) strong.push(m[1])
  for (const m of text.matchAll(/["“”]([^"“”]{3,})["“”]/g)) strong.push(m[1])
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,}[-_]\d+\b/g)) strong.push(m[0])
  for (const m of text.matchAll(/[\w.~-]+\/[\w./~-]+/g)) strong.push(m[0])
  if (strong.length > 0) return { kind: 'strong', items: [...new Set(strong.map((s) => s.trim()))] }
  const words = [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 6))]
  words.sort((a, b) => b.length - a.length)
  return { kind: 'words', items: words.slice(0, 4) }
}

function norm(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ')
}

// Whether the summary still says what the line says, by its anchors. A line with no anchor at all
// counts as present (nothing to test, and the restore block puts it back anyway).
export function lineSurvives(summary, line) {
  const hay = norm(summary)
  const { kind, items } = anchorsOf(line)
  if (items.length === 0) return true
  const found = items.filter((i) => hay.includes(norm(i))).length
  return kind === 'strong' ? found >= 1 : found >= Math.ceil(items.length / 2)
}

// What the summary lost from the person's pinned lines and the open tasks. Deterministic, no model.
export function checkSummary(summary, { constraints = [], tasks = [] } = {}) {
  const hay = norm(summary)
  const missingConstraints = constraints.filter((c) => !lineSurvives(summary, c))
  const missingTasks = tasks.filter((t) => {
    if (t.id !== '' && hay.includes(norm(t.id))) return false
    return !(t.title !== '' && lineSurvives(summary, t.title))
  })
  return { missingConstraints, missingTasks }
}

// ---- PROGRESS.md: archive by age ------------------------------------------------------------

export const PROGRESS_ARCHIVE_DAYS = 60
const DAY_MS = 86_400_000

// Splits a dated log into what stays and what is old enough to archive. An entry starts at a line
// like "- 2026-08-01: ..." (or "## 2026-08-01"); the lines under it belong to it, up to the next
// entry or the next heading that is not a date. Everything else (the title, a rule, "## Log", a later
// "## Conventions" section) is kept where it is. An entry whose date does not parse is kept too:
// nothing is moved unless its date is certain.
export function splitProgress(text, nowMs, days = PROGRESS_ARCHIVE_DAYS) {
  const lines = String(text).split('\n')
  const segments = [{ entry: false, lines: [] }]
  const start = /^\s*(?:[-*]\s+|#{2,4}\s+)?(\d{4})-(\d{2})-(\d{2})\b/
  for (const line of lines) {
    const m = start.exec(line)
    const last = segments[segments.length - 1]
    if (m) {
      const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      const valid = Number.isFinite(ms) && new Date(ms).getUTCMonth() === Number(m[2]) - 1
      segments.push({ entry: true, ms: valid ? ms : undefined, lines: [line] })
    } else if (/^#{1,6}\s/.test(line)) {
      // A heading that is not a date ends the entry above it.
      if (last.entry) segments.push({ entry: false, lines: [line] })
      else last.lines.push(line)
    } else {
      last.lines.push(line)
    }
  }
  const cutoff = nowMs - days * DAY_MS
  const isOld = (seg) => seg.entry && seg.ms !== undefined && seg.ms < cutoff
  const old = segments.filter(isOld)
  const kept = segments.filter((seg) => !isOld(seg))
  const join = (list) => list.flatMap((seg) => seg.lines).join('\n').replace(/\n+$/, '')
  return {
    count: old.length,
    keep: join(kept) + '\n',
    archived: old.length > 0 ? join(old) + '\n' : '',
  }
}

// ---- paths ----------------------------------------------------------------------------------

// Claude Code names a project's folder by replacing every character that is not a letter or a digit
// with "-" (checked on 2.1.300: "/private/tmp/x/.y" -> "-private-tmp-x--y").
export function projectDirName(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-')
}

// ~/.claude/plugins/cache/<marketplace>/<name>/<version> -> ~/.claude/plugins/data/<name>-<marketplace>,
// the folder Claude Code keeps for the plugin's own files. A plugin loaded from a plain directory has
// none: undefined, and the caller uses a temporary folder instead.
export function pluginDataDir(pluginRoot, home) {
  const marker = '/plugins/cache/'
  const at = String(pluginRoot).indexOf(marker)
  if (at < 0 || typeof home !== 'string' || home === '') return undefined
  const [marketplace, name] = String(pluginRoot)
    .slice(at + marker.length)
    .split('/')
  if (!marketplace || !name) return undefined
  const clean = (s) => s.replace(/[^A-Za-z0-9_-]/g, '-')
  return `${String(pluginRoot).slice(0, at)}/plugins/data/${clean(name)}-${clean(marketplace)}`
}

// A file name that sorts by time and cannot escape its folder.
export function backupName(prefix, ms, ext = 'md') {
  const stamp = new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return `${prefix.replace(/[^A-Za-z0-9_-]/g, '')}-${stamp}.${ext}`
}

// Which backups to delete so that only the newest `keep` remain (names sort by time).
export function backupsToPrune(names, prefix, keep) {
  const mine = names.filter((n) => n.startsWith(prefix + '-')).sort()
  return mine.length > keep ? mine.slice(0, mine.length - keep) : []
}
