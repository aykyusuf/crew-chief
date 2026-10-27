// Run: node --test tests/guard-confirm.test.mjs
// The 'confirm' level, the config protection, suggestions and the /crew-guard texts (hooks/guard-logic.mjs).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BUILTIN_RULES,
  CHECKLIST,
  GUARD_NOTE,
  MAX_SUGGESTIONS,
  addSuggestion,
  callKey,
  checklistMessage,
  classify,
  compileConfig,
  guardStatusText,
  isConfigPath,
  isFresh,
  markCommand,
  newGateState,
  suggestionsText,
  writesConfig,
} from '../hooks/guard-logic.mjs'

const lv = (tool, input) => classify(tool, input)?.level ?? null
const bash = (command) => lv('Bash', { command })

test('every built-in rule has the level the owner chose', () => {
  const C = [
    ['guard-config', 'deny', 'Write', { file_path: '/h/.claude/crew-chief-guard.json' }],
    ['rm-rf', 'deny', 'Bash', { command: 'rm -rf ~' }],
    ['rm-rf', 'confirm', 'Bash', { command: 'rm -rf /srv/old' }],
    ['rm-rf', 'warn', 'Bash', { command: 'rm -rf src/old' }],
    ['sql-destructive', 'confirm', 'Bash', { command: 'psql -c "DROP TABLE t"' }],
    ['git-force-push', 'confirm', 'Bash', { command: 'git push --force' }],
    ['git-reset-hard', 'confirm', 'Bash', { command: 'git reset --hard' }],
    ['key-write', 'confirm', 'Edit', { file_path: '/k/a.pem' }],
    ['key-read', 'confirm', 'Read', { file_path: '/k/id_rsa' }],
    ['key-access', 'confirm', 'Bash', { command: 'cat /k/a.pem' }],
    ['env-write', 'warn', 'Write', { file_path: '/p/.env' }],
    ['env-read', 'warn', 'Read', { file_path: '/p/.env' }],
    ['env-stage', 'warn', 'Bash', { command: 'git add .env' }],
    ['env-access', 'warn', 'Bash', { command: 'cat .env' }],
    ['ssh-db', 'confirm', 'Bash', { command: 'ssh h psql' }],
    ['sql-no-where', 'confirm', 'Bash', { command: 'psql -c "DELETE FROM t"' }],
    ['prod-deploy', 'confirm', 'Bash', { command: 'firebase deploy' }],
    ['service-control', 'confirm', 'Bash', { command: 'systemctl disable nginx' }],
  ]
  assert.deepEqual([...new Set(C.map((c) => c[0]))].sort(), [...BUILTIN_RULES].sort())
  for (const [rule, level, tool, input] of C) {
    const v = classify(tool, input)
    assert.deepEqual([v?.rule, v?.level], [rule, level], `${rule} ${JSON.stringify(input)}`)
  }
})

test('a user rule may be confirm; deny beats confirm beats warn', () => {
  const cfg = compileConfig(
    JSON.stringify({
      enabled: true,
      confirmTtlMinutes: 60,
      rules: [
        { id: 'c', level: 'confirm', tools: ['Bash'], pattern: 'migrate' },
        { id: 'w', level: 'warn', tools: ['Bash'], pattern: 'migrate' },
        { id: 'd', level: 'deny', tools: ['Bash'], pattern: 'migrate --prod' },
      ],
    }),
  ).config
  assert.equal(cfg.confirmTtlMs, 60 * 60_000)
  assert.equal(cfg.ssh.ttlMs, 60 * 60_000) // the ssh gate shares it unless ssh.ttlMinutes is set
  assert.equal(classify('Bash', { command: 'npm run migrate' }, cfg).rule, 'c')
  assert.equal(classify('Bash', { command: 'npm run migrate --prod' }, cfg).rule, 'd')
  assert.equal(compileConfig('{"confirmTtlMinutes": 0}').problems.length, 1)
  assert.equal(compileConfig('{}').config.confirmTtlMs, 360 * 60_000)
  assert.equal(compileConfig('{"ssh":{"ttlMinutes":15}}').config.ssh.ttlMs, 15 * 60_000)
})

test('the guard-config rule cannot be disabled', () => {
  const cfg = compileConfig(JSON.stringify({ disable: ['guard-config', 'rm-rf'] })).config
  assert.equal(classify('Write', { file_path: '/h/.claude/crew-chief-guard.json' }, cfg).level, 'deny')
  assert.equal(classify('Bash', { command: 'rm -rf ~' }, cfg), null)
})

test('confirm state: first attempt held, identical retry passes within the TTL, changed command is new, per loop', () => {
  const st = newGateState()
  const ttl = 360 * 60_000
  const k = callKey(undefined, 'Bash', { command: 'git  reset --hard ' })
  assert.equal(k, callKey(undefined, 'Bash', { command: 'git reset --hard' }))
  assert.equal(isFresh(st, k, 0, ttl), false)
  markCommand(st, k, 0)
  assert.equal(isFresh(st, k, ttl, ttl), true)
  assert.equal(isFresh(st, k, ttl + 1, ttl), false)
  assert.equal(isFresh(st, callKey(undefined, 'Bash', { command: 'git reset --hard HEAD~2' }), 1, ttl), false)
  assert.equal(isFresh(st, callKey('a1', 'Bash', { command: 'git reset --hard' }), 1, ttl), false)
  assert.notEqual(callKey(undefined, 'Write', { file_path: '/a' }), callKey(undefined, 'Edit', { file_path: '/a' }))
})

test('the checklist message', () => {
  const m = checklistMessage(['git reset --hard [git-reset-hard]'])
  assert.match(m, /^crew-chief guard: stopped before it ran \(first attempt\): git reset --hard \[git-reset-hard\]\. Do not ask the user and wait/)
  assert.ok(m.includes(CHECKLIST))
  assert.match(m, /verified backup/)
  assert.doesNotMatch(m, /report to the caller/)
  assert.match(checklistMessage(['x'], { loop: 'a1' }), /If you cannot decide, stop and report to the caller; do not retry\./)
  assert.match(checklistMessage(['x'], { unknown: true }), /could not be fully read/)
})

test('config protection: writes are caught, reads pass', () => {
  const blocked = [
    'echo {} > ~/.claude/crew-chief-guard.json',
    'cat new.json >> /Users/x/.claude/crew-chief-guard.json',
    'jq ".enabled=false" a.json | tee ~/.claude/crew-chief-guard.json',
    "sed -i '' 's/true/false/' ~/.claude/crew-chief-guard.json",
    'rm ~/.claude/crew-chief-guard.json',
    'mv ~/.claude/crew-chief-guard.json /tmp/x',
    'cp /tmp/x.json ~/.claude/crew-chief-guard.json',
    "python3 -c \"open('/h/.claude/crew-chief-guard.json','w').write('{}')\"",
    "node -e \"require('fs').writeFileSync(process.env.HOME+'/.claude/crew-chief-guard.json','{}')\"",
    "bash -c 'echo {} > ~/.claude/crew-chief-guard.json'",
    'sudo tee ~/.claude/crew-chief-guard.json < x',
    "perl -pi -e 's/a/b/' ~/.claude/crew-chief-guard.json",
    'dd if=/dev/zero of=/h/.claude/crew-chief-guard.json',
    'truncate -s 0 ~/.claude/crew-chief-guard.json',
  ]
  for (const c of blocked) {
    assert.ok(writesConfig(c), c)
    assert.equal(bash(c), 'deny', c)
  }
  const allowed = [
    'cat ~/.claude/crew-chief-guard.json',
    'jq . ~/.claude/crew-chief-guard.json',
    'cat ~/.claude/crew-chief-guard.json 2>/dev/null | grep enabled',
    'cp ~/.claude/crew-chief-guard.json /tmp/backup.json',
    'cat docs/examples/crew-chief-guard.example.json',
    // Honest gaps: these change the file and still pass (a speed bump, not a boundary).
    'python3 edit_config.py',
    'F=crew-chief-guard; echo {} > ~/.claude/$F.json',
  ]
  for (const c of allowed) assert.equal(writesConfig(c), false, c)
  assert.ok(isConfigPath('C:\\Users\\x\\.claude\\crew-chief-guard.json'))
  assert.ok(!isConfigPath('/x/crew-chief-guard.json.bak'))
  assert.equal(lv('Read', { file_path: '/h/.claude/crew-chief-guard.json' }), null)
})

test('suggestions: stored, deduped, capped, secrets keep only a label, tokens hidden', () => {
  const list = []
  assert.equal(addSuggestion(list, { kind: 'host', value: 'db1.example.com', reason: 'production database' }), 'added')
  assert.equal(addSuggestion(list, { kind: 'host', value: 'DB1.example.com', reason: 'again' }), 'duplicate')
  assert.equal(addSuggestion(list, { kind: 'nope', value: 'x' }), 'invalid')
  assert.equal(addSuggestion(list, { kind: 'path', value: '' }), 'invalid')
  assert.equal(addSuggestion(list, null), 'invalid')
  assert.equal(addSuggestion(list, { kind: 'secret', value: 'STRIPE_KEY=' + ['sk', 'live', 'FAKE0000000000000000'].join('_'), reason: 'in .env' }), 'added')
  assert.equal(list[1].value, 'STRIPE_KEY')
  addSuggestion(list, { kind: 'other', value: 'x', reason: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 seen' })
  assert.doesNotMatch(JSON.stringify(list), /sk_live|ghp_/)
  addSuggestion(list, { kind: 'command', value: 'x'.repeat(500), reason: 'r'.repeat(500) })
  assert.ok(list[3].value.length <= 200 && list[3].reason.length <= 200)
  for (let i = 0; i < 100; i++) addSuggestion(list, { kind: 'path', value: '/p/' + i, reason: 'r' })
  assert.equal(list.length, MAX_SUGGESTIONS)
  assert.equal(addSuggestion(list, { kind: 'path', value: '/p/new', reason: 'r' }), 'full')
})

test('/crew-guard texts: status and paste-ready suggestions', () => {
  const list = []
  addSuggestion(list, { kind: 'host', value: 'db1.example.com', reason: 'production database' })
  addSuggestion(list, { kind: 'path', value: '/srv/app/uploads', reason: 'customer files' })
  addSuggestion(list, { kind: 'command', value: 'npm run migrate', reason: 'changes the schema' })
  addSuggestion(list, { kind: 'other', value: 'cron', reason: 'nightly job' })
  const out = suggestionsText(list)
  assert.match(out, /4 suggestion\(s\)/)
  assert.match(out, /Nothing was written/)
  assert.ok(out.includes('{"ssh":{"prodHosts":["db1.example.com"]}}'))
  assert.ok(out.includes('"level":"confirm","tools":["Bash"],"target":"command","pattern":"npm run migrate"'))
  assert.ok(out.includes('"pattern":"/srv/app/uploads"'))
  assert.match(out, /no snippet/)
  for (const line of out.split('\n').filter((l) => l.startsWith('{'))) JSON.parse(line.replace(/,$/, ''))
  assert.match(suggestionsText([]), /no suggestions/)
  const cfg = compileConfig(JSON.stringify({ enabled: true, rules: [{ id: 'a', level: 'confirm', tools: ['Bash'], pattern: 'x' }], ssh: { mode: 'gate', prodHosts: ['a', 'b'] } })).config
  const s = guardStatusText({ on: true, why: 'the config file says enabled: true', config: cfg, contacted: 1, suggestions: 4 })
  assert.match(s, /guard: on \(the config file says enabled: true\)/)
  assert.match(s, /deny 0, confirm 1, warn 0/)
  assert.match(s, /ssh gate: gate, production host patterns: 2, first contacts made this session: 1/)
  assert.match(s, /360 min/)
  assert.match(guardStatusText({ on: false, why: 'CREW_CHIEF_GUARD=off', config: undefined, contacted: 0, suggestions: 0 }), /off \(CREW_CHIEF_GUARD=off\)/)
  assert.match(GUARD_NOTE, /crew_guard_suggest/)
})
