import { expect, mock, test } from 'claude-code/testing'

// The agent-done notices and the /crew-agents pane (hooks/src/agent-view.js).

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const NOW = Date.parse('2026-11-15T10:00:00Z')
const USAGE = { model: 'claude-opus-5-5', input_tokens: 400, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000, output_tokens: 600 }

const TRANSCRIPT: Record<string, unknown> = {
  a1: [
    { role: 'user', text: 'Fix the login bug', toolUses: [] },
    {
      role: 'assistant',
      text: 'Reading the login module.',
      toolUses: [{ tool_use_id: 'u1', tool: 'Read', input: { file_path: '/work/login.js' }, text: 'export function login() {}' }],
    },
  ],
  a2: [
    { role: 'user', text: 'Scan the repo', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'u2', tool: 'Grep', input: { pattern: 'password' }, text: 'src/env.js:3' }] },
  ],
}

function harness(on: any, env: Record<string, string> = {}, notify: 'ok' | 'reject' = 'ok') {
  const s: any = {
    clock: undefined as any,
    agents: [] as { id: string; type: string; status: string; description: string; teammateId?: string }[],
    usages: [] as unknown[],
    toasts: [] as string[],
    notified: [] as any[],
    reads: [] as string[],
    opened: [] as any[],
    closed: [] as string[],
    transcript: { ...TRANSCRIPT } as Record<string, unknown>,
    views: [] as any[],
    viewDeny: undefined as string | undefined,
    sent: [] as any[],
    sendResult: { isDelivered: true } as any,
    surfaces: ['desktop'] as string[],
    store: {} as Record<string, unknown>,
    storeWrites: [] as string[],
  }
  mock.env(on, { CREW_CHIEF_SAVER: 'off', CREW_CHIEF_COMPACT: 'off', CREW_CHIEF_ADVISOR_OFFER: 'off', CREW_CHIEF_GUARD: 'off', CREW_CHIEF_ROW: 'off', CREW_CHIEF_ROW_MOD: 'off', CREW_CHIEF_UI: 'off', ...env })
  s.clock = mock.clock(on, { now: NOW })
  // The store in memory, every write seen (a message sent from the pane must never reach it).
  on('store.get', ($: any, e: any) => ({ value: s.store[e.key] }))
  on('store.set', ($: any, e: any) => {
    s.storeWrites.push(JSON.stringify({ key: e.key, value: e.value }))
    s.store[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(s.store) }))
  on('store.delete', ($: any, e: any) => {
    delete s.store[e.key]
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: NOW - 1000, context: { window: 1_000_000, tokens: 1000, percent: 0 }, rateLimits: [] } }))
  on('session.surfaces', () => ({ value: s.surfaces }))
  on('agent.list', () => ({ value: s.agents }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'advisor' }] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    s.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', ($: any, e: any) => {
    s.notified.push(e)
    return notify === 'ok' ? { value: { isSent: true, channel: 'client' } } : { deny: 'notifications are off' }
  })
  on('session.messages', ($: any, e: any) => {
    s.reads.push(e.agentId)
    const found = s.transcript[e.agentId]
    return { value: found ?? { deny: `agent ${e.agentId} has no saved transcript` } }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('ui.view', ($: any, e: any) => {
    s.views.push({ ...e })
    return { value: s.viewDeny ? { deny: s.viewDeny } : {} }
  })
  on('session.send', ($: any, e: any) => {
    s.sent.push({ to: e.to, text: e.text })
    return s.sendResult
  })
  on('ui.render', ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ children: [Text({ children: ['engine ' + e.component + ' ' + String(e.requestId)] })] })
  })
  on('ui.panes', () => ({ value: s.opened.filter((o: any) => !s.closed.includes(o.id)).map((o: any) => ({ id: o.id, title: o.title ?? o.id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($: any, e: any) => {
    s.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($: any, e: any) => {
    s.closed.push(e.id)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: 'ok' }))
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
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await settle()
}

// An agent the list names makes one request (so the mod knows its name, model and tokens).
async function spawn($: any, s: any, id: string, type: string, extra: Record<string, string> = {}) {
  s.agents.push({ id, type, status: 'running', description: 'x', ...extra })
  s.usages.push(USAGE)
  const stream = $.turn.step({ turnId: 't-' + id, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, agentId: id })
  let piece = await stream.next()
  while (piece.done !== true) piece = await stream.next()
}

const finish = ($: any, id: string, durationMs: number, reason = 'answer', answer = 'Done: fixed it.') =>
  $.turn.complete({ turnId: 't-' + id, answer, durationMs, isAborted: reason === 'aborted', reason, agentId: id })

const run = ($: any, command: string, args = '') => $.command.run({ command, args })
const agentKeys = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.key).filter((k: string) => k.startsWith('agent-'))
const mountView = ($: any, surface = 'desktop') =>
  $.ui.mount({
    plugin: 'crew-chief',
    surface,
    component: 'Pane',
    requestId: 'crew-agent-view',
    props: { title: 'Agents', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    viewport: { columns: 120, rows: 40, isFullscreen: false },
  })

// ---- the notice ----

test('a finished subagent gets one toast and one system notification, after the batch window', async ($, on) => {
  const s = harness(on)
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Read', file_path: '/work/a', agentId: 'a1' })
  await finish($, 'a1', 215_000)
  await settle()
  expect(s.toasts.filter((x: string) => /finished/.test(x))).toEqual([]) // not before the window ends
  await s.clock.advance(1600)
  await settle()
  const done = s.toasts.filter((x: string) => /finished/.test(x))
  expect(done).toHaveLength(1)
  expect(done[0]).toContain('implementer finished: 3:35 · 13k · 3 calls')
  expect(s.notified).toHaveLength(1)
  expect(JSON.stringify(s.notified[0])).toContain('implementer finished: 3:35')
  expect(JSON.stringify(s.notified[0])).toContain('crew-chief')
  // The same run's end heard again is not a second notice.
  await finish($, 'a1', 215_000)
  await s.clock.advance(1600)
  await settle()
  expect(s.toasts.filter((x: string) => /finished/.test(x))).toHaveLength(1)
})

test('short runs, stopped runs, teammates and the engine\'s own forks are not announced; runs ending together share one toast', async ($, on) => {
  const s = harness(on)
  await start($)
  await spawn($, s, 'short', 'scanner')
  await spawn($, s, 'stopped', 'scanner')
  await spawn($, s, 'mate', 'teammate', { teammateId: 'ana@team' })
  await finish($, 'short', 4000)
  await finish($, 'stopped', 60_000, 'aborted')
  await finish($, 'mate', 60_000)
  await finish($, 'fork-of-the-engine', 60_000) // no list ever named it
  await s.clock.advance(1600)
  await settle()
  expect(s.toasts.filter((x: string) => /finished|error/.test(x))).toEqual([])
  expect(s.notified).toEqual([])
  await spawn($, s, 'b1', 'crew-chief:implementer')
  await spawn($, s, 'b2', 'crew-chief:scanner')
  await finish($, 'b1', 120_000)
  await finish($, 'b2', 30_000, 'error')
  await s.clock.advance(1600)
  await settle()
  const done = s.toasts.filter((x: string) => /finished/.test(x))
  expect(done).toEqual(['2 agents finished: implementer 2:00, scanner 0:30 ✗'])
})

test('Turkish notice; notify.native off keeps the toast only', async ($, on) => {
  const s = harness(on, { CREW_CHIEF_LANG: 'tr', CREW_CHIEF_NOTIFY_NATIVE: 'off' })
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await finish($, 'a1', 95_000)
  await s.clock.advance(1600)
  await settle()
  expect(s.toasts).toContain('implementer bitti: 1:35 · 13k')
  expect(s.notified).toEqual([])
})

test('a refused system notification is passed over quietly', async ($, on) => {
  const s = harness(on, {}, 'reject')
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await finish($, 'a1', 95_000)
  await s.clock.advance(1600)
  await settle()
  expect(s.notified).toHaveLength(1)
  expect(s.toasts.filter((x: string) => /finished/.test(x))).toHaveLength(1)
})

test('notify.agent off and notify.native off: nothing at all', async ($, on) => {
  const s = harness(on, { CREW_CHIEF_NOTIFY_AGENT: 'off', CREW_CHIEF_NOTIFY_NATIVE: 'off' })
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await finish($, 'a1', 95_000)
  await s.clock.advance(1600)
  await settle()
  expect(s.toasts.filter((x: string) => /finished/.test(x))).toEqual([])
  expect(s.notified).toEqual([])
})

test('the host\'s own end-of-turn notice is not repeated: a main turn that ends inside the window drops the system notification', async ($, on) => {
  const s = harness(on)
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await finish($, 'a1', 95_000)
  await s.clock.advance(500)
  await $.turn.complete({ turnId: 'main', answer: 'ok', durationMs: 100_000, isAborted: false, reason: 'answer' })
  await s.clock.advance(1600)
  await settle()
  expect(s.toasts.filter((x: string) => /finished/.test(x))).toHaveLength(1)
  expect(s.notified).toEqual([])
})

// ---- the pane ----

test('/crew-agents opens a pane: the agents newest first, the picked one\'s transcript, no reads while drawing', async ($, on) => {
  const s = harness(on)
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await s.clock.advance(5000)
  await spawn($, s, 'a2', 'crew-chief:scanner')
  const said = await run($, 'crew-agents')
  expect(JSON.stringify(said)).toContain('crew-agents: open')
  expect(s.opened.map((o: any) => o.id)).toEqual(['crew-agent-view'])
  expect(s.opened[0].holdToasts).toBeUndefined() // the notices must not wait behind it
  const reads = s.reads.length
  expect(reads).toBe(1)
  const ui = await mountView($)
  expect(s.reads.length).toBe(reads) // drawing reads nothing
  expect(await ui.find({ type: 'Text', text: /^2 running$/ })).toBeDefined() // a count chip
  expect(await ui.find({ type: 'Text', text: /^Running$/ })).toBeDefined() // the group
  expect(await agentKeys(ui)).toEqual(['agent-a2', 'agent-a1'])
  // The newest running agent is picked first: its title, its task, its last steps.
  expect(await ui.find({ type: 'Text', text: /^● running$/ })).toBeDefined() // the title's status
  expect(await ui.find({ type: 'Text', text: /^Last steps$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Grep$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^password$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /src\/env\.js:3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Scan the repo/ })).toBeDefined()
  // A press picks another agent; its transcript is read then, not while drawing.
  await ui.press({ key: 'agent-a1' })
  await settle()
  expect(s.reads).toEqual(['a2', 'a1'])
  // The refresh after the press redraws the mounted pane.
  expect(await ui.find({ type: 'Text', text: /^Read$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/work\/login\.js/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Reading the login module\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Fix the login bug/ })).toBeDefined()
  expect(s.reads).toEqual(['a2', 'a1'])
  await ui.unmount()
})

test('the pane draws and takes presses on the terminal, the Desktop app and VS Code', async ($, on) => {
  const s = harness(on)
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await spawn($, s, 'a2', 'crew-chief:scanner')
  await finish($, 'a2', 30_000) // the agent fork of the engine below is never listed
  await finish($, 'fork-x', 30_000)
  await run($, 'crew-agents')
  for (const surface of ['terminal', 'desktop', 'vscode']) {
    const ui = await mountView($, surface)
    // Running first, then finished.
    expect(await agentKeys(ui)).toEqual(['agent-a1', 'agent-a2'])
    expect(await ui.find({ type: 'Text', text: /^Finished$/ })).toBeDefined()
    await ui.press({ key: 'agent-a1' })
    await settle()
    expect(await ui.find({ type: 'Text', text: /\/work\/login\.js/ })).toBeDefined()
    await ui.press({ key: 'agent-a2' })
    await settle()
    expect(await ui.find({ type: 'Text', text: /^Grep$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\/work\/login\.js/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a finished agent shows its report first; one the session cannot read says so', async ($, on) => {
  const s = harness(on)
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await finish($, 'a1', 95_000, 'answer', 'Fixed the login bug.\nTests pass.')
  s.agents.length = 0
  s.transcript = {} // the saved transcript cannot be read back: deny
  await run($, 'crew-agents')
  const ui = await mountView($)
  expect(await ui.find({ type: 'Text', text: /implementer: its content cannot be read/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Report/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Fixed the login bug\.$/ })).toBeDefined() // a paragraph each, not cut
  expect(await ui.find({ type: 'Text', text: /^Tests pass\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ finished/ })).toBeDefined()
  await ui.unmount()
})

test('the open pane refreshes on the agent\'s events at most once per 1.5 s, the last event never lost', async ($, on) => {
  const s = harness(on)
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await run($, 'crew-agents')
  expect(s.reads).toEqual(['a1'])
  for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Read', file_path: '/work/f' + i, agentId: 'a1' })
  await settle()
  expect(s.reads.length).toBe(1) // inside the window: booked, not read
  await s.clock.advance(1600)
  await settle()
  expect(s.reads.length).toBe(2) // one trailing read for the whole burst
  await s.clock.advance(1600)
  await settle()
  expect(s.reads.length).toBe(2)
})

test('/crew-agents again closes the pane and stops reading; /crew-panel agents still opens the timeline', async ($, on) => {
  const s = harness(on)
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await run($, 'crew-agents')
  const closed = await run($, 'crew-agents')
  expect(JSON.stringify(closed)).toContain('closed')
  expect(s.closed).toContain('crew-agent-view')
  const reads = s.reads.length
  await $.tool.call({ tool: 'Read', file_path: '/work/x', agentId: 'a1' })
  await s.clock.advance(10_000)
  await settle()
  expect(s.reads.length).toBe(reads)
  await run($, 'crew-panel', 'agents')
  expect(s.opened.map((o: any) => o.id)).toContain('crew-agents')
})

// ---- an agent opened in the band (a click on its row, outside the terminal) ----

const BAND = { hasSurvey: false, isWorking: true, isCollapsed: false, maxRows: 30, bodyColumns: 100, scroll: { offset: 0, bodyRows: 29 }, view: {} }
const mountBand = ($: any, over: Record<string, unknown> = {}, surface = 'desktop') =>
  $.ui.mount({ plugin: 'crew-chief', surface, component: 'AbovePrompt', props: { ...BAND, ...over }, viewport: { columns: 120, rows: 40, isFullscreen: false } })
const keysOf = async (ui: any) => (await ui.findAll({ type: 'Button' })).filter((b: any) => b.key !== 'band-perf').map((b: any) => b.key)

test('band: a press on an agent row opens the side pane on that agent; drawing reads nothing', async ($, on) => {
  const s = harness(on, { CREW_CHIEF_UI: 'on' })
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await spawn($, s, 'a2', 'crew-chief:scanner')
  const ui = await mountBand($)
  expect(s.reads).toEqual([])
  expect(await ui.find({ type: 'Svg' })).toBeDefined() // the pictures stay, a short button sits at their end
  expect(await keysOf(ui)).toEqual(['open-a1', 'open-a2'])
  expect((await ui.find({ key: 'open-a1' }))?.text).toContain('inspect')
  await ui.press({ key: 'open-a1' })
  await settle()
  // The side pane opened, on the agent pressed (not the newest), and nothing opened under the row.
  expect(s.opened.map((o: any) => o.id)).toEqual(['crew-agent-view'])
  expect(s.reads).toEqual(['a1'])
  expect(await ui.find({ key: 'full-a1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Read \/work\/login\.js/ })).toBeUndefined()
  const pane = await mountView($)
  expect(await pane.find({ type: 'Text', text: /^Read$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /\/work\/login\.js/ })).toBeDefined()
  // A press on another row while the pane is open switches it; no second pane.
  await ui.press({ key: 'open-a2' })
  await settle()
  expect(s.opened.length).toBe(1)
  expect(s.reads).toEqual(['a1', 'a2'])
  expect(await pane.find({ type: 'Text', text: /^Grep$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /\/work\/login\.js/ })).toBeUndefined()
  await pane.unmount()
  await ui.unmount()
})

test('band: with panel.style text the row itself is the button; the terminal keeps plain rows', async ($, on) => {
  const s = harness(on, { CREW_CHIEF_UI: 'on', CREW_CHIEF_PANEL_STYLE: 'text' })
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  const row = await ui.find({ key: 'open-a1' })
  expect(row?.text).toContain('implementer')
  await ui.press({ key: 'open-a1' })
  await settle()
  expect(s.opened.map((o: any) => o.id)).toEqual(['crew-agent-view'])
  await ui.unmount()
  const term = await mountBand($, {}, 'terminal')
  expect(await term.find({ key: 'open-a1' })).toBeUndefined()
  await term.unmount()
})

test('band: panel.click off leaves the rows as they were', async ($, on) => {
  const s = harness(on, { CREW_CHIEF_UI: 'on', CREW_CHIEF_PANEL_CLICK: 'off' })
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await keysOf(ui)).toEqual([])
  await ui.unmount()
  const said = await run($, 'crew-config')
  expect(JSON.stringify(said)).toContain('panel.click = off [CREW_CHIEF_PANEL_CLICK in the environment wins]')
})

test('pane: one send control, the field\'s own; a message goes on submit, the field empties and says sent; the terminal has no field', async ($, on) => {
  const s = harness(on)
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await run($, 'crew-agents')
  const ui = await mountView($)
  const field = await ui.find({ key: 'pane-msg-a1' })
  expect(field).toBeDefined()
  expect(field?.props?.rows ?? 1).toBe(1) // a normal single-line field
  expect(field?.props?.submitLabel).toBe('Send')
  expect((await keysOf(ui)).filter((k: string) => !k.startsWith('agent-'))).toEqual([]) // no second send button
  expect(await ui.find({ type: 'Text', text: /^Message to implementer$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^implementer sees the message at its next step\.$/ })).toBeDefined()
  expect(field?.props?.placeholder).toBe('Write a message to implementer…')
  expect((await ui.find({ key: 'pane-msg-row-a1' }))?.props?.width).toBe('100%') // the field spans the pane
  expect(await ui.find({ type: 'Text', text: /^Messages$/ })).toBeUndefined() // nothing sent yet
  await ui.input({ key: 'pane-msg-a1', text: 'and the signup form', kind: 'change' })
  await ui.input({ key: 'pane-msg-a1', text: 'and the signup form' })
  await settle()
  expect(s.sent).toEqual([{ to: 'a1', text: 'and the signup form' }])
  expect(await ui.find({ type: 'Text', text: /^Messages$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^and the signup form$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✓ delivered$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^just now$/ })).toBeDefined()
  expect((await ui.find({ key: 'pane-msg-a1' }))?.props?.value).toBe('') // the field emptied
  expect(s.toasts.filter((x: string) => /Sent|sent|delivered/.test(x))).toEqual([]) // said in the pane, not in a toast
  await ui.unmount()
  const term = await mountView($, 'terminal')
  expect(await term.find({ key: 'pane-msg-a1' })).toBeUndefined()
  await term.unmount()
})

test('pane: an empty or too long message is refused on a line under the field, not in a toast', async ($, on) => {
  const s = harness(on, { CREW_CHIEF_LANG: 'tr' })
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await run($, 'crew-agents')
  const ui = await mountView($)
  await ui.input({ key: 'pane-msg-a1', text: '   ' })
  await settle()
  expect(s.sent).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^Önce bir mesaj yaz\.$/ })).toBeDefined()
  await ui.input({ key: 'pane-msg-a1', text: 'x'.repeat(2001) })
  await settle()
  expect(s.sent).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^Çok uzun: en fazla 2000 karakter\.$/ })).toBeDefined()
  expect((await ui.find({ key: 'pane-msg-a1' }))?.props?.value).toBe('x'.repeat(2001)) // what was typed stays
  expect(s.toasts.filter((x: string) => /Gönderilmedi|mesaj/.test(x))).toEqual([])
  await ui.unmount()
})

test('pane: a finished agent is restarted by the field\'s own "Restart and send"; no band question, no toast', async ($, on) => {
  const s = harness(on, { CREW_CHIEF_UI: 'on', CREW_CHIEF_LANG: 'tr' })
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await finish($, 'a1', 30_000)
  await run($, 'crew-agents')
  const band = await mountBand($)
  const ui = await mountView($)
  expect(await ui.find({ type: 'Text', text: /^Gönderince implementer yeniden başlar \(token harcar\)\.$/ })).toBeDefined()
  expect((await ui.find({ key: 'pane-msg-a1' }))?.props?.placeholder).toBe("implementer'a mesaj yaz…")
  expect((await ui.find({ key: 'pane-msg-a1' }))?.props?.submitLabel).toBe('Yeniden başlat ve gönder')
  expect((await keysOf(ui)).filter((k: string) => !k.startsWith('agent-'))).toEqual([])
  const toasts = s.toasts.length
  await ui.input({ key: 'pane-msg-a1', text: 'one more thing' })
  await settle()
  expect(s.sent).toEqual([{ to: 'a1', text: 'one more thing' }])
  expect(await band.find({ key: 'ask-1' })).toBeUndefined()
  expect(await band.find({ key: 'ask-2' })).toBeUndefined()
  expect(s.toasts.length).toBe(toasts)
  expect(await ui.find({ type: 'Text', text: /^✓ iletildi · yeniden başlatıldı$/ })).toBeDefined()
  await ui.unmount()
  await band.unmount()
})

test('pane: a sent message moves from iletildi to okundu and yanıtladı as the transcript shows it; nothing is stored', async ($, on) => {
  const s = harness(on, { CREW_CHIEF_LANG: 'tr' })
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await run($, 'crew-agents')
  const ui = await mountView($)
  const writesBefore = s.storeWrites.length
  await ui.input({ key: 'pane-msg-a1', text: 'and the signup form' })
  await settle()
  expect(await ui.find({ type: 'Text', text: /^Mesajlar$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✓ iletildi$/ })).toBeDefined()
  // The agent's next step holds the message (framed by the host as a peer's): read on the next refresh.
  const transcript = s.transcript.a1 as any[]
  transcript.push({ role: 'user', text: '<peer-message from="crew-chief">and the signup form</peer-message>', toolUses: [] })
  await s.clock.advance(5000)
  await settle()
  expect(await ui.find({ type: 'Text', text: /^✓✓ okundu$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✓ iletildi$/ })).toBeUndefined()
  // Then it writes back: replied, its first line under the bubble.
  transcript.push({ role: 'assistant', text: 'Signup form fixed too.\nDetails follow.', toolUses: [] })
  await s.clock.advance(5000)
  await settle()
  expect(await ui.find({ type: 'Text', text: /^✓✓ yanıtladı$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^yanıt: Signup form fixed too\.$/ })).toBeDefined()
  // The bubble outlives the pane (closed and opened again), but nothing of it is stored.
  await ui.unmount()
  await run($, 'crew-agents')
  await run($, 'crew-agents')
  const again = await mountView($)
  expect(await again.find({ type: 'Text', text: /^and the signup form$/ })).toBeDefined()
  await again.unmount()
  expect(s.storeWrites.slice(writesBefore)).toEqual([]) // no store write from the send to the reopened pane
  expect(JSON.stringify(s.store)).not.toContain('signup form')
})

test('pane: a send that fails shows iletilemedi with the reason in red; the text goes back into the field', async ($, on) => {
  const s = harness(on, { CREW_CHIEF_LANG: 'tr' })
  s.sendResult = { isDelivered: false, reason: 'the recipient is gone' }
  await start($)
  await spawn($, s, 'a1', 'crew-chief:implementer')
  await run($, 'crew-agents')
  const ui = await mountView($)
  await ui.input({ key: 'pane-msg-a1', text: 'one more thing' })
  await settle()
  const failed = await ui.find({ type: 'Text', text: /^✗ iletilemedi: the recipient is gone$/ })
  expect(failed).toBeDefined()
  expect(failed?.props?.color).toBe('error')
  expect((await ui.find({ key: 'pane-msg-a1' }))?.props?.value).toBe('one more thing')
  await ui.unmount()
})

test('pane: steps are said in plain words, never as engine tags, raw exit lines or long paths', async ($, on) => {
  const s = harness(on, { CREW_CHIEF_LANG: 'tr' })
  s.transcript.a1 = [
    { role: 'user', text: 'sleep test', toolUses: [] },
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool_use_id: 'b1', tool: 'Bash', input: { command: 'sleep 300' }, isError: true, text: '<tool_use_error>Blocked: standalone sleep 300. To wait for a condition, use Monitor.</tool_use_error>' },
        { tool_use_id: 'b2', tool: 'Bash', input: { command: 'crew-progress 0' }, isError: true, text: 'Exit code 1\n/bin/sh: crew-progress: command not found' },
        { tool_use_id: 'b3', tool: 'Bash', input: { command: 'sleep 300' }, text: 'Command running in background with ID: bx7. Output is being written to: /private/tmp/a/b/c/tasks/bx7.output' },
      ],
    },
  ]
  await start($)
  await spawn($, s, 'a1', 'crew-chief:scanner')
  await run($, 'crew-agents')
  const ui = await mountView($)
  expect(await ui.find({ type: 'Text', text: /^Son adımlar$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^son araç çağrıları, en yenisi altta$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^engellendi: standalone sleep 300$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^hata \(çıkış 1\): \/bin\/sh: crew-progress: command not found$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^arka planda başladı$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tool_use_error|Exit code|\/private\/tmp/ })).toBeUndefined()
  await ui.unmount()
})
