// First-run default config, /crew-guard on|off text helpers, and the loopback / catch-all host rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_COMMENT,
  compileConfig,
  defaultConfigText,
  hostMatches,
  isDefaultConfig,
  isLoopback,
  offConfigText,
  sshAssess,
  toggleConfigText,
} from '../hooks/guard-logic.mjs'

const EXPECTED = {
  $comment: "Written once by crew-chief on first run. Edit freely, or run /crew-guard off. Delete this file and crew-chief will NOT recreate it. Docs: README, 'Command guard'.",
  enabled: true,
  confirmTtlMinutes: 360,
  rules: [],
  disable: [],
  ssh: { mode: 'gate', prodHosts: ['*'], ttlMinutes: 360 },
}

test('the default config is exactly the agreed object, 2-space JSON, and compiles with no problems', () => {
  assert.equal(defaultConfigText(), JSON.stringify(EXPECTED, null, 2) + '\n')
  const c = compileConfig(defaultConfigText())
  assert.equal(c.ok, true)
  assert.deepEqual(c.problems, [])
  assert.equal(c.config.enabled, true)
  assert.equal(c.config.ssh.mode, 'gate')
  assert.equal(c.config.ssh.ttlMs, 360 * 60_000)
  assert.equal(isDefaultConfig(defaultConfigText()), true)
  assert.equal(isDefaultConfig(JSON.stringify(EXPECTED)), true)
  assert.equal(isDefaultConfig(JSON.stringify({ ...EXPECTED, rules: [{ id: 'x' }] })), false)
  assert.equal(isDefaultConfig('{'), false)
})

test('offConfigText is enabled false plus the comment', () => {
  assert.deepEqual(JSON.parse(offConfigText()), { $comment: DEFAULT_COMMENT, enabled: false })
})

test('toggleConfigText keeps every other key and the key order, refuses invalid JSON', () => {
  const own = '{"$comment":"mine","enabled":true,"rules":[{"id":"a"}],"x":{"y":[1,2]}}'
  const off = toggleConfigText(own, false)
  assert.equal(off.ok, true)
  assert.deepEqual(Object.keys(JSON.parse(off.text)), ['$comment', 'enabled', 'rules', 'x'])
  assert.deepEqual(JSON.parse(off.text), { ...JSON.parse(own), enabled: false })
  assert.match(off.text, /^\{\n {2}"\$comment": "mine",\n/)
  assert.deepEqual(JSON.parse(toggleConfigText(off.text, true).text), JSON.parse(own))
  assert.deepEqual(JSON.parse(toggleConfigText('{}', true).text), { enabled: true })
  assert.deepEqual(toggleConfigText('{ "enabled": true, ', true), { ok: false, error: 'not valid JSON' })
  assert.deepEqual(toggleConfigText('[1]', true), { ok: false, error: 'not a JSON object' })
})

test('loopback hosts', () => {
  for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]', 'box.local', 'app.localhost']) assert.equal(isLoopback(h), true, h)
  for (const h of ['prod.example.com', 'local', 'localhost.example.com', '128.0.0.1', '10.0.0.1']) assert.equal(isLoopback(h), false, h)
})

const ssh = (hosts) => compileConfig(JSON.stringify({ enabled: true, ssh: { mode: 'gate', prodHosts: hosts } })).config.ssh

test('the catch-all never matches loopback; an explicit entry does', () => {
  const any = ssh(['*']).prodHosts
  assert.equal(hostMatches(any, undefined, 'prod.example.com'), true)
  for (const h of ['localhost', '127.0.0.1', '::1', 'nas.local']) assert.equal(hostMatches(any, undefined, h), false, h)
  assert.equal(hostMatches(ssh(['u@*']).prodHosts, 'u', 'localhost'), false)
  assert.equal(hostMatches(ssh(['localhost']).prodHosts, undefined, 'localhost'), true)
  assert.equal(hostMatches(ssh(['*.local']).prodHosts, undefined, 'nas.local'), true)
  assert.equal(hostMatches(ssh(['127.0.0.1', '*']).prodHosts, undefined, '127.0.0.1'), true)
})

test('with the default config: no touch for loopback, ssh tools that do not connect, or ssh as a word', () => {
  const def = compileConfig(defaultConfigText()).config.ssh
  for (const cmd of [
    'ssh -V',
    'ssh-keygen -t ed25519 -f ~/.ssh/k',
    'ssh-add -l',
    'ssh-add ~/.ssh/id_ed25519',
    'eval "$(ssh-agent -s)"',
    'ssh-agent bash',
    'which ssh',
    'man ssh',
    'git commit -m "fix ssh notes"',
    'GIT_SSH_COMMAND="ssh -i k" git fetch',
    'ssh localhost uptime',
    'ssh u@127.0.0.1 ls',
    'ssh ::1',
    'ssh box.local',
    'scp a.txt localhost:/tmp/',
  ]) {
    assert.deepEqual(sshAssess(cmd, def), [], cmd)
  }
})

test('with the default config: a real host is a touch, and a named host still found by the fallback', () => {
  const def = compileConfig(defaultConfigText()).config.ssh
  const t = sshAssess('ssh prod.example.com ls', def)
  assert.equal(t.length, 1)
  assert.equal(t[0].host, 'prod.example.com')
  assert.equal(t[0].verdict.kind, 'read')
  assert.equal(sshAssess('ssh $HOST ls', def)[0].verdict.kind, 'unknown') // a variable host stays unknown
  // The fallback scan still finds an explicitly listed host.
  const named = ssh(['db1.example.com'])
  assert.equal(sshAssess('for h in db1.example.com; do ssh "$h" uptime; done', named).some((x) => x.host === 'db1.example.com'), true)
})
