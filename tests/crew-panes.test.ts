import { expect, mock, test } from 'claude-code/testing'

// The panes (hooks/src/crew-panes.js): commands and drawings.

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const NOW = Date.parse('2026-10-29T20:00:00Z')
const TASKS = JSON.stringify({
  tasks: [
    { id: 'GUARD-LIVE-01', title: 'See the command guard work', status: 'in_progress', priority: 1 },
    { id: 'TEST-SAVER-07', title: 'Fix the saver test', status: 'todo', priority: 3 },
  ],
})

function harness(on: any, placed = true) {
  const s: any = {
    clock: undefined as any,
    opened: [] as any[],
    closed: [] as string[],
    agents: [] as { id: string; type: string; status: string; description: string }[],
    usages: [] as unknown[],
    toasts: [] as string[],
  }
  mock.env(on, { CREW_CHIEF_SAVER: 'off', CREW_CHIEF_COMPACT: 'off', CREW_CHIEF_ADVISOR_OFFER: 'off', CREW_CHIEF_GUARD: 'off', CREW_CHIEF_ROW: 'off', CREW_CHIEF_ROW_MOD: 'off', CREW_CHIEF_UI: 'off' })
  s.clock = mock.clock(on, { now: NOW })
  mock.store(on, {})
  on('session.usage', () => ({ value: { startedAt: NOW - 1000, context: { window: 1_000_000, tokens: 1000, percent: 0 }, rateLimits: [] } }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('agent.list', () => ({ value: s.agents }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'advisor' }] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('fs.exists', ($: any, e: any) => ({ value: e.path === '/work/STATUS.md' || e.path === '/work/tasks.json' }))
  on('fs.read', ($: any, e: any) => (e.path === '/work/tasks.json' ? { value: TASKS } : { deny: 'no such file' }))
  on('fs.list', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    s.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('ui.render', ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ children: [Text({ children: ['engine ' + e.component + ' ' + String(e.requestId)] })] })
  })
  on('ui.panes', () => ({ value: s.opened.filter((o: any) => !s.closed.includes(o.id)).map((o: any) => ({ id: o.id, title: o.title ?? o.id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($: any, e: any) => {
    s.opened.push(e)
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'no room' } }
  })
  on('ui.close', ($: any, e: any) => {
    s.closed.push(e.id)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($: any, e: any) {
    const usage = s.usages.shift() ?? null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  return s
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await settle()
}

const run = ($: any, command: string, args = '') => $.command.run({ command, args })
const mountPane = ($: any, requestId: string, surface = 'terminal') =>
  $.ui.mount({
    plugin: 'crew-chief',
    surface,
    component: 'Pane',
    requestId,
    props: { title: requestId, isFocused: false, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 10 }, view: {} },
    viewport: { columns: 105, rows: 40, isFullscreen: false },
  })
// ---- the panes ----

test('/crew-panel tasks opens a pane that lists tasks.json, in progress first', async ($, on) => {
  const s = harness(on)
  await start($)
  expect(JSON.stringify(await run($, 'crew-panel', 'tasks'))).toContain('tasks pane open')
  expect(s.opened.map((o: any) => o.id)).toEqual(['crew-tasks'])
  expect(s.opened[0].focus).toBe(true)
  const ui = await mountPane($, 'crew-tasks')
  expect(await ui.find({ type: 'Text', text: /GUARD-LIVE-01/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /TEST-SAVER-07/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tasks/ })).toBeDefined()
  await ui.unmount()
})

test('/crew-panel agents shows the session\'s subagents with a timeline bar and their status', async ($, on) => {
  const s = harness(on)
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:deep-reader', status: 'running', description: 'x' })
  s.usages.push({ model: 'claude-sonnet-5-5', input_tokens: 400, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000, output_tokens: 600 })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1, agentId: 'a1' })
  let piece = await stream.next()
  while (piece.done !== true) piece = await stream.next()
  await run($, 'crew-panel', 'agents')
  const ui = await mountPane($, 'crew-agents')
  expect(await ui.find({ type: 'Text', text: /deep-reader/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /●●○○○/ })).toBeDefined()
  await ui.unmount()
})

test('/crew-panel guard says so when nothing was stopped; an unknown pane id is left to the engine', async ($, on) => {
  const s = harness(on)
  await start($)
  await run($, 'crew-panel', 'guard')
  expect(s.opened.map((o: any) => o.id)).toEqual(['crew-guard'])
  const guard = await mountPane($, 'crew-guard')
  expect(await guard.find({ type: 'Text', text: /nothing stopped or warned yet/ })).toBeDefined()
  await guard.unmount()
  const other = await mountPane($, 'someone-elses')
  expect(await other.find({ type: 'Text', text: /engine Pane someone-elses/ })).toBeDefined()
  await other.unmount()
})

test('/crew-panel with no or a wrong word lists the panes; close shuts them all', async ($, on) => {
  const s = harness(on)
  await start($)
  expect(JSON.stringify(await run($, 'crew-panel'))).toContain('tasks')
  expect(JSON.stringify(await run($, 'crew-panel', 'nope'))).toContain('agents')
  await run($, 'crew-panel', 'tasks')
  await run($, 'crew-panel', 'close')
  expect(s.closed).toEqual(expect.arrayContaining(['crew-tasks', 'crew-agents', 'crew-guard']))
})

test('a pane that cannot be placed says why', async ($, on) => {
  harness(on, false)
  await start($)
  expect(JSON.stringify(await run($, 'crew-panel', 'tasks'))).toContain('no room')
})

test('the agents pane still names an agent after it has left the list', async ($, on) => {
  const s = harness(on)
  await start($)
  s.agents.push({ id: 'a1', type: 'crew-chief:deep-reader', status: 'running', description: 'x' })
  s.usages.push({ model: 'claude-sonnet-5-5', input_tokens: 400, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000, output_tokens: 600 })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1, agentId: 'a1' })
  let piece = await stream.next()
  while (piece.done !== true) piece = await stream.next()
  s.agents.length = 0 // the agent ended and is no longer listed
  await run($, 'crew-panel', 'agents')
  const ui = await mountPane($, 'crew-agents')
  expect(await ui.find({ type: 'Text', text: /deep-reader/ })).toBeDefined()
  await ui.unmount()
})

test('the same /crew-panel command again closes its pane; close shuts every pane of ours the engine has open', async ($, on) => {
  const s = harness(on)
  await start($)
  await run($, 'crew-panel', 'tasks')
  expect(s.opened.map((o: any) => o.id)).toEqual(['crew-tasks'])
  const again = await run($, 'crew-panel', 'tasks')
  expect(JSON.stringify(again)).toContain('pane closed')
  expect(s.closed).toContain('crew-tasks')
  expect(s.opened.length).toBe(1) // not opened a second time
  await run($, 'crew-panel', 'agents')
  await run($, 'crew-panel', 'guard')
  await run($, 'crew-panel', 'close')
  expect(s.closed).toEqual(expect.arrayContaining(['crew-agents', 'crew-guard']))
})
