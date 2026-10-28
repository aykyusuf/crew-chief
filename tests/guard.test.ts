import { expect, mock, test } from 'claude-code/testing'

// The command guard (hooks/src/guard.js) through the whole mod: config loading, deny, warn, the ssh gate.
// No real ssh, file or network: fs.read and the tools are answered by the hooks below.

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const GUARD_PATH = '/home/t/.claude/crew-chief-guard.json'
const MIN = 60_000

const CONFIG = JSON.stringify({
  enabled: true,
  rules: [{ id: 'mdb-write', level: 'deny', tools: ['Write', 'Edit'], target: 'file_path', pattern: '\\.mdb$', flags: 'i', text: 'write to a branch database' }],
  ssh: { mode: 'gate', prodHosts: ['prod.example.com', '*.db.example.com'], ttlMinutes: 30 },
})

type Opts = {
  env?: Record<string, string>
  file?: string
  agents?: { id: string; type: string }[]
  agentListFails?: boolean
  surfaces?: string[]
  store?: Record<string, unknown>
  writeFails?: boolean
}

function harness(on: any, opts: Opts = {}) {
  const state: any = {
    registered: [] as string[],
    prompts: [] as string[][],
    clock: undefined as any,
    toasts: [] as string[],
    notices: [] as string[],
    ran: [] as string[],
    reads: [] as string[],
    files: {} as Record<string, string>,
    writes: [] as string[],
    store: { ...(opts.store ?? {}) } as Record<string, unknown>,
    logs: [] as string[],
  }
  if (opts.file !== undefined) state.files[GUARD_PATH] = opts.file
  mock.env(on, {
    CREW_CHIEF_SAVER: 'off',
    CREW_CHIEF_COMPACT: 'off',
    CREW_CHIEF_ADVISOR_OFFER: 'off',
    CREW_CHIEF_ROW_MOD: 'off',
    CREW_CHIEF_ROW: 'off', // no jq hint toast in these tests
    HOME: '/home/t',
    ...(opts.env ?? {}),
  })
  state.clock = mock.clock(on, { now: 3_600_000 })
  on('store.get', ($: any, e: any) => ({ value: state.store[e.key] }))
  on('store.set', ($: any, e: any) => {
    state.store[e.key] = e.value
    return { value: undefined }
  })
  on('fs.read', ($: any, e: any) => {
    state.reads.push(e.path)
    if (e.path in state.files) return { value: state.files[e.path] }
    return { deny: 'ENOENT: no such file' }
  })
  on('fs.exists', ($: any, e: any) => ({ value: e.path in state.files }))
  on('fs.write', ($: any, e: any) => {
    state.writes.push(e.path)
    if (opts.writeFails) return { deny: 'EACCES: permission denied' }
    state.files[e.path] = e.text
    return { value: undefined }
  })
  on('agent.list', () => {
    if (opts.agentListFails) throw new Error('agent list unavailable')
    return { value: (opts.agents ?? []).map((a) => ({ ...a, status: 'running', description: '' })) }
  })
  on('session.usage', () => ({ value: { startedAt: 3_000_000, context: { window: 1_000_000, tokens: 1000, percent: 0 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'advisor' }] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notice', ($: any, e: any) => {
    state.notices.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($: any, e: any) => {
    state.logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($: any, e: any) => {
    state.ran.push(String(e.command ?? e.file_path ?? e.tool))
    return { result: 'ok' }
  })
  on('tool.register', ($: any, e: any) => {
    state.registered.push(e.name)
    return { value: undefined }
  })
  on('prompt.submit', ($: any, e: any) => {
    state.prompts.push(e.context ?? [])
    return { text: e.text }
  })
  return state
}

function extra(s: any) {
  s.registered = [] as string[]
  s.prompts = [] as string[][]
  return s
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await settle()
}

const bash = ($: any, command: string, agentId?: string) => $.tool.call(agentId ? { tool: 'Bash', command, agentId } : { tool: 'Bash', command })

const NO_SETUP = { CREW_CHIEF_GUARD_AUTOSETUP: 'off' }

test('no config file and autosetup off: nothing is held, nothing is shown', async ($, on) => {
  const s = harness(on, { env: NO_SETUP })
  await start($)
  expect((await bash($, 'rm -rf /')).deny).toBeUndefined()
  expect((await bash($, 'ssh prod.example.com reboot')).deny).toBeUndefined()
  expect(s.ran).toEqual(['rm -rf /', 'ssh prod.example.com reboot'])
  expect(s.reads).toEqual([GUARD_PATH])
  expect(s.toasts).toEqual([])
  expect(s.notices).toEqual([])
})

test('CREW_CHIEF_GUARD=off wins over an enabled config and never reads it', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_GUARD: 'off' }, file: CONFIG })
  await start($)
  expect((await bash($, 'rm -rf /')).deny).toBeUndefined()
  expect(s.reads).toEqual([])
})

test('CREW_CHIEF_GUARD=on without a file: the built-in rules only', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_GUARD: 'on', ...NO_SETUP } })
  await start($)
  const r = await bash($, 'rm -rf ~')
  expect(r.deny).toContain('crew-chief guard [rm-rf] BLOCKED')
  expect((await bash($, 'ssh prod.example.com reboot')).deny).toBeUndefined() // no ssh gate without a config
  expect(s.ran).toEqual(['ssh prod.example.com reboot'])
  expect(s.toasts.length).toBe(1)
  expect(s.toasts[0]).toContain('crew-chief guard blocked')
})

test('a personal deny rule and a built-in one stop the call; Read/Glob of other files pass', async ($, on) => {
  const s = harness(on, { file: CONFIG })
  await start($)
  const w = await $.tool.call({ tool: 'Write', file_path: '/x/databases/a.MDB', content: 'x' })
  expect(w.deny).toContain('[mdb-write] BLOCKED: write to a branch database')
  const k = await $.tool.call({ tool: 'Read', file_path: '/home/t/.ssh/id_ed25519' })
  expect(k.deny).toContain('[key-read]')
  expect((await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })).deny).toBeUndefined()
  expect(s.ran).toEqual(['/work/README.md'])
  expect(s.toasts.length).toBe(2)
})

test('a warning lets the call run, then adds a notice and context', async ($, on) => {
  const s = harness(on, { file: CONFIG })
  await start($)
  const r = await bash($, 'cat .env')
  expect(r.deny).toBeUndefined()
  expect(r.result).toBe('ok')
  expect(r.context).toEqual([expect.stringContaining('crew-chief guard [env-access] WARNING')])
  expect(s.notices).toEqual(['crew-chief guard warning: access to a .env file'])
  expect(s.ran).toEqual(['cat .env'])
})

test('ssh gate: first contact held once, read-only passes, a risky command held once, the TTL expires', async ($, on) => {
  const s = harness(on, { file: CONFIG })
  await start($)
  const first = await bash($, 'ssh prod.example.com ls /var/log')
  expect(first.deny).toContain('first contact with the production host prod.example.com')
  expect(first.deny).toContain('stopped before it ran (first attempt)')
  expect(s.toasts[0]).toContain('prod.example.com')
  expect((await bash($, 'ssh prod.example.com ls /var/log')).deny).toBeUndefined()
  expect((await bash($, 'ssh prod.example.com "tail -n 20 /var/log/syslog | grep err"')).deny).toBeUndefined()
  const risky = await bash($, 'ssh prod.example.com "systemctl restart nginx"')
  expect(risky.deny).toContain('systemctl is not on the read-only list')
  expect((await bash($, 'ssh prod.example.com "systemctl restart nginx"')).deny).toBeUndefined()
  await s.clock.advance(31 * MIN)
  expect((await bash($, 'ssh prod.example.com "systemctl restart nginx"')).deny).toContain('not on the read-only list')
  expect((await bash($, 'ssh staging.example.com reboot')).deny).toBeUndefined()
  expect(s.ran).toEqual([
    'ssh prod.example.com ls /var/log',
    'ssh prod.example.com "tail -n 20 /var/log/syslog | grep err"',
    'ssh prod.example.com "systemctl restart nginx"',
    'ssh staging.example.com reboot',
  ])
})

test('a read-only agent gets a plain deny every time; its read-only commands pass', async ($, on) => {
  const s = harness(on, { file: CONFIG, agents: [{ id: 'a1', type: 'crew-chief:scanner' }, { id: 'a2', type: 'crew-chief:implementer' }] })
  await start($)
  expect((await bash($, 'ssh prod.example.com uptime', 'a1')).deny).toBeUndefined()
  const d = await bash($, 'ssh prod.example.com "rm -rf /srv/old"', 'a1')
  expect(d.deny).toContain('this agent is read-only')
  expect((await bash($, 'ssh prod.example.com "rm -rf /srv/old"', 'a1')).deny).toContain('cannot be retried')
  // An ordinary subagent makes its own first contact and is told to report when unsure.
  const sub = await bash($, 'ssh x.db.example.com uptime', 'a2')
  expect(sub.deny).toContain('report to the caller')
  expect((await bash($, 'ssh x.db.example.com uptime', 'a2')).deny).toBeUndefined()
  expect(s.ran).toEqual(['ssh prod.example.com uptime', 'ssh x.db.example.com uptime'])
})

test('a failing agent list is treated as an ordinary agent', async ($, on) => {
  harness(on, { file: CONFIG, agentListFails: true })
  await start($)
  expect((await bash($, 'ssh prod.example.com "rm x"', 'a9')).deny).toContain('first contact')
  expect((await bash($, 'ssh prod.example.com "rm x"', 'a9')).deny).toBeUndefined()
})

test('warn mode never holds a call', async ($, on) => {
  const s = harness(on, { file: JSON.stringify({ enabled: true, ssh: { mode: 'warn', prodHosts: ['prod.example.com'] } }) })
  await start($)
  const r = await bash($, 'ssh prod.example.com reboot')
  expect(r.deny).toBeUndefined()
  expect(r.context).toEqual([expect.stringContaining('crew-chief ssh check WARNING: first contact')])
  expect(s.ran).toEqual(['ssh prod.example.com reboot'])
})

test('a new session forgets every contact', async ($, on) => {
  harness(on, { file: CONFIG })
  await start($)
  await bash($, 'ssh prod.example.com ls')
  expect((await bash($, 'ssh prod.example.com ls')).deny).toBeUndefined()
  await $.session.end({ sessionId: 's1', reason: 'clear' })
  await start($)
  expect((await bash($, 'ssh prod.example.com ls')).deny).toContain('first contact')
})

test('invalid JSON: one toast, the guard stays off (fail open)', async ($, on) => {
  const s = harness(on, { file: '{ "enabled": true, ' })
  await start($)
  expect(s.toasts.length).toBe(1)
  expect(s.toasts[0]).toContain('not valid JSON')
  expect((await bash($, 'rm -rf /')).deny).toBeUndefined()
  expect(s.ran).toEqual(['rm -rf /'])
})

test('bad rules are dropped, the good ones still work', async ($, on) => {
  const file = JSON.stringify({
    enabled: true,
    rules: [
      { id: 'broken', level: 'deny', tools: ['Bash'], pattern: '(' },
      { id: 'no-curl', level: 'deny', tools: ['Bash'], pattern: '\\bcurl\\b', text: 'curl is not allowed here' },
    ],
  })
  const s = harness(on, { file })
  await start($)
  expect((await bash($, 'curl https://example.com')).deny).toContain('[no-curl] BLOCKED: curl is not allowed here')
  expect((await bash($, 'echo (')).deny).toBeUndefined()
  expect(s.toasts.length).toBe(1)
})

test('confirm: the first attempt is held with the checklist, the identical retry passes silently, a changed one is new', async ($, on) => {
  const s = harness(on, { file: CONFIG })
  await start($)
  const first = await bash($, 'git reset --hard HEAD~1')
  expect(first.deny).toContain('stopped before it ran (first attempt): git reset --hard [git-reset-hard]')
  expect(first.deny).toContain('verified backup')
  expect(s.toasts.length).toBe(1)
  const again = await bash($, 'git reset --hard HEAD~1')
  expect(again.deny).toBeUndefined()
  expect(again.context).toBeUndefined()
  expect(s.toasts.length).toBe(1)
  expect(s.notices).toEqual([])
  expect((await bash($, 'git reset --hard HEAD~2')).deny).toContain('first attempt')
  await s.clock.advance(361 * MIN)
  expect((await bash($, 'git reset --hard HEAD~1')).deny).toContain('first attempt')
  expect(s.ran).toEqual(['git reset --hard HEAD~1'])
})

test('confirm in a subagent asks it to report when unsure; a read-only agent gets a plain deny', async ($, on) => {
  harness(on, { file: CONFIG, agents: [{ id: 'r1', type: 'crew-chief:reviewer' }, { id: 'a2', type: 'crew-chief:implementer' }] })
  await start($)
  expect((await bash($, 'git reset --hard', 'a2')).deny).toContain('report to the caller')
  expect((await bash($, 'git reset --hard', 'a2')).deny).toBeUndefined()
  expect((await bash($, 'git reset --hard', 'r1')).deny).toContain('this agent is read-only')
  expect((await bash($, 'git reset --hard', 'r1')).deny).toContain('cannot be retried')
})

test('the guard config cannot be written by Claude; reading it passes', async ($, on) => {
  const s = harness(on, { file: CONFIG })
  await start($)
  expect((await $.tool.call({ tool: 'Write', file_path: GUARD_PATH, content: '{}' })).deny).toContain('can only be changed by the user')
  expect((await bash($, 'echo {} > ~/.claude/crew-chief-guard.json')).deny).toContain('[guard-config] BLOCKED')
  expect((await bash($, 'echo {} > ~/.claude/crew-chief-guard.json')).deny).toContain('BLOCKED') // permanent
  expect((await $.tool.call({ tool: 'Read', file_path: GUARD_PATH })).deny).toBeUndefined()
  expect(s.ran).toEqual([GUARD_PATH])
})

test('crew_guard_suggest returns at once, stores, toasts once; /crew-guard prints; the prompt note comes once', async ($, on) => {
  const s = harness(on, { file: CONFIG })
  await start($)
  expect(s.registered).toContain('crew_guard_suggest')
  const tool = 'mcp__crew-chief__crew_guard_suggest'
  const r1 = await $.tool.call({ tool, kind: 'host', value: 'db1.example.com', reason: 'production database' } as any)
  expect(String(r1.result)).toContain('Do not stop to wait')
  await $.tool.call({ tool, kind: 'host', value: 'db1.example.com', reason: 'dup' } as any)
  await $.tool.call({ tool, kind: 'secret', value: 'API_TOKEN=abcdefghijklmnopqrstuvwxyz0123', reason: 'in .env' } as any)
  expect(s.toasts.filter((x: string) => x.includes('/crew-guard')).length).toBe(1)
  const list = await $.command.run({ command: 'crew-guard', args: 'suggestions' })
  expect(list.text).toContain('2 suggestion(s)')
  expect(list.text).toContain('{"ssh":{"prodHosts":["db1.example.com"]}}')
  expect(list.text).not.toContain('abcdefghijklmnop')
  const status = await $.command.run({ command: 'crew-guard', args: '' })
  expect(status.text).toContain('crew-chief guard: on (the config file says enabled: true)')
  expect(status.text).toContain('suggestions from Claude: 2')
  await $.prompt.submit({ text: 'hello' })
  await $.prompt.submit({ text: 'again' })
  const notes = s.prompts.map((c: string[]) => c.filter((x) => x.includes('The command guard is on')).length)
  expect(notes).toEqual([1, 0])
  expect(s.ran).toEqual([])
})

test('guard off: no tool, no note, /crew-guard says why', async ($, on) => {
  const s = harness(on, { env: NO_SETUP })
  await start($)
  expect(s.registered).not.toContain('crew_guard_suggest')
  await $.prompt.submit({ text: 'hello' })
  expect(s.prompts[0].some((x: string) => x.includes('command guard'))).toBe(false)
  expect((await $.command.run({ command: 'crew-guard', args: 'status' })).text).toContain('off (no config file at /home/t/.claude/crew-chief-guard.json)')
})

test('toasts clip the command', async ($, on) => {
  const s = harness(on, { file: CONFIG })
  await start($)
  await bash($, 'ssh prod.example.com "grep ' + 'x'.repeat(300) + ' /var/log/syslog"')
  expect(s.toasts.length).toBe(1)
  expect(s.toasts[0].length).toBeLessThan(200)
  expect(s.toasts[0]).not.toContain('x'.repeat(100))
})

// ---- first run: the default config is written once -------------------------------------------------

const DEFAULT_OBJ = {
  $comment:
    "Written once by crew-chief on first run. Edit freely, or run /crew-guard off. Delete this file and crew-chief will NOT recreate it. Docs: README, 'Command guard'.",
  enabled: true,
  confirmTtlMinutes: 360,
  rules: [],
  disable: [],
  ssh: { mode: 'warn', prodHosts: ['*'], ttlMinutes: 360 },
}
const DEFAULT_TEXT = JSON.stringify(DEFAULT_OBJ, null, 2) + '\n'
const TYPED = { kind: 'composer' }

test('first run: writes the exact default once, toasts once, the guard is live in the same session', async ($, on) => {
  const s = harness(on)
  await start($)
  expect(s.writes).toEqual([GUARD_PATH])
  expect(s.files[GUARD_PATH]).toBe(DEFAULT_TEXT)
  expect(s.store.guard_setup).toBe('done')
  expect(s.toasts).toEqual(['crew-chief: command guard is on (default rules). Status: /crew-guard status. Off: /crew-guard off.'])
  expect(s.registered).toContain('crew_guard_suggest')
  // The default ssh mode is warn: nothing is held, the first contact only carries a warning.
  const first = await bash($, 'ssh prod.example.com ls')
  expect(first.deny).toBeUndefined()
  expect(first.context).toEqual([expect.stringContaining('first contact with the production host prod.example.com')])
  expect((await bash($, 'ssh prod.example.com ls')).context ?? []).toEqual([])
  expect((await bash($, 'ssh localhost uptime')).deny).toBeUndefined()
  expect((await bash($, 'ssh-keygen -t ed25519 -f /tmp/k')).deny).toBeUndefined()
  expect((await bash($, 'ssh-add -l')).deny).toBeUndefined()
  expect((await bash($, 'ssh -V')).deny).toBeUndefined()
  expect((await bash($, 'which ssh')).deny).toBeUndefined()
  expect((await bash($, 'rm -rf ~')).deny).toContain('[rm-rf] BLOCKED')
  await $.prompt.submit({ text: 'hello' })
  const note = s.prompts[0].find((x: string) => x.includes('The command guard is on'))
  expect(note).toContain('defaults crew-chief wrote on first run')
  // A new session reads the file it wrote, writes nothing, toasts nothing.
  await $.session.end({ sessionId: 's1', reason: 'clear' })
  await start($)
  expect(s.writes).toEqual([GUARD_PATH])
  expect(s.toasts.filter((x: string) => x.includes('default rules')).length).toBe(1) // no second first-run toast
  expect((await bash($, 'ssh prod.example.com ls')).context).toEqual([expect.stringContaining('first contact')])
})

test('first run: the owner\'s file is never touched, the marker is still set', async ($, on) => {
  const s = harness(on, { file: CONFIG })
  await start($)
  expect(s.writes).toEqual([])
  expect(s.files[GUARD_PATH]).toBe(CONFIG)
  expect(s.store.guard_setup).toBe('done')
  expect(s.toasts).toEqual([])
})

test('first run: an invalid file is not touched either', async ($, on) => {
  const s = harness(on, { file: '{ broken' })
  await start($)
  expect(s.writes).toEqual([])
  expect(s.store.guard_setup).toBe('done')
})

for (const env of [{ CREW_CHIEF_GUARD_AUTOSETUP: 'off' }, { CREW_CHIEF_GUARD: 'off' }, { CREW_CHIEF_GUARD_AUTOSETUP: ' OFF ' }]) {
  test('first run: ' + JSON.stringify(env) + ' prevents the write', async ($, on) => {
    const s = harness(on, { env })
    await start($)
    expect(s.writes).toEqual([])
    expect(s.store.guard_setup).toBeUndefined()
    expect((await bash($, 'ssh prod.example.com ls')).deny).toBeUndefined()
  })
}

test('first run: no surface (-p, SDK, cloud) writes nothing and sets no marker', async ($, on) => {
  const s = harness(on, { surfaces: [] })
  await start($)
  expect(s.writes).toEqual([])
  expect(s.store.guard_setup).toBeUndefined()
  expect((await bash($, 'rm -rf ~')).deny).toBeUndefined()
})

test('first run: a deleted file is not recreated (marker)', async ($, on) => {
  const s = harness(on, { store: { guard_setup: 'done' } })
  await start($)
  expect(s.writes).toEqual([])
  expect((await bash($, 'rm -rf ~')).deny).toBeUndefined()
})

test('first run: a failed write sets failed, does not throw, the guard stays off, no retry next session', async ($, on) => {
  const s = harness(on, { writeFails: true })
  await start($)
  expect(s.writes).toEqual([GUARD_PATH])
  expect(s.store.guard_setup).toBe('failed')
  expect(s.toasts).toEqual([])
  expect((await bash($, 'rm -rf ~')).deny).toBeUndefined()
  await $.session.end({ sessionId: 's1', reason: 'clear' })
  await start($)
  expect(s.writes).toEqual([GUARD_PATH])
})

// ---- /crew-guard on|off ------------------------------------------------------------------------------

test('/crew-guard off then on: round trip keeps other keys and the $comment, applies at once', async ($, on) => {
  const own = JSON.stringify({ $comment: 'mine', enabled: true, rules: [], ssh: { mode: 'gate', prodHosts: ['prod.example.com'] }, extra: { a: 1 } })
  const s = harness(on, { file: own })
  await start($)
  const off = await $.command.run({ command: 'crew-guard', args: 'off', origin: TYPED } as any)
  expect(off.text).toContain('set "enabled": false in ' + GUARD_PATH)
  expect(off.text).toContain('now off')
  expect(JSON.parse(s.files[GUARD_PATH])).toEqual({ ...JSON.parse(own), enabled: false })
  expect(s.files[GUARD_PATH]).toContain('\n  "enabled": false,')
  expect((await bash($, 'ssh prod.example.com ls')).deny).toBeUndefined()
  const back = await $.command.run({ command: 'crew-guard', args: 'on', origin: TYPED } as any)
  expect(back.text).toContain('now on')
  expect(JSON.parse(s.files[GUARD_PATH])).toEqual(JSON.parse(own))
  expect((await bash($, 'ssh prod.example.com uptime')).deny).toContain('first contact')
  expect((await $.command.run({ command: 'crew-guard', args: 'status' })).text).toContain('on (the config file says enabled: true)')
})

test('/crew-guard on without a file writes the default even with the marker set; off writes enabled false', async ($, on) => {
  const s = harness(on, { store: { guard_setup: 'done' } })
  await start($)
  const r = await $.command.run({ command: 'crew-guard', args: 'on', origin: TYPED } as any)
  expect(r.text).toContain('created ' + GUARD_PATH + ' with the default rules')
  expect(s.files[GUARD_PATH]).toBe(DEFAULT_TEXT)
  expect(s.registered).toContain('crew_guard_suggest')
  expect((await bash($, 'rm -rf ~')).deny).toContain('[rm-rf]')
  delete s.files[GUARD_PATH]
  const o = await $.command.run({ command: 'crew-guard', args: 'off', origin: TYPED } as any)
  expect(o.text).toContain('with "enabled": false')
  expect(JSON.parse(s.files[GUARD_PATH])).toEqual({ $comment: DEFAULT_OBJ.$comment, enabled: false })
  expect((await bash($, 'rm -rf ~')).deny).toBeUndefined()
})

test('/crew-guard on|off refuses a file that is not valid JSON', async ($, on) => {
  const s = harness(on, { file: '{ "enabled": true, ' })
  await start($)
  const r = await $.command.run({ command: 'crew-guard', args: 'off', origin: TYPED } as any)
  expect(r.text).toContain('is not valid JSON, so it was not changed')
  expect(s.files[GUARD_PATH]).toBe('{ "enabled": true, ')
  expect(s.writes).toEqual([])
})

test('/crew-guard on while CREW_CHIEF_GUARD=off writes the file and says the guard stays off', async ($, on) => {
  const s = harness(on, { env: { CREW_CHIEF_GUARD: 'off' } })
  await start($)
  const r = await $.command.run({ command: 'crew-guard', args: 'on', origin: TYPED } as any)
  expect(r.text).toContain('stays off until you unset it')
  expect(s.files[GUARD_PATH]).toBe(DEFAULT_TEXT)
  expect((await bash($, 'rm -rf ~')).deny).toBeUndefined()
})

test('Claude still cannot write the config after the first-run setup', async ($, on) => {
  const s = harness(on)
  await start($)
  expect((await $.tool.call({ tool: 'Write', file_path: GUARD_PATH, content: '{}' })).deny).toContain('can only be changed by the user')
  expect((await bash($, 'echo {} > ~/.claude/crew-chief-guard.json')).deny).toContain('[guard-config] BLOCKED')
  expect(s.files[GUARD_PATH]).toBe(DEFAULT_TEXT)
})

test('/crew-guard on|off from anything but the person (a plugin, the model, the SDK) changes nothing', async ($, on) => {
  const s = harness(on, { file: CONFIG })
  await start($)
  for (const origin of [undefined, { kind: 'sdk' }, { kind: 'plugin', name: 'x' }, { kind: 'peer' }]) {
    const r = await $.command.run({ command: 'crew-guard', args: 'off', ...(origin ? { origin } : {}) } as any)
    expect(r.text).toContain('only you can run it by typing it at the prompt')
  }
  expect(s.writes).toEqual([])
  expect((await bash($, 'rm -rf ~')).deny).toContain('[rm-rf]')
})
