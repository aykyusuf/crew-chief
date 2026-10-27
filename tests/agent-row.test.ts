import { expect, mock, test } from 'claude-code/testing'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

type Opts = { env?: Record<string, string>; surfaces?: string[]; jq?: 'yes' | 'missing' }

function harness(on: any, opts: Opts = {}) {
  const state = {
    clock: undefined as any,
    status: [] as (string | undefined)[], // every $.ui.status call, in order
    surfaces: opts.surfaces ?? ['terminal'],
    agents: [] as { id: string; type: string; status: string; description: string }[],
    listFails: false,
    jqRuns: 0,
    usages: [] as unknown[],
  }
  mock.env(on, { CREW_CHIEF_SAVER: 'off', CREW_CHIEF_COMPACT: 'off', CREW_CHIEF_ADVISOR_OFFER: 'off', ...(opts.env ?? {}) })
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
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
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
  expect(s.jqRuns).toBe(0) // jq only matters on a plain terminal
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

test('Windows (OS=Windows_NT): shown without asking for jq', async ($, on) => {
  const s = harness(on, { surfaces: ['terminal'], env: { OS: 'Windows_NT' } })
  await start($)
  running(s, 'a1', 'Explore')
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  await redraw(s)
  expect(s.status.at(-1)).toBe('Explore sonnet-5.5·high')
  expect(s.jqRuns).toBe(0)
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
