// Run: claude plugin test   (from the plugin directory; no session, sign-in, or network)
// Night mode, the mod's side (hooks/src/night.js): quiet plugin questions, the opening deadline, the hold file,
// the watchdog, the limit stop, the fallback report and /night status|off. The shell (scripts/night-state.sh) is
// not run here: its calls are recorded and answered with exit 0.
import { expect, mock, test } from 'claude-code/testing'

const SID = 'abcdef12-3456-7890-abcd-ef1234567890'
const POINTER = '/data/night/' + SID
const DIR = '/work/night/abcdef12'
const STATE = DIR + '/state.json'
const NOW = 3_600_000_000 // ms, mock clock start
const SEC = NOW / 1000
const NO_ANSWER = 'NO_ANSWER: nobody answered within 20 minutes; park it in QUESTIONS.md and continue'
const TOOL = 'mcp__crew-chief__crew_compact_checkpoint'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

type Opts = {
  night?: Record<string, unknown> | null // state.json; null: no pointer (no night)
  list?: Record<string, { name: string; kind: string }[]> // fs.list answers by path
  env?: Record<string, string>
  answers?: string[]
  files?: Record<string, string>
  mtimes?: Record<string, number>
  settings?: Record<string, unknown>
  turns?: number
}

function harness(on: any, opts: Opts = {}) {
  const state = {
    clock: undefined as any,
    tokens: 60_000,
    rateLimits: [] as any[],
    questions: [] as string[],
    toasts: [] as string[],
    submitted: [] as string[],
    writes: [] as { path: string; text: string }[],
    ran: [] as { argv: string[]; init: any }[],
    compactCalls: 0,
    answerAt: 0,
    stateMtime: 1,
    files: { ...(opts.files ?? {}) } as Record<string, string>,
    mtimes: { ...(opts.mtimes ?? {}) } as Record<string, number>,
  }
  if (opts.night !== null) {
    state.files[POINTER] = DIR + '\n'
    state.files[STATE] = JSON.stringify({ status: 'armed', session: SID, sid8: 'abcdef12', root: '/work', dir: DIR, started: SEC - 600, deadline: SEC + 4 * 3600, softWrap: SEC + 3.5 * 3600, blocks: 0, noProgress: 0, spawned: 0, current: { id: 'T-1', since: SEC - 300 }, reportDone: false, ...(opts.night ?? {}) })
  }
  const answers = opts.answers ?? ['hang']
  mock.env(on, { CREW_CHIEF_UI: 'off', HOME: '/home/me', CLAUDE_PLUGIN_DATA: '/data', ...(opts.env ?? {}) })
  state.clock = mock.clock(on, { now: NOW })
  mock.store(on, {})
  on('session.usage', () => ({ value: { startedAt: NOW - 600_000, context: { window: 1_000_000, tokens: state.tokens, percent: 1 }, rateLimits: state.rateLimits } }))
  mock.session(on)
  on('agent.list', () => ({ value: [] }))
  on('classic.Stop', () => ({}))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('session.id', () => ({ value: SID }))
  on('session.turns', () => ({ value: opts.turns ?? 1 }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('settings.read', () => ({ value: opts.settings ?? { advisorModel: 'opus' } }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'advisor' }] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('tool.register', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('fs.exists', ($: any, e: any) => ({ value: e.path in state.files }))
  on('fs.read', ($: any, e: any) => (e.path in state.files ? { value: state.files[e.path] } : { deny: 'no such file' }))
  on('fs.stat', ($: any, e: any) => {
    if (e.path === STATE && STATE in state.files) return { value: { kind: 'file', size: 1, mtimeMs: state.stateMtime, isLink: false } }
    return e.path in state.mtimes ? { value: { kind: 'file', size: 1, mtimeMs: state.mtimes[e.path], isLink: false } } : { deny: 'no such file' }
  })
  on('fs.list', ($: any, e: any) => ({ value: (opts.list && opts.list[e.path]) || [] }))
  on('fs.write', ($: any, e: any) => {
    state.writes.push({ path: e.path, text: e.text ?? e.content ?? e.data })
    return { value: undefined }
  })
  on('process.run', ($: any, e: any) => {
    state.ran.push({ argv: e.argv, init: e.init })
    if (e.argv[0] === 'git' && e.argv.includes('--show-toplevel')) return { value: { exitCode: 0, stdout: '/work\n', stderr: '' } }
    if (e.argv[0] === 'wc') return { value: { exitCode: 0, stdout: `10 ${e.argv[2]}\n`, stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('prompt.submit', ($: any, e: any) => {
    if (e.origin && e.origin.kind === 'plugin') state.submitted.push(e.text)
    return { text: e.text }
  })
  on('session.compact', () => {
    state.compactCalls += 1
    return { messages: [{ role: 'user', text: 'Summary.', toolUses: [] }], tokensBefore: 1, tokensAfter: 1 }
  })
  on('command.run', { command: 'compact' }, () => ({ text: '' }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    state.questions.push(e.questions[0].question)
    const answer = answers[Math.min(state.answerAt, answers.length - 1)]
    state.answerAt += 1
    if (answer === 'hang') return new Promise(() => {}) // nobody answers
    return { result: { answers: { [e.questions[0].question]: answer } } }
  })
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return state
}

function setNight(s: any, patch: Record<string, unknown>) {
  s.files[STATE] = JSON.stringify({ ...JSON.parse(s.files[STATE]), ...patch })
  s.stateMtime += 1
}

// The lines the mod appended to events.log.
function events(s: any): string[] {
  return s.ran.filter((r: any) => r.argv[0] === 'sh' && r.argv[1] === '-c' && r.argv[5] === DIR + '/events.log').map((r: any) => r.argv[4])
}

// The night-state.sh calls, as their arguments.
function scripts(s: any): string[] {
  return s.ran.filter((r: any) => r.argv[0] === 'sh' && String(r.argv[1]).endsWith('/scripts/night-state.sh')).map((r: any) => r.argv.slice(2).join(' '))
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: 'hello' }] } })
  await settle()
}

async function finishTurn($: any, s: any) {
  await $.turn.complete({ turnId: 't' + Math.random(), answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage: null })
  await settle()
  await s.clock.advance(0)
  await settle()
}

async function runClock(s: any, ms: number, step = 250) {
  for (let spent = 0; spent < ms; spent += step) {
    await s.clock.advance(step)
    await settle()
  }
}

async function measure($: any, s: any, rateLimits: any[]) {
  s.rateLimits = rateLimits
  await $.session.measure({ context: { window: 1_000_000, tokens: s.tokens, percent: 1 }, rateLimits, changed: ['rateLimits'] })
  await settle()
}

function claudeAsks($: any, questions: string[]) {
  const box = { settled: false, result: undefined as any }
  $.tool.call({ tool: 'AskUserQuestion', questions: questions.map((q) => ({ question: q, header: 'Q', options: [{ label: 'A', description: '' }, { label: 'B', description: '' }], multiSelect: false })) }).then(
    (r: any) => {
      box.settled = true
      box.result = r
    },
    () => (box.settled = true),
  )
  return box
}

// ---- Claude's own questions --------------------------------------------------------------------------------------

test('outside a night Claude\'s own question keeps no deadline (regression)', async ($, on) => {
  const s = harness(on, { night: null })
  await start($)
  const q = claudeAsks($, ['Which database?'])
  await settle()
  await s.clock.advance(90 * 60_000)
  await settle()
  expect(q.settled).toBe(false)
  expect(s.toasts.some((t: string) => t.startsWith('Night') || t.startsWith('No answer'))).toBe(false)
  expect(s.ran.filter((r: any) => r.argv[0] === 'sh').length).toBe(0)
})

for (const status of ['armed', 'wrapup', 'done']) {
  test(`status ${status}: Claude's own question gets no deadline from the mod`, async ($, on) => {
    const s = harness(on, { night: { status } })
    await start($)
    const q = claudeAsks($, ['Which database?'])
    await settle()
    await s.clock.advance(60 * 60_000)
    await settle()
    expect(q.settled).toBe(false)
  })
}

test('opening phase: a batch of four questions closes after 20 minutes, each answered NO_ANSWER', async ($, on) => {
  const s = harness(on, { night: { status: 'opening' } })
  await start($)
  const qs = ['Scope?', 'Goal?', 'Deadline?', 'Git policy?']
  const q = claudeAsks($, qs)
  await settle()
  await s.clock.advance(19 * 60_000)
  await settle()
  expect(q.settled).toBe(false)
  await s.clock.advance(60_000)
  await settle()
  expect(q.settled).toBe(true)
  expect(q.result.result.answers).toEqual(Object.fromEntries(qs.map((x) => [x, NO_ANSWER])))
  expect(s.toasts).toContain('Night: no answer for 20 min. Claude parks the question and goes on.')
  expect(events(s).some((l) => /mod opening questions unanswered for 20 min \(4\)/.test(l))).toBe(true)
})

test('a plugin read from a local marketplace folder: the pointer is found in plugins/data/<name>-<marketplace> without CLAUDE_PLUGIN_DATA', async ($, on) => {
  const DEV = '/home/me/.claude/plugins/data/crew-chief-crew-chief-dev'
  const list = { '/home/me/.claude/plugins/data': [{ name: 'crew-chief-crew-chief', kind: 'dir' }, { name: 'crew-chief-crew-chief-dev', kind: 'dir' }, { name: 'other-plugin-x', kind: 'dir' }] }
  const s = harness(on, { night: { status: 'opening' }, env: { CLAUDE_PLUGIN_DATA: '' }, list })
  s.files[DEV + '/night/' + SID] = s.files[POINTER]
  delete s.files[POINTER]
  await start($)
  const q = claudeAsks($, ['Scope?'])
  await settle()
  await s.clock.advance(20 * 60_000)
  await settle()
  expect(q.settled).toBe(true)
  expect(q.result.result.answers).toEqual({ 'Scope?': NO_ANSWER })
})

test('opening phase: an answered question passes through unchanged', async ($, on) => {
  const s = harness(on, { night: { status: 'opening' }, answers: ['B'] })
  await start($)
  const q = claudeAsks($, ['Scope?'])
  await settle()
  expect(q.settled).toBe(true)
  expect(q.result.result.answers).toEqual({ 'Scope?': 'B' })
})

test('opening phase: CREW_CHIEF_NIGHT_ASK_MIN=2 closes it after two minutes', async ($, on) => {
  const s = harness(on, { night: { status: 'opening' }, env: { CREW_CHIEF_NIGHT_ASK_MIN: '2' } })
  await start($)
  const q = claudeAsks($, ['Scope?'])
  await settle()
  await s.clock.advance(2 * 60_000)
  await settle()
  expect(q.settled).toBe(true)
  expect(q.result.result.answers['Scope?']).toContain('within 2 minutes')
})

// ---- quiet plugin questions --------------------------------------------------------------------------------------

test('armed: the compact question is never shown, answered yes, the hold goes up, the update turn runs, then the compaction and one resume prompt', async ($, on) => {
  const s = harness(on, { files: { '/work/STATUS.md': '# S\n', '/work/tasks.json': '{"tasks":[]}' }, mtimes: { '/work/STATUS.md': 1_000 } })
  await start($)
  s.tokens = 260_000
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], changed: ['context'] })
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await finishTurn($, s)
  await runClock(s, 10_500)
  expect(s.questions.length).toBe(0)
  // The hold goes up as soon as the compaction is due (the turn end), and again when the yes comes.
  const holds = s.writes.filter((w: any) => w.path === DIR + '/hold')
  expect(holds.length).toBeGreaterThan(0)
  expect(Number(String(holds[holds.length - 1].text).trim())).toBe(SEC + 10 + 600)
  expect(events(s).some((l) => /auto-answered a crew-chief question .* -> Yes, compact/.test(l))).toBe(true)
  expect(s.submitted.length).toBe(1) // the handoff update request
  expect(s.submitted[0]).toContain('approved compacting')
  // The update turn writes STATUS.md and ends: the compaction runs, the hold comes down, the night is resumed.
  s.mtimes['/work/STATUS.md'] = NOW + 20_000
  await finishTurn($, s)
  await runClock(s, 1500)
  expect(s.compactCalls).toBe(1)
  expect(s.ran.some((r: any) => r.argv[0] === 'rm' && r.argv[2] === DIR + '/hold')).toBe(true)
  await runClock(s, 5000)
  expect(s.submitted.length).toBe(2)
  expect(s.submitted[1]).toContain('crew-chief night: the conversation was just compacted')
  expect(events(s).some((l) => /compaction finished: resume prompt sent/.test(l))).toBe(true)
})

test('armed: the update turn left the handoff files alone: the gate is answered "compact anyway", not asked', async ($, on) => {
  const s = harness(on, { files: { '/work/STATUS.md': '# S\n', '/work/tasks.json': '{"tasks":[]}' }, mtimes: { '/work/STATUS.md': 1_000 } })
  await start($)
  s.tokens = 260_000
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], changed: ['context'] })
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await finishTurn($, s)
  await runClock(s, 10_500)
  expect(s.submitted.length).toBe(1) // the update request
  await finishTurn($, s) // STATUS.md unchanged: the gate
  await runClock(s, 1500)
  expect(s.questions.length).toBe(0)
  expect(events(s).some((l) => /-> Compact anyway$/.test(l))).toBe(true)
  expect(s.compactCalls).toBe(1)
  expect(s.ran.some((r: any) => r.argv[0] === 'rm' && r.argv[2] === DIR + '/hold')).toBe(true)
})

test('armed: the saver question turns on the plain saver, never ultra, without asking', async ($, on) => {
  const s = harness(on)
  await start($)
  await measure($, s, [{ kind: 'five_hour', percentUsed: 72, resetsAt: new Date(NOW + 3_600_000).toISOString() }])
  await finishTurn($, s)
  expect(s.questions.length).toBe(0)
  expect(s.toasts).toContain('Saver is on for this session. /saver off switches it off.')
  expect(s.toasts.some((t: string) => t.startsWith('Ultra-saver'))).toBe(false)
  const status = await $.command.run({ command: 'saver', args: 'status' })
  expect(status.text).toContain('saver ON')
  expect(status.text).not.toContain('ultra')
  expect(events(s).some((l) => /auto-answered a crew-chief question .* -> Turn on saver$/.test(l))).toBe(true)
})

test('armed: the advisor offer is not made', async ($, on) => {
  const s = harness(on, { settings: {} })
  await start($)
  await finishTurn($, s)
  await settle()
  expect(s.questions.length).toBe(0)
  expect(events(s).some((l) => /skipped the advisor offer \(night\)/.test(l))).toBe(true)
})

test('outside a night the advisor offer is still made (the switch is scoped)', async ($, on) => {
  const s = harness(on, { night: null, settings: {} })
  await start($)
  await finishTurn($, s)
  await settle()
  expect(s.questions.length).toBe(1)
})

test('a night open at a fresh start: the handoff offer is not made and nothing is recorded', async ($, on) => {
  const s = harness(on, { night: { status: 'opening' }, turns: 0 })
  await start($)
  await runClock(s, 1000)
  expect(s.questions.length).toBe(0)
  expect(s.writes.some((w: any) => w.path.endsWith('handoff-offers.tsv'))).toBe(false)
  expect(events(s).some((l) => /skipped the handoff setup offer/.test(l))).toBe(true)
})

// ---- the limit stop ---------------------------------------------------------------------------------------------

test('limit: the weekly limit at 95 percent starts the wrap-up once', async ($, on) => {
  const s = harness(on)
  await start($)
  await measure($, s, [{ kind: 'seven_day', percentUsed: 94.9 }])
  expect(scripts(s).length).toBe(0)
  await measure($, s, [{ kind: 'seven_day', percentUsed: 95 }])
  expect(scripts(s)).toEqual(['phase wrapup --reason limit'])
  await measure($, s, [{ kind: 'seven_day', percentUsed: 97 }])
  await finishTurn($, s)
  expect(scripts(s)).toEqual(['phase wrapup --reason limit'])
  expect(events(s).some((l) => /limit: seven_day at 95% \(stop at 95%\): wrap-up started/.test(l))).toBe(true)
  expect(s.toasts).toContain('Night: weekly limit at 95%, wrapping up.')
  const call = s.ran.find((r: any) => String(r.argv[1]).endsWith('/scripts/night-state.sh'))
  expect(call.init.cwd).toBe('/work')
  expect(call.init.env.CREW_CHIEF_NIGHT_DIR).toBe(DIR)
  expect(call.init.env.CREW_CHIEF_SESSION_ID).toBe(SID)
})

test('limit: the 5-hour window at 95 percent too, seen at a turn end', async ($, on) => {
  const s = harness(on)
  await start($)
  s.rateLimits = [{ kind: 'five_hour', percentUsed: 96 }]
  await finishTurn($, s)
  expect(scripts(s)).toEqual(['phase wrapup --reason limit'])
})

for (const [name, night] of [['the opening phase', { status: 'opening' }], ['the wrap-up', { status: 'wrapup' }], ['no night', null]] as const) {
  test(`limit: nothing in ${name}`, async ($, on) => {
    const s = harness(on, { night: night as any })
    await start($)
    await measure($, s, [{ kind: 'seven_day', percentUsed: 99 }])
    expect(scripts(s).length).toBe(0)
  })
}

// ---- the watchdog -----------------------------------------------------------------------------------------------

test('watchdog: one resume prompt after 4 idle minutes; the 7th in an hour is withheld', async ($, on) => {
  const s = harness(on)
  await start($)
  await finishTurn($, s)
  await runClock(s, 3 * 60_000, 60_000)
  expect(s.submitted.length).toBe(0)
  await runClock(s, 60_000, 60_000)
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('crew-chief night: the session went idle')
  expect(s.submitted[0]).toContain(DIR + '/NIGHT.md')
  // Each prompt starts a turn that ends at once, and the session goes idle again.
  for (let i = 0; i < 12; i++) {
    await finishTurn($, s)
    await runClock(s, 4 * 60_000, 60_000)
  }
  expect(s.submitted.length).toBe(6)
  expect(events(s).some((l) => /no more until the hour has passed/.test(l))).toBe(true)
})

test('watchdog: no prompt while a turn runs', async ($, on) => {
  const s = harness(on)
  await start($)
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } })
  await runClock(s, 10 * 60_000, 60_000)
  expect(s.submitted.length).toBe(0)
})

test('watchdog: nothing outside a night', async ($, on) => {
  const n = harness(on, { night: null })
  await start($)
  await finishTurn($, n)
  await runClock(n, 30 * 60_000, 60_000)
  expect(n.submitted.length).toBe(0)
  expect(n.ran.filter((r: any) => r.argv[0] === 'sh').length).toBe(0)
})

test('the deadline 2 minutes past with no report: the mod closes the night with done (fallback report, caffeinate off) once and toasts', async ($, on) => {
  const s = harness(on, { night: { deadline: SEC + 5 * 60 } })
  await start($)
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } }) // busy until the deadline
  await runClock(s, 5 * 60_000, 60_000)
  await finishTurn($, s)
  await runClock(s, 60_000, 60_000)
  expect(scripts(s).length).toBe(0)
  await runClock(s, 2 * 60_000, 60_000)
  expect(scripts(s)).toEqual(['done'])
  expect(s.toasts).toContain(`Night over: report at ${DIR}/REPORT.md`)
  await runClock(s, 5 * 60_000, 60_000)
  expect(scripts(s)).toEqual(['done'])
})

test('a night the Stop hook ends: one toast, and the watchdog stops', async ($, on) => {
  const s = harness(on)
  await start($)
  setNight(s, { status: 'done', reportDone: true })
  await finishTurn($, s)
  expect(s.toasts).toContain(`Night over: report at ${DIR}/REPORT.md`)
  await runClock(s, 20 * 60_000, 60_000)
  expect(s.submitted.length).toBe(0)
  expect(s.toasts.filter((t: string) => t.startsWith('Night over')).length).toBe(1)
})

test('the hold stays fresh while a compaction is under way and comes down after it (tick)', async ($, on) => {
  const s = harness(on, { answers: ['hang'] })
  await start($)
  s.tokens = 260_000
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], changed: ['context'] })
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await finishTurn($, s)
  await runClock(s, 10_500)
  const before = s.writes.filter((w: any) => w.path === DIR + '/hold').length
  expect(before).toBeGreaterThan(0)
  // The update turn never comes: the plan is open, each tick renews the hold.
  await runClock(s, 60_000, 60_000)
  expect(s.writes.filter((w: any) => w.path === DIR + '/hold').length).toBeGreaterThan(before)
})

test('a compaction due while the Stop hook keeps the turn going: the tick puts up the hold so the turn can end', async ($, on) => {
  const s = harness(on)
  await start($)
  s.tokens = 260_000
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], changed: ['context'] })
  // Claude calls the checkpoint tool mid-turn; no turn end follows (the Stop hook blocks it).
  await $.tool.call({ tool: TOOL, phase: 'p' })
  expect(s.writes.filter((w: any) => w.path === DIR + '/hold').length).toBe(0)
  await runClock(s, 60_000, 60_000)
  expect(s.writes.filter((w: any) => w.path === DIR + '/hold').length).toBeGreaterThan(0)
})

test('past the ask size with no tool call: the hold also goes up', async ($, on) => {
  const s = harness(on)
  await start($)
  s.tokens = 450_000
  await $.session.measure({ context: { window: 1_000_000, tokens: 450_000, percent: 45 }, rateLimits: [], changed: ['context'] })
  await runClock(s, 60_000, 60_000)
  expect(s.writes.filter((w: any) => w.path === DIR + '/hold').length).toBeGreaterThan(0)
})

// ---- /night ----------------------------------------------------------------------------------------------------

test('/night status shows the phase, the time left, the task and the counts', async ($, on) => {
  const s = harness(on, { night: { blocks: 2, spawned: 5 } })
  await start($)
  const out = await $.command.run({ command: 'night', args: 'status' })
  expect(out.text).toContain('crew-chief night: armed')
  expect(out.text).toContain('4h 00m left')
  expect(out.text).toContain('task T-1 for 5m')
  expect(out.text).toContain('stop blocks 2')
  expect(out.text).toContain('subagents 5/20')
  expect(out.text).toContain('folder: ' + DIR)
})

test('/night off runs night-state.sh stop --reason off and toasts', async ($, on) => {
  const s = harness(on)
  await start($)
  const out = await $.command.run({ command: 'night', args: 'off' })
  expect(scripts(s)).toEqual(['stop --reason off'])
  expect(out.text).toContain('off')
  expect(s.toasts).toContain('Night mode is off.')
})

test('/night with no night in this session says so', async ($, on) => {
  const s = harness(on, { night: null })
  await start($)
  const out = await $.command.run({ command: 'night', args: '' })
  expect(out.text).toContain('no night in this session')
  expect(scripts(s).length).toBe(0)
})
