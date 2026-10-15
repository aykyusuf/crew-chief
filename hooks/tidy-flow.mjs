// /crew-tidy: what in your context is oversized, repeated, or points at something that is gone.
// Part of the mod in hooks/register.js (Claude Code 2.1.287+).
//
//   /crew-tidy            a report (nothing is changed): the instruction and memory files Claude Code
//                         actually loaded (read from /context), measured against Anthropic's own limits;
//                         paths they mention that no longer exist; lines repeated across files; the
//                         handoff files' size and age; MCP servers and skills by token cost.
//   /crew-tidy archive    moves PROGRESS.md entries older than 60 days to PROGRESS-archive.md. It shows
//                         the count and asks first; the archive is written and read back before the
//                         source is rewritten; nothing is deleted; an entry whose date is unclear stays.
// Files under ~/.claude (your global ones) are only ever reported. Memory files are never rewritten.
import { findHandoff } from './handoff.mjs'
import { resolveLang } from './lang.mjs'
import { PROGRESS_ARCHIVE_DAYS, splitProgress } from './compact-logic.mjs'
import { t } from './saver-i18n.mjs'
import {
  INSTRUCTION_LINES,
  MCP_NOTABLE_TOKENS,
  MEMORY_BYTES,
  MEMORY_LINES,
  STATUS_BYTES,
  extractPathRefs,
  findDuplicateLines,
  isGlobalPath,
  kb,
  measure,
  memoryIndexLinks,
  summarizeMcp,
} from './tidy-logic.mjs'

const NAMES_SHOWN = 5

async function safe(fn, fallback) {
  try {
    return await fn()
  } catch (err) {
    return fallback
  }
}

function dirOf(path) {
  const at = path.lastIndexOf('/')
  return at > 0 ? path.slice(0, at) : '/'
}

function baseOf(path) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function shown(list) {
  return list.slice(0, NAMES_SHOWN).join(', ') + (list.length > NAMES_SHOWN ? ', …' : '')
}

// The instruction and memory files this session loaded, with their text. The context breakdown names
// exactly those; without it (an older build) the usual project files are looked at instead.
async function loadedFiles($, breakdown, root, cwd) {
  let paths = (breakdown?.memoryFiles ?? []).map((f) => f.path)
  if (paths.length === 0) {
    paths = [`${root}/CLAUDE.md`, `${root}/CLAUDE.local.md`, `${cwd}/CLAUDE.md`]
    const rules = await safe(() => $.fs.list(`${root}/.claude/rules`), [])
    for (const r of rules) if (r.kind === 'file' && r.name.endsWith('.md')) paths.push(`${root}/.claude/rules/${r.name}`)
  }
  const files = []
  for (const path of [...new Set(paths)]) {
    if (!(await safe(() => $.fs.exists(path), false))) continue
    const text = await safe(() => $.fs.read(path), undefined)
    if (typeof text === 'string') files.push({ path, text })
  }
  return files
}

async function pathExists($, ref, root, cwd) {
  const candidates = ref.startsWith('/') ? [ref] : [`${root}/${ref}`, `${cwd}/${ref}`]
  for (const c of candidates) {
    if (await safe(() => $.fs.exists(c.replace(/\/+$/, '')), false)) return true
  }
  return false
}

async function buildReport($) {
  const lang = await resolveLang($)
  const home = await safe(() => $.env.get('HOME'), '')
  const cwd = (await safe(() => $.session.cwd(), '')) || ''
  const root = (await safe(() => $.session.root(), cwd)) || cwd
  const now = await $.clock.now()
  const usage = await safe(() => $.session.usage({ breakdown: 'summary' }), undefined)
  const breakdown = usage?.context?.breakdown
  const findings = []
  const globals = []

  const files = await loadedFiles($, breakdown, root, cwd)
  for (const file of files) {
    const global = isGlobalPath(file.path, home)
    if (global) globals.push(file.path)
    const size = measure(file.text)
    const memoryIndex = baseOf(file.path) === 'MEMORY.md'
    if (memoryIndex) {
      if (size.lines > MEMORY_LINES || size.bytes > MEMORY_BYTES) {
        findings.push(t(lang, 'tidy_memory_long', { path: file.path, lines: size.lines, kb: kb(size.bytes) }))
      }
      const gone = []
      for (const link of memoryIndexLinks(file.text)) {
        if (!(await safe(() => $.fs.exists(`${dirOf(file.path)}/${link}`), false))) gone.push(link)
      }
      if (gone.length > 0) findings.push(t(lang, 'tidy_memory_missing', { path: file.path, n: gone.length, list: shown(gone) }))
      continue
    }
    if (size.lines > INSTRUCTION_LINES) {
      findings.push(t(lang, 'tidy_file_long', { path: file.path, lines: size.lines }))
    }
    const missing = []
    for (const ref of extractPathRefs(file.text)) {
      if (!(await pathExists($, ref, root, cwd))) missing.push(ref)
    }
    if (missing.length > 0) findings.push(t(lang, 'tidy_paths_missing', { path: file.path, n: missing.length, list: shown(missing) }))
  }

  const dupes = findDuplicateLines(files.filter((f) => baseOf(f.path) !== 'MEMORY.md'))
  if (dupes.length > 0) findings.push(t(lang, 'tidy_dupes', { n: dupes.length, sample: dupes[0].line.slice(0, 80) }))

  const handoff = await findHandoff($)
  if (handoff?.status) {
    const text = await safe(() => $.fs.read(handoff.status), '')
    const size = measure(text)
    if (size.bytes > STATUS_BYTES) findings.push(t(lang, 'tidy_status_big', { path: handoff.status, kb: kb(size.bytes) }))
  }
  if (handoff?.progress) {
    const text = await safe(() => $.fs.read(handoff.progress), '')
    const old = splitProgress(text, now, PROGRESS_ARCHIVE_DAYS).count
    if (old > 0) findings.push(t(lang, 'tidy_progress_old', { path: handoff.progress, n: old, days: PROGRESS_ARCHIVE_DAYS }))
  }

  const mcp = summarizeMcp(breakdown?.mcpTools).filter((r) => r.tokens >= MCP_NOTABLE_TOKENS)
  for (const row of mcp) findings.push(t(lang, 'tidy_mcp', { server: row.server, count: row.count, tokens: row.tokens, loaded: row.loaded }))

  const out = [t(lang, 'tidy_head')]
  out.push(...(findings.length > 0 ? findings.map((f) => '- ' + f) : [t(lang, 'tidy_none')]))
  if (breakdown) {
    const top = (breakdown.categories ?? [])
      .filter((c) => c.tokens > 0 && !/free|buffer/i.test(c.name))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, NAMES_SHOWN)
      .map((c) => `${c.name} ${c.tokens}`)
    if (top.length > 0) out.push(t(lang, 'tidy_categories', { list: top.join(' · ') }))
    if (breakdown.skills) out.push(t(lang, 'tidy_skills', { n: breakdown.skills.totalSkills, tokens: breakdown.skills.tokens }))
  }
  if (globals.length > 0) out.push(t(lang, 'tidy_global', { list: shown(globals) }))
  return out.join('\n')
}

async function archiveProgress($) {
  const lang = await resolveLang($)
  const handoff = await findHandoff($)
  if (!handoff?.progress) return t(lang, 'tidy_archive_nofile')
  const source = handoff.progress
  const original = await safe(() => $.fs.read(source), undefined)
  if (typeof original !== 'string') return t(lang, 'tidy_archive_failed', { reason: source })
  const now = await $.clock.now()
  const split = splitProgress(original, now, PROGRESS_ARCHIVE_DAYS)
  if (split.count === 0) return t(lang, 'tidy_archive_none', { days: PROGRESS_ARCHIVE_DAYS })
  const archive = source.replace(/\.md$/i, '') + '-archive.md'
  const yes = t(lang, 'tidy_archive_yes')
  const answers = [yes, t(lang, 'tidy_archive_no')]
  let answer
  try {
    answer = await $.ui.ask(t(lang, 'tidy_archive_ask', { n: split.count, days: PROGRESS_ARCHIVE_DAYS, path: baseOf(source), archive: baseOf(archive) }), answers)
  } catch (err) {
    return t(lang, 'tidy_archive_cancelled')
  }
  if (answer !== yes) return t(lang, 'tidy_archive_cancelled')

  try {
    // The file may have changed while the question was open (another session, an editor): look again.
    const current = await $.fs.read(source)
    if (current !== original) return t(lang, 'tidy_archive_changed')
    const existing = (await $.fs.exists(archive)) ? await $.fs.read(archive) : ''
    const header = `# Archived from ${baseOf(source)}\n\nMoved by crew-chief when older than ${PROGRESS_ARCHIVE_DAYS} days. Nothing was deleted.\n\n`
    const next = (existing === '' ? header : existing.replace(/\n*$/, '\n\n')) + split.archived
    await $.fs.write(archive, next)
    const back = await $.fs.read(archive)
    if (!back.includes(split.archived.trim())) throw new Error('the archive did not read back as written')
    // Only now is the source rewritten. If that fails the entries are in both files: nothing is lost.
    await $.fs.write(source, split.keep)
    const kept = await $.fs.read(source)
    if (kept.trim() !== split.keep.trim()) {
      await $.fs.write(source, original)
      throw new Error('the source did not read back as written; it was restored')
    }
  } catch (err) {
    return t(lang, 'tidy_archive_failed', { reason: String(err && err.message ? err.message : err).slice(0, 160) })
  }
  return t(lang, 'tidy_archive_done', { n: split.count, archive })
}

export async function tidySessionStart($) {
  try {
    await $.command.register({
      name: 'crew-tidy',
      description: t(await resolveLang($), 'tidy_description'),
      argumentHint: '[archive]',
    })
  } catch (err) {
    // The name is taken: everything else still works.
  }
}

export function registerTidy(on) {
  on('command.run', { command: 'crew-tidy' }, async ($, e) => {
    const word = String(e.args || '').trim().toLowerCase()
    if (word === 'archive' || word === 'arşiv' || word === 'arsiv') return { text: await archiveProgress($) }
    return { text: await buildReport($) }
  })
}
