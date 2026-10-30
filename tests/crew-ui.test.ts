import { expect, mock, test } from 'claude-code/testing'

// The crew-ui band (hooks/src/crew-ui.js): drawn above the prompt with $.ui.mount, no terminal.

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const NOW = Date.parse('2026-10-28T20:00:00Z')

type Opts = {
  env?: Record<string, string>
  store?: Record<string, unknown>
  tokens?: number
  window?: number
  rateLimits?: unknown[]
  settings?: Record<string, unknown>
}

function harness(on: any, opts: Opts = {}) {
  const state: any = {
    clock: undefined as any,
    agents: [] as { id: string; type: string; status: string; description: string }[],
    usages: [] as unknown[],
    tokens: opts.tokens ?? 100_000,
    window: opts.window ?? 1_000_000,
    toasts: [] as string[],
    submitted: [] as string[],
    stored: { ...(opts.store ?? {}) } as Record<string, unknown>,
  }
  mock.env(on, { CREW_CHIEF_SAVER: 'off', CREW_CHIEF_COMPACT: 'off', CREW_CHIEF_ADVISOR_OFFER: 'off', CREW_CHIEF_GUARD: 'off', CREW_CHIEF_ROW: 'off', CREW_CHIEF_ROW_MOD: 'off', CREW_CHIEF_UI: 'off', ...(opts.env ?? {}) })
  state.clock = mock.clock(on, { now: NOW })
  on('store.get', ($: any, e: any) => ({ value: state.stored[e.key] }))
  on('store.set', ($: any, e: any) => {
    state.stored[e.key] = e.value
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: {
      startedAt: NOW - 1000,
      context: { window: state.window, tokens: state.tokens, percent: Math.round((state.tokens / state.window) * 100) },
      rateLimits: opts.rateLimits ?? [
        { kind: 'five_hour', percentUsed: 4, resetsAt: '2026-10-29T00:20:00Z' },
        { kind: 'seven_day', percentUsed: 96, resetsAt: '2026-11-03T09:00:00Z' },
      ],
    },
  }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('agent.list', () => ({ value: state.agents }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('settings.read', () => ({ value: { advisorModel: 'opus', ...(opts.settings ?? {}) } }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'advisor' }] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('ui.status', () => ({ value: undefined }))
  // What the engine itself draws in the band when no plugin does.
  on('ui.render', ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    if (e.component === 'AbovePrompt') return Box({ children: [Text({ children: ['engine band'] })] })
    return Text({ children: ['engine ' + e.component + ' ' + JSON.stringify(e.props)] }) // echoes the props it was given
  })
  on('ui.toast', ($: any, e: any) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('prompt.submit', ($: any, e: any) => {
    state.submitted.push(e.text)
    return { text: e.text }
  })
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

async function step($: any, s: any, agentId: string, model: string, effort: string) {
  s.usages.push({ model, input_tokens: 400, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000, output_tokens: 600 })
  const stream = $.turn.step({ turnId: 't-' + agentId, index: 0, model, effort, messageCount: 1, agentId })
  let piece = await stream.next()
  while (piece.done !== true) piece = await stream.next()
}

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} }
const mount = ($: any, over: Record<string, unknown> = {}) =>
  $.ui.mount({ plugin: 'crew-chief', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, ...over }, viewport: { columns: 105, rows: 40, isFullscreen: false } })

test('CREW_CHIEF_UI=off: nothing of ours is drawn', async ($, on) => {
  harness(on)
  await start($)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await ui.unmount()
})

test('on by default and quiet: a calm session draws nothing, a high week shows, and a toast says so once', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: '' }, tokens: 100_000 }) // no environment choice, no saved choice
  await start($)
  expect(s.toasts.filter((x: string) => x.includes('band above the prompt is on')).length).toBe(1)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: '96%' })).toBeDefined() // the harness week is at 96 %
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined() // quiet: the context is fine
  await ui.unmount()
  await $.session.end({ sessionId: 's1', reason: 'clear' })
  await start($)
  expect(s.toasts.filter((x: string) => x.includes('band above the prompt is on')).length).toBe(1) // not again
})

test('a saved "off" stays off and says nothing; /crew-ui off is saved', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: '' }, store: { crew_ui: 'off' } })
  await start($)
  expect(s.toasts.filter((x: string) => x.includes('band above the prompt is on')).length).toBe(0)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: '96%' })).toBeUndefined()
  await ui.unmount()
})

test('full mode: context, both limit windows and the reset times', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, store: { crew_ui_mode: 'full' }, tokens: 100_000 })
  await start($)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '10%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '4%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '96%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~4h20m/ })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined() // below the compaction size: no compact key
  await ui.unmount()
})

test('a running subagent gets a line with model, effort meter and tokens', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:deep-reader', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /deep-reader/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sonnet-5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /●●○○○/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /13k/ })).toBeDefined()
  await ui.unmount()
})

test('past the compaction size the compact key appears, pressing it asks the usual question', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, tokens: 500_000 })
  await start($)
  const ui = await mount($)
  const button = await ui.find({ type: 'Button' })
  expect(button).toBeDefined()
  expect(button?.text).toContain('compact')
  await ui.unmount()
})

test('a survey wins: nothing of ours', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  const ui = await mount($, { hasSurvey: true })
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await ui.unmount()
})

test('/crew-ui on and off are saved, status says which surfaces draw it', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: '' }, store: { crew_ui: 'off', crew_ui_mode: 'full' } })
  await start($)
  const status = await $.command.run({ command: 'crew-ui', args: 'status' })
  expect(JSON.stringify(status)).toContain('the band is off')
  const turnedOn = await $.command.run({ command: 'crew-ui', args: 'on' })
  expect(JSON.stringify(turnedOn)).toContain('Nothing in settings.json was changed')
  expect(s.stored.crew_ui).toBe('on')
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'crew-ui', args: 'off' })
  expect(s.stored.crew_ui).toBe('off')
  const ui2 = await mount($)
  expect(await ui2.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await ui2.unmount()
})

test('a saved "on" is read at the next session start', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: '' }, store: { crew_ui: 'on', crew_ui_mode: 'full' } })
  await start($)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  await ui.unmount()
})

test('CREW_CHIEF_UI=off beats a saved on', async ($, on) => {
  harness(on, { store: { crew_ui: 'on' }, env: { CREW_CHIEF_UI: 'off' } })
  await start($)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await ui.unmount()
})

test('quiet mode (the default): a calm session draws nothing, a high week and a due compaction do', async ($, on) => {
  const calm = harness(on, {
    env: { CREW_CHIEF_UI: 'on' },
    rateLimits: [{ kind: 'five_hour', percentUsed: 4 }, { kind: 'seven_day', percentUsed: 10 }],
    tokens: 100_000,
  })
  await start($)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /ctx|5h|7d|guard/ })).toBeUndefined()
  await ui.unmount()
  expect(calm.agents.length).toBe(0)
})

test('quiet mode shows a high window, and a running subagent even when everything else is calm', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' }, tokens: 100_000 }) // the harness week is at 96 %
  await start($)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: '96%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined() // 10 % context: not shown
  await ui.unmount()
  s.agents.push({ id: 'a1', type: 'Explore', status: 'running', description: 'x' })
  await step($, s, 'a1', 'claude-haiku-5-5', 'low')
  const ui2 = await mount($)
  expect(await ui2.find({ type: 'Text', text: /Explore/ })).toBeDefined()
  await ui2.unmount()
})

test('/crew-ui full and quiet are saved', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' }, tokens: 100_000 })
  await start($)
  expect(JSON.stringify(await $.command.run({ command: 'crew-ui', args: 'full' }))).toContain('full mode')
  expect(s.stored.crew_ui_mode).toBe('full')
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  await ui.unmount()
  expect(JSON.stringify(await $.command.run({ command: 'crew-ui', args: 'quiet' }))).toContain('quiet mode')
  expect(s.stored.crew_ui_mode).toBe('quiet')
})

const mountOf = ($: any, component: string, props: Record<string, unknown>) =>
  $.ui.mount({ plugin: 'crew-chief', surface: 'terminal', component, props, viewport: { columns: 105, rows: 40, isFullscreen: false } })

async function mainStep($: any, model: string, effort: string) {
  const stream = $.turn.step({ turnId: 't-main', index: 0, model, effort, messageCount: 1 })
  let piece = await stream.next()
  while (piece.done !== true) piece = await stream.next()
}

test('extras: the spinner and the turn line get the model and effort of the main loop', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  await mainStep($, 'claude-sonnet-5-5', 'medium')
  const spinner = await mountOf($, 'Spinner', { word: 'Beaming', message: null, suffix: '…', mode: 'thinking' })
  expect(await spinner.find({ type: 'Text', text: /"suffix":"… sonnet ●●○○○"/ })).toBeDefined()
  await spinner.unmount()
  const turn = await mountOf($, 'TurnDuration', { word: 'Baked', durationMs: 58_000 })
  expect(await turn.find({ type: 'Text', text: /"word":"sonnet ●●○○○ · Baked"/ })).toBeDefined()
  await turn.unmount()
  const open = await mountOf($, 'TurnDuration', { word: 'Baked', durationMs: 58_000, isExpanded: true })
  expect(await open.find({ type: 'Text', text: /"word":"Baked"/ })).toBeDefined() // ctrl+o shows all, untouched
  await open.unmount()
})

test('extras: a limit note after the prompt hint, none while typing; nothing to add leaves the mode line alone', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' } }) // the harness week is at 96 %
  await start($)
  const hint = await mountOf($, 'PromptHint', { isDraft: false, isWorking: false, hint: '? for shortcuts' })
  expect(await hint.find({ type: 'Text', text: /"tail":"7d 96% ~5d13h"/ })).toBeDefined()
  await hint.unmount()
  const draft = await mountOf($, 'PromptHint', { isDraft: true, isWorking: false, hint: '' })
  expect(await draft.find({ type: 'Text', text: /"tail"/ })).toBeUndefined()
  await draft.unmount()
  const mode = await mountOf($, 'SessionMode', { modes: ['bypass permissions on'] })
  expect(await mode.find({ type: 'Text', text: /"modes":\["bypass permissions on"\]/ })).toBeDefined() // saver off, guard idle
  await mode.unmount()
})

test('extras off, and the band off: the engine draws its own', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, store: { crew_ui_extras: 'off' } })
  await start($)
  await mainStep($, 'claude-sonnet-5-5', 'medium')
  const spinner = await mountOf($, 'Spinner', { word: 'Beaming', message: null, suffix: '…', mode: 'thinking' })
  expect(await spinner.find({ type: 'Text', text: /"suffix":"…"/ })).toBeDefined()
  await spinner.unmount()
})

test('/crew-ui extras off and on are saved', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  expect(JSON.stringify(await $.command.run({ command: 'crew-ui', args: 'extras off' }))).toContain('extras off')
  expect(s.stored.crew_ui_extras).toBe('off')
  expect(JSON.stringify(await $.command.run({ command: 'crew-ui', args: 'extras on' }))).toContain('extras on')
  expect(s.stored.crew_ui_extras).toBe('on')
})

test('demo on draws sample content in every style; style and demo commands', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' }, tokens: 100_000 })
  await start($)
  expect(JSON.stringify(await $.command.run({ command: 'crew-ui', args: 'style' }))).toContain('choose one of plain, color, pills, boxed')
  expect(JSON.stringify(await $.command.run({ command: 'crew-ui', args: 'style neon' }))).toContain('choose one of')
  expect(JSON.stringify(await $.command.run({ command: 'crew-ui', args: 'demo on' }))).toContain('demo on')
  for (const style of ['plain', 'color', 'pills', 'boxed']) {
    expect(JSON.stringify(await $.command.run({ command: 'crew-ui', args: 'style ' + style }))).toContain('style ' + style)
    expect(s.stored.crew_ui_style).toBe(style)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /deep-reader/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /implementer-hard/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /96%/ })).toBeDefined()
    expect(await ui.find({ type: 'Button' })).toBeDefined() // the compact key of the sample
    await ui.unmount()
  }
  await $.command.run({ command: 'crew-ui', args: 'demo off' })
  const calm = await mount($)
  expect(await calm.find({ type: 'Text', text: /deep-reader/ })).toBeUndefined()
  await calm.unmount()
})

test('a saved style is read at the next session start', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, store: { crew_ui_style: 'pills' }, tokens: 100_000 })
  await start($)
  await $.command.run({ command: 'crew-ui', args: 'demo on' })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /deep-reader/ })).toBeDefined()
  await ui.unmount()
})

const STATUS_LINE = { statusLine: { type: 'command', command: 'echo hi' } }

test('terminal with a status line of the person\'s own: the quiet band leaves out the limits it shows; the compact key stays', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, settings: STATUS_LINE, tokens: 500_000 }) // week 96 %, context past the compaction size
  await start($)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: '96%' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button' })).toBeDefined()
  await ui.unmount()
})

test('the Desktop app has no such line: everything is shown there, and `full` shows it in the terminal too', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, settings: STATUS_LINE, tokens: 100_000 })
  await start($)
  const desktop = await $.ui.mount({ plugin: 'crew-chief', surface: 'desktop', component: 'AbovePrompt', props: PROPS, viewport: { columns: 105, rows: 40 } })
  expect(await desktop.find({ type: 'Text', text: '96%' })).toBeDefined()
  await desktop.unmount()
  await $.command.run({ command: 'crew-ui', args: 'full' })
  const full = await mount($)
  expect(await full.find({ type: 'Text', text: '96%' })).toBeDefined()
  expect(await full.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  await full.unmount()
})

test('a terminal with no status line of its own still gets the quiet alarms', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, tokens: 100_000 })
  await start($)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: '96%' })).toBeDefined()
  await ui.unmount()
})

// ---- the plugin's questions in the band ------------------------------------------------------------------

async function askCompact($: any, s: any) {
  await $.command.run({ command: 'crew-compact', args: '' })
  await s.clock.advance(400)
  await settle()
}

test('a plugin question is asked in the band, as buttons; pressing one answers it, no dialog', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, tokens: 100_000 })
  await start($)
  await askCompact($, s)
  expect(s.toasts.some((x: string) => x.includes('press 1, 2, 3'))).toBe(true)
  const ui = await mount($)
  const asked = await ui.find({ type: 'Text', text: /crew-chief asks: / })
  expect(asked).toBeDefined()
  expect(asked?.props?.backgroundColor).toBe('#e08ef0') // a lilac band, dark text
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.length).toBe(3)
  expect(buttons[0].text).toContain('1 Yes, compact')
  expect(buttons[1].text).toContain('2 Not now')
  expect(s.submitted.length).toBe(0)
  await ui.press({ key: 'ask-1' })
  await settle()
  await ui.unmount()
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('approved compacting')
  const after = await mount($)
  expect(await after.find({ type: 'Button' })).toBeUndefined() // the question left the band
  await after.unmount()
})

test('"Not now" in the band is a plain no: nothing is submitted', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, tokens: 100_000 })
  await start($)
  await askCompact($, s)
  const ui = await mount($)
  await ui.press({ key: 'ask-2' })
  await settle()
  await ui.unmount()
  expect(s.submitted.length).toBe(0)
})

test('an unanswered band question expires to its safe default and leaves the band', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, tokens: 100_000 })
  await start($)
  await askCompact($, s)
  await s.clock.advance(21 * 60_000)
  await settle()
  const ui = await mount($)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
  expect(s.submitted.length).toBe(0)
  expect(s.toasts.some((x: string) => x.includes('Not now'))).toBe(true)
})

test('the band question is only asked where the band is drawn: not with the band off', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_COMPACT: 'on' }, tokens: 100_000 }) // band off
  await start($)
  await askCompact($, s)
  expect(s.toasts.some((x: string) => x.includes('asks above the prompt'))).toBe(false)
})

test('words on: the spinner word follows the model, only when the engine uses a word (no message)', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, store: { crew_ui_words: 'on' } })
  await start($)
  await mainStep($, 'claude-opus-5-5', 'high')
  const spinner = await mountOf($, 'Spinner', { word: 'Beaming', message: null, suffix: '…', mode: 'thinking' })
  expect(await spinner.find({ type: 'Text', text: /"word":"Pondering"/ })).toBeDefined()
  await spinner.unmount()
  const overridden = await mountOf($, 'Spinner', { word: 'Beaming', message: 'Compacting', suffix: '…', mode: 'thinking' })
  expect(await overridden.find({ type: 'Text', text: /"word":"Beaming"/ })).toBeDefined() // a state's message is left alone
  await overridden.unmount()
})

test('words off by default, and the command saves the choice', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  await mainStep($, 'claude-opus-5-5', 'high')
  const spinner = await mountOf($, 'Spinner', { word: 'Beaming', message: null, suffix: '…', mode: 'thinking' })
  expect(await spinner.find({ type: 'Text', text: /"word":"Beaming"/ })).toBeDefined()
  await spinner.unmount()
  expect(JSON.stringify(await $.command.run({ command: 'crew-ui', args: 'words on' }))).toContain('words on')
  expect(s.stored.crew_ui_words).toBe('on')
})

test('"Not now" takes the compact key away until the context has grown another 100k, "never" for good', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, tokens: 500_000 })
  await start($)
  const before = await mount($)
  expect(await before.find({ type: 'Button' })).toBeDefined() // due: the key shows
  await before.unmount()
  await $.command.run({ command: 'crew-compact', args: '' })
  await s.clock.advance(400)
  await settle()
  const asking = await mount($)
  await asking.press({ key: 'ask-2' }) // not now
  await settle()
  await asking.unmount()
  const after = await mount($)
  expect(await after.find({ type: 'Button' })).toBeUndefined() // the key does not stay
  await after.unmount()
  s.tokens = 640_000 // another 100k on top
  const later = await mount($)
  expect(await later.find({ type: 'Button' })).toBeDefined()
  await later.unmount()
  await $.command.run({ command: 'crew-compact', args: '' })
  await s.clock.advance(400)
  await settle()
  const again = await mount($)
  await again.press({ key: 'ask-3' }) // never
  await settle()
  await again.unmount()
  s.tokens = 900_000
  const never = await mount($)
  expect(await never.find({ type: 'Button' })).toBeUndefined()
  await never.unmount()
})

test('an agent the band never saw start says "starting" for a few seconds, then just its name, calls and time', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:implementer-hard', status: 'running', description: 'x' })
  const young = await mount($)
  expect(await young.find({ type: 'Text', text: /starting/ })).toBeDefined()
  await young.unmount()
  await s.clock.advance(20_000)
  const old = await mount($)
  expect(await old.find({ type: 'Text', text: /implementer-hard/ })).toBeDefined()
  expect(await old.find({ type: 'Text', text: /starting/ })).toBeUndefined()
  expect(await old.find({ type: 'Text', text: /20s/ })).toBeDefined()
  await old.unmount()
})

test('without a reported percentage the agent line shows its calls and time', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'Explore', status: 'running', description: 'x' })
  await step($, s, 'a1', 'claude-haiku-5-5', 'low')
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Read', file_path: '/work/a', agentId: 'a1' })
  await s.clock.advance(45_000)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /3 calls/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /45s/ })).toBeDefined()
  await ui.unmount()
})

test('every running agent is drawn while there is room, not just the first two', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  for (let i = 1; i <= 5; i++) s.agents.push({ id: 'a' + i, type: 'worker-' + i, status: 'running', description: 'x' })
  const ui = await mount($, { maxRows: 10 }) // room for the frame and eight lines
  for (let i = 1; i <= 5; i++) expect(await ui.find({ type: 'Text', text: new RegExp('worker-' + i) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /more agents/ })).toBeUndefined()
  await ui.unmount()
})

test('when the engine gives little room the rest becomes "+N more agents"', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  for (let i = 1; i <= 5; i++) s.agents.push({ id: 'a' + i, type: 'worker-' + i, status: 'running', description: 'x' })
  const ui = await mount($, { maxRows: 5 }) // the frame takes two, three lines are left: the status line, one agent, the rest
  expect(await ui.find({ type: 'Text', text: /worker-1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /worker-5/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\+4 more agents/ })).toBeDefined()
  await ui.unmount()
})
