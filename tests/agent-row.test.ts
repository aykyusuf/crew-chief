import { expect, mock, test } from 'claude-code/testing'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

type Opts = { env?: Record<string, string>; surfaces?: string[]; jq?: 'yes' | 'missing' }

function harness(on: any, opts: Opts = {}) {
  const state = {
    clock: undefined as any,
    status: [] as (string | undefined)[], // every $.ui.status call, in order
    toasts: [] as string[],
    surfaces: opts.surfaces ?? ['terminal'],
    agents: [] as { id: string; type: string; status: string; description: string }[],
    listFails: false,
    jqRuns: 0,
    usages: [] as unknown[],
  }
  mock.env(on, { CREW_CHIEF_UI: 'off', CREW_CHIEF_SAVER: 'off', CREW_CHIEF_COMPACT: 'off', CREW_CHIEF_ADVISOR_OFFER: 'off', ...(opts.env ?? {}) })
  state.clock = mock.clock(on, { now: 3_600_000 })
  mock.store(on, {})
  on('session.usage', () => ({ value: { startedAt: 3_000_000, context: { window: 1_000_000, tokens: 1000, percent: 0 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.surfaces', () => ({ value: state.surfaces }))
  on('agent.list', () => {
    if (state.listFails) throw new Error('agent list unavailable')
    return { value: state.agents }
  })
  on('process.run', ($: any, e: any) => {
    if (e.argv[0] !== 'jq') return { deny: 'unexpected command' }
    state.jqRuns++
    if (opts.jq === 'missing') throw new Error('spawn jq ENOENT')
    return { value: { exitCode: 0, stdout: 'jq-1.7.1\n', stderr: '' } }
  })
  on('ui.status', ($: any, e: any) => {
    state.status.push(e.text)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'advisor' }] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('ui.toast', ($: any, e: any) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ok' }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($: any, e: any) {
    const usage = state.usages.shift() ?? null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  return state
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await settle()
}

async function step($: any, s: any, agentId: string, model: string, effort: string, usage?: Record<string, number>) {
  s.usages.push(usage ? { model, ...usage } : null)
  const stream = $.turn.step({ turnId: 't-' + agentId, index: 0, model, effort, messageCount: 1, agentId })
  let piece = await stream.next()
  while (piece.done !== true) piece = await stream.next()
}

// Lets the 50 ms redraw fire.
async function redraw(s: any) {
  await s.clock.advance(60)
  await settle()
}

function running(s: any, id: string, type: string) {
  s.agents.push({ id, type, status: 'running', description: 'a task' })
}

const USAGE = { input_tokens: 400, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000, output_tokens: 600 }

test('VS Code: every running subagent with model, effort and tokens on one line', async ($, on) => {
  const s = harness(on, { surfaces: ['vscode'] })
  await start($)
  running(s, 'a1', 'crew-chief:scanner')
  running(s, 'a2', 'implementer')
  await step($, s, 'a1', 'claude-haiku-5-5', 'low', USAGE)
  await step($, s, 'a2', 'claude-opus-5-5', 'medium')
  await redraw(s)
  expect(s.status.at(-1)).toBe('scanner haiku-5.5·low 13k | implementer opus-5.5·medium')
  expect(s.jqRuns).toBe(1) // probed once a session for the install hint; it does not decide the line here
})

test('Desktop: shown too', async ($, on) => {
  const s = harness(on, { surfaces: ['desktop'] })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  expect(s.status.at(-1)).toBe('Explore sonnet-5.5·high')
})

test('a plain terminal with jq: the shell panel row is enough, no status line', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], jq: 'yes' })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high', USAGE)
  await redraw(s)
  expect(s.status.length).toBe(0)
  expect(s.jqRuns).toBe(1)
})

test('a terminal without jq gets the status line', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], jq: 'missing' })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high', USAGE)
  await redraw(s)
  expect(s.status.at(-1)).toBe('Explore sonnet-5.5·high 13k')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high', USAGE)
  await redraw(s)
  expect(s.jqRuns).toBe(1) // probed once a session
})

test('Windows with jq: the shell panel row works, so no status line (same as the Mac terminal)', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], env: { OS: 'Windows_NT' }, jq: 'yes' })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  expect(s.status.length).toBe(0)
  expect(s.jqRuns).toBe(1)
})

test('Windows without jq (OS=Windows_NT): the status line is drawn', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], env: { OS: 'Windows_NT' }, jq: 'missing' })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  expect(s.status.at(-1)).toBe('Explore sonnet-5.5·high')
  expect(s.jqRuns).toBe(1)
})

test('no surface (-p, SDK): nothing drawn', async ($, on) => {
  const s = harness(on, { surfaces: [], env: { CREW_CHIEF_ROW_MOD: 'on' } })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  expect(s.status.length).toBe(0)
})

test('cleared when the agents finish, even while the list still says running', async ($, on) => {
  const s = harness(on, { surfaces: ['vscode'] })
  await start($)
  running(s, 'a1', 'Explore')
  running(s, 'a2', 'Plan')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await step($, s, 'a2', 'claude-haiku-5-5', 'low')
  await redraw(s)
  expect(s.status.at(-1)).toBe('Explore sonnet-5.5·high | Plan haiku-5.5·low')
  await $.turn.complete({ turnId: 't-a1', agentId: 'a1', answer: 'done', durationMs: 5, isAborted: false, reason: 'answer' })
  await redraw(s)
  expect(s.status.at(-1)).toBe('Plan haiku-5.5·low')
  await $.turn.complete({ turnId: 't-a2', agentId: 'a2', answer: 'done', durationMs: 5, isAborted: false, reason: 'answer' })
  await redraw(s)
  expect(s.status.at(-1)).toBe(undefined)
  expect(s.status.length).toBe(3)
})

test('a finished agent drops off when the list says completed', async ($, on) => {
  const s = harness(on, { surfaces: ['vscode'] })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  s.agents[0].status = 'completed'
  await $.turn.complete({ turnId: 'main', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' })
  await redraw(s)
  expect(s.status.at(-1)).toBe(undefined)
})

test('CREW_CHIEF_ROW_MOD=off: never drawn, not even on VS Code', async ($, on) => {
  const s = harness(on, { surfaces: ['vscode'], env: { CREW_CHIEF_ROW_MOD: 'off' } })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  expect(s.status.length).toBe(0)
})

test('CREW_CHIEF_ROW_MOD=on: drawn on a terminal that has jq', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], jq: 'yes', env: { CREW_CHIEF_ROW_MOD: 'on' } })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  expect(s.status.at(-1)).toBe('Explore sonnet-5.5·high')
})

test('a failing agent list throws nothing and the request still completes', async ($, on) => {
  const s = harness(on, { surfaces: ['vscode'] })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  expect(s.status.at(-1)).toBe('Explore sonnet-5.5·high')
  s.listFails = true
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high', USAGE)
  await redraw(s)
  expect(s.status.at(-1)).toBe(undefined) // nothing reliable to show: cleared
})

test('the saver cap shows: the line has the effort the request went out with', async ($, on) => {
  const s = harness(on, { surfaces: ['vscode'] })
  await start($)
  await $.command.run({ command: 'saver', args: 'on' })
  running(s, 'a1', 'implementer-hard')
  await step($, s, 'a1', 'claude-opus-5-5', 'xhigh')
  await redraw(s)
  expect(s.status.at(-1)).toBe('implementer-hard opus-5.5·medium')
})

// ---- progress kept by the mod (hooks/src/progress.js) -----------------------------------------------------

const call = ($: any, agentId: string | undefined, command = 'ls') => $.tool.call(agentId ? { tool: 'Bash', command, agentId } : { tool: 'Bash', command })
const REPORT = ": 'crew-progress 40 | reading auth | slow tests'"
const contextOf = (r: any) => JSON.stringify(r?.context ?? [])

test('a fresh report puts its percentage in the status line', async ($, on) => {
  const s = harness(on, { surfaces: ['vscode'] })
  await start($)
  running(s, 'a1', 'crew-chief:scanner')
  await step($, s, 'a1', 'claude-haiku-5-5', 'low', USAGE)
  await call($, 'a1', REPORT)
  await step($, s, 'a1', 'claude-haiku-5-5', 'low', USAGE)
  await redraw(s)
  expect(s.status.at(-1)).toBe('scanner haiku-5.5·low ~40% 13k')
})

test('no report, no percentage; a stale report (25 calls) drops it again', async ($, on) => {
  const s = harness(on, { surfaces: ['vscode'] })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await call($, 'a1')
  await redraw(s)
  expect(s.status.at(-1)).toBe('Explore sonnet-5.5·high')
  await call($, 'a1', REPORT)
  for (let i = 0; i < 24; i++) await call($, 'a1')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  expect(s.status.at(-1)).toBe('Explore sonnet-5.5·high ~40%')
  await call($, 'a1')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  expect(s.status.at(-1)).toBe('Explore sonnet-5.5·high')
})

test('a subagent gets the rule at its second call and a reminder every 10 calls without a report, louder when ignored', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], jq: 'yes' }) // with or without jq: the mod sends it
  await start($)
  expect(contextOf(await call($, 'a1'))).toBe('[]')
  expect(contextOf(await call($, 'a1'))).toContain('crew-chief progress rule')
  for (let i = 3; i <= 9; i++) expect(contextOf(await call($, 'a1'))).toBe('[]')
  const tenth = await call($, 'a1')
  expect(contextOf(tenth)).toContain('10 tool calls since your last progress report')
  expect(contextOf(tenth)).toContain('crew-progress NN')
  expect(contextOf(tenth)).not.toContain('reminder 2')
  for (let i = 11; i <= 19; i++) expect(contextOf(await call($, 'a1'))).toBe('[]')
  const twentieth = contextOf(await call($, 'a1'))
  expect(twentieth).toContain('reminder 2')
  expect(twentieth).toContain('20 tool calls')
  expect(s.jqRuns).toBeLessThanOrEqual(1)
})

test('a report restarts the count and the escalation; the main session is never counted or reminded', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], env: { OS: 'Windows_NT' }, jq: 'missing' })
  await start($)
  for (let i = 0; i < 9; i++) await call($, 'a1')
  await call($, 'a1', REPORT)
  for (let i = 0; i < 9; i++) expect(contextOf(await call($, 'a1'))).toBe('[]') // reported: no rule, no reminder yet
  for (let i = 0; i < 30; i++) expect(contextOf(await call($, undefined))).toBe('[]')
  const next = contextOf(await call($, 'a1'))
  expect(next).toContain('10 tool calls')
  expect(next).not.toContain('reminder 2') // the earlier reminder was answered by the report
  expect(s.jqRuns).toBeLessThanOrEqual(1)
})

test('an agent that reported on its own is not given the rule', async ($, on) => {
  await (async () => {})()
  const s = harness(on, { surfaces: ['terminal'], jq: 'yes' })
  await start($)
  await call($, 'a1')
  await call($, 'a1', REPORT) // reported before its second counted call
  expect(contextOf(await call($, 'a1'))).toBe('[]')
  expect(s.jqRuns).toBeLessThanOrEqual(1)
})

// ---- the one-time jq install hint --------------------------------------------------------------------------

test('no jq: one toast says how to install it, on Windows with winget, and it is not a question', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], env: { OS: 'Windows_NT' }, jq: 'missing' })
  await start($)
  expect(s.toasts.length).toBe(1)
  expect(s.toasts[0]).toContain('winget install jqlang.jq')
  expect(s.toasts[0]).toContain('model and effort')
})

test('no jq on another system: a generic install hint', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], jq: 'missing' })
  await start($)
  expect(s.toasts.length).toBe(1)
  expect(s.toasts[0]).toContain('brew install jq')
})

test('the hint is shown once, not again in a later session', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], jq: 'missing' })
  await start($)
  await $.session.end({ sessionId: 's1', reason: 'clear' })
  await start($)
  expect(s.toasts.length).toBe(1)
})

test('with jq: no hint', async ($, on) => {
  const withJq = harness(on, { surfaces: ['terminal'], jq: 'yes' })
  await start($)
  expect(withJq.toasts.length).toBe(0)
})

test('no surface: no hint and no probe', async ($, on) => {
  const s = harness(on, { surfaces: [], jq: 'missing' })
  await start($)
  expect(s.toasts.length).toBe(0)
  expect(s.jqRuns).toBe(0)
})

test('CREW_CHIEF_ROW=off: no hint', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], jq: 'missing', env: { CREW_CHIEF_ROW: 'off' } })
  await start($)
  expect(s.toasts.length).toBe(0)
})
