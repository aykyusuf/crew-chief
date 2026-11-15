import { expect, mock, test } from 'claude-code/testing'

// The guard pane on the Desktop app (hooks/src/crew-panes.js guardTree): cards from the guard's log, a press
// opens one, /crew-guard log opens the pane; the terminal keeps its text lines.

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const NOW = Date.parse('2026-10-29T20:00:00Z')

function harness(on: any, guard = 'on') {
  const s: any = { opened: [] as any[], closed: [] as string[], ran: [] as string[], clock: undefined as any }
  mock.env(on, { CREW_CHIEF_SAVER: 'off', CREW_CHIEF_COMPACT: 'off', CREW_CHIEF_ADVISOR_OFFER: 'off', CREW_CHIEF_GUARD: guard, CREW_CHIEF_GUARD_AUTOSETUP: 'off', CREW_CHIEF_ROW: 'off', CREW_CHIEF_ROW_MOD: 'off', CREW_CHIEF_UI: 'off', CREW_CHIEF_LANG: 'en', HOME: '/home/t' })
  s.clock = mock.clock(on, { now: NOW })
  mock.store(on, {})
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 1000, context: { window: 1_000_000, tokens: 1000, percent: 0 }, rateLimits: [] } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('agent.list', () => ({ value: [] }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'advisor' }] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ deny: 'no such file' }))
  on('fs.list', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notice', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('ui.render', ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ children: [Text({ children: ['engine ' + e.component + ' ' + String(e.requestId)] })] })
  })
  on('ui.panes', () => ({ value: s.opened.filter((o: any) => !s.closed.includes(o.id)).map((o: any) => ({ id: o.id, title: o.title, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($: any, e: any) => {
    s.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($: any, e: any) => {
    s.closed.push(e.id)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($: any, e: any) => {
    s.ran.push(String(e.command ?? e.tool))
    return { result: 'ok' }
  })
  return s
}

async function start($: any) {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await settle()
}

const run = ($: any, command: string, args = '') => $.command.run({ command, args })
const mountPane = ($: any, surface = 'desktop') =>
  $.ui.mount({
    plugin: 'crew-chief',
    surface,
    component: 'Pane',
    requestId: 'crew-guard',
    props: { title: 'Guard', isFocused: false, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 10 }, view: {} },
    viewport: { columns: 105, rows: 40, isFullscreen: false },
  })

test('the Desktop guard pane: the state, counts and a card per entry; a press opens its detail', async ($, on) => {
  const s = harness(on)
  await start($)
  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' })).deny).toContain('BLOCKED')
  expect(s.ran).toEqual([])
  expect(JSON.stringify(await run($, 'crew-panel', 'guard'))).toContain('guard pane open')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: /Command guard/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^on$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^blocked$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /rm -rf on ~/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^rm-rf$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/crew-guard off/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /crew-chief-guard\.json/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /never lets the call through/ })).toBeUndefined()
  const button = await ui.find({ type: 'Button' })
  expect(button).toBeDefined()
  await ui.press({ key: button.key })
  await settle()
  expect(await ui.find({ type: 'Text', text: /never lets the call through/ })).toBeDefined()
  await ui.press({ key: button.key }) // pressed again: closed
  await settle()
  expect(await ui.find({ type: 'Text', text: /never lets the call through/ })).toBeUndefined()
  await ui.unmount()
})

test('the Desktop guard pane with nothing logged says the guard is on; the terminal keeps its text line', async ($, on) => {
  harness(on)
  await start($)
  await run($, 'crew-panel', 'guard')
  const desk = await mountPane($)
  expect(await desk.find({ type: 'Text', text: /The guard is on\. Nothing was stopped/ })).toBeDefined()
  await desk.unmount()
  const term = await mountPane($, 'terminal')
  expect(await term.find({ type: 'Text', text: /nothing stopped or warned yet/ })).toBeDefined()
  await term.unmount()
})

test('the guard off: the pane says so and offers /crew-guard on', async ($, on) => {
  harness(on, 'off')
  await start($)
  await run($, 'crew-panel', 'guard')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: /The guard is off/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/crew-guard on/ })).toBeDefined()
  await ui.unmount()
})

test('/crew-guard log opens the guard pane and closes it again; other /crew-guard words still reach the guard', async ($, on) => {
  const s = harness(on)
  await start($)
  expect(JSON.stringify(await run($, 'crew-guard', 'log'))).toContain('guard pane open')
  expect(s.opened.map((o: any) => o.id)).toEqual(['crew-guard'])
  expect(JSON.stringify(await run($, 'crew-guard', 'log'))).toContain('guard pane closed')
  expect(s.closed).toContain('crew-guard')
  expect(JSON.stringify(await run($, 'crew-guard', 'status'))).not.toContain('crew-panel')
})
