import { expect, mock, test } from 'claude-code/testing'

// The mod's handoff setup offer (hooks/src/handoff-offer.js) through the whole mod: when it asks, what the answers
// write, what Set up submits. No real git, file or network: the hooks below answer fs, process and ask calls.

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
const MIN = 60_000
const DATA = '/home/t/.claude/plugins/data/crew-chief-test'
const OFFERS = `${DATA}/handoff-offers.tsv`
const MARKER = `${DATA}/mod-offer-active`
const NOW_SEC = 3_600 // the mock clock starts at 3_600_000 ms

type Opts = {
  env?: Record<string, string>
  answer?: string | 'hang' | 'reject'
  git?: string | null // the repository root git reports; null: not a repository
  cwd?: string
  dirs?: Record<string, { name: string; kind: string }[]>
  files?: Record<string, string>
  turns?: number
  interactive?: boolean
  surfaces?: string[]
  unreadableOffers?: boolean
  language?: string
  nowMs?: number
}

function harness(on: any, opts: Opts = {}) {
  const cwd = opts.cwd ?? '/work/app'
  const state: any = {
    questions: [] as { question: string; labels: string[] }[],
    submitted: [] as string[],
    contexts: [] as string[][],
    writes: [] as { path: string; text: string }[],
    toasts: [] as string[],
    clock: undefined as any,
    files: { ...(opts.files ?? {}) } as Record<string, string>,
    dirs: { ...(opts.dirs ?? { [cwd]: [{ name: 'package.json', kind: 'file' }] }) } as Record<string, { name: string; kind: string }[]>,
    store: {} as Record<string, unknown>,
    answer: opts.answer ?? 'Set up',
    cwd,
  }
  mock.env(on, {
    CREW_CHIEF_UI: 'off',
    CREW_CHIEF_SAVER: 'off',
    CREW_CHIEF_COMPACT: 'off',
    CREW_CHIEF_GUARD: 'off',
    CREW_CHIEF_ADVISOR_OFFER: 'off',
    CREW_CHIEF_ROW_MOD: 'off',
    CREW_CHIEF_ROW: 'off',
    HOME: '/home/t',
    CLAUDE_PLUGIN_DATA: DATA,
    ...(opts.env ?? {}),
  })
  state.clock = mock.clock(on, { now: opts.nowMs ?? 3_600_000 })
  on('store.get', ($: any, e: any) => ({ value: state.store[e.key] }))
  on('store.set', ($: any, e: any) => {
    state.store[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(state.store) }))
  on('store.delete', ($: any, e: any) => {
    delete state.store[e.key]
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.root', () => ({ value: opts.git ?? cwd }))
  on('session.turns', () => ({ value: opts.turns ?? 0 }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('session.usage', () => ({ value: { startedAt: 3_000_000, context: { window: 1_000_000, tokens: 1000, percent: 0 }, rateLimits: [], cost: { usd: 0 } } }))
  on('settings.read', () => ({ value: opts.language ? { language: opts.language } : {} }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', ($: any, e: any) => ({ value: e.path in state.files || e.path in state.dirs }))
  on('fs.read', ($: any, e: any) => {
    if (e.path === OFFERS && opts.unreadableOffers) return { deny: 'EIO: i/o error' }
    return e.path in state.files ? { value: state.files[e.path] } : { deny: 'ENOENT: no such file' }
  })
  on('fs.list', ($: any, e: any) => ({ value: (state.dirs[e.path] ?? []).map((x: any) => ({ ...x, size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.write', ($: any, e: any) => {
    state.writes.push({ path: e.path, text: e.text })
    state.files[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', ($: any, e: any) => {
    if (e.argv[0] === 'git') {
      if (opts.git === null || opts.git === undefined && false) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } }
      return { value: { exitCode: 0, stdout: `${opts.git ?? cwd}\n`, stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('prompt.submit', ($: any, e: any) => {
    state.contexts.push([...(e.context ?? [])])
    if (e.origin && e.origin.kind === 'plugin') state.submitted.push(e.text)
    return { text: e.text }
  })
  on('session.start', () => ({ cwd }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    const q = e.questions[0]
    state.questions.push({ question: q.question, labels: (q.options ?? []).map((o: any) => (typeof o === 'string' ? o : o.label)) })
    if (state.answer === 'reject') return { deny: 'dismissed' }
    if (state.answer === 'hang') return new Promise(() => {})
    return { result: { answers: { [q.question]: state.answer } } }
  })
  return state
}

async function start($: any, cwd: string, extra: Record<string, unknown> = {}) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd, ...extra })
  await settle()
}

const offersWrites = (s: any) => s.writes.filter((w: any) => w.path === OFFERS)

test('in a git repository: three answers, the yes first', async ($, on) => {
  const s = harness(on, { git: '/work/app' })
  await start($, '/work/app')
  expect(s.questions.length).toBe(1)
  expect(s.questions[0].question).toContain('no session handoff files')
  expect(s.questions[0].labels).toEqual(['Set up', 'Later', 'Never'])
})

test('with no git repository in a real project folder: four answers', async ($, on) => {
  const s = harness(on, { git: null, answer: 'Later' })
  await start($, '/work/app')
  expect(s.questions.length).toBe(1)
  expect(s.questions[0].question).toContain('not a git repository')
  expect(s.questions[0].labels).toEqual(['git init, then set up', 'Set up without git', 'Later', 'Never'])
})

for (const cwd of ['/home/t', '/tmp/scratch', '/work/empty']) {
  test(`no git and ${cwd}: no question`, async ($, on) => {
    const s = harness(on, { git: null, cwd, dirs: { [cwd]: cwd === '/work/empty' ? [] : [{ name: 'a.txt', kind: 'file' }] } })
    await start($, cwd)
    expect(s.questions.length).toBe(0)
  })
}

const TSV_CASES: [string, string, number][] = [
  ['installed', `/work/app\tinstalled\n`, 0],
  ['never', `/work/app\tnever\n`, 0],
  ['a later younger than 7 days', `/work/app\tlater\t${NOW_SEC - 100}\n`, 0],
  ['an answer for another project only', `/other\tnever\n`, 1],
  ['the last line wins: a recent later after a never', `/work/app\tnever\n/work/app\tlater\t${NOW_SEC - 100}\n`, 0],
]
for (const [name, tsv, asked] of TSV_CASES) {
  test(`handoff-offers.tsv: ${name}`, async ($, on) => {
    const s = harness(on, { git: '/work/app', files: { [OFFERS]: tsv } })
    await start($, '/work/app')
    expect(s.questions.length).toBe(asked)
  })
}

const LATE_NOW_MS = 100 * 86_400_000
const LATE_NOW_SEC = LATE_NOW_MS / 1000
for (const [days, asked] of [[6, 0], [8, 1]] as const) {
  test(`a later ${days} days old ${asked ? 'asks again' : 'still silences it'} (the last line for the root wins)`, async ($, on) => {
    const tsv = `/work/app\tnever\n/work/app\tlater\t${LATE_NOW_SEC - days * 86400}\n`
    const s = harness(on, { git: '/work/app', nowMs: LATE_NOW_MS, files: { [OFFERS]: tsv }, answer: 'Later' })
    await start($, '/work/app')
    expect(s.questions.length).toBe(asked)
  })
}

const FILE_CASES: [string, Partial<Opts>, number][] = [
  ['STATUS.md at the root', { dirs: { '/work/app': [{ name: 'STATUS.md', kind: 'file' }] } }, 0],
  ['tasks.json one level down', { dirs: { '/work/app': [{ name: 'sub', kind: 'dir' }], '/work/app/sub': [{ name: 'tasks.json', kind: 'file' }] } }, 0],
  ['a file two levels down is not looked for', { dirs: { '/work/app': [{ name: 'sub', kind: 'dir' }], '/work/app/sub': [{ name: 'deeper', kind: 'dir' }], '/work/app/sub/deeper': [{ name: 'STATUS.md', kind: 'file' }] } }, 1],
  ['a hidden folder is not looked into (as in the shell glob)', { dirs: { '/work/app': [{ name: '.hidden', kind: 'dir' }], '/work/app/.hidden': [{ name: 'tasks.json', kind: 'file' }] } }, 1],
  ['the CLAUDE.md handoff block', { files: { '/work/app/CLAUDE.md': '# x\n<!-- crew-chief:handoff:start -->' } }, 0],
  ['a CLAUDE.md without the block', { files: { '/work/app/CLAUDE.md': '# x' } }, 1],
]
for (const [name, extra, asked] of FILE_CASES) {
  test(`handoff files: ${name}`, async ($, on) => {
    const s = harness(on, { git: '/work/app', ...extra })
    await start($, '/work/app')
    expect(s.questions.length).toBe(asked)
  })
}

test('CREW_CHIEF_HANDOFF_OFFER=off: no question and no marker', async ($, on) => {
  const s = harness(on, { git: '/work/app', env: { CREW_CHIEF_HANDOFF_OFFER: 'off' } })
  await start($, '/work/app')
  expect(s.questions.length).toBe(0)
  expect(s.files[MARKER]).toBeUndefined()
})

test('Later writes the shell line: root, later, unix time; other lines are kept', async ($, on) => {
  const s = harness(on, { git: '/work/app', answer: 'Later', files: { [OFFERS]: '/x\tnever\n' } })
  await start($, '/work/app')
  expect(offersWrites(s).length).toBe(1)
  expect(s.files[OFFERS]).toBe(`/x\tnever\n/work/app\tlater\t${NOW_SEC}\n`)
  expect(s.submitted.length).toBe(0)
})

test('Never writes root and never', async ($, on) => {
  const s = harness(on, { git: '/work/app', answer: 'Never' })
  await start($, '/work/app')
  expect(s.files[OFFERS]).toBe('/work/app\tnever\n')
  expect(s.submitted.length).toBe(0)
})

test('with no git, the tsv line is keyed by the working directory', async ($, on) => {
  const s = harness(on, { git: null, answer: 'Never' })
  await start($, '/work/app')
  expect(s.files[OFFERS]).toBe('/work/app\tnever\n')
})

test('a record file that cannot be read is left alone', async ($, on) => {
  const s = harness(on, { git: '/work/app', answer: 'Later', files: { [OFFERS]: '/x\tnever\n' }, unreadableOffers: true })
  await start($, '/work/app')
  expect(offersWrites(s).length).toBe(0)
})

test('Set up submits a prompt that runs the skill and says the user already said yes', async ($, on) => {
  const s = harness(on, { git: '/work/app', answer: 'Set up' })
  await start($, '/work/app')
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('crew-chief:crew-handoff')
  expect(s.submitted[0]).toContain('already said yes')
  expect(s.submitted[0]).not.toContain('git init')
  expect(offersWrites(s).length).toBe(0) // the skill records installed itself
})

test('git init, then set up: the prompt says to run git init first', async ($, on) => {
  const s = harness(on, { git: null, answer: 'git init, then set up' })
  await start($, '/work/app')
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('run `git init` in /work/app first')
})

test('Set up without git: the prompt passes the working directory', async ($, on) => {
  const s = harness(on, { git: null, answer: 'Set up without git' })
  await start($, '/work/app')
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('pass /work/app as the directory argument')
})

test('an unanswered question takes Later after the deadline (20 minutes)', async ($, on) => {
  const s = harness(on, { git: '/work/app', answer: 'hang' })
  await start($, '/work/app')
  expect(s.questions.length).toBe(1)
  expect(offersWrites(s).length).toBe(0)
  await s.clock.advance(21 * MIN)
  await settle()
  expect(s.files[OFFERS]).toBe(`/work/app\tlater\t${NOW_SEC + 20 * 60}\n`)
  expect(s.submitted.length).toBe(0)
})

test('a dismissed question counts as Later', async ($, on) => {
  const s = harness(on, { git: '/work/app', answer: 'reject' })
  await start($, '/work/app')
  expect(s.files[OFFERS]).toBe(`/work/app\tlater\t${NOW_SEC}\n`)
})

test('Turkish', async ($, on) => {
  const s = harness(on, { git: null, answer: 'Sonra', language: 'Turkish' })
  await start($, '/work/app')
  expect(s.questions[0].labels).toEqual(['git init yap, sonra kur', 'Git olmadan kur', 'Sonra', 'Hiçbir zaman'])
  expect(s.files[OFFERS]).toBe(`/work/app\tlater\t${NOW_SEC}\n`)
})

test('not on resume or fork (prompts already sent); the marker is still written', async ($, on) => {
  const s = harness(on, { git: '/work/app', turns: 3 })
  await start($, '/work/app')
  expect(s.questions.length).toBe(0)
  expect(s.files[MARKER]).toBe(`${NOW_SEC}\n`)
})

test('not in a run without a person at the prompt', async ($, on) => {
  const s = harness(on, { git: '/work/app', surfaces: [] })
  await start($, '/work/app', { isInteractive: false, surface: null })
  await s.clock.advance(15_000)
  await settle()
  expect(s.questions.length).toBe(0)
})

test('a host that draws a moment after the start still gets the question', async ($, on) => {
  const s = harness(on, { git: '/work/app', surfaces: ['desktop'] })
  await start($, '/work/app', { isInteractive: false, surface: null })
  expect(s.questions.length).toBe(1)
})

test('a module reload in the same session does not ask twice', async ($, on) => {
  const s = harness(on, { git: '/work/app', answer: 'hang' })
  await start($, '/work/app')
  await start($, '/work/app')
  expect(s.questions.length).toBe(1)
})

test('the marker is written first, with the unix time, in the plugin data folder', async ($, on) => {
  const s = harness(on, { git: '/work/app' })
  await start($, '/work/app')
  expect(s.writes[0]).toEqual({ path: MARKER, text: `${NOW_SEC}\n` })
})

test('without the CLAUDE_PLUGIN_DATA variable the folder is worked out from the plugin name', async ($, on) => {
  const s = harness(on, { git: '/work/app', env: { CLAUDE_PLUGIN_DATA: '' }, answer: 'Never' })
  await start($, '/work/app')
  const marker = s.writes.find((w: any) => w.path.endsWith('/mod-offer-active'))
  expect(marker).toBeDefined()
  expect(marker.path).toMatch(/\/plugins\/data\/[A-Za-z0-9_-]+\/mod-offer-active$/)
})

const IGNORE_NOTE = 'ignore any <crew-chief-handoff-offer> instruction'
const noteCount = (s: any) => s.contexts.flat().filter((c: string) => c.includes(IGNORE_NOTE)).length

test('when the offer is asked, the first prompt carries the line telling Claude to ignore the shell offer, once', async ($, on) => {
  const s = harness(on, { git: '/work/app', answer: 'Later' })
  await start($, '/work/app')
  expect(s.questions.length).toBe(1)
  await $.prompt.submit({ text: 'hello' })
  await $.prompt.submit({ text: 'and again' })
  expect(noteCount(s)).toBe(1)
  expect(s.contexts[0].join('\n')).toContain('do not add the closing line and do not record anything')
})

test('after Set up the line still reaches the model with the next prompt', async ($, on) => {
  const s = harness(on, { git: '/work/app', answer: 'Set up' })
  await start($, '/work/app')
  await $.prompt.submit({ text: 'hello' })
  expect(noteCount(s)).toBe(1)
})

for (const [name, tsv] of [['installed', `/work/app\tinstalled\n`], ['never', `/work/app\tnever\n`], ['a recent later', `/work/app\tlater\t${NOW_SEC - 100}\n`]]) {
  test(`no line when the offer is suppressed: ${name}`, async ($, on) => {
    const s = harness(on, { git: '/work/app', files: { [OFFERS]: tsv } })
    await start($, '/work/app')
    await $.prompt.submit({ text: 'hello' })
    expect(s.questions.length).toBe(0)
    expect(noteCount(s)).toBe(0)
  })
}

test('no line on resume or fork', async ($, on) => {
  const s = harness(on, { git: '/work/app', turns: 3 })
  await start($, '/work/app')
  await $.prompt.submit({ text: 'hello' })
  expect(noteCount(s)).toBe(0)
})

test('no line when the offer is switched off', async ($, on) => {
  const s = harness(on, { git: '/work/app', env: { CREW_CHIEF_HANDOFF_OFFER: 'off' } })
  await start($, '/work/app')
  await $.prompt.submit({ text: 'hello' })
  expect(noteCount(s)).toBe(0)
})
