// Run: claude plugin test   (from the plugin directory; no session, sign-in, or network)
import { expect, mock, test } from 'claude-code/testing'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const MIN = 60_000

type Usage = Record<string, unknown>
type Opts = { env?: Record<string, string>; store?: Record<string, unknown> }

function harness(on: any, opts: Opts = {}) {
  const state = {
    clock: undefined as any,
    toasts: [] as string[],
    usd: 0,
    usages: [] as Usage[], // what the next requests report, in order
    contextTokens: 300_000,
  }
  mock.env(on, { CREW_CHIEF_UI: 'off', CREW_CHIEF_SAVER: 'off', CREW_CHIEF_COMPACT: 'off', ...(opts.env ?? {}) })
  state.clock = mock.clock(on, { now: 3_600_000 })
  mock.store(on, opts.store ?? {})
  on('session.usage', () => ({
    value: { startedAt: 3_000_000, context: { window: 1_000_000, tokens: state.contextTokens, percent: 30 }, rateLimits: [], cost: { usd: state.usd } },
  }))
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
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.StopFailure', () => ({}))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.step', async function* ($: any, e: any) {
    const usage = state.usages.shift() ?? null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  return state
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

async function step($: any, s: any, model: string, usage: Usage | null, usdAfter?: number, agentId?: string) {
  if (usage) s.usages.push({ model, ...usage })
  else s.usages.push(null as any)
  if (usdAfter !== undefined) s.usd = usdAfter
  const input: Record<string, unknown> = { turnId: 't', index: 0, model, effort: 'medium', messageCount: 1 }
  if (agentId) input.agentId = agentId
  const stream = $.turn.step(input)
  let piece = await stream.next()
  while (piece.done !== true) piece = await stream.next()
}

async function report($: any) {
  return (await $.command.run({ command: 'crew-report', args: '' })).text as string
}

const WARM = { input_tokens: 500, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 1000, output_tokens: 300 }
const COLD = { input_tokens: 500, cache_read_input_tokens: 800, cache_creation_input_tokens: 150_000, output_tokens: 300 }

test('/crew-report before any request says so', async ($, on) => {
  harness(on)
  await start($)
  expect(await report($)).toContain('No requests recorded')
})

test('/crew-report adds up tokens by role and model and credits the cost growth to the request', async ($, on) => {
  const s = harness(on)
  await start($)
  await step($, s, 'claude-sonnet-5-5', { input_tokens: 1000, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 2000, output_tokens: 500 }, 0.4)
  await step($, s, 'claude-sonnet-5-5', { input_tokens: 1000, cache_read_input_tokens: 22_000, cache_creation_input_tokens: 0, output_tokens: 700 }, 0.5)
  await step($, s, 'claude-haiku-5-5', { input_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 2800 }, 0.52, 'agent1')
  const text = await report($)
  expect(text).toContain('main · sonnet: 2 requests · in 2k · cache read 42k · cache write 2k · out 1k · about $0.50')
  expect(text).toContain('subagent · haiku: 1 requests · in 3k · cache read 0 · cache write 0 · out 3k · about $0.02')
  expect(text).toContain('Session cost so far: $0.52')
  expect(text).toContain('Subagents wrote 70% of the output tokens; 100% came from Sonnet or Haiku.')
  expect(text).toContain('Dollars are approximate')
})

test('a request that reports no usage still counts', async ($, on) => {
  const s = harness(on)
  await start($)
  await step($, s, 'claude-opus-5-5', null)
  expect(await report($)).toContain('main · opus: 1 requests')
})

async function idleThenAsk($: any, s: any, gap: number) {
  await s.clock.advance(gap)
  await $.prompt.submit({ text: 'back again', origin: { kind: 'composer' } })
  await settle()
}

test('no cache warning until an expiry has been seen', async ($, on) => {
  const s = harness(on)
  await start($)
  await step($, s, 'claude-sonnet-5-5', WARM)
  await idleThenAsk($, s, 30 * MIN)
  expect(s.toasts.length).toBe(0)
})

test('an expiry seen after an idle gap teaches the hint; the next long gap warns once', async ($, on) => {
  const s = harness(on)
  await start($)
  await step($, s, 'claude-sonnet-5-5', WARM)
  await s.clock.advance(7 * MIN)
  await step($, s, 'claude-sonnet-5-5', COLD) // 7 minutes idle, the cache had expired
  await idleThenAsk($, s, 9 * MIN)
  expect(s.toasts.filter((t) => t.includes('prompt cache has probably gone cold')).length).toBe(1)
  expect(s.toasts[0]).toContain('9m idle')
  expect(s.toasts[0]).toContain('151k tokens')
  await $.prompt.submit({ text: 'again', origin: { kind: 'composer' } })
  await settle()
  expect(s.toasts.length).toBe(1) // once per gap
})

test('a short gap does not warn, and neither does a small context', async ($, on) => {
  const s = harness(on, { store: { cache_hint: JSON.stringify({ expiredMs: 6 * MIN }) } })
  await start($)
  await step($, s, 'claude-sonnet-5-5', WARM)
  await idleThenAsk($, s, 3 * MIN)
  expect(s.toasts.length).toBe(0)
})

test('small context: no warning even after an expiry was seen', async ($, on) => {
  const s = harness(on, { store: { cache_hint: JSON.stringify({ expiredMs: 6 * MIN }) } })
  await start($)
  await step($, s, 'claude-sonnet-5-5', { input_tokens: 500, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 500, output_tokens: 10 })
  await idleThenAsk($, s, 20 * MIN)
  expect(s.toasts.length).toBe(0)
})

test('a cache seen alive across a long gap (a one-hour cache) silences the warning', async ($, on) => {
  const s = harness(on, { store: { cache_hint: JSON.stringify({ expiredMs: 6 * MIN, aliveMs: 40 * MIN }) } })
  await start($)
  await step($, s, 'claude-sonnet-5-5', WARM)
  await idleThenAsk($, s, 30 * MIN)
  expect(s.toasts.length).toBe(0)
})

test('subagent requests do not teach the hint or start a gap', async ($, on) => {
  const s = harness(on)
  await start($)
  await step($, s, 'claude-sonnet-5-5', WARM)
  await s.clock.advance(7 * MIN)
  await step($, s, 'claude-haiku-5-5', COLD, undefined, 'agent1')
  await idleThenAsk($, s, 20 * MIN)
  expect(s.toasts.length).toBe(0) // nothing was learned from the subagent
})

test('CREW_CHIEF_CACHE_HINT=off silences it', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_CACHE_HINT: 'off' }, store: { cache_hint: JSON.stringify({ expiredMs: 6 * MIN }) } })
  await start($)
  await step($, s, 'claude-sonnet-5-5', WARM)
  await idleThenAsk($, s, 20 * MIN)
  expect(s.toasts.length).toBe(0)
})

test('Turkish report', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_LANG: 'tr' } })
  await start($)
  await step($, s, 'claude-sonnet-5-5', WARM, 0.3)
  const text = await report($)
  expect(text).toContain('Bu session, rol ve model bazında')
  expect(text).toContain('ana · sonnet')
})
