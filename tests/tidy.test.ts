// Run: claude plugin test   (from the plugin directory; no session, sign-in, or network)
import { expect, mock, test } from 'claude-code/testing'

const MOVE = 'Move them'
const CANCEL = 'Cancel'
const NOW = Date.UTC(2026, 9, 15)
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

type Opts = {
  files?: Record<string, string>
  answer?: string | 'reject'
  env?: Record<string, string>
  breakdown?: Record<string, unknown> | null
  writeFails?: string // a path whose write is silently lost (reads back old text)
  changeWhileAsking?: [string, string] // [path, text] written while the question is open
}

function harness(on: any, opts: Opts = {}) {
  const state = {
    files: { ...(opts.files ?? {}) } as Record<string, string>,
    writes: [] as string[],
    questions: [] as string[],
    dirs: {} as Record<string, string[]>,
  }
  mock.env(on, { CREW_CHIEF_UI: 'off', HOME: '/home/me', CREW_CHIEF_SAVER: 'off', ...(opts.env ?? {}) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  const breakdown = opts.breakdown === null ? undefined : opts.breakdown
  on('session.usage', ($: any, e: any) => ({
    value: { startedAt: NOW - 1000, context: { window: 1_000_000, tokens: 50_000, percent: 5, ...(e.breakdown && breakdown ? { breakdown } : {}) }, rateLimits: [] },
  }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'advisor' }] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('tool.register', () => ({ value: undefined }))
  on('fs.exists', ($: any, e: any) => ({ value: e.path in state.files }))
  on('fs.read', ($: any, e: any) => (e.path in state.files ? { value: state.files[e.path] } : { deny: 'no such file' }))
  on('fs.list', ($: any, e: any) => ({ value: (state.dirs[e.path] ?? []).map((name) => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.write', ($: any, e: any) => {
    state.writes.push(e.path)
    if (e.path !== opts.writeFails) state.files[e.path] = e.text
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.StopFailure', () => ({}))
  on('tool.call', ($: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    state.questions.push(e.questions[0].question)
    if (opts.changeWhileAsking) state.files[opts.changeWhileAsking[0]] = opts.changeWhileAsking[1]
    if (opts.answer === 'reject') return { deny: 'dismissed' }
    return { result: { answers: { [e.questions[0].question]: opts.answer ?? MOVE } } }
  })
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return state
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

async function run($: any, args = '') {
  const r = await $.command.run({ command: 'crew-tidy', args })
  await settle()
  return r.text as string
}

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} number ${i} with enough words`).join('\n') + '\n'
const BREAKDOWN = (paths: string[], extra: Record<string, unknown> = {}) => ({
  categories: [
    { name: 'Messages', tokens: 4000, color: 'x' },
    { name: 'Memory files', tokens: 3000, color: 'x' },
    { name: 'Free space', tokens: 900000, color: 'x' },
  ],
  memoryFiles: paths.map((path) => ({ path, type: 'Project', tokens: 100 })),
  mcpTools: [],
  ...extra,
})

test('the report names an oversized CLAUDE.md, missing paths, repeats and heavy MCP servers, and changes nothing', async ($, on) => {
  const claude = lines(250) + 'See `lib/gone/file.dart` and `README.md`.\nAlways answer in Turkish unless asked otherwise\n'
  const rules = 'Always answer in Turkish unless asked otherwise\n'
  const s = harness(on, {
    files: { '/work/CLAUDE.md': claude, '/work/.claude/rules/a.md': rules, '/work/README.md': 'x' },
    breakdown: BREAKDOWN(['/work/CLAUDE.md', '/work/.claude/rules/a.md'], {
      mcpTools: [
        { name: 'a', serverName: 'figma', tokens: 3000, isLoaded: true },
        { name: 'b', serverName: 'figma', tokens: 2500, isLoaded: false },
        { name: 'c', serverName: 'tiny', tokens: 100, isLoaded: true },
      ],
      skills: { totalSkills: 12, includedSkills: 12, tokens: 900, skillFrontmatter: [] },
    }),
  })
  await start($)
  const text = await run($)
  expect(text).toContain('nothing was changed')
  expect(text).toContain('/work/CLAUDE.md: 252 lines')
  expect(text).toContain('`lib/gone/file.dart`'.replace(/`/g, '') )
  expect(text).not.toContain('README.md, ') // README exists
  expect(text).toContain('appear in more than one loaded file')
  expect(text).toContain('MCP server figma: 2 tools, about 5500 tokens (1 loaded now)')
  expect(text).not.toContain('tiny')
  expect(text).toContain('Skill listing: 12 skills')
  expect(text).toContain('Messages 4000')
  expect(text).not.toContain('Free space')
  expect(s.writes.length).toBe(0)
})

test('a memory index over its limit, or pointing at missing files, is reported', async ($, on) => {
  const index = Array.from({ length: 230 }, (_, i) => `- [Note ${i}](note_${i}.md) — hook`).join('\n') + '\n'
  const s = harness(on, {
    files: { '/home/me/.claude/projects/-work/memory/MEMORY.md': index, '/home/me/.claude/projects/-work/memory/note_0.md': 'x' },
    breakdown: BREAKDOWN(['/home/me/.claude/projects/-work/memory/MEMORY.md']),
  })
  await start($)
  const text = await run($)
  expect(text).toContain('230 lines')
  expect(text).toContain('dropped silently')
  expect(text).toContain('229 entries point to files that do not exist')
  expect(text).toContain('note_1.md')
  expect(text).toContain('…') // the list is cut after five names
  expect(s.writes.length).toBe(0)
})

test('global files are looked at but listed as never changed', async ($, on) => {
  const s = harness(on, {
    files: { '/home/me/.claude/CLAUDE.md': lines(300) },
    breakdown: BREAKDOWN(['/home/me/.claude/CLAUDE.md']),
  })
  await start($)
  const text = await run($)
  expect(text).toContain('/home/me/.claude/CLAUDE.md: 300 lines')
  expect(text).toContain('never changed: /home/me/.claude/CLAUDE.md')
  expect(s.writes.length).toBe(0)
})

test('clean files give a plain all-clear', async ($, on) => {
  harness(on, { files: { '/work/CLAUDE.md': 'Short and sweet.\n' }, breakdown: BREAKDOWN(['/work/CLAUDE.md']) })
  await start($)
  expect(await run($)).toContain('Nothing oversized, stale or repeated')
})

test('without a breakdown the usual project files are looked at', async ($, on) => {
  harness(on, { files: { '/work/CLAUDE.md': lines(260) }, breakdown: null })
  await start($)
  expect(await run($)).toContain('/work/CLAUDE.md: 260 lines')
})

test('a big STATUS.md and an old PROGRESS.md are reported', async ($, on) => {
  const progress = '# P\n\n## Log\n- 2026-10-12: new\n- 2026-07-01: old one\n- 2026-06-01: older one\n'
  harness(on, {
    files: { '/work/STATUS.md': 'x'.repeat(7000), '/work/PROGRESS.md': progress },
    breakdown: BREAKDOWN([]),
  })
  await start($)
  const text = await run($)
  expect(text).toContain('/work/STATUS.md: 6.8 KB')
  expect(text).toContain('/work/PROGRESS.md: 2 entries older than 60 days')
})

const OLD_LOG = '# P: progress\n\n## Log\n- 2026-10-12: new work\n  with detail\n- 2026-07-01: old one\n- 2026-06-01: older one\n'

test('archive: asks, writes the archive first, then rewrites the source, deletes nothing', async ($, on) => {
  const s = harness(on, { files: { '/work/STATUS.md': 's', '/work/PROGRESS.md': OLD_LOG }, answer: MOVE })
  await start($)
  const text = await run($, 'archive')
  expect(s.questions.length).toBe(1)
  expect(s.questions[0]).toContain('Move 2 entries older than 60 days')
  expect(s.writes).toEqual(['/work/PROGRESS-archive.md', '/work/PROGRESS.md'])
  expect(s.files['/work/PROGRESS-archive.md']).toContain('2026-07-01: old one')
  expect(s.files['/work/PROGRESS-archive.md']).toContain('2026-06-01: older one')
  expect(s.files['/work/PROGRESS.md']).toContain('2026-10-12: new work')
  expect(s.files['/work/PROGRESS.md']).toContain('with detail')
  expect(s.files['/work/PROGRESS.md']).not.toContain('old one')
  expect(text).toContain('Moved 2 entries to /work/PROGRESS-archive.md')
})

test('archive appends to an existing archive', async ($, on) => {
  const s = harness(on, {
    files: { '/work/STATUS.md': 's', '/work/PROGRESS.md': OLD_LOG, '/work/PROGRESS-archive.md': '# Archived\n\n- 2026-01-01: ancient\n' },
  })
  await start($)
  await run($, 'archive')
  expect(s.files['/work/PROGRESS-archive.md']).toContain('2026-01-01: ancient')
  expect(s.files['/work/PROGRESS-archive.md']).toContain('2026-07-01: old one')
})

test('archive: cancel or a dismissed question changes nothing', async ($, on) => {
  const a = harness(on, { files: { '/work/STATUS.md': 's', '/work/PROGRESS.md': OLD_LOG }, answer: CANCEL })
  await start($)
  expect(await run($, 'archive')).toContain('Cancelled')
  expect(a.writes.length).toBe(0)
})

test('archive: a dismissed question changes nothing', async ($, on) => {
  const s = harness(on, { files: { '/work/STATUS.md': 's', '/work/PROGRESS.md': OLD_LOG }, answer: 'reject' })
  await start($)
  expect(await run($, 'archive')).toContain('Cancelled')
  expect(s.writes.length).toBe(0)
})

test('archive: nothing old, or no PROGRESS.md, says so without asking', async ($, on) => {
  const s = harness(on, { files: { '/work/STATUS.md': 's', '/work/PROGRESS.md': '## Log\n- 2026-10-12: new\n' } })
  await start($)
  expect(await run($, 'archive')).toContain('Nothing to move')
  expect(s.questions.length).toBe(0)
})

test('archive: no progress file', async ($, on) => {
  harness(on, { files: { '/work/STATUS.md': 's' } })
  await start($)
  expect(await run($, 'archive')).toContain('No PROGRESS.md')
})

test('archive: if the archive does not read back as written, the source is untouched', async ($, on) => {
  const s = harness(on, { files: { '/work/STATUS.md': 's', '/work/PROGRESS.md': OLD_LOG }, writeFails: '/work/PROGRESS-archive.md' })
  await start($)
  const text = await run($, 'archive')
  expect(text).toContain('Could not archive')
  expect(text).toContain('Nothing was lost')
  expect(s.files['/work/PROGRESS.md']).toBe(OLD_LOG)
})

test('archive: if the source does not read back as written, it is restored', async ($, on) => {
  const s = harness(on, { files: { '/work/STATUS.md': 's', '/work/PROGRESS.md': OLD_LOG }, writeFails: '/work/PROGRESS.md' })
  await start($)
  const text = await run($, 'archive')
  expect(text).toContain('Could not archive')
  expect(s.files['/work/PROGRESS.md']).toBe(OLD_LOG)
  expect(s.files['/work/PROGRESS-archive.md']).toContain('old one') // the entries are safe in the archive
})

test('Turkish report and archive', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_LANG: 'tr' }, files: { '/work/STATUS.md': 's', '/work/PROGRESS.md': OLD_LOG }, answer: 'Taşı', breakdown: BREAKDOWN([]) })
  await start($)
  expect(await run($)).toContain('Context denetimi (hiçbir şey değiştirilmedi)')
  expect(await run($, 'archive')).toContain('girdi')
  expect(s.questions[0]).toContain('günden eski 2 girdi')
})

test('archive: if the file changed while the question was open, nothing is moved', async ($, on) => {
  const s = harness(on, {
    files: { '/work/STATUS.md': 's', '/work/PROGRESS.md': OLD_LOG },
    answer: MOVE,
    changeWhileAsking: ['/work/PROGRESS.md', OLD_LOG + '- 2026-10-15: written by another session\n'],
  })
  await start($)
  const text = await run($, 'archive')
  expect(text).toContain('changed while the question was open')
  expect(s.writes.length).toBe(0)
  expect(s.files['/work/PROGRESS.md']).toContain('written by another session')
})
