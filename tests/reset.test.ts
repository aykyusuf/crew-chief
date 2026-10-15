// Run: claude plugin test   (from the plugin directory; no session, sign-in, or network)
import { expect, mock, test } from 'claude-code/testing'

const YES = 'Yes, continue at reset'
const NO = 'No'
const NEVER = "Don't ask again this session"

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const NOW = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

type Window = { kind: string; percentUsed: number; resetsAt?: string }
type Opts = { env?: Record<string, string>; answer?: string | 'reject' }

function harness(on: any, opts: Opts = {}) {
  const state = {
    rateLimits: [] as Window[],
    clock: undefined as any,
    questions: [] as string[],
    toasts: [] as string[],
    submitted: [] as string[],
  }
  // The saver would also ask at 90 percent; this file is about the reset flow only.
  mock.env(on, { CREW_CHIEF_SAVER: 'off', ...(opts.env ?? {}) })
  state.clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: NOW - 1000, context: { window: 1_000_000, tokens: 50_000, percent: 5 }, rateLimits: state.rateLimits } }))
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'advisor' }] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('tool.register', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('ui.toast', ($: any, e: any) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('prompt.submit', ($: any, e: any) => {
    if (e.origin && e.origin.kind === 'plugin') state.submitted.push(e.text)
    return { text: e.text }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.StopFailure', () => ({}))
  on('tool.call', ($: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    state.questions.push(e.questions[0].question)
    if (opts.answer === 'reject') return { deny: 'dismissed' }
    return { result: { answers: { [e.questions[0].question]: opts.answer ?? YES } } }
  })
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return state
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

async function measure($: any, s: any, rateLimits: Window[]) {
  s.rateLimits = rateLimits
  await $.session.measure({ context: { window: 1_000_000, tokens: 50_000, percent: 5 }, rateLimits, changed: ['rateLimits'] })
  await settle()
}

async function runClock(s: any, ms: number) {
  await s.clock.advance(ms)
  await settle()
}

const FIVE = (percent: number, inMs: number): Window[] => [{ kind: 'five_hour', percentUsed: percent, resetsAt: iso(NOW + inMs) }]
const HOUR = 3_600_000

async function stopFailure($: any, error: string) {
  await $.classic.StopFailure({ session_id: 's', transcript_path: '/t', cwd: '/work', hook_event_name: 'StopFailure', error })
  await settle()
}

test('a window close to full gets a toast when it resets, even if nothing else happens', async ($, on) => {
  const s = harness(on)
  await start($)
  await measure($, s, FIVE(93, 2 * HOUR))
  await runClock(s, HOUR)
  expect(s.toasts.some((t) => t.includes('has reset'))).toBe(false)
  await runClock(s, HOUR + 30_000)
  expect(s.toasts.filter((t) => t === 'Your 5-hour limit has reset.').length).toBe(1)
})

test('a window below 90 percent is not announced', async ($, on) => {
  const s = harness(on)
  await start($)
  await measure($, s, FIVE(60, HOUR))
  await runClock(s, 2 * HOUR)
  expect(s.toasts.some((t) => t.includes('has reset'))).toBe(false)
})

test('several readings of the same window schedule one toast', async ($, on) => {
  const s = harness(on)
  await start($)
  await measure($, s, FIVE(95, HOUR))
  await measure($, s, FIVE(96, HOUR))
  await measure($, s, FIVE(97, HOUR))
  await runClock(s, 2 * HOUR)
  expect(s.toasts.filter((x) => x.includes('has reset')).length).toBe(1)
})

test('a reset more than 12 hours away is not timed', async ($, on) => {
  const s = harness(on)
  await start($)
  await measure($, s, [{ kind: 'seven_day', percentUsed: 99, resetsAt: iso(NOW + 30 * HOUR) }])
  await runClock(s, 40 * HOUR)
  expect(s.toasts.some((t) => t.includes('has reset'))).toBe(false)
})

test('a rate-limit stop asks; yes sends "continue" at the reset, framed as a plugin message', async ($, on) => {
  const s = harness(on, { answer: YES })
  await start($)
  s.rateLimits = FIVE(100, 2 * HOUR)
  await stopFailure($, 'rate_limit')
  expect(s.questions.length).toBe(1)
  expect(s.questions[0]).toContain('5-hour limit stopped Claude')
  expect(s.questions[0]).toContain('2h')
  await runClock(s, HOUR)
  expect(s.submitted.length).toBe(0)
  await runClock(s, HOUR + 60_000)
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('the usage limit has reset')
  expect(s.toasts.some((t) => t.includes('asked Claude to continue'))).toBe(true)
})

test('other errors do not ask', async ($, on) => {
  const s = harness(on)
  await start($)
  s.rateLimits = FIVE(100, HOUR)
  await stopFailure($, 'overloaded')
  await stopFailure($, 'server_error')
  expect(s.questions.length).toBe(0)
})

test('"No" sends nothing at the reset', async ($, on) => {
  const s = harness(on, { answer: NO })
  await start($)
  s.rateLimits = FIVE(100, HOUR)
  await stopFailure($, 'rate_limit')
  await runClock(s, 3 * HOUR)
  expect(s.questions.length).toBe(1)
  expect(s.submitted.length).toBe(0)
})

test('"don\'t ask again" stops further questions', async ($, on) => {
  const s = harness(on, { answer: NEVER })
  await start($)
  s.rateLimits = FIVE(100, HOUR)
  await stopFailure($, 'rate_limit')
  await stopFailure($, 'rate_limit')
  expect(s.questions.length).toBe(1)
})

test('if the person typed in the meantime, nothing is sent', async ($, on) => {
  const s = harness(on, { answer: YES })
  await start($)
  s.rateLimits = FIVE(100, HOUR)
  await stopFailure($, 'rate_limit')
  await runClock(s, 1800_000)
  await $.prompt.submit({ text: 'I am back', origin: { kind: 'composer' } })
  await runClock(s, 2 * HOUR)
  expect(s.submitted.length).toBe(0)
})

test('a reset more than 6 hours away is not offered', async ($, on) => {
  const s = harness(on)
  await start($)
  s.rateLimits = [{ kind: 'seven_day', percentUsed: 100, resetsAt: iso(NOW + 30 * HOUR) }]
  await stopFailure($, 'rate_limit')
  expect(s.questions.length).toBe(0)
})

test('a dismissed question is not an error and sends nothing', async ($, on) => {
  const s = harness(on, { answer: 'reject' })
  await start($)
  s.rateLimits = FIVE(100, HOUR)
  await stopFailure($, 'rate_limit')
  await runClock(s, 2 * HOUR)
  expect(s.submitted.length).toBe(0)
})

test('CREW_CHIEF_RESET=off: no toast, no question', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_RESET: 'off' } })
  await start($)
  await measure($, s, FIVE(95, HOUR))
  s.rateLimits = FIVE(100, HOUR)
  await stopFailure($, 'rate_limit')
  await runClock(s, 2 * HOUR)
  expect(s.questions.length).toBe(0)
  expect(s.toasts.some((t) => t.includes('has reset'))).toBe(false)
})

test('Turkish session', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_LANG: 'tr' } })
  await start($)
  await measure($, s, FIVE(95, HOUR))
  await runClock(s, 2 * HOUR)
  expect(s.toasts).toContain('5 saatlik limitin sıfırlandı.')
})

test('a timer set before /clear does nothing afterwards', async ($, on) => {
  const s = harness(on, { answer: YES })
  await start($)
  s.rateLimits = FIVE(100, HOUR)
  await stopFailure($, 'rate_limit')
  await measure($, s, FIVE(95, 2 * HOUR))
  await $.session.end({ sessionId: 's1', reason: 'clear' })
  await start($)
  await runClock(s, 3 * HOUR)
  expect(s.submitted.length).toBe(0)
  expect(s.toasts.some((t) => t.includes('has reset'))).toBe(false)
})
