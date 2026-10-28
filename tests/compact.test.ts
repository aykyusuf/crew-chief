// Run: claude plugin test   (from the plugin directory; no session, sign-in, or network)
import { expect, mock, test } from 'claude-code/testing'

const YES = 'Yes, compact'
const LATER = 'Not now'
const NEVER = "Don't ask again this session"
const ANYWAY = 'Compact anyway'
const RETRY = 'Ask Claude to update first'
const CANCEL = 'Cancel'
const TOOL = 'mcp__crew-chief__crew_compact_checkpoint'
const MARKER = '[crew-chief compaction brief]'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

type Opts = {
  env?: Record<string, string>
  answers?: string[] // answers to the questions, in order; the last one repeats
  files?: Record<string, string> // path -> text; a path in this map exists
  mtimes?: Record<string, number>
  lines?: number[] // `wc -l` answers, in order
  dirty?: number // files `git status --porcelain` lists
  summary?: string
  compactFails?: string[] // rejection reasons of the first compaction calls
  store?: Record<string, unknown>
}

function harness(on: any, opts: Opts = {}) {
  const state = {
    tokens: 60_000,
    window: 1_000_000,
    clock: undefined as any,
    questions: [] as string[],
    toasts: [] as string[],
    compactCalls: [] as any[],
    submitted: [] as string[],
    contexts: [] as string[],
    written: [] as string[],
    ran: [] as string[][],
    registered: [] as string[],
    answerAt: 0,
    wcAt: 0,
    failuresLeft: [...(opts.compactFails ?? [])],
    agents: [] as string[], // statuses of the session's subagents
    files: { ...(opts.files ?? {}) } as Record<string, string>,
    mtimes: { ...(opts.mtimes ?? {}) } as Record<string, number>,
  }
  const answers = opts.answers ?? [YES]
  mock.env(on, { HOME: '/home/me', ...(opts.env ?? {}) })
  state.clock = mock.clock(on, { now: 3_600_000 })
  mock.store(on, opts.store ?? {})
  on('session.usage', () => ({
    value: { startedAt: 3_000_000, context: { window: state.window, tokens: state.tokens, percent: Math.round((state.tokens / state.window) * 100) }, rateLimits: [] },
  }))
  mock.session(on)
  on('agent.list', () => ({ value: state.agents.map((status, i) => ({ id: 'a' + i, description: 'x', type: 't', status })) }))
  on('classic.Stop', () => ({}))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 'sess1' }))
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'advisor' }] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('tool.register', ($: any, e: any) => {
    state.registered.push(e.name)
    return { value: undefined }
  })
  on('ui.toast', ($: any, e: any) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('fs.exists', ($: any, e: any) => ({ value: e.path in state.files || e.path === '/home/me/.claude/projects/-work/sess1.jsonl' }))
  on('fs.read', ($: any, e: any) => (e.path in state.files ? { value: state.files[e.path] } : { deny: 'no such file' }))
  on('fs.stat', ($: any, e: any) => (e.path in state.mtimes ? { value: { kind: 'file', size: 1, mtimeMs: state.mtimes[e.path], isLink: false } } : { deny: 'no such file' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', ($: any, e: any) => {
    state.written.push(e.path)
    return { value: undefined }
  })
  on('process.run', ($: any, e: any) => {
    state.ran.push(e.argv)
    if (e.argv[0] === 'git') {
      const n = opts.dirty ?? 0
      return { value: { exitCode: 0, stdout: Array.from({ length: n }, (_, i) => ` M file${i}.txt\n`).join(''), stderr: '' } }
    }
    if (e.argv[0] === 'wc') {
      const lines = opts.lines ?? []
      const n = lines[Math.min(state.wcAt, lines.length - 1)] ?? 10
      state.wcAt += 1
      return { value: { exitCode: 0, stdout: `${n} ${e.argv[2]}\n`, stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('prompt.submit', ($: any, e: any) => {
    if (e.origin && e.origin.kind === 'plugin') state.submitted.push(e.text)
    for (const c of e.context ?? []) state.contexts.push(String(c))
    return { text: e.text }
  })
  on('session.compact', ($: any, e: any) => {
    state.compactCalls.push(e)
    const fail = state.failuresLeft.shift()
    if (fail) throw new Error(fail)
    return { messages: [{ role: 'user', text: opts.summary ?? 'Summary: all good.', toolUses: [] }], tokensBefore: 1, tokensAfter: 1 }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    state.questions.push(e.questions[0].question)
    const answer = answers[Math.min(state.answerAt, answers.length - 1)]
    state.answerAt += 1
    if (answer === 'reject') return { deny: 'dismissed' }
    if (answer === 'hang') return new Promise(() => {}) // nobody answers
    return { result: { answers: { [e.questions[0].question]: answer } } }
  })
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return state
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  // A compaction needs a conversation to summarize.
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: 'hello' }] } })
}

async function setTokens($: any, s: any, tokens: number) {
  s.tokens = tokens
  await $.session.measure({ context: { window: s.window, tokens, percent: 0 }, rateLimits: [], changed: ['context'] })
  await settle()
}

async function finishTurn($: any, s: any) {
  await $.turn.complete({ turnId: 't' + Math.random(), answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage: null })
  await settle()
  await s.clock.advance(0)
  await settle()
}

// The compaction question waits 10 s after a clean turn end.
async function afterGrace(s: any) {
  await s.clock.advance(10_000)
  await settle()
  await s.clock.advance(0)
  await settle()
}

async function askAtTurnEnd($: any, s: any) {
  await finishTurn($, s)
  await afterGrace(s)
}

async function prompt($: any, text = 'go') {
  await $.prompt.submit({ text, origin: { kind: 'composer' } })
}

async function runClock(s: any, ms: number) {
  for (let spent = 0; spent < ms; spent += 250) {
    await s.clock.advance(250)
    await settle()
  }
}

const STATUS = '# P\n\n## Constraints\n- Do not modify `lib/legacy/`\n- "no commits" until told\n\n## Next\n1. AUTH-01\n'
const TASKS = JSON.stringify({ tasks: [{ id: 'AUTH-01', title: 'Login', status: 'in_progress', done_when: 'tests' }] })
const FAITHFUL = 'AUTH-01 in progress. Never touch lib/legacy/. Rule: no commits until told.'
const FILES = { '/work/STATUS.md': STATUS, '/work/tasks.json': TASKS }

// Armed, approved, the turn ends, the compaction runs. For tests that care about what happens after it.
async function compactOnce($: any, s: any) {
  await setTokens($, s, Math.max(s.tokens, 260_000)) // a fresh measurement arms the flow again after a compaction
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await askAtTurnEnd($, s)
  if ('/work/STATUS.md' in s.files) s.mtimes['/work/STATUS.md'] = 9_000_000 + s.answerAt
  await finishTurn($, s)
  await runClock(s, 1500)
}

async function approvedPlan($: any, s: any) {
  await setTokens($, s, 260_000)
  const result = await $.tool.call({ tool: TOOL, phase: 'login done' })
  await askAtTurnEnd($, s)
  return result
}

test('the checkpoint tool is registered and a command is added', async ($, on) => {
  const s = harness(on)
  await start($)
  expect(s.registered).toEqual(['crew_compact_checkpoint'])
})

test('no note below the arm size; one note, once, past it', async ($, on) => {
  const s = harness(on)
  await start($)
  await setTokens($, s, 100_000)
  await prompt($, 'go')
  expect(s.contexts.length).toBe(0)
  await setTokens($, s, 260_000)
  await prompt($, 'go on')
  expect(s.contexts.length).toBe(1)
  expect(s.contexts[0]).toContain(TOOL)
  expect(s.contexts[0]).toContain('never in the middle of work')
  await prompt($, 'more')
  expect(s.contexts.length).toBe(1)
})

test('a small window arms at 60 percent', async ($, on) => {
  const s = harness(on)
  s.window = 200_000
  await start($)
  await setTokens($, s, 110_000)
  await prompt($, 'a')
  expect(s.contexts.length).toBe(0)
  await setTokens($, s, 125_000)
  await prompt($, 'b')
  expect(s.contexts.join()).toContain(TOOL)
})

test('the tool says "not needed" when the flow is not armed, and asks nothing', async ($, on) => {
  const s = harness(on)
  await start($)
  await setTokens($, s, 100_000)
  const result = await $.tool.call({ tool: TOOL, phase: 'x' })
  expect(JSON.stringify(result)).toContain('Not needed yet')
  expect(s.questions.length).toBe(0)
})

test('yes: the tool returns at once, the question comes after the turn, Claude updates the files, then the compaction runs', async ($, on) => {
  const s = harness(on, { answers: [YES], files: FILES, mtimes: { '/work/STATUS.md': 1_000 }, summary: FAITHFUL })
  await start($)
  await setTokens($, s, 260_000)
  const result = await $.tool.call({ tool: TOOL, phase: 'login done' })
  expect(JSON.stringify(result)).toContain('after this turn finishes')
  expect(JSON.stringify(result)).toContain('Do not wait for an answer')
  expect(s.questions.length).toBe(0) // nothing is asked inside the turn
  await finishTurn($, s)
  expect(s.questions.length).toBe(0) // the grace period
  await afterGrace(s)
  expect(s.questions.length).toBe(1)
  expect(s.questions[0]).toContain('260k')
  expect(s.questions[0]).toContain('login done')
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('approved compacting')
  expect(s.submitted[0]).toContain('STATUS.md')
  expect(s.compactCalls.length).toBe(0)

  // Claude updates STATUS.md during the turn, then the turn ends.
  s.mtimes['/work/STATUS.md'] = 9_000_000
  await finishTurn($, s)
  expect(s.compactCalls.length).toBe(0) // waits a moment so the turn is really over
  await runClock(s, 1500)
  expect(s.compactCalls.length).toBe(1)
  expect(s.compactCalls[0].instructions).toContain(MARKER)
  expect(s.toasts.some((t) => t.startsWith('Compacted. Raw summary saved:'))).toBe(true)
  expect(s.written.some((p) => p.includes('/compact-summaries/compact-'))).toBe(true)
})

test('the gate: STATUS.md not updated asks again; "compact anyway" goes on', async ($, on) => {
  const s = harness(on, { answers: [YES, ANYWAY], files: FILES, mtimes: { '/work/STATUS.md': 1_000 } })
  await start($)
  await approvedPlan($, s)
  await finishTurn($, s) // STATUS.md unchanged
  expect(s.questions.length).toBe(2)
  expect(s.questions[1]).toContain('have not changed')
  await runClock(s, 1500)
  expect(s.compactCalls.length).toBe(1)
})

test('the gate: cancel drops the plan; retry asks Claude again in a new turn', async ($, on) => {
  const a = harness(on, { answers: [YES, CANCEL], files: FILES, mtimes: { '/work/STATUS.md': 1_000 } })
  await start($)
  await approvedPlan($, a)
  await finishTurn($, a)
  await runClock(a, 3000)
  expect(a.compactCalls.length).toBe(0)
})

test('the gate: retry submits the update request', async ($, on) => {
  const s = harness(on, { answers: [YES, RETRY], files: FILES, mtimes: { '/work/STATUS.md': 1_000 } })
  await start($)
  await approvedPlan($, s)
  await finishTurn($, s)
  await settle()
  expect(s.submitted.length).toBe(2) // the first came with the yes
  expect(s.submitted[1]).toContain('Update the handoff files')
  expect(s.compactCalls.length).toBe(0)
})

test('a project without handoff files is not asked about them, only told the command, and the compaction does not wait', async ($, on) => {
  const s = harness(on, { answers: [YES] })
  await start($)
  await approvedPlan($, s)
  expect(s.submitted[0]).toContain('no handoff files')
  expect(s.submitted[0]).toContain('/crew-chief:crew-handoff')
  expect(s.submitted[0]).toContain('Do not ask the user')
  expect(s.submitted[0]).toContain('do not create anything')
  expect(s.submitted[0]).toContain('as if they had declined')
  expect(s.submitted[0]).not.toContain('ask the user once')
  expect(s.submitted[0]).not.toMatch(/AskUserQuestion\)/)
  await finishTurn($, s)
  await runClock(s, 1500)
  expect(s.compactCalls.length).toBe(1)
})

test('"not now" arms again only after 100k more tokens', async ($, on) => {
  const s = harness(on, { answers: [LATER] })
  await start($)
  await approvedPlan($, s)
  expect(s.questions.length).toBe(1)
  await setTokens($, s, 300_000)
  await prompt($, 'x')
  expect(s.contexts.length).toBe(0)
  await setTokens($, s, 365_000)
  await prompt($, 'y')
  expect(s.contexts.join()).toContain(TOOL)
})

test('"don\'t ask again" ends it for the session', async ($, on) => {
  const s = harness(on, { answers: [NEVER] })
  await start($)
  await approvedPlan($, s)
  await setTokens($, s, 900_000)
  const again = await $.tool.call({ tool: TOOL, phase: 'z' })
  expect(JSON.stringify(again)).toContain('Not needed yet')
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(1)
})

test('a dismissed question is not an error and is not asked again in this cycle', async ($, on) => {
  const s = harness(on, { answers: ['reject'] })
  await start($)
  await approvedPlan($, s)
  expect(s.questions.length).toBe(1)
  expect(s.compactCalls.length).toBe(0)
  await setTokens($, s, 410_000)
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(1)
  expect(s.submitted.length).toBe(0)
})

test('a subagent cannot propose a compaction', async ($, on) => {
  const s = harness(on)
  await start($)
  await setTokens($, s, 260_000)
  let outcome = ''
  try {
    outcome = JSON.stringify(await $.tool.call({ tool: TOOL, phase: 'x', agentId: 'sub1' }))
  } catch (err) {
    outcome = String(err)
  }
  expect(outcome).toContain('Only the main conversation')
  expect(s.questions.length).toBe(0)
})

test('fallback: Claude never calls the tool; past 400k the person is asked between turns', async ($, on) => {
  const s = harness(on, { answers: [YES], files: FILES, mtimes: { '/work/STATUS.md': 1_000 } })
  await start($)
  await setTokens($, s, 300_000)
  await finishTurn($, s)
  expect(s.questions.length).toBe(0)
  await setTokens($, s, 410_000)
  await finishTurn($, s)
  expect(s.questions.length).toBe(0) // the grace period
  await afterGrace(s)
  expect(s.questions.length).toBe(1)
  expect(s.submitted.length).toBe(1) // the request to update the handoff files
  expect(s.submitted[0]).toContain('approved compacting')
  expect(s.submitted[0]).toContain('Update the handoff files') // this project has them
  // Claude updates STATUS.md in that turn; the next finished turn starts the compaction. No second question.
  s.mtimes['/work/STATUS.md'] = 9_000_000
  await finishTurn($, s)
  await runClock(s, 1500)
  expect(s.questions.length).toBe(1)
  expect(s.compactCalls.length).toBe(1)
})

test('/crew-compact asks when the turn is over', async ($, on) => {
  const s = harness(on, { answers: [YES] })
  await start($)
  const r = await $.command.run({ command: 'crew-compact', args: '' })
  expect(r.text).toContain('ask when this turn ends')
  await runClock(s, 500)
  expect(s.questions.length).toBe(1)
  expect(s.submitted.length).toBe(1)
})

test('CREW_CHIEF_COMPACT=off: no tool, no note, no flow', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_COMPACT: 'off' } })
  await start($)
  expect(s.registered.length).toBe(0)
  await setTokens($, s, 500_000)
  await prompt($, 'x')
  expect(s.contexts.length).toBe(0)
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(0)
  expect((await $.command.run({ command: 'crew-compact', args: '' })).text).toContain('CREW_CHIEF_COMPACT=off')
})

test('the compaction this plugin starts carries the brief (its own hook is skipped for it)', async ($, on) => {
  const s = harness(on)
  await start($)
  await compactOnce($, s)
  expect(s.compactCalls.length).toBe(1)
  expect(s.compactCalls[0].instructions.startsWith(MARKER)).toBe(true)
  expect(s.compactCalls[0].instructions.split(MARKER).length).toBe(2)
})

test('CREW_CHIEF_COMPACT_FOCUS=off: the flow still runs but sends no brief', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_COMPACT_FOCUS: 'off' } })
  await start($)
  await compactOnce($, s)
  expect(s.compactCalls.length).toBe(1)
  expect(s.compactCalls[0].instructions).toBe(undefined)
})

test('the summary check names what was lost', async ($, on) => {
  const s = harness(on, { files: FILES, summary: 'Working on the login screen.' })
  await start($)
  await compactOnce($, s)
  expect(s.toasts.some((t) => t.startsWith('2 ') && t.includes('missing from the summary'))).toBe(true)
})

test('a summary that kept everything is a plain success with the backup path', async ($, on) => {
  const s = harness(on, { files: FILES, summary: FAITHFUL })
  await start($)
  await compactOnce($, s)
  expect(s.toasts.some((t) => t.startsWith('Compacted. Raw summary saved:'))).toBe(true)
  expect(s.toasts.some((t) => t.includes('missing'))).toBe(false)
})

test('transcript lines lost in a compaction are noticed, and the next compaction copies first', async ($, on) => {
  const s = harness(on, { lines: [100, 60, 80, 90] })
  await start($)
  await compactOnce($, s)
  expect(s.toasts.some((t) => t.includes('lost lines'))).toBe(true)
  expect(s.ran.some((argv) => argv[0] === 'cp')).toBe(false)
  await compactOnce($, s)
  expect(s.ran.some((argv) => argv[0] === 'cp' && argv.includes('/home/me/.claude/projects/-work/sess1.jsonl'))).toBe(true)
})

test('transcript lines kept: nothing is copied and no warning', async ($, on) => {
  const s = harness(on, { lines: [100, 130, 140, 150] })
  await start($)
  await compactOnce($, s)
  await compactOnce($, s)
  expect(s.ran.some((argv) => argv[0] === 'cp')).toBe(false)
  expect(s.toasts.some((t) => t.includes('lost lines'))).toBe(false)
})

test('a compaction refused while a turn runs is retried after a moment', async ($, on) => {
  const s = harness(on, { answers: [YES], compactFails: ['a turn is still running'] })
  await start($)
  await approvedPlan($, s)
  await finishTurn($, s)
  await runClock(s, 1500)
  expect(s.compactCalls.length).toBe(1)
  await runClock(s, 3500)
  expect(s.compactCalls.length).toBe(2)
  expect(s.toasts.some((t) => t.startsWith('Compacted.'))).toBe(true)
})

test('a compaction that keeps failing says so once and stops', async ($, on) => {
  const s = harness(on, { answers: [YES], compactFails: ['boom', 'boom', 'boom', 'boom'] })
  await start($)
  await approvedPlan($, s)
  await finishTurn($, s)
  await runClock(s, 12_000)
  expect(s.toasts.filter((t) => t.startsWith('Compaction did not run:')).length).toBe(1)
  expect(s.compactCalls.length).toBe(4)
})

test('Turkish session: the question and the toast speak Turkish', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_LANG: 'tr' }, answers: ['Evet, compact et'] })
  await start($)
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'giriş bitti' })
  await askAtTurnEnd($, s)
  expect(s.questions[0]).toContain('Bağlam 260k token')
  expect(s.questions[0]).toContain('giriş bitti')
})

test('each compaction starts a fresh cycle: the note and the question come back at the next 250k', async ($, on) => {
  const s = harness(on)
  await start($)
  await setTokens($, s, 260_000)
  await prompt($, 'first note')
  expect(s.contexts.length).toBe(1)
  await compactOnce($, s)
  expect(s.compactCalls.length).toBe(1)
  await setTokens($, s, 30_000)
  await prompt($, 'after the compaction')
  expect(s.contexts.length).toBe(1) // small context: no new note
  expect(JSON.stringify(await $.tool.call({ tool: TOOL, phase: 'x' }))).toContain('Not needed yet')
  expect(s.questions.length).toBe(1)
  await setTokens($, s, 270_000)
  await prompt($, 'much later')
  expect(s.contexts.length).toBe(2)
  await compactOnce($, s)
  expect(s.compactCalls.length).toBe(2)
})

test('Cancel at the gate is not asked again at the very next turn end', async ($, on) => {
  const s = harness(on, { answers: [YES, CANCEL], files: FILES, mtimes: { '/work/STATUS.md': 1_000 } })
  await start($)
  await setTokens($, s, 410_000)
  await askAtTurnEnd($, s) // the fallback question: yes
  await finishTurn($, s) // STATUS.md unchanged: the gate question: cancel
  expect(s.questions.length).toBe(2)
  await askAtTurnEnd($, s)
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(2)
  expect(s.compactCalls.length).toBe(0)
})

test('an interrupted turn does not start the compaction; a finished one does', async ($, on) => {
  const s = harness(on, { answers: [YES], files: FILES, mtimes: { '/work/STATUS.md': 1_000 } })
  await start($)
  await approvedPlan($, s)
  s.mtimes['/work/STATUS.md'] = 9_000_000
  await $.turn.complete({ turnId: 'x', answer: '', durationMs: 1, isAborted: true, reason: 'aborted', usage: null })
  await settle()
  await runClock(s, 2000)
  expect(s.compactCalls.length).toBe(0)
  expect(s.questions.length).toBe(1)
  await finishTurn($, s)
  await runClock(s, 1500)
  expect(s.compactCalls.length).toBe(1)
})

test('fallback path without handoff files: the update request only names the setup command', async ($, on) => {
  const s = harness(on, { answers: [YES] })
  await start($)
  await setTokens($, s, 410_000)
  await askAtTurnEnd($, s)
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('no handoff files')
  expect(s.submitted[0]).toContain('crew-chief:crew-handoff')
})

test('files that exist keep the plain update request', async ($, on) => {
  const s = harness(on, { answers: [YES], files: FILES, mtimes: { '/work/STATUS.md': 1_000 } })
  await start($)
  await approvedPlan($, s)
  expect(s.submitted[0]).toContain('Update the handoff files')
  expect(s.submitted[0]).not.toContain('no handoff files')
})

const STOP = (tasks: unknown[]) => ({ session_id: 's', transcript_path: '/t', cwd: '/work', hook_event_name: 'Stop', stop_hook_active: false, background_tasks: tasks })

test('the question shows what is running and what is uncommitted', async ($, on) => {
  const s = harness(on, { answers: [LATER], dirty: 3 })
  await start($)
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'login done' })
  await askAtTurnEnd($, s)
  expect(s.questions[0]).toContain('subagents running: 0')
  expect(s.questions[0]).toContain('uncommitted files: 3')
})

test('subagents running when the grace ends: nobody is asked until a later clean turn end', async ($, on) => {
  const s = harness(on)
  s.agents = ['running']
  await start($)
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'x' })
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(0)
  s.agents = ['completed', 'idle']
  await afterGrace(s)
  expect(s.questions.length).toBe(0) // no timer left: it waits for a turn end
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(1)
  expect(s.submitted[0]).toContain('approved compacting')
})

test('the fallback question waits for subagents and comes at the next finished turn', async ($, on) => {
  const s = harness(on, { answers: [LATER] })
  s.agents = ['running']
  await start($)
  await setTokens($, s, 410_000)
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(0)
  s.agents = []
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(1)
})

test('only a turn that ended with an answer is a phase boundary', async ($, on) => {
  const s = harness(on, { answers: [LATER] })
  await start($)
  await setTokens($, s, 410_000)
  for (const reason of ['error', 'aborted', 'refusal']) {
    await $.turn.complete({ turnId: 'x' + reason, answer: '', durationMs: 1, isAborted: reason === 'aborted', reason, usage: null, ...(reason === 'refusal' ? { refusal: { category: null, explanation: null } } : {}) })
    await settle()
  }
  await afterGrace(s)
  expect(s.questions.length).toBe(0)
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(1)
})

test('an approved compaction waits for subagents that started in the meantime', async ($, on) => {
  const s = harness(on, { answers: [YES] })
  await start($)
  await approvedPlan($, s)
  s.agents = ['running']
  await finishTurn($, s)
  await runClock(s, 20_000)
  expect(s.compactCalls.length).toBe(0)
  s.agents = []
  await runClock(s, 6000)
  expect(s.compactCalls.length).toBe(1)
})

test('subagents that never finish: it says so after a while and gives up', async ($, on) => {
  const s = harness(on, { answers: [YES] })
  await start($)
  await approvedPlan($, s)
  s.agents = ['running']
  await finishTurn($, s)
  await s.clock.advance(200_000) // one jump: the waiting is timers, not real time
  await settle()
  expect(s.compactCalls.length).toBe(0)
  expect(s.toasts.some((t) => t.startsWith('Compaction did not run:') && t.includes('still running'))).toBe(true)
})

test('a dev server left open is shown, never waited for, and named to the summarizer', async ($, on) => {
  const s = harness(on, { answers: [YES] })
  await start($)
  await $.classic.Stop(STOP([
    { id: 'b1', type: 'shell', status: 'running', description: 'backend', command: 'uvicorn app:app --port 8000' },
    { id: 'b2', type: 'shell', status: 'running', description: 'frontend', command: 'npm run dev' },
    { id: 'g1', type: 'agent', status: 'running', description: 'an agent', agent_type: 'implementer' },
  ]))
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await askAtTurnEnd($, s)
  expect(s.questions[0]).toContain('background processes: 2 (uvicorn app:app --port 8000, npm run dev)')
  await finishTurn($, s)
  await runClock(s, 1500)
  expect(s.compactCalls.length).toBe(1) // the servers did not hold it back
  expect(s.compactCalls[0].instructions).toContain('Background processes running right now')
  expect(s.compactCalls[0].instructions).toContain('b1: uvicorn app:app --port 8000') // with the task id
})

test('no background processes: nothing extra in the brief', async ($, on) => {
  const s = harness(on)
  await start($)
  await compactOnce($, s)
  expect(s.compactCalls[0].instructions).not.toContain('Background processes')
})

test('/crew-compact while subagents run says to ask again later', async ($, on) => {
  const s = harness(on)
  s.agents = ['pending']
  await start($)
  await $.command.run({ command: 'crew-compact', args: '' })
  await runClock(s, 500)
  expect(s.questions.length).toBe(0)
  expect(s.toasts.some((t) => t.includes('Subagents are still running'))).toBe(true)
})

test('a subagent waiting on a server it started does not hold anything back, and is shown', async ($, on) => {
  const s = harness(on, { answers: [YES] })
  s.agents = ['waiting', 'idle', 'completed']
  await start($)
  await approvedPlan($, s)
  expect(s.questions.length).toBe(1)
  expect(s.questions[0]).toContain('subagents running: 0')
  expect(s.questions[0]).toContain('waiting on background work or approval: 1')
  await finishTurn($, s)
  await runClock(s, 1500)
  expect(s.compactCalls.length).toBe(1)
})

test('a prompt during the grace period holds the question until the next clean turn end', async ($, on) => {
  const s = harness(on, { answers: [LATER] })
  await start($)
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await finishTurn($, s)
  await prompt($, 'one more thing')
  await afterGrace(s)
  expect(s.questions.length).toBe(0)
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(1)
})

test('a main-loop model request during the grace period holds the question too', async ($, on) => {
  const s = harness(on, { answers: [LATER] })
  await start($)
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await finishTurn($, s)
  const gen = $.turn.step({ turnId: 'n', index: 0, model: 'claude-sonnet-5-5', messages: [] })
  for await (const _ of gen) {
    // drain
  }
  await afterGrace(s)
  expect(s.questions.length).toBe(0)
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(1)
})

test('two turn ends close together give one question', async ($, on) => {
  const s = harness(on, { answers: [LATER] })
  await start($)
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await finishTurn($, s)
  await finishTurn($, s)
  await afterGrace(s)
  await afterGrace(s)
  expect(s.questions.length).toBe(1)
})

test('/clear during the grace period: no question', async ($, on) => {
  const s = harness(on, { answers: [YES] })
  await start($)
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await finishTurn($, s)
  await $.session.end({ reason: 'clear', sessionId: 'sess1', resume: { sessionId: 'sess1' } })
  await afterGrace(s)
  expect(s.questions.length).toBe(0)
  expect(s.submitted.length).toBe(0)
})

test('an unanswered compaction question counts as "not now" after 20 minutes and frees the flow', async ($, on) => {
  const s = harness(on, { answers: ['hang'] })
  await start($)
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await askAtTurnEnd($, s)
  expect(s.questions.length).toBe(1)
  expect((await $.command.run({ command: 'crew-compact', args: '' })).text).toContain('already being arranged')
  await s.clock.advance(20 * 60_000)
  await settle()
  expect(s.toasts).toContain('No answer for 20 min: treated as "Not now".')
  expect(s.submitted.length).toBe(0)
  expect(s.compactCalls.length).toBe(0)
  // "not now": armed again only after 100k more tokens, and nothing is locked
  await setTokens($, s, 300_000)
  await prompt($, 'x')
  expect(s.contexts.length).toBe(0)
  expect((await $.command.run({ command: 'crew-compact', args: '' })).text).toContain('ask when this turn ends')
})

test('an unanswered gate question counts as "cancel" after 20 minutes', async ($, on) => {
  const s = harness(on, { answers: [YES, 'hang'], files: FILES, mtimes: { '/work/STATUS.md': 1_000 } })
  await start($)
  await approvedPlan($, s)
  const done = $.turn.complete({ turnId: 'g', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage: null })
  await settle()
  expect(s.questions.length).toBe(2)
  await s.clock.advance(20 * 60_000)
  await settle()
  await done
  expect(s.toasts).toContain('No answer for 20 min: treated as "Cancel".')
  await runClock(s, 3000)
  expect(s.compactCalls.length).toBe(0)
})

test('CREW_CHIEF_ASK_TIMEOUT_MIN=off: an unanswered question stays open', async ($, on) => {
  const s = harness(on, { answers: ['hang'], env: { CREW_CHIEF_ASK_TIMEOUT_MIN: 'off' } })
  await start($)
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await askAtTurnEnd($, s)
  await s.clock.advance(60 * 60_000)
  await settle()
  expect(s.toasts.some((t) => t.startsWith('No answer'))).toBe(false)
  expect((await $.command.run({ command: 'crew-compact', args: '' })).text).toContain('already being arranged')
})

test('CREW_CHIEF_ASK_TIMEOUT_MIN=1: the deadline is one minute', async ($, on) => {
  const s = harness(on, { answers: ['hang'], env: { CREW_CHIEF_ASK_TIMEOUT_MIN: '1' } })
  await start($)
  await setTokens($, s, 260_000)
  await $.tool.call({ tool: TOOL, phase: 'p' })
  await askAtTurnEnd($, s)
  await s.clock.advance(60_000)
  await settle()
  expect(s.toasts).toContain('No answer for 1 min: treated as "Not now".')
})

test('an AskUserQuestion that Claude raises itself is never given a deadline', async ($, on) => {
  const s = harness(on, { answers: ['hang'] })
  await start($)
  let settled = false
  $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which database?', header: 'DB', options: [{ label: 'A', description: '' }, { label: 'B', description: '' }], multiSelect: false }] }).then(
    () => (settled = true),
    () => (settled = true),
  )
  await settle()
  await s.clock.advance(60 * 60_000)
  await settle()
  expect(settled).toBe(false)
  expect(s.toasts.some((t) => t.startsWith('No answer'))).toBe(false)
})
