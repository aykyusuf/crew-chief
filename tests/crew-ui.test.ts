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
  surfaces?: string[]
  cwd?: string
  branch?: string
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
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('agent.list', () => ({ value: state.agents }))
  on('session.cwd', () => ({ value: opts.cwd ?? '/work' }))
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
  on('process.run', ($: any, e: any) => {
    if (Array.isArray(e.argv) && e.argv.includes('symbolic-ref')) return { value: opts.branch ? { exitCode: 0, stdout: opts.branch + '\n', stderr: '' } : { exitCode: 128, stdout: '', stderr: 'not a git repository' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('prompt.submit', ($: any, e: any) => {
    state.submitted.push(e.text)
    return { text: e.text }
  })
  on('tool.call', () => ({ result: 'ok' }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
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
  expect(await ui.find({ type: 'Text', text: /Sonnet 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● ● ○ ○ ○/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined() // the terminal has no pictures
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

test('the compact key is gone while a subagent runs and comes back when it ends', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, tokens: 500_000 })
  await start($)
  s.agents = [{ id: 'a1', type: 'crew-chief:implementer', status: 'running', description: 'job' }]
  let ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /implementer/ })).toBeDefined() // the band is drawn, with the agent
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
  s.agents = [{ id: 'a1', type: 'crew-chief:implementer', status: 'completed', description: 'job' }]
  ui = await mount($)
  expect(await ui.find({ type: 'Button' })).toBeDefined()
  await ui.unmount()
})

test('the compact key says "1" only in the terminal: elsewhere the shortcut does not work, so it is just "compact"', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, tokens: 500_000 })
  await start($)
  const term = await mount($)
  expect((await term.find({ type: 'Button' }))?.text).toContain('1 compact')
  await term.unmount()
  const desktop = await $.ui.mount({ plugin: 'crew-chief', surface: 'desktop', component: 'AbovePrompt', props: PROPS, viewport: { columns: 105, rows: 40 } })
  const button = await desktop.find({ type: 'Button', key: 'band-compact' }) // on the Desktop status line, beside the toggle
  expect(button?.props?.label).toBe('⇣ ctx')
  expect(button?.props?.hotkey).toBeUndefined()
  expect(button?.text).not.toContain('1')
  await desktop.unmount()
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
  // On Desktop the windows are in the band's own status line at its foot (ui.statusline), not in the status row.
  expect(await desktop.find({ type: 'Text', text: /^7d: %96 / })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: '96%' })).toBeUndefined()
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

test('Desktop: the compact question is a quiet card (topic, short line, facts, note, answers); the terminal keeps the strip', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, tokens: 100_000 })
  await start($)
  await askCompact($, s)
  const desk = await mountDesktop($)
  const card = await desk.find({ type: 'Box', key: 'ask-card' })
  expect(card).toBeDefined()
  expect(card?.props?.backgroundColor).not.toBe('#e08ef0') // no loud fill
  expect(await desk.find({ type: 'Text', text: /crew-chief asks: / })).toBeUndefined()
  expect(await desk.find({ type: 'Text', text: 'Time to compact' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: 'Compact the conversation now?' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /^Claude updates STATUS\.md and tasks\.json first/ })).toBeDefined()
  const facts = (await desk.findAll({ type: 'Text' })).filter((x: any) => x.props?.backgroundColor === 'rgba(255,255,255,.13)') // the chips
  expect(facts.length).toBeGreaterThan(0)
  expect(facts.length).toBeLessThanOrEqual(4)
  expect(facts.some((x: any) => /Context 100k/.test(x.text))).toBe(true)
  const buttons = (await desk.findAll({ type: 'Button' })).filter((b: any) => /^ask-\d$/.test(keyOf(b) ?? ''))
  expect(buttons.map((b: any) => b.text)).toEqual(['Yes, compact', 'Not now', "Don't ask again this session"])
  expect(buttons.map((b: any) => b.props.hotkey)).toEqual(['1', '2', '3'])
  expect(buttons[0].props.variant).toBe('primary')
  expect(buttons[1].props.variant).toBe('secondary')
  expect(buttons[2].props.plain).toBe(true) // the quiet one, a text button at the end
  await desk.unmount()
  const term = await mount($)
  const strip = await term.find({ type: 'Text', text: /crew-chief asks: Context is 100k tokens\..*Compact now\?/ })
  expect(strip?.props?.backgroundColor).toBe('#e08ef0')
  const keys = (await term.findAll({ type: 'Button' })).filter((b: any) => /^ask-\d$/.test(keyOf(b) ?? ''))
  expect(keys.map((b: any) => b.text)).toEqual(['1 Yes, compact', '2 Not now', "3 Don't ask again this session"])
  expect(keys.map((b: any) => b.props.hotkey)).toEqual(['1', '2', '3'])
  await term.unmount()
  const again = await mountDesktop($)
  await again.press({ key: 'ask-1' }) // the same answer as the terminal's '1'
  await settle()
  await again.unmount()
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('approved compacting')
})

test('Desktop: the quiet "don\'t ask again" in the card answers never, as the terminal\'s 3 does', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, tokens: 500_000 })
  await start($)
  await askCompact($, s)
  const desk = await mountDesktop($)
  await desk.press({ key: 'ask-3' })
  await settle()
  await desk.unmount()
  s.tokens = 900_000
  const never = await mount($)
  expect(await never.find({ type: 'Button' })).toBeUndefined() // never: no compact key any more
  await never.unmount()
  expect(s.submitted.length).toBe(0)
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

test('without a reported percentage the agent line shows its time, never a call count', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'Explore', status: 'running', description: 'x' })
  await step($, s, 'a1', 'claude-haiku-5-5', 'low')
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Read', file_path: '/work/a', agentId: 'a1' })
  await s.clock.advance(45_000)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /calls/ })).toBeUndefined()
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

// ---- the busy note and the overlap note -----------------------------------------------------------

test('the band says so when more subagents run than agents.warn allows, and /crew-config moves the line', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  s.agents = Array.from({ length: 6 }, (_, i) => ({ id: 'a' + i, type: 'crew-chief:implementer', status: 'running', description: 'job ' + i }))
  await start($)
  let ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /6 agents running/ })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'crew-config', args: 'set agents.warn 8' })
  ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /agents running/ })).toBeUndefined()
  await ui.unmount()
})

test('a second writer whose brief names the same file gets a note with its result; disjoint files and an idle list get none', async ($, on) => {
  const s = harness(on)
  await start($)
  s.agents = [{ id: 'a1', type: 'crew-chief:implementer', status: 'running', description: 'first' }]
  const first = await $.tool.call({ tool: 'Agent', subagent_type: 'crew-chief:implementer', prompt: 'Change `hooks/src/guard.js` only.', description: 'a' })
  expect(JSON.stringify(first)).not.toContain('same file')
  const clash = await $.tool.call({ tool: 'Agent', subagent_type: 'crew-chief:implementer-hard', prompt: 'Also rework hooks/src/guard.js and its test.', description: 'b' })
  expect(JSON.stringify(clash)).toContain('same file(s)')
  const apart = await $.tool.call({ tool: 'Agent', subagent_type: 'crew-chief:mechanic', prompt: 'Rename in docs/readme.md', description: 'c' })
  expect(JSON.stringify(apart)).not.toContain('same file')
  s.agents = []
  const later = await $.tool.call({ tool: 'Agent', subagent_type: 'crew-chief:implementer', prompt: 'Touch hooks/src/guard.js again', description: 'd' })
  expect(JSON.stringify(later)).not.toContain('same file') // nothing was running: the earlier brief is forgotten
  const reader = await $.tool.call({ tool: 'Agent', subagent_type: 'crew-chief:deep-reader', prompt: 'Read hooks/src/guard.js', description: 'e' })
  expect(JSON.stringify(reader)).not.toContain('same file')
})

test('the first run of an agent type in a session says so; the second run of the same type does not', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' }, store: { crew_ui_mode: 'full' } })
  await start($)
  s.agents = [{ id: 'p1', type: 'crew-chief:planner', status: 'running', description: 'plan' }]
  let ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /first run/ })).toBeDefined()
  await ui.unmount()
  s.agents = [{ id: 'p1', type: 'crew-chief:planner', status: 'completed', description: 'plan' }, { id: 'p2', type: 'crew-chief:planner', status: 'running', description: 'plan again' }]
  ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /first run/ })).toBeUndefined()
  await ui.unmount()
})

test('the context is not drawn in quiet mode; one toast says so when it passes the compaction size, and again only after a drop', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, tokens: 100_000 })
  await start($)
  const done = () => $.turn.complete({ turnId: 'main', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' })
  const ctxToasts = () => s.toasts.filter((x: string) => x.includes('Context at')).length
  await done()
  expect(ctxToasts()).toBe(0)
  s.tokens = 450_000
  await done()
  await done()
  expect(ctxToasts()).toBe(1) // once, not on every turn
  expect(s.toasts.find((x: string) => x.includes('Context at'))).toContain('450k (45%)')
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined() // nothing drawn, however full
  await ui.unmount()
  s.tokens = 750_000 // 70 % newly crossed
  await done()
  expect(ctxToasts()).toBe(2)
  s.tokens = 50_000 // compacted
  await done()
  s.tokens = 450_000
  await done()
  expect(ctxToasts()).toBe(3)
})

test('full mode on the Desktop app draws the context as figures, without the block graph', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, store: { crew_ui_mode: 'full' }, tokens: 100_000 })
  await start($)
  for (let i = 0; i < 4; i++) await $.turn.complete({ turnId: 'main', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' })
  const desktop = await $.ui.mount({ plugin: 'crew-chief', surface: 'desktop', component: 'AbovePrompt', props: PROPS, viewport: { columns: 105, rows: 40 } })
  expect(await desktop.find({ type: 'Text', text: /10%/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /[▁▂▃▄▅▆▇█]/ })).toBeUndefined()
  await desktop.unmount()
  const terminal = await mount($)
  expect(await terminal.find({ type: 'Text', text: /[▁▂▃▄▅▆▇█]/ })).toBeDefined()
  await terminal.unmount()
})

// ---- pictures outside the terminal (panel.style) ------------------------------------------------------------

const mountDesktop = ($: any, over: Record<string, unknown> = {}) => $.ui.mount({ plugin: 'crew-chief', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, ...over }, viewport: { columns: 105, rows: 40 } })

test('on Desktop a running subagent is a picture (capsule by default), in the terminal the line', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:deep-reader', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  const desk = await mountDesktop($)
  // The card is Text around two small pictures: the character and the bar.
  const svgs = await desk.findAll({ type: 'Svg' })
  expect(svgs.length).toBe(2)
  const face = svgs.find((x: any) => x.props.alt === 'deep-reader')
  expect(face?.props?.source).toContain('#ffcf3d') // the yellow capsule
  expect(face?.props?.source).toContain('#7ab8ff') // in Sonnet's colour
  expect(face?.props?.source.length).toBeLessThan(131072)
  expect(svgs.find((x: any) => x.props.alt === 'no estimate')).toBeDefined() // the bar
  expect(await desk.find({ type: 'Text', text: /^deep-reader$/ })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /^Sonnet 5\.5$/ })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /^●●●○○$/ })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /^High$/ })).toBeDefined()
  // A later drawing is byte for byte the same: no clock in the face, so the frame it is drawn in (isInteractive)
  // is not loaded again (blank while it loads).
  await s.clock.advance(7000)
  const again = await mountDesktop($)
  const later = (await again.findAll({ type: 'Svg' })).map((x: any) => x.props.source)
  expect(later).toEqual(svgs.map((x: any) => x.props.source))
  expect((await again.findAll({ type: 'Svg' })).find((x: any) => x.props.alt === 'deep-reader')?.props?.isInteractive).toBe(true)
  await again.unmount()
  await desk.unmount()
  const term = await mount($)
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /deep-reader/ })).toBeDefined()
  await term.unmount()
})

test('the face moves fully by default; panel.perf on keeps it fully still, the same source on a later drawing', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:implementer', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  const faceOf = async () => {
    const desk = await mountDesktop($)
    const face = (await desk.findAll({ type: 'Svg' })).find((x: any) => x.props.alt === 'implementer')
    await desk.unmount()
    return face?.props?.source as string
  }
  const frames = (src: string) => {
    const P = /\.(c\w+?)a\{animation:none/.exec(src)![1]
    return [...src.matchAll(/@keyframes (\w+)\{/g)].map((m) => m[1].slice(P.length))
  }
  const moving = await faceOf()
  expect(frames(moving)).toContain('ham') // the hammer swings
  expect(frames(moving)).toContain('bob')
  const r = await $.command.run({ command: 'crew-config', args: 'set panel.perf on' })
  expect(JSON.stringify(r)).toContain('panel.perf = on')
  const still = await faceOf()
  expect(still).not.toMatch(/@keyframes|animation/) // fully still, not even a blink
  await s.clock.advance(7000)
  expect(await faceOf()).toBe(still)
})

test('an agent whose turn ended while it waits on its background work keeps a calm card; resuming runs it again; a real end drops it', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:implementer', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  const end = () => $.turn.complete({ turnId: 't-a1', agentId: 'a1', answer: 'waiting on the build', durationMs: 5, isAborted: false, reason: 'answer' })
  const look = async () => {
    const desk = await mountDesktop($)
    const face = (await desk.findAll({ type: 'Svg' })).find((x: any) => x.props.alt === 'implementer')?.props?.source as string | undefined
    const waitText = await desk.find({ type: 'Text', text: /^waiting on background work$/ })
    const tag = await desk.find({ type: 'Text', text: /^waiting$/ })
    const time = await desk.find({ type: 'Text', text: /^\d+[smh]/ })
    await desk.unmount()
    return { face, waitText, tag, time: time?.text }
  }
  const frames = (src: string) => {
    const P = /\.(c\w+?)a\{animation:none/.exec(src)![1]
    return [...src.matchAll(/@keyframes (\w+)\{/g)].map((m) => m[1].slice(P.length))
  }
  const running = await look()
  expect(running.waitText).toBeUndefined()
  expect(frames(running.face!)).toContain('ham') // moving
  // Its turn ends with a background shell still going: the list says waiting.
  s.agents[0].status = 'waiting'
  await end()
  await s.clock.advance(65_000)
  const waiting = await look()
  expect(waiting.face).toBeDefined() // the card stays
  expect(waiting.waitText).toBeDefined()
  expect(waiting.tag).toBeDefined()
  expect(waiting.face!).not.toMatch(/@keyframes|animation/) // fully still, panel.perf off
  expect(waiting.time).toMatch(/^1m/) // the time counts on past the turn's end
  // The background work is done: it runs another turn, the normal card again.
  s.agents[0].status = 'running'
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  const resumed = await look()
  expect(resumed.waitText).toBeUndefined()
  expect(resumed.tag).toBeUndefined()
  expect(frames(resumed.face!)).toContain('ham')
  // It really ends: no background work left, the list says completed, the card leaves.
  s.agents[0].status = 'completed'
  await end()
  expect((await look()).face).toBeUndefined()
})

test('a turn ended with the list still saying running (no background work): the card leaves as before', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:implementer', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  await $.turn.complete({ turnId: 't-a1', agentId: 'a1', answer: 'done', durationMs: 5, isAborted: false, reason: 'answer' })
  const desk = await mountDesktop($)
  expect((await desk.findAll({ type: 'Svg' })).find((x: any) => x.props.alt === 'implementer')).toBeUndefined()
  expect(await desk.find({ type: 'Text', text: /waiting on background work/ })).toBeUndefined()
  await desk.unmount()
})

// Every Svg of a drawing by where a redraw finds it (each ancestor's key, else its place among its siblings),
// with its source: the same address and the same source mean the Desktop app keeps the image and its animation.
const kidsOf = (el: any): any[] => (Array.isArray(el?.props?.children) ? el.props.children : Array.isArray(el?.children) ? el.children : [])
// The place of the keyed Box among its siblings (how many rows the band draws above it).
function placeOf(tree: any, key: string): number {
  const kids = kidsOf(tree)
  const i = kids.findIndex((c: any) => c?.props?.key === key || c?.key === key)
  if (i >= 0) return i
  for (const c of kids) {
    const j = placeOf(c, key)
    if (j >= 0) return j
  }
  return -1
}
function pictures(tree: any): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (el: any, path: string, i: number) => {
    if (!el || typeof el !== 'object') return
    const here = path + '/' + el.type + ':' + (el.props?.key ?? '#' + i)
    if (el.type === 'Svg') out.set(here, el.props.source)
    kidsOf(el).forEach((c: any, j: number) => walk(c, here, j))
  }
  walk(tree, '', 0)
  return out
}

test('consecutive band drawings keep each picture at the same keyed place with the same source', async ($, on) => {
  // Limits far off and a small context: no status line at first, so the cards are the band's first row.
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' }, rateLimits: [{ kind: 'five_hour', percentUsed: 4, resetsAt: '2026-10-29T00:20:00Z' }] })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:deep-reader', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  // Room for every card (six agents in three rows): this test is about places and sources, not the budget.
  const draw = async () => {
    const ui = await mountDesktop($, { maxRows: 30 })
    const tree = await ui.drawn()
    await ui.unmount()
    return tree
  }
  // Same place, same drawing, byte for byte: nothing in a picture follows the clock.
  const mine = (m: Map<string, string>) => new Map([...m].filter(([k]) => k.includes('-a1/')))
  const quiet = await draw()
  expect(placeOf(quiet, 'agentcards-0')).toBe(0) // no status line yet: the cards are the first row
  const first = mine(pictures(quiet))
  expect(first.size).toBe(2) // the character and the bar, each in a Box keyed by the agent
  expect([...first.keys()].every((k) => /Box:agentface-a1\/Svg|Box:agentbar-a1\/Svg/.test(k))).toBe(true)
  // A redraw on the clock alone, then one after an agent event (more tokens).
  await s.clock.advance(2000)
  expect(mine(pictures(await draw()))).toEqual(first)
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  await s.clock.advance(2000)
  expect(mine(pictures(await draw()))).toEqual(first)
  // More agents: the grid grows and a status line appears (past agents.warn), a1's pictures stay where they were.
  for (const id of ['a2', 'a3', 'a4', 'a5', 'a6']) {
    s.agents.push({ id, type: 'crew-chief:scanner', status: 'running', description: 'a task' })
    await step($, s, id, 'claude-haiku-5-5', 'low')
  }
  await s.clock.advance(2000)
  const busy = (await draw()) as any
  expect(placeOf(busy, 'agentcards-0')).toBe(1) // the status line (six agents, past agents.warn) now sits above
  expect(mine(pictures(busy))).toEqual(first)
})

test('a new estimate redraws the still bar at its keyed place; no sheen or moving part lies over it', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:deep-reader', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  const draw = async () => {
    const ui = await mountDesktop($)
    const tree = await ui.drawn()
    await ui.unmount()
    return tree
  }
  const barOf = (m: Map<string, string>) => [...m].find(([k]) => k.endsWith('Box:agentbar-a1/Svg:#0'))?.[1]
  await $.tool.call({ tool: 'Bash', command: ": 'crew-progress 41 | reading | '", agentId: 'a1' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  const at41 = pictures(await draw())
  await $.tool.call({ tool: 'Bash', command: ": 'crew-progress 58 | writing | '", agentId: 'a1' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  await s.clock.advance(1000)
  const at58 = pictures(await draw())
  expect(barOf(at41)).toBeDefined()
  expect(barOf(at58)).toBeDefined()
  expect(barOf(at58)).not.toBe(barOf(at41)) // the fill moved a step
  for (const m of [at41, at58]) {
    expect([...m.keys()].some((k) => k.includes('agentsheen'))).toBe(false)
    expect(barOf(m)).not.toMatch(/@keyframes|animation/)
  }
})

const typeOf =(el: any) => el?.type ?? el?.props?.type

test('agent cards sit in a grid sized by what a card needs: five agents at 145 columns in rows of 2, 2 and 1', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  const crew: [string, string, string][] = [
    ['scanner', 'claude-haiku-5-5', 'low'],
    ['deep-reader', 'claude-sonnet-5-5', 'medium'],
    ['implementer', 'claude-sonnet-5-5', 'medium'],
    ['mechanic', 'claude-haiku-5-5', 'low'],
    ['reviewer', 'claude-opus-5-5', 'high'],
  ]
  for (const [i, [type, model, effort]] of crew.entries()) {
    s.agents.push({ id: 'a' + (i + 1), type: 'crew-chief:' + type, status: 'running', description: 'a task' })
    await step($, s, 'a' + (i + 1), model, effort)
  }
  // Room for three rows of cards (the budget is tested on its own below).
  const desk = await $.ui.mount({ plugin: 'crew-chief', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 145, maxRows: 30 }, viewport: { columns: 150, rows: 40 } })
  const rows = (await Promise.all([0, 1, 2, 3].map((r) => desk.find({ type: 'Box', key: `agentline-0-${r}` })))) as any[]
  expect(rows[3]).toBeUndefined()
  expect(rows.slice(0, 3).map((r) => kidsOf(r).length)).toEqual([2, 2, 2])
  const cells = rows.slice(0, 3).flatMap(kidsOf) as any[]
  expect(cells.map((c) => c.props.key)).toEqual(['agentrow-a1', 'agentrow-a2', 'agentrow-a3', 'agentrow-a4', 'agentrow-a5', 'agentfill-0-2-1'])
  // One frame for every cell: the same basis, grow, least width, border and padding, so all six are one width.
  const frame = (c: any) => [c.props.width, c.props.flexGrow, c.props.flexShrink, c.props.minWidth, c.props.borderStyle, c.props.paddingX].join()
  expect(new Set(cells.map(frame)).size).toBe(1)
  // Nothing in a card wraps: every Text but the step sits in a Box that does not shrink, the step alone is cut
  // short, and no line of the card wraps its pieces.
  const walk = (el: any, inFixed: boolean, out: { fixed: boolean; el: any }[]) => {
    if (typeOf(el) === 'Text') return void out.push({ fixed: inFixed, el })
    if (typeOf(el) === 'Box' && el.props?.flexWrap !== undefined) out.push({ fixed: false, el: { props: { wrap: 'flexWrap' } } })
    const fixedHere = typeOf(el) === 'Box' ? el.props?.flexShrink === 0 || (inFixed && el.props?.flexShrink === undefined) : inFixed
    for (const k of kidsOf(el)) if (k && typeof k === 'object') walk(k, fixedHere, out)
  }
  for (const c of cells.slice(0, 5)) {
    const texts: { fixed: boolean; el: any }[] = []
    walk(c, false, texts)
    expect(texts.length).toBeGreaterThan(4)
    for (const { fixed, el } of texts) {
      if (el.props?.wrap === 'truncate-end') continue // the step, the one that shrinks
      expect(el.props?.wrap).toBeUndefined()
      expect(fixed).toBe(true)
    }
  }
  await desk.unmount()
})

test('one agent alone in a wide band is not stretched across it: an empty cell keeps it at half', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:implementer', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  const desk = await $.ui.mount({ plugin: 'crew-chief', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 145 }, viewport: { columns: 150, rows: 40 } })
  const line = await desk.find({ type: 'Box', key: 'agentline-0-0' })
  expect(kidsOf(line).map((c: any) => c.props.key)).toEqual(['agentrow-a1', 'agentfill-0-0-1'])
  await desk.unmount()
  const narrow = await mountDesktop($) // 100 columns: a card to a row, no empty cell
  expect(kidsOf(await narrow.find({ type: 'Box', key: 'agentline-0-0' })).map((c: any) => c.props.key)).toEqual(['agentrow-a1'])
  await narrow.unmount()
})

test('panel.style cat draws the kitten', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_PANEL_STYLE: 'cat' } })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:scanner', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-haiku-5-5', 'low')
  const cat = await mountDesktop($)
  expect((await cat.find({ type: 'Svg' }))?.props?.source).toContain('#f8f2e7') // cream body
  await cat.unmount()
})

test('panel.style text (the way out) draws no picture at all', async ($, on) => {
  const t = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_PANEL_STYLE: 'text' } })
  await start($)
  t.agents.push({ id: 'a2', type: 'crew-chief:scanner', status: 'running', description: 'a task' })
  await step($, t, 'a2', 'claude-haiku-5-5', 'low')
  const plain = await mountDesktop($)
  expect(await plain.find({ type: 'Svg' })).toBeUndefined()
  expect(await plain.find({ type: 'Text', text: /Haiku 5\.5/ })).toBeDefined()
  await plain.unmount()
})

test('/crew-ui panel saves the style as /crew-config does, and refuses an unknown one', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' } })
  await start($)
  const r = await $.command.run({ command: 'crew-ui', args: 'panel cat' })
  expect(r.text).toContain('panel cat')
  expect(s.stored.cfg_panel_style).toBe('cat')
  const bad = await $.command.run({ command: 'crew-ui', args: 'panel robot' })
  expect(bad.text).toContain('choose capsule')
  expect(s.stored.cfg_panel_style).toBe('cat')
})

test('the saver badge is a picture on Desktop and the words in the terminal', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' }, store: { crew_ui_mode: 'full' } })
  await start($)
  await $.command.run({ command: 'saver', args: 'on' })
  const desk = await mountDesktop($)
  const badge = await desk.find({ type: 'Svg', alt: 'saver on' })
  expect(badge).toBeDefined()
  await desk.unmount()
  const term = await mount($)
  expect(await term.find({ type: 'Text', text: /saver on/ })).toBeDefined()
  await term.unmount()
})

const SAVER_HIT = [{ kind: 'five_hour', percentUsed: 82, resetsAt: '2026-10-28T21:40:00Z' }]
async function askSaver($: any) {
  await $.session.measure({ context: { window: 1_000_000, tokens: 100_000, percent: 10 }, rateLimits: SAVER_HIT, changed: ['rateLimits'] })
  await settle()
}

test('the saver question on Desktop is the quiet card: topic, two chips, one note, four plain buttons; the terminal keeps its strip', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_SAVER: 'on' }, rateLimits: SAVER_HIT })
  await start($)
  await askSaver($)
  const desk = await mountDesktop($)
  expect(await desk.find({ type: 'Box', key: 'ask-card' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /crew-chief asks: / })).toBeUndefined()
  expect(await desk.find({ type: 'Text', text: 'Token saver' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: 'Turn on the saver for this session?' })).toBeDefined()
  const chips = (await desk.findAll({ type: 'Text' })).filter((x: any) => x.props?.backgroundColor === 'rgba(255,255,255,.13)')
  expect(chips.map((x: any) => x.text.trim())[0]).toBe('5-hour 82%')
  expect(chips.length).toBeLessThanOrEqual(2)
  expect(chips.some((x: any) => /^ Resets in /.test(x.text))).toBe(true)
  expect(await desk.find({ type: 'Text', text: /^Saver: Opus agents medium.*Ultra: agents skip Opus$/ })).toBeDefined()
  expect(await desk.find({ type: 'Svg', alt: /leaf|shield|^82%/ })).toBeUndefined() // no icons, no meter
  expect(await desk.find({ type: 'Text', text: ' ULTRA ' })).toBeUndefined()
  const buttons = (await desk.findAll({ type: 'Button' })).filter((b: any) => /^ask-\d$/.test(keyOf(b) ?? ''))
  expect(buttons.map((b: any) => b.props.label)).toEqual(['Turn on saver', 'Ultra', 'Not now', "Don't ask again"])
  expect(buttons.map((b: any) => b.props.hotkey)).toEqual(['1', '2', '3', '4'])
  expect(buttons[0].props.variant).toBe('primary')
  expect(buttons[1].props.variant).toBe('secondary')
  expect(buttons[3].props.plain).toBe(true)
  await desk.unmount()
  const term = await mount($)
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  const strip = await term.find({ type: 'Text', text: /crew-chief asks: Your 5-hour limit is 82% used\..*Turn on the token saver for this session\?/ })
  expect(strip?.props?.backgroundColor).toBe('#e08ef0') // the lilac strip, as before
  const keys = (await term.findAll({ type: 'Button' })).filter((b: any) => /^ask-\d$/.test(keyOf(b) ?? ''))
  expect(keys.map((b: any) => b.text)).toEqual(['1 Turn on saver', '2 Ultra-saver', '3 Not now', "4 Don't ask again this session"])
  await term.unmount()
  const again = await mountDesktop($)
  await again.press({ key: 'ask-2' }) // the short 'Ultra' answers the same as the terminal's 2
  await settle()
  await again.unmount()
  const after = await mountDesktop($)
  expect(await after.find({ type: 'Svg', alt: 'ultra-saver on' })).toBeDefined()
  await after.unmount()
})

test('Desktop: a question and five agents in a small band: the cards give way, the status line stays', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_SAVER: 'on' }, surfaces: ['desktop'], rateLimits: SAVER_HIT })
  await start($)
  for (let i = 1; i <= 5; i++) {
    s.agents.push({ id: 'a' + i, type: 'crew-chief:scanner', status: 'running', description: 'a task' })
    await step($, s, 'a' + i, 'claude-haiku-5-5', 'low')
  }
  await askSaver($)
  const desk = await $.ui.mount({ plugin: 'crew-chief', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, maxRows: 12 }, viewport: { columns: 105, rows: 40 } })
  expect(await desk.find({ type: 'Box', key: 'ask-card' })).toBeDefined()
  const cards = (await desk.findAll({ type: 'Box' })).filter((b: any) => /^agentrow-/.test(keyOf(b) ?? ''))
  expect(cards.length).toBeGreaterThan(0)
  expect(cards.length).toBeLessThan(5)
  expect(await desk.find({ type: 'Text', text: new RegExp(`\\+${5 - cards.length} more agents`) })).toBeDefined()
  const kids = kidsOfLine(await desk.find({ type: 'Box', key: 'band-with-line' }))
  expect(keyOf(kids[kids.length - 1])).toBe('band-statusline') // still the band's last row
  await desk.unmount()
})

test('Desktop: seven agents in a small band keep one layout on every drawing: busy row, whole card rows, a "+N more" chip, the status line last', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' }, surfaces: ['desktop'] })
  await start($)
  for (let i = 1; i <= 7; i++) {
    s.agents.push({ id: 'a' + i, type: 'crew-chief:scanner', status: 'running', description: 'a task' })
    await step($, s, 'a' + i, 'claude-haiku-5-5', 'low')
  }
  // maxRows 14: the frame (2), the status line (1) and the busy row (1) leave 10 rows: two rows of cards
  // (3 rows each and a gap), never a third one cut in half.
  const draw = async () => {
    const ui = await $.ui.mount({ plugin: 'crew-chief', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, maxRows: 14, bodyColumns: 145 }, viewport: { columns: 150, rows: 40 } })
    const busy = await ui.find({ type: 'Text', text: /7 agents running/ })
    const lines = (await Promise.all([0, 1, 2].map((r) => ui.find({ type: 'Box', key: `agentline-0-${r}` })))) as any[]
    const kids = kidsOfLine(await ui.find({ type: 'Box', key: 'band-with-line' }))
    const cells = lines.filter(Boolean).flatMap(kidsOf).map((c: any) => keyOf(c))
    const more = await ui.find({ type: 'Box', key: 'agentmore' })
    const moreText = more ? kidsOf(more).map((t: any) => kidsOf(t).join('')).join('') : undefined
    const faces = (await ui.findAll({ type: 'Svg' })).filter((x: any) => x.props.isInteractive === true).map((x: any) => x.props.source)
    await ui.unmount()
    return { busy: busy !== undefined, rows: lines.filter(Boolean).length, cells, last: keyOf(kids[kids.length - 1]), moreText, faces }
  }
  const first = await draw()
  expect(first.busy).toBe(true)
  expect(first.last).toBe('band-statusline')
  expect(first.rows).toBe(2) // two whole rows, no third
  const cards = first.cells.filter((k: string) => /^agentrow-/.test(k))
  expect(first.cells[first.cells.length - 1]).toBe('agentmore') // the chip is the last cell
  expect(first.moreText).toBe(`+${7 - cards.length} more agents`)
  expect(first.cells.length).toBeLessThanOrEqual(6)
  expect(first.faces.length).toBe(cards.length)
  // Two more drawings, the clock moving on as the agents' events redraw the band: the same layout, the same faces.
  for (const ms of [2500, 5000]) {
    await s.clock.advance(ms)
    expect(await draw()).toEqual(first)
  }
})

// ---- the status line at the foot of the band on the Desktop app (ui.statusline) ------------------------------

const kidsOfLine = (el: any): any[] => (Array.isArray(el?.props?.children) ? el.props.children : Array.isArray(el?.children) ? el.children : [])
const keyOf = (el: any) => el?.props?.key ?? el?.key
const lineTexts = async (ui: any) => {
  const foot = await ui.find({ type: 'Box', key: 'band-statusline-text' })
  return foot ? kidsOfLine(foot).map((t: any) => kidsOfLine(t).join('')).join('') : undefined
}

test('Desktop: the status line is the band\'s last element, under the agent cards, with folder, branch, windows, context, tokens, model and effort', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' }, surfaces: ['desktop'], cwd: '/Users/me/projects/shop', branch: 'feature/cart' })
  await start($)
  await step($, s, undefined as any, 'claude-haiku-5-5', 'medium') // the main loop's request: model and effort
  s.agents.push({ id: 'a1', type: 'crew-chief:deep-reader', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'high')
  const desk = await mountDesktop($)
  const kids = kidsOfLine(await desk.find({ type: 'Box', key: 'band-with-line' }))
  expect(keyOf(kids[kids.length - 1])).toBe('band-statusline')
  expect(kids.length).toBe(2) // the framed band (the cards), then the line
  expect(await desk.find({ type: 'Box', key: 'agentcards-0' })).toBeDefined()
  expect(await lineTexts(desk)).toBe('shop   |   feature/cart   |   5h: %4 ~4h 20m   |   7d: %96 ~5d 13h   |   ctx:10%   |   100k   |   Haiku 5.5 ●●○○○ Medium')
  expect((await desk.find({ type: 'Text', text: 'shop' }))?.props?.color).toBe('#ff3030')
  expect((await desk.find({ type: 'Text', text: 'feature/cart' }))?.props?.color).toBe('#2ecc40')
  // Not twice: the status row does not show the context or the windows again.
  expect(await desk.find({ type: 'Text', text: '96%' })).toBeUndefined()
  await desk.unmount()
})

test('Desktop with no agent and nothing to say: the band is the status line alone', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, surfaces: ['desktop'], branch: 'main', rateLimits: [{ kind: 'seven_day', percentUsed: 47, resetsAt: '2026-11-01T12:00:00Z' }] })
  await start($)
  const desk = await mountDesktop($)
  const ours = await desk.find({ type: 'Box', key: 'band-with-line' })
  expect(kidsOfLine(ours).map(keyOf)).toEqual(['band-statusline']) // no empty frame above it
  expect(await lineTexts(desk)).toBe('work   |   main   |   7d: %47 ~3d 16h   |   ctx:10%   |   100k   |   Sonnet 5.5')
  await desk.unmount()
})

test('ui.statusline off: no line, and with nothing else to say nothing of ours is drawn', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, surfaces: ['desktop'], branch: 'main', rateLimits: [] })
  await start($)
  const r = await $.command.run({ command: 'crew-config', args: 'set ui.statusline off' })
  expect(JSON.stringify(r)).toContain('ui.statusline = off')
  const desk = await mountDesktop($)
  expect(await desk.find({ type: 'Box', key: 'band-statusline' })).toBeUndefined()
  expect(await desk.find({ type: 'Box', key: 'band-with-line' })).toBeUndefined()
  expect(await desk.find({ type: 'Text', text: /^ctx:/ })).toBeUndefined()
  await desk.unmount()
})

test('the terminal never gets the status line', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, surfaces: ['terminal', 'desktop'], branch: 'main' })
  await start($)
  const term = await mount($)
  expect(await term.find({ type: 'Box', key: 'band-statusline' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /^ctx:/ })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: 'main' })).toBeUndefined()
  await term.unmount()
})

test('a spare folder of the Desktop app is never named; the next main turn reads the folder again', async ($, on) => {
  const opts: Opts = { env: { CREW_CHIEF_UI: 'on' }, surfaces: ['desktop'], branch: 'main', rateLimits: [], cwd: '/Users/me/.claude/spares/spare-ab12' }
  harness(on, opts)
  await start($)
  const desk = await mountDesktop($)
  expect(await lineTexts(desk)).toBe('main   |   ctx:10%   |   100k   |   Sonnet 5.5')
  await desk.unmount()
  opts.cwd = '/Users/me/projects/shop'
  await $.turn.start({ turnId: 'main-2', text: 'hi' })
  const again = await mountDesktop($)
  expect(await lineTexts(again)).toBe('shop   |   main   |   ctx:10%   |   100k   |   Sonnet 5.5')
  await again.unmount()
})

// ---- performance mode in one action: /crew-perf and the toggle at the end of the Desktop status line ---------

const implementerFace = async ($: any) => {
  const desk = await mountDesktop($)
  const face = (await desk.findAll({ type: 'Svg' })).find((x: any) => x.props.alt === 'implementer')
  await desk.unmount()
  return face?.props?.source as string
}
const keyframes = (src: string) => {
  const P = /\.(c\w+?)a\{animation:none/.exec(src)![1]
  return [...src.matchAll(/@keyframes (\w+)\{/g)].map((m) => m[1].slice(P.length))
}
const perfButton = async (ui: any) => {
  const foot = await ui.find({ type: 'Box', key: 'band-statusline' })
  return kidsOfLine(foot).find((k: any) => keyOf(k) === 'band-perf')
}

test('/crew-perf toggles panel.perf, on|off sets it, it is saved as /crew-config saves it, and it answers in the person\'s language', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_LANG: 'tr' }, surfaces: ['desktop'] })
  await start($)
  const first = await $.command.run({ command: 'crew-perf', args: '' })
  expect(JSON.stringify(first)).toContain('Performans modu açık: ajanlar duruyor, sadece göz kırpıyor.')
  expect(s.stored.cfg_panel_perf).toBe('on')
  expect(JSON.stringify(await $.command.run({ command: 'crew-config', args: '' }))).toContain('panel.perf = on [saved]')
  const second = await $.command.run({ command: 'crew-perf', args: '' })
  expect(JSON.stringify(second)).toContain('Performans modu kapalı: ajanlar hareketli.')
  expect(s.stored.cfg_panel_perf).toBe('off')
  await $.command.run({ command: 'crew-perf', args: 'on' })
  await $.command.run({ command: 'crew-perf', args: 'on' })
  expect(s.stored.cfg_panel_perf).toBe('on') // explicit, not a toggle
  const bad = await $.command.run({ command: 'crew-perf', args: 'maybe' })
  expect(JSON.stringify(bad)).toContain('/crew-perf on | off')
  expect(s.stored.cfg_panel_perf).toBe('on')
})

test('/crew-perf answers in English by default', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_LANG: 'en' } })
  await start($)
  expect(JSON.stringify(await $.command.run({ command: 'crew-perf', args: 'on' }))).toContain('Performance mode on')
  expect(JSON.stringify(await $.command.run({ command: 'crew-perf', args: 'off' }))).toContain('Performance mode off')
})

test('/crew-perf, /crew-config and session start write ~/.claude/perf-mode.json for other mods, and a failed write never fails the toggle', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_LANG: 'en', HOME: '/home/t' } })
  const writes: Array<{ path: string; text: string }> = []
  let fail = false
  on('fs.write', ($: any, e: any) => {
    if (fail) return { deny: 'EACCES: permission denied' }
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  const file = '/home/t/.claude/perf-mode.json'
  const last = () => {
    const mine = writes.filter((w) => w.path === file)
    return JSON.parse(mine[mine.length - 1].text)
  }
  on('fs.exists', ($: any, e: any) => ({ value: writes.some((w) => w.path === e.path) }))
  on('fs.read', ($: any, e: any) => {
    const mine = writes.filter((w) => w.path === e.path)
    return mine.length > 0 ? { value: mine[mine.length - 1].text } : { deny: 'ENOENT: no such file' }
  })
  await start($)
  await settle()
  expect(writes).toEqual([]) // no file and the mode off: a missing file already reads as off
  await $.command.run({ command: 'crew-perf', args: 'on' })
  expect(last().on).toBe(true)
  expect(last().at).toMatch(/^\d{4}-\d\d-\d\dT/)
  await $.command.run({ command: 'crew-config', args: 'set panel.perf off' })
  expect(last().on).toBe(false)
  await $.command.run({ command: 'crew-config', args: 'set panel.perf on' })
  expect(last().on).toBe(true)
  await $.command.run({ command: 'crew-config', args: 'reset panel.perf' })
  expect(last().on).toBe(false)
  fail = true
  const r = await $.command.run({ command: 'crew-perf', args: 'on' })
  expect(JSON.stringify(r)).toContain('Performance mode on')
  expect(s.stored.cfg_panel_perf).toBe('on')
})

test('session start writes ~/.claude/perf-mode.json only when it says otherwise than panel.perf', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on', HOME: '/home/t' }, store: { cfg_panel_perf: 'on' } })
  const file = '/home/t/.claude/perf-mode.json'
  const files: Record<string, string> = { [file]: '{"on":false,"at":"2026-11-01T00:00:00.000Z"}' }
  const writes: string[] = []
  on('fs.exists', ($: any, e: any) => ({ value: e.path in files }))
  on('fs.read', ($: any, e: any) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT: no such file' }))
  on('fs.write', ($: any, e: any) => {
    writes.push(e.path)
    files[e.path] = e.text
    return { value: undefined }
  })
  await start($)
  await settle()
  expect(writes).toEqual([file])
  expect(JSON.parse(files[file]).on).toBe(true)
})

test('Desktop: a press on the status line toggle switches panel.perf, and the next drawing\'s face goes from full motion to fully still and back', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' }, surfaces: ['desktop'], branch: 'main' })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:implementer', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  expect(keyframes(await implementerFace($))).toContain('ham')
  const desk = await mountDesktop($)
  const off = await perfButton(desk)
  expect(off?.props?.dimColor).toBe(true) // dim when off
  const foot = kidsOfLine(await desk.find({ type: 'Box', key: 'band-statusline' }))
  expect(keyOf(foot[foot.length - 1])).toBe('band-perf') // at the line's right end
  await desk.press({ key: 'band-perf' })
  await settle()
  await desk.unmount()
  expect(s.stored.cfg_panel_perf).toBe('on')
  expect(await implementerFace($)).not.toMatch(/@keyframes|animation/)
  const lit = await mountDesktop($)
  const onBtn = await perfButton(lit)
  expect(onBtn?.props?.dimColor).toBeUndefined()
  expect(kidsOfLine(onBtn)[0]?.props?.weight).toBe('bold') // highlighted when on
  await lit.press({ key: 'band-perf' })
  await settle()
  await lit.unmount()
  expect(s.stored.cfg_panel_perf).toBe('off')
  expect(keyframes(await implementerFace($))).toContain('ham')
  expect(s.toasts).toEqual(['Performance mode on — agents still', 'Performance mode off — agents move']) // one toast a press
})

test('the toggle draws the ⚡ alone: its label names it, no "perf" word is drawn', async ($, on) => {
  harness(on, { env: { CREW_CHIEF_UI: 'on' }, surfaces: ['desktop'], branch: 'main' })
  await start($)
  const desk = await mountDesktop($)
  const btn = await desk.find({ type: 'Button', key: 'band-perf' })
  expect(btn?.text).toBe('⚡')
  expect(btn?.props?.label).toBe('⚡')
  expect(await desk.find({ type: 'Text', text: /perf/ })).toBeUndefined()
  await desk.unmount()
})

test('/crew-perf toasts the change once, in the person\'s language; a refused change only answers', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_LANG: 'tr' }, surfaces: ['desktop'] })
  await start($)
  await $.command.run({ command: 'crew-perf', args: '' })
  expect(s.toasts).toEqual(['Performans modu açık — ajanlar duruyor'])
  await $.command.run({ command: 'crew-perf', args: 'off' })
  expect(s.toasts).toEqual(['Performans modu açık — ajanlar duruyor', 'Performans modu kapalı — ajanlar hareketli'])
  await $.command.run({ command: 'crew-perf', args: 'maybe' })
  expect(s.toasts.length).toBe(2)
})

test('Desktop: the compact key sits at the status line\'s end beside the ⚡, small, not in the frame; gone while an agent is on the band', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_COMPACT: 'on' }, surfaces: ['desktop'], branch: 'main', tokens: 500_000 })
  await start($)
  let desk = await mountDesktop($)
  const foot = kidsOfLine(await desk.find({ type: 'Box', key: 'band-statusline' })).map(keyOf)
  expect(foot.slice(-2)).toEqual(['band-compact', 'band-perf'])
  const key = await desk.find({ type: 'Button', key: 'band-compact' })
  expect(key?.props?.plain).toBe(true)
  expect(key?.props?.variant).toBeUndefined()
  expect(key?.text).toBe('⇣ ctx')
  expect((await desk.findAll({ type: 'Button' })).filter((b: any) => keyOf(b) !== 'band-perf').map(keyOf)).toEqual(['band-compact']) // only once
  await desk.unmount()
  for (const status of ['pending', 'running', 'waiting']) {
    s.agents = [{ id: 'a1', type: 'crew-chief:implementer', status, description: 'job' }]
    desk = await mountDesktop($)
    expect(await desk.find({ type: 'Button', key: 'band-compact' })).toBeUndefined()
    await desk.unmount()
  }
  s.agents = [{ id: 'a1', type: 'crew-chief:implementer', status: 'completed', description: 'job' }]
  desk = await mountDesktop($)
  expect(await desk.find({ type: 'Button', key: 'band-compact' })).toBeDefined()
  await desk.unmount()
})

test('a card shows no model until the agent\'s first request names it, then the model and its effort', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on' }, surfaces: ['desktop'] })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:implementer', status: 'running', description: 'a task' })
  let desk = await mountDesktop($)
  expect(await desk.find({ type: 'Text', text: /implementer/ })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: 'starting' })).toBeUndefined()
  expect(await desk.find({ type: 'Text', text: /Haiku/ })).toBeUndefined() // (the status line holds the main loop's Sonnet)
  await desk.unmount()
  await step($, s, 'a1', 'claude-haiku-4-5', 'medium')
  desk = await mountDesktop($)
  expect(await desk.find({ type: 'Text', text: 'Haiku 4.5' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: 'Medium' })).toBeDefined()
  await desk.unmount()
})

test('CREW_CHIEF_PANEL_PERF set: /crew-perf and the toggle say the environment wins and change nothing', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_PANEL_PERF: 'on', CREW_CHIEF_LANG: 'en' }, surfaces: ['desktop'], branch: 'main' })
  await start($)
  const r = await $.command.run({ command: 'crew-perf', args: 'off' })
  expect(JSON.stringify(r)).toContain('CREW_CHIEF_PANEL_PERF=on is set in the environment and wins')
  expect(s.stored.cfg_panel_perf).toBeUndefined()
  const desk = await mountDesktop($)
  expect((await perfButton(desk))?.props?.dimColor).toBeUndefined() // the environment's on is shown
  await desk.press({ key: 'band-perf' })
  await settle()
  await desk.unmount()
  expect(s.stored.cfg_panel_perf).toBeUndefined()
  expect(s.toasts.some((x: string) => x.includes('CREW_CHIEF_PANEL_PERF=on is set in the environment and wins'))).toBe(true)
})

test('the terminal has no performance mode toggle', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_UI: 'on', CREW_CHIEF_UI_STATUSLINE: 'on' }, surfaces: ['terminal', 'desktop'], branch: 'main' })
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:implementer', status: 'running', description: 'a task' })
  await step($, s, 'a1', 'claude-sonnet-5-5', 'medium')
  const term = await mount($)
  expect(await term.find({ type: 'Button', key: 'band-perf' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /perf/ })).toBeUndefined()
  await term.unmount()
})
