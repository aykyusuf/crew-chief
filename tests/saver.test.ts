// Run: claude plugin test   (from the plugin directory; no session, sign-in, or network)
import { expect, mock, test } from 'claude-code/testing'

const ON = 'Turn on saver'
const NOT_NOW = 'Not now'
const NEVER = "Don't ask again this session"

// The mod does not wait for the person to answer, so let its pending promises finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

type Window = { kind: string; percentUsed: number; resetsAt?: string }

function usageOf(rateLimits: Window[], extra: Record<string, unknown> = {}) {
  return { startedAt: 0, context: { window: 1_000_000, tokens: 60_000, percent: 6 }, rateLimits, ...extra }
}

// Everything the mod asks Claude Code for, answered from variables the test can change.
function harness(on: any, opts: { env?: Record<string, string>; answer?: string | 'reject'; refuseCommand?: boolean; settings?: Record<string, unknown>; stored?: string } = {}) {
  const state = {
    usage: usageOf([]),
    answer: opts.answer ?? ON,
    questions: [] as string[],
    toasts: [] as string[],
    efforts: [] as unknown[],
    clock: undefined as any,
    storedWrites: [] as unknown[],
  }
  mock.env(on, opts.env ?? {})
  state.clock = mock.clock(on, { now: 3_600_000 })
  on('session.usage', () => ({ value: state.usage }))
  on('command.register', () => (opts.refuseCommand ? { deny: 'the name is taken' } : { value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('settings.read', () => ({ value: opts.settings ?? {} }))
  on('store.get', () => ({ value: opts.stored }))
  on('store.set', ($: any, e: any) => {
    state.storedWrites.push(e.value)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    state.questions.push(e.questions[0].question)
    if (state.answer === 'reject') return { deny: 'dismissed' }
    return { result: { answers: { [e.questions[0].question]: state.answer } } }
  })
  on('turn.step', async function* ($: any, e: any) {
    state.efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return state
}

async function measure($: any, state: ReturnType<typeof harness>, rateLimits: Window[], extra: Record<string, unknown> = {}) {
  state.usage = usageOf(rateLimits, extra)
  await $.session.measure({ context: state.usage.context, rateLimits, changed: ['rateLimits'] })
  await settle()
}

async function step($: any, model: string, effort: string | undefined, agentId?: string) {
  const input: Record<string, unknown> = { turnId: 't', index: 0, model, effort, messageCount: 1 }
  if (agentId) input.agentId = agentId
  const stream = $.turn.step(input)
  let piece = await stream.next()
  while (piece.done !== true) piece = await stream.next()
}

const FIVE = (p: number): Window[] => [{ kind: 'five_hour', percentUsed: p, resetsAt: '1970-01-01T05:00:00.000Z' }]

test('the saver starts off: no question below the first threshold, no cap', async ($, on) => {
  const s = harness(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(40))
  await step($, 'claude-opus-5-5', 'high', 'a1')
  expect(s.questions.length).toBe(0)
  expect(s.efforts).toEqual(['high'])
})

test('70 percent asks once; yes caps Opus at medium and Sonnet at high, others untouched', async ($, on) => {
  const s = harness(on, { answer: ON })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(72))
  await settle()
  expect(s.questions.length).toBe(1)
  expect(s.questions[0]).toContain('5-hour limit is 72% used')
  expect(s.toasts.some((t) => t.includes('Saver is on'))).toBe(true)

  await step($, 'claude-opus-5-5', 'xhigh', 'a1')
  await step($, 'claude-opus-5-5', 'high', 'a1')
  await step($, 'claude-opus-5-5', 'low', 'a1')
  await step($, 'claude-sonnet-5-5', 'max', 'a2')
  await step($, 'claude-sonnet-5-5', 'high', 'a2')
  await step($, 'claude-haiku-5-5', 'xhigh', 'a3')
  await step($, 'claude-opus-5-5', 'xhigh')
  expect(s.efforts).toEqual(['medium', 'medium', 'low', 'high', 'high', 'xhigh', 'xhigh'])

  await measure($, s, FIVE(85))
  expect(s.questions.length).toBe(1)
})

test('a later threshold asks again after "not now", the same one does not', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(71))
  await measure($, s, FIVE(75))
  expect(s.questions.length).toBe(1)
  await measure($, s, FIVE(83))
  expect(s.questions.length).toBe(2)
  await step($, 'claude-opus-5-5', 'xhigh', 'a1')
  expect(s.efforts).toEqual(['xhigh'])
})

test('crossing two thresholds at once asks only once', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(91))
  await measure($, s, FIVE(92))
  expect(s.questions.length).toBe(1)
})

test('"don\'t ask again" silences the session; a new window is not special', async ($, on) => {
  const s = harness(on, { answer: NEVER })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(72))
  await measure($, s, FIVE(95))
  expect(s.questions.length).toBe(1)
})

test('the weekly window has its own thresholds', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, [{ kind: 'seven_day', percentUsed: 52, resetsAt: '1970-01-07T00:00:00.000Z' }])
  expect(s.questions.length).toBe(1)
  expect(s.questions[0]).toContain('weekly limit is 52% used')
  await measure($, s, [{ kind: 'seven_day', percentUsed: 76, resetsAt: '1970-01-07T00:00:00.000Z' }])
  expect(s.questions.length).toBe(2)
})

test('a reset window (new resetsAt) asks again', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(72))
  await measure($, s, [{ kind: 'five_hour', percentUsed: 72, resetsAt: '1970-01-01T10:00:00.000Z' }])
  expect(s.questions.length).toBe(2)
})

test('a dismissed question is not an error and leaves the saver off', async ($, on) => {
  const s = harness(on, { answer: 'reject' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(72))
  expect(s.questions.length).toBe(1)
  await step($, 'claude-opus-5-5', 'xhigh', 'a1')
  expect(s.efforts).toEqual(['xhigh'])
})

test('/clear or a new session turns the saver off again', async ($, on) => {
  const s = harness(on, { answer: ON })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(72))
  await settle()
  await step($, 'claude-opus-5-5', 'xhigh', 'a1')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { sessionId: 's1' } })
  await step($, 'claude-opus-5-5', 'xhigh', 'a1')
  expect(s.efforts).toEqual(['medium', 'xhigh'])
  await measure($, s, FIVE(72))
  await settle()
  expect(s.questions.length).toBe(2)
})

test('CREW_CHIEF_SAVER=off: no questions and no toasts', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_SAVER: 'off' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(95), { context: { window: 1_000_000, tokens: 400_000, percent: 40 } })
  expect(s.questions.length).toBe(0)
  expect(s.toasts.length).toBe(0)
})

test('thresholds can be set from the environment', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW, env: { CREW_CHIEF_SAVER_FIVE_HOUR: '10, 20', CREW_CHIEF_SAVER_SEVEN_DAY: 'junk' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(12))
  expect(s.questions.length).toBe(1)
  await measure($, s, FIVE(21))
  expect(s.questions.length).toBe(2)
  await measure($, s, [{ kind: 'seven_day', percentUsed: 49, resetsAt: '1970-01-07T00:00:00.000Z' }])
  expect(s.questions.length).toBe(2)
  await measure($, s, [{ kind: 'seven_day', percentUsed: 51, resetsAt: '1970-01-07T00:00:00.000Z' }])
  expect(s.questions.length).toBe(3)
})

test('no plan data (API key): nothing to ask, the mod stays quiet', async ($, on) => {
  const s = harness(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, [])
  expect(s.questions.length).toBe(0)
  const status = await $.command.run({ command: 'saver', args: 'status' })
  expect(status.text).toContain('no plan limit data')
})

test('a question that arrives mid-turn waits for the turn to finish', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'do something', origin: { kind: 'composer' } })
  await measure($, s, FIVE(72))
  expect(s.questions.length).toBe(0)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer', usage: null })
  await settle()
  expect(s.questions.length).toBe(1)
})

test('a subagent turn ending does not trigger the question', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } })
  await measure($, s, FIVE(72))
  await $.turn.complete({ turnId: 'sub', agentId: 'a1', answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', usage: null })
  expect(s.questions.length).toBe(0)
})

test('context and age toasts come once each', async ($, on) => {
  const s = harness(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const big = { context: { window: 1_000_000, tokens: 160_000, percent: 16 } }
  await measure($, s, [], big)
  await measure($, s, [], big)
  expect(s.toasts.filter((t) => t.includes('160k')).length).toBe(1)
  await measure($, s, [], { startedAt: -8 * 3_600_000 })
  await measure($, s, [], { startedAt: -9 * 3_600_000 })
  expect(s.toasts.filter((t) => t.includes('opened')).length).toBe(1)
})

test('/saver on, off, status, and a bad word', async ($, on) => {
  const s = harness(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect((await $.command.run({ command: 'saver', args: '' })).text).toContain('saver off')
  expect((await $.command.run({ command: 'saver', args: 'on' })).text).toContain('saver on')
  await step($, 'claude-opus-5-5', 'max', 'a1')
  expect(s.efforts).toEqual(['medium'])
  expect((await $.command.run({ command: 'saver', args: 'status' })).text).toContain('saver ON')
  expect((await $.command.run({ command: 'saver', args: 'off' })).text).toContain('saver off')
  await step($, 'claude-opus-5-5', 'max', 'a1')
  expect(s.efforts).toEqual(['medium', 'max'])
  expect((await $.command.run({ command: 'saver', args: 'maybe' })).text).toContain('usage:')
})

test('a main-thread model request counts as a running turn even without a prompt', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await step($, 'claude-opus-5-5', 'high')
  await measure($, s, FIVE(72))
  expect(s.questions.length).toBe(0)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer', usage: null })
  await settle()
  expect(s.questions.length).toBe(1)
})

test('a lost turn.complete cannot block the question forever', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } })
  await step($, 'claude-opus-5-5', 'high')
  await s.clock.advance(11 * 60 * 1000)
  await measure($, s, FIVE(72))
  expect(s.questions.length).toBe(1)
})

test('when /saver is taken by another command, ours stays out of its way', async ($, on) => {
  const s = harness(on, { refuseCommand: true })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  let seen = ''
  try {
    seen = JSON.stringify(await $.command.run({ command: 'saver', args: 'on' }))
  } catch (error: any) {
    seen = String(error.message)
  }
  expect(seen).not.toContain('saver on for this session')
  await measure($, s, FIVE(72))
  expect(s.questions.length).toBe(1)
})

test('CREW_CHIEF_SAVER=off keeps the cap toast quiet even after /saver on', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_SAVER: 'off' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(95))
  await $.command.run({ command: 'saver', args: 'on' })
  await step($, 'claude-opus-5-5', 'xhigh', 'a1')
  expect(s.efforts).toEqual(['medium'])
  expect(s.toasts.length).toBe(0)
})

// ---- language -------------------------------------------------------------------------------

const TR_ON = 'Tasarruf modunu aç'
const TR_NOT_NOW = 'Şimdi değil'

async function say($: any, text: string, kind = 'composer') {
  await $.prompt.submit({ text, origin: { kind } })
  await $.turn.complete({ turnId: 't' + text.length, answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage: null })
  await settle()
}

test('Turkish prompts get a Turkish question, Turkish answers, and Turkish toasts', async ($, on) => {
  const s = harness(on, { answer: TR_ON })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await say($, 'tamam yaz bakalım')
  await say($, 'bunu düzelt lütfen')
  await measure($, s, FIVE(72))
  await settle()
  expect(s.questions.length).toBe(1)
  expect(s.questions[0]).toContain('5 saatlik limitin %72 dolu.')
  expect(s.questions[0]).toContain('sonra sıfırlanır')
  expect(s.toasts.some((t) => t.includes('Tasarruf modu bu session için açık'))).toBe(true)
  await step($, 'claude-opus-5-5', 'xhigh', 'a1')
  expect(s.efforts).toEqual(['medium'])
  expect(s.toasts.some((t) => t.includes('Tasarruf: Opus alt ajanı effort xhigh -> medium'))).toBe(true)
  expect(s.storedWrites).toEqual(['tr'])
})

test('the Turkish "don\'t ask again" answer works', async ($, on) => {
  const s = harness(on, { answer: "Bu session'da bir daha sorma" })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await say($, 'tamam yaz bakalım')
  await say($, 'bunu düzelt lütfen')
  await measure($, s, FIVE(72))
  await measure($, s, FIVE(95))
  await settle()
  expect(s.questions.length).toBe(1)
})

test('the remembered language is used before any prompt is typed', async ($, on) => {
  const s = harness(on, { answer: TR_NOT_NOW, stored: 'tr' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(72))
  expect(s.questions[0]).toContain('limitin %72 dolu')
  expect(s.storedWrites).toEqual([])
})

test('English prompts win over a remembered Turkish, and the change is remembered', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW, stored: 'tr' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await say($, 'please fix the failing test')
  await say($, 'can you add this to the README')
  await measure($, s, FIVE(72))
  expect(s.questions[0]).toContain('Your 5-hour limit is 72% used')
  expect(s.storedWrites).toEqual(['en'])
})

test('one English prompt does not flip a Turkish session (majority of the last five)', async ($, on) => {
  const s = harness(on, { answer: TR_NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await say($, 'tamam yaz bakalım')
  await say($, 'bunu düzelt lütfen')
  await say($, 'please fix the failing test')
  await measure($, s, FIVE(72))
  expect(s.questions[0]).toContain('limitin %72 dolu')
})

test('CREW_CHIEF_LANG beats the prompts', async ($, on) => {
  const forced = harness(on, { answer: NOT_NOW, env: { CREW_CHIEF_LANG: 'en' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await say($, 'tamam yaz bakalım')
  await say($, 'bunu düzelt lütfen')
  await measure($, forced, FIVE(72))
  expect(forced.questions[0]).toContain('Your 5-hour limit is 72% used')
})

test('the Claude Code language setting selects Turkish with no prompts at all', async ($, on) => {
  const s = harness(on, { answer: TR_NOT_NOW, settings: { language: 'turkish' }, env: { LANG: 'en_US.UTF-8' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(72))
  expect(s.questions[0]).toContain('limitin %72 dolu')
})

test('a Turkish locale is the last resort; another language setting is ignored', async ($, on) => {
  const s = harness(on, { answer: TR_NOT_NOW, settings: { language: 'japanese' }, env: { LANG: 'tr_TR.UTF-8' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(72))
  expect(s.questions[0]).toContain('limitin %72 dolu')
})

test('/saver speaks Turkish when the session does', async ($, on) => {
  const s = harness(on, { settings: { language: 'turkish' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  s.usage = usageOf([{ kind: 'five_hour', percentUsed: 30, resetsAt: '1970-01-01T05:00:00.000Z' }])
  const status = (await $.command.run({ command: 'saver', args: 'status' })).text
  expect(status).toContain('tasarruf modu kapalı')
  expect(status).toContain('5 saatlik %30')
  expect(status).toContain('sa')
  expect((await $.command.run({ command: 'saver', args: 'on' })).text).toContain('tasarruf modu bu session için açık')
  expect((await $.command.run({ command: 'saver', args: 'status' })).text).toContain('tasarruf modu AÇIK')
  expect((await $.command.run({ command: 'saver', args: 'huh' })).text).toContain('kullanım:')
})

test('a prompt that is a slash command or code never changes the language', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await say($, '/crew-chief:crew-mode auto')
  await say($, 'git status')
  await measure($, s, FIVE(72))
  expect(s.questions[0]).toContain('Your 5-hour limit is 72% used')
  expect(s.storedWrites).toEqual([])
})

test('the language setting beats the locale; the setting loses to CREW_CHIEF_LANG', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW, settings: { language: 'english' }, env: { LANG: 'tr_TR.UTF-8' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await measure($, s, FIVE(72))
  expect(s.questions[0]).toContain('Your 5-hour limit is 72% used')
})

test('only what the person types votes on the language, not notifications or other sessions', async ($, on) => {
  const s = harness(on, { answer: TR_NOT_NOW, stored: 'tr' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  for (const kind of ['task-notification', 'peer', 'scheduled-trigger', 'sdk', 'plugin']) {
    await say($, 'please fix the failing test and add this to the README', kind)
    await say($, 'can you run the build now and tell me what it said', kind)
  }
  await measure($, s, FIVE(72))
  expect(s.questions[0]).toContain('limitin %72 dolu')
  expect(s.storedWrites).toEqual([])
})

test('a prompt from the Remote Control bridge counts like a typed one', async ($, on) => {
  const s = harness(on, { answer: TR_NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await say($, 'tamam yaz bakalım', 'bridge')
  await say($, 'bunu düzelt lütfen', 'bridge')
  await measure($, s, FIVE(72))
  expect(s.questions[0]).toContain('limitin %72 dolu')
})

test('a prompt with a Turkish name or French text does not turn the session Turkish', async ($, on) => {
  const s = harness(on, { answer: NOT_NOW })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await say($, 'Ping Ayşe about it')
  await say($, 'Je ne sais pas, ne touche pas')
  await measure($, s, FIVE(72))
  expect(s.questions[0]).toContain('Your 5-hour limit is 72% used')
  expect(s.storedWrites).toEqual([])
})
