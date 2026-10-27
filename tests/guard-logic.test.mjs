// Run: node --test tests/guard-logic.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  BUILTIN_RULES,
  MAX_STATE,
  classify,
  clipText,
  compileConfig,
  configPath,
  gateDecide,
  gateRecord,
  guardOn,
  hostMatches,
  newGateState,
  normaliseCommand,
  parseRemoteCalls,
  remoteVerdict,
  ruleDenyMessage,
  sshAssess,
  sshDenyMessage,
  sshWarnContext,
  tokenize,
} from '../hooks/guard-logic.mjs'

const EXAMPLE = new URL('../docs/examples/crew-chief-guard.example.json', import.meta.url)
const example = compileConfig(readFileSync(EXAMPLE, 'utf8'))
const level = (v) => (v ? v.level : null)

// ---- prod-guard parity -----------------------------------------------------------------------------

// The 55 cases of prod-guard's tests/classify.test.mts. [name, tool, input, level, rule id (optional)]
const PROD_GUARD = [
  ['rm -rf /', 'Bash', 'rm -rf /', 'deny', 'rm-rf'],
  ['rm -rf ~', 'Bash', 'rm -rf ~', 'deny'],
  ['rm -rf $HOME', 'Bash', 'rm -rf "$HOME"', 'deny'],
  ['rm -rf ~/Desktop', 'Bash', 'rm -rf ~/Desktop', 'confirm'],
  ['rm -rf ..', 'Bash', 'rm -rf ../x', 'confirm'],
  ['rm -rf *', 'Bash', 'rm -rf *', 'deny'],
  ['rm -rf .git', 'Bash', 'rm -rf .git', 'confirm'],
  ['rm -rf quoted abs', 'Bash', 'rm -rf "/Users/x/proj/old"', 'confirm'],
  ['rm -rf node_modules', 'Bash', 'rm -rf node_modules', null],
  ['rm -rf build dist', 'Bash', 'rm -rf build dist', null],
  ['rm -rf /tmp/x', 'Bash', 'rm -rf /tmp/x', null],
  ['rm -rf src/old', 'Bash', 'rm -rf src/old', 'warn'],
  ['rm file', 'Bash', 'rm file.txt', null],
  ['DROP TABLE', 'Bash', 'psql -c "DROP TABLE users"', 'confirm', 'sql-destructive'],
  ['truncate', 'Bash', 'mysql -e "truncate table x"', 'confirm'],
  ['force push', 'Bash', 'git push --force origin main', 'confirm', 'git-force-push'],
  ['force push -f', 'Bash', 'git push origin main -f', 'confirm'],
  ['normal push', 'Bash', 'git push origin main', null],
  ['reset hard', 'Bash', 'git reset --hard HEAD~1', 'confirm', 'git-reset-hard'],
  ['mdb rm', 'Bash', 'rm /x/databases/sube1.mdb', 'deny', 'mdb-write-cmd'],
  ['mdb mv', 'Bash', 'mv a.mdb b.mdb', 'deny', 'mdb-write-cmd'],
  ['mdb redirect', 'Bash', 'echo x > /x/databases/a.mdb', 'deny', 'mdb-write-cmd'],
  ['mdb read ls', 'Bash', 'ls /x/databases/', null],
  ['mdb cp', 'Bash', 'cp /x/databases/a.mdb /backup/', 'confirm', 'mdb-copy'],
  ['Write mdb', 'Write', { file_path: '/x/databases/a.mdb' }, 'deny', 'mdb-write'],
  ['Write key', 'Write', { file_path: '/k/lic-2026.key' }, 'confirm', 'lic-key-write'],
  ['Write pub ok', 'Write', { file_path: '/k/lic-2026.pub' }, null],
  ['Read key', 'Read', { file_path: '/k/id_rsa' }, 'confirm', 'key-read'],
  ['Read pem', 'Read', { file_path: '/k/server.pem' }, 'confirm', 'key-read'],
  ['cat key', 'Bash', 'cat /k/lic-2026.key', 'confirm', 'lic-key-access'],
  ['cat pub ok', 'Bash', 'cat /k/lic-2026.pub', null],
  ['Write .env', 'Write', { file_path: '/p/.env' }, 'warn', 'env-write'],
  ['Read .env', 'Read', { file_path: '/p/.env' }, 'warn', 'env-read'],
  ['git add .env', 'Bash', 'git add .env', 'warn', 'env-stage'],
  ['deploy.sh', 'Bash', './deploy/deploy.sh prod', 'confirm', 'prod-deploy'],
  ['bash deploy.sh', 'Bash', 'bash scripts/deploy.sh', 'confirm'],
  ['npm run deploy', 'Bash', 'npm run deploy', 'confirm'],
  ['firebase deploy', 'Bash', 'firebase deploy --only hosting', 'confirm'],
  ['undeployed word ok', 'Bash', 'echo redeployment notes', null],
  ['cat .env', 'Bash', 'cat .env', 'warn', 'env-access'],
  ['ssh psql', 'Bash', 'ssh root@host "psql -c \'select 1\'"', 'confirm', 'ssh-db'],
  ['ssh update', 'Bash', 'ssh u@h "mysql -e \'UPDATE t SET a=1\'"', 'confirm'],
  ['ssh ls', 'Bash', 'ssh u@h ls /var', null],
  ['delete no where', 'Bash', 'psql -c "DELETE FROM t"', 'confirm', 'sql-no-where'],
  ['delete with where', 'Bash', 'psql -c "DELETE FROM t WHERE id=1"', null],
  ['netlify prod', 'Bash', 'netlify deploy --prod', 'confirm'],
  ['vercel prod', 'Bash', 'vercel --prod', 'confirm'],
  ['netlify preview', 'Bash', 'netlify deploy', null],
  ['pm2 restart', 'Bash', 'pm2 restart all', 'confirm', 'service-control'],
  ['docker down', 'Bash', 'docker compose down', 'confirm'],
  ['docker ps', 'Bash', 'docker ps', null],
  ['new branch', 'Bash', 'git checkout -b feature/x', 'confirm', 'git-branch'],
  ['switch -c', 'Bash', 'git switch -c x', 'confirm', 'git-branch'],
  ['checkout existing', 'Bash', 'git checkout main', null],
  ['status', 'Bash', 'git status', null],
]

const inputOf = (tool, x) => (typeof x === 'string' ? { command: x } : x)

test('the example config reproduces every prod-guard case', () => {
  assert.equal(PROD_GUARD.length, 55)
  assert.equal(example.ok, true)
  assert.deepEqual(example.problems, [])
  assert.equal(example.config.rules.length, 7)
  for (const [name, tool, x, want, rule] of PROD_GUARD) {
    const v = classify(tool, inputOf(tool, x), example.config)
    assert.equal(level(v), want, `${name}: level (${v?.rule})`)
    if (rule) assert.equal(v.rule, rule, `${name}: rule`)
  }
})

test('the example config has unique rule ids', () => {
  const ids = example.config.rules.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('without a config only the generic rules apply: the owner-specific ones are gone', () => {
  assert.equal(classify('Bash', { command: 'rm /x/databases/sube1.mdb' }), null)
  assert.equal(classify('Write', { file_path: '/x/databases/a.mdb' }), null)
  assert.equal(classify('Write', { file_path: '/k/lic-2026.key' }), null)
  assert.equal(classify('Bash', { command: 'git checkout -b x' }), null)
  assert.equal(classify('Bash', { command: 'cat /k/lic-2026.key' }), null)
  assert.equal(level(classify('Bash', { command: 'rm -rf /' })), 'deny')
  assert.equal(level(classify('Write', { file_path: '/k/id_ed25519' })), 'confirm')
  assert.equal(level(classify('Write', { file_path: '/k/cert.p12' })), 'confirm')
  assert.equal(level(classify('Read', { file_path: '/k/x.pfx' })), 'confirm')
})

test('more built-in cases', () => {
  const cases = [
    ['Read', { file_path: '/home/u/.ssh/id_rsa.pub' }, null],
    ['Read', { file_path: '/home/u/.ssh/id_ed25519.pub' }, null],
    ['Read', { file_path: '/p/.env.local' }, 'warn'],
    ['Read', { file_path: '/p/env.example' }, null],
    ['Edit', { file_path: '/p/.env.production' }, 'warn'],
    ['NotebookEdit', { notebook_path: '/k/server.pem' }, 'confirm'],
    ['Bash', { command: 'git push --force-with-lease' }, 'confirm'],
    ['Bash', { command: 'git push -u origin feature' }, null],
    ['Bash', { command: 'git reset --soft HEAD~1' }, null],
    ['Bash', { command: 'DROP DATABASE prod' }, 'confirm'],
    ['Bash', { command: 'psql -c "UPDATE users SET admin=true"' }, 'confirm'],
    ['Bash', { command: 'psql -c "UPDATE users SET admin=true WHERE id=3"' }, null],
    ['Bash', { command: 'systemctl restart nginx' }, 'confirm'],
    ['Bash', { command: 'systemctl status nginx' }, null],
    ['Bash', { command: 'fly deploy' }, 'confirm'],
    ['Bash', { command: 'wrangler deploy' }, 'confirm'],
    ['Bash', { command: 'cat ~/.ssh/id_rsa' }, 'confirm'],
    ['Bash', { command: 'rm -rf $HOME/*' }, 'deny'],
    ['Bash', { command: 'rm -rf /tmp/a /etc' }, 'confirm'],
    ['Bash', { command: 'echo hello' }, null],
    ['Glob', { pattern: '**/*.pem' }, null],
    ['Bash', {}, null],
  ]
  for (const [tool, input, want] of cases) assert.equal(level(classify(tool, input)), want, `${tool} ${JSON.stringify(input)}`)
  assert.equal(classify('Bash', null), null)
})

test('a deny beats a warning; at one level the person\'s rule is reported first; disabled rules are skipped', () => {
  const cfg = compileConfig(
    JSON.stringify({
      enabled: true,
      rules: [
        { id: 'no-curl', level: 'warn', tools: ['Bash'], pattern: '\\bcurl\\b', text: 'curl' },
        { id: 'env-mine', level: 'warn', tools: ['Read'], target: 'file_path', pattern: '\\.env', text: 'mine' },
        { id: 'any-tool', level: 'deny', tools: ['*'], target: 'command', pattern: 'shutdown', text: 'no shutdown' },
        { id: 'tmp-ok', level: 'deny', tools: ['Bash'], pattern: 'wipe', unless: 'wipe /tmp/', text: 'wipe' },
      ],
      disable: ['git-reset-hard', 'service-control'],
    }),
  ).config
  assert.equal(classify('Bash', { command: 'curl x && rm -rf /' }, cfg).rule, 'rm-rf')
  assert.equal(classify('Read', { file_path: '/p/.env' }, cfg).rule, 'env-mine')
  assert.equal(classify('Bash', { command: 'git reset --hard' }, cfg), null)
  assert.equal(classify('Bash', { command: 'systemctl stop x' }, cfg), null)
  assert.equal(classify('Bash', { command: 'sudo shutdown now' }, cfg).text, 'no shutdown')
  assert.equal(classify('Bash', { command: 'wipe /tmp/x' }, cfg), null)
  assert.equal(level(classify('Bash', { command: 'wipe /srv' }, cfg)), 'deny')
  assert.equal(classify('Read', { file_path: '/p/notes' }, cfg), null)
})

// ---- config ------------------------------------------------------------------------------------------

test('config validation drops bad rules with a reason and keeps the good ones', () => {
  assert.deepEqual(compileConfig('{nope'), { ok: false, error: 'not valid JSON' })
  assert.equal(compileConfig('[]').ok, false)
  assert.equal(compileConfig('null').ok, false)
  const long = 'a'.repeat(301)
  const r = compileConfig(
    JSON.stringify({
      enabled: true,
      rules: [
        { id: 'ok', level: 'warn', tools: ['Bash'], pattern: 'x' },
        { id: 'bad-re', level: 'warn', tools: ['Bash'], pattern: '(' },
        { id: 'long', level: 'warn', tools: ['Bash'], pattern: long },
        { id: 'lvl', level: 'block', tools: ['Bash'], pattern: 'x' },
        { id: 'no-tools', level: 'warn', tools: [], pattern: 'x' },
        { id: 'tgt', level: 'warn', tools: ['Bash'], target: 'url', pattern: 'x' },
        { id: 'flags', level: 'warn', tools: ['Bash'], pattern: 'x', flags: 'gx' },
        { id: 'bad id!', level: 'warn', tools: ['Bash'], pattern: 'x' },
        { id: 'unless-bad', level: 'warn', tools: ['Bash'], pattern: 'x', unless: '[' },
        'string',
        { id: 'g-stripped', level: 'deny', tools: ['Bash'], pattern: 'zap', flags: 'gi' },
      ],
      disable: ['rm-rf', 'not-a-rule'],
      ssh: { mode: 'gate', prodHosts: ['a.com', 'has space', 7], safeRemote: ['(', 'ok'], ttlMinutes: 0 },
    }),
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.config.rules.map((x) => x.id), ['ok', 'g-stripped'])
  assert.equal(r.problems.length, 14, r.problems.join('\n'))
  assert.ok(r.config.disabled.has('rm-rf'))
  assert.equal(r.config.ssh.mode, 'gate')
  assert.equal(r.config.ssh.prodHosts.length, 1)
  assert.equal(r.config.ssh.safeRemote.length, 1)
  assert.equal(r.config.ssh.ttlMs, 360 * 60_000)
  // The g flag is dropped: the same command matches every time (no lastIndex state).
  const cfg = r.config
  for (let k = 0; k < 3; k++) assert.equal(level(classify('Bash', { command: 'ZAP' }, cfg)), 'deny')
})

test('at most 100 rules are used', () => {
  const rules = Array.from({ length: 120 }, (_, i) => ({ id: 'r' + i, level: 'warn', tools: ['Bash'], pattern: 'x' + i }))
  const r = compileConfig(JSON.stringify({ rules }))
  assert.equal(r.config.rules.length, 100)
  assert.ok(r.problems.some((p) => p.includes('first 100')))
  assert.equal(r.config.enabled, false)
})

test('ssh config defaults and limits', () => {
  const r = compileConfig('{"enabled":true}')
  assert.deepEqual({ ...r.config.ssh }, { mode: 'off', prodHosts: [], safeRemote: [], ttlMs: 360 * 60_000 })
  const s = compileConfig(JSON.stringify({ ssh: { mode: 'warn', ttlMinutes: 5 } })).config.ssh
  assert.equal(s.mode, 'warn')
  assert.equal(s.ttlMs, 5 * 60_000)
  assert.equal(compileConfig(JSON.stringify({ ssh: { mode: 'block' } })).config.ssh.mode, 'off')
  assert.ok(BUILTIN_RULES.includes('ssh-db'))
})

test('CREW_CHIEF_GUARD: off beats everything, on works without a file, auto follows enabled', () => {
  const on = { ok: true, config: { enabled: true } }
  const disabled = { ok: true, config: { enabled: false } }
  const bad = { ok: false, error: 'not valid JSON' }
  const cases = [
    ['off', on, false],
    ['OFF', on, false],
    ['on', undefined, true],
    ['on', disabled, true],
    ['on', bad, false],
    ['auto', on, true],
    ['auto', disabled, false],
    ['auto', undefined, false],
    [undefined, on, true],
    ['', undefined, false],
    ['maybe', on, true],
  ]
  for (const [env, loaded, want] of cases) assert.equal(guardOn(env, loaded), want, `${env} ${JSON.stringify(loaded)}`)
})

test('configPath on macOS, Linux and Windows', () => {
  assert.equal(configPath('/Users/x'), '/Users/x/.claude/crew-chief-guard.json')
  assert.equal(configPath('/home/x/'), '/home/x/.claude/crew-chief-guard.json')
  assert.equal(configPath('C:\\Users\\x'), 'C:\\Users\\x\\.claude\\crew-chief-guard.json')
  assert.equal(configPath(''), undefined)
  assert.equal(configPath(undefined), undefined)
})

// ---- tokenizer and ssh parser -------------------------------------------------------------------------

test('tokenize keeps quoted text whole and marks local expansion', () => {
  const { tokens, flags } = tokenize(`a 'b c' "d $X" e\\ f 2>&1 | g`)
  const words = tokens.filter((t) => t.t === 'word')
  assert.deepEqual(words.map((w) => w.v), ['a', 'b c', 'd $X', 'e f', '1', 'g'])
  assert.equal(words[1].dyn, false)
  assert.equal(words[2].dyn, true)
  assert.deepEqual(flags, { heredoc: false, subst: false, unbalanced: false })
  assert.equal(tokenize('cat <<EOF\nx\nEOF').flags.heredoc, true)
  assert.equal(tokenize('cat <<< "x"').flags.heredoc, false)
  assert.equal(tokenize('diff <(ls a) <(ls b)').flags.subst, true)
  assert.equal(tokenize('echo "unclosed').flags.unbalanced, true)
  assert.equal(tokenize("echo '$(not)'").flags.subst, false)
})

const show = (c) => `${c.tool} ${c.host ?? '?'}${c.unknown ? ' !' : ''}${c.remote !== undefined ? ' => ' + (c.remote ?? '(none)') : ''}`
const parsed = (cmd) => parseRemoteCalls(cmd).map(show)

// [command, the calls it holds: "tool host [!=unknown] [=> remote command]"]
const PARSER = [
  ['ssh prod ls', ['ssh prod => ls']],
  ['ssh user@prod ls -la /var', ['ssh prod => ls -la /var']],
  ['ssh -p 2222 prod uptime', ['ssh prod => uptime']],
  ['ssh -p2222 -i ~/.ssh/k prod df -h', ['ssh prod => df -h']],
  ['ssh -o StrictHostKeyChecking=no prod uptime', ['ssh prod => uptime']],
  ['ssh -o "ProxyCommand nc %h %p" prod ls', ['ssh prod ! => ls']],
  ['ssh -J bastion prod ls', ['ssh prod => ls']],
  ['ssh -o ProxyJump=jump.example.com prod ls', ['ssh prod => ls']],
  ['ssh prod "ls /var; rm -rf /tmp/x"', ['ssh prod => ls /var; rm -rf /tmp/x']],
  ["ssh prod 'tail -n 50 /var/log/syslog | grep error'", ['ssh prod => tail -n 50 /var/log/syslog | grep error']],
  ['ssh prod ls && ssh other uptime', ['ssh prod => ls', 'ssh other => uptime']],
  ['cd /x; ssh prod ls', ['ssh prod => ls']],
  ['sudo ssh prod ls', ['ssh prod => ls']],
  ['sudo -u deploy ssh prod ls', ['ssh prod => ls']],
  ['rtk ssh prod ls', ['ssh prod => ls']],
  ['FOO=1 ssh prod ls', ['ssh prod => ls']],
  ['timeout 10 ssh prod ls', ['ssh prod => ls']],
  ['env -i PATH=/bin ssh prod ls', ['ssh prod => ls']],
  ['ssh prod', ['ssh prod => (none)']],
  ['ssh -t prod', ['ssh prod => (none)']],
  ['ssh -N -L 8080:localhost:80 prod', ['ssh prod => (none)']],
  ['ssh $HOST ls', ['ssh ? !']],
  ['ssh prod "$CMD"', ['ssh prod ! => $CMD']],
  ['ssh prod "rm $(cat list)"', ['ssh prod ! => rm $(cat list)']],
  ['ssh prod <<EOF\nrm -rf /x\nEOF', ['ssh prod ! => (none)']],
  ['ssh prod bash < script.sh', ['ssh prod ! => bash']],
  ["ssh prod 'echo $HOME'", ['ssh prod => echo $HOME']],
  ['ssh -l admin prod ls', ['ssh prod => ls']],
  ['ssh ssh://admin@prod:2222 ls', ['ssh prod => ls']],
  ['ssh -F ./cfg prod ls', ['ssh prod ! => ls']],
  ['scp file.txt prod:/tmp/', ['scp prod']],
  ['scp prod:/var/log/app.log .', ['scp prod']],
  ['scp -P 2222 -r dir user@prod:/srv/', ['scp prod']],
  ['scp -J bastion a prod:/x', ['scp prod']],
  ['scp ./a:b c', []],
  ['rsync -avz -e ssh dist/ prod:/srv/app/', ['rsync prod']],
  ['rsync -avz -e "ssh -p 2222" dist/ deploy@prod:/srv/', ['rsync prod']],
  ['rsync --rsh=ssh prod:/var/log/ ./logs/', ['rsync prod']],
  ['rsync --rsync-path="sudo rsync" a prod:/x', ['rsync prod !']],
  ['rsync -av dist/ /backup/', []],
  ['rsync -av rsync://prod/module/ .', []],
  ['sftp prod', ['sftp prod']],
  ['sftp -P 22 user@prod:/upload', ['sftp prod']],
  ['bash -c "ssh prod rm -rf /x"', ['ssh prod => rm -rf /x']],
  ['for h in a b; do ssh $h uptime; done', ['ssh ? !']],
  ['echo prod | xargs ssh', ['ssh ? !']],
  ['ssh -V', []],
  ['git push origin main', []],
  ['grep ssh notes.txt', []],
  ['ssh prod "systemctl status nginx" 2>&1 | tail -5', ['ssh prod => systemctl status nginx']],
  ["ssh prod ls 'my dir'", ['ssh prod => ls my dir']],
  ['ssh -o User=root prod id', ['ssh prod => id']],
  ['sshpass -p secret ssh prod ls', ['ssh prod => ls']],
  ['ssh prod ls & ssh prod2 ls', ['ssh prod => ls', 'ssh prod2 => ls']],
  ['ssh -vvv prod ls', ['ssh prod => ls']],
  ["ssh prod 'cat <(ls)'", ['ssh prod => cat <(ls)']],
  ['/usr/bin/ssh prod ls', ['ssh prod => ls']],
  ['autossh -M 0 prod ls', ['ssh prod => ls']],
  ['ssh PROD.Example.com ls', ['ssh prod.example.com => ls']],
  ['ssh -- prod ls', ['ssh prod => ls']],
]

test(`ssh parser table (${PARSER.length} commands)`, () => {
  assert.ok(PARSER.length >= 40)
  for (const [cmd, want] of PARSER) assert.deepEqual(parsed(cmd), want, cmd)
})

test('the parser keeps the user, the jump hosts and HostName', () => {
  assert.equal(parseRemoteCalls('ssh -l admin prod ls')[0].user, 'admin')
  assert.equal(parseRemoteCalls('ssh admin@prod ls')[0].user, 'admin')
  assert.equal(parseRemoteCalls('ssh -o User=root prod id')[0].user, 'root')
  assert.deepEqual(parseRemoteCalls('ssh -J me@bastion:22,jump2 prod ls')[0].jumps, ['bastion', 'jump2'])
  assert.deepEqual(parseRemoteCalls('ssh -o HostName=10.0.0.5 alias ls')[0].hostnames, ['10.0.0.5'])
  assert.equal(parseRemoteCalls('scp file.txt prod:/tmp/')[0].upload, true)
  assert.equal(parseRemoteCalls('scp prod:/x .')[0].upload, false)
  assert.equal(parseRemoteCalls('rsync -av -e "ssh -l deploy" a prod:/x')[0].user, 'deploy')
})

// ---- remote commands ------------------------------------------------------------------------------------

test('remote read-only list', () => {
  const read = [
    'ls -la /var',
    'tail -n 100 /var/log/syslog | grep -i error',
    'df -h && free -m && uptime',
    'systemctl status nginx',
    'journalctl -u nginx --since today',
    'docker ps',
    'docker logs app --tail 50',
    'docker compose ps',
    'git -C /srv/app status',
    'git log -5',
    'hostname',
    'hostname -f',
    'whoami',
    'date +%s',
    'date -u',
    'stat /etc/hosts',
    'wc -l /var/log/x',
    'find /var/log -name "*.gz"',
    'sudo tail /var/log/auth.log',
    'ps aux | grep node',
    'du -sh /srv',
    'cat /etc/os-release',
    'ls 2>/dev/null',
    'grep foo x 2>&1',
    'head -5 < /etc/hosts',
  ]
  const risky = [
    'rm -rf /tmp/x',
    'systemctl restart nginx',
    'find /x -delete',
    'find . -exec rm {} ;',
    'journalctl --vacuum-time=1d',
    'docker rm app',
    'docker inspect app',
    'echo x > /etc/hosts',
    'cat .env',
    'cat /srv/app/.env',
    'cat /etc/shadow',
    'cat /srv/keys/server.pem',
    'hostname newname',
    'date -s 2020-01-01',
    'mysql -e "select 1"',
    'ls; reboot',
    'git pull',
    'bash deploy.sh',
    'sudo systemctl stop x',
    'ls | tee /x',
    'ls | xargs rm',
    'grep x y >> out.txt',
  ]
  for (const r of read) assert.equal(remoteVerdict(r).kind, 'read', r)
  for (const r of risky) assert.equal(remoteVerdict(r).kind, 'risky', r)
  for (const r of ['echo $HOME', 'cat $(ls)', 'ls `pwd`', 'cat <<EOF\nx\nEOF', 'ls "unclosed', 'cat <(ls)']) assert.equal(remoteVerdict(r).kind, 'unknown', r)
  assert.match(remoteVerdict(null).why, /interactive/)
  assert.match(remoteVerdict('systemctl restart nginx').why, /systemctl is not on the read-only list/)
})

test('safeRemote patterns are anchored to a whole part of the remote command', () => {
  const ssh = compileConfig(JSON.stringify({ ssh: { safeRemote: ['pm2 (list|status|logs)( .*)?', 'ls'] } })).config.ssh
  assert.equal(remoteVerdict('pm2 list', ssh.safeRemote).kind, 'read')
  assert.equal(remoteVerdict('pm2 logs app --lines 20 | grep err', ssh.safeRemote).kind, 'read')
  assert.equal(remoteVerdict('pm2 restart all', ssh.safeRemote).kind, 'risky')
  assert.equal(remoteVerdict('lsof -i', ssh.safeRemote).kind, 'risky')
  assert.equal(remoteVerdict('false; ls', ssh.safeRemote).kind, 'risky')
})

// ---- the gate -------------------------------------------------------------------------------------------

const SSH = compileConfig(
  JSON.stringify({ enabled: true, ssh: { mode: 'gate', prodHosts: ['prod.example.com', '*.db.example.com', 'deploy@10.0.0.5'], ttlMinutes: 30 } }),
).config.ssh
const MIN = 60_000

function run(state, command, opts = {}) {
  const now = opts.now ?? 0
  const touches = sshAssess(command, SSH)
  const d = gateDecide(state, touches, { mode: opts.mode ?? 'gate', loop: opts.loop, readOnly: opts.readOnly ?? false, now, ttlMs: SSH.ttlMs, command })
  if (d.action !== 'pass') gateRecord(state, d, now)
  return d
}

test('host matching: glob *, user@host, case-insensitive', () => {
  assert.ok(hostMatches(SSH.prodHosts, undefined, 'prod.example.com'))
  assert.ok(hostMatches(SSH.prodHosts, undefined, 'PROD.example.COM'))
  assert.ok(hostMatches(SSH.prodHosts, 'x', 'a.db.example.com'))
  assert.ok(!hostMatches(SSH.prodHosts, undefined, 'db.example.com'))
  assert.ok(hostMatches(SSH.prodHosts, 'deploy', '10.0.0.5'))
  assert.ok(!hostMatches(SSH.prodHosts, 'root', '10.0.0.5'))
  assert.ok(!hostMatches(SSH.prodHosts, undefined, 'staging.example.com'))
  assert.ok(!hostMatches(SSH.prodHosts, undefined, undefined))
})

test('first contact denies once, then read-only commands pass', () => {
  const st = newGateState()
  const d = run(st, 'ssh prod.example.com ls /var')
  assert.equal(d.action, 'deny')
  assert.equal(d.kind, 'first')
  assert.match(sshDenyMessage(d), /first contact with the production host prod\.example\.com/)
  assert.match(sshDenyMessage(d), /5 short lines/)
  assert.equal(run(st, 'ssh prod.example.com ls /var').action, 'pass')
  assert.equal(run(st, 'ssh prod.example.com df -h').action, 'pass')
  assert.equal(run(st, 'ssh staging.example.com rm -rf /').action, 'pass') // not a production host
})

test('a risky command is denied once; the identical retry passes within the TTL; after it, denied again', () => {
  const st = newGateState()
  run(st, 'ssh prod.example.com uptime', { now: 0 })
  const d = run(st, 'ssh prod.example.com "systemctl restart nginx"', { now: MIN })
  assert.equal(d.kind, 'risky')
  assert.match(sshDenyMessage(d), /systemctl is not on the read-only list/)
  assert.equal(run(st, 'ssh  prod.example.com   "systemctl restart nginx" ', { now: 2 * MIN }).action, 'pass') // whitespace does not matter
  assert.equal(run(st, 'ssh prod.example.com "systemctl restart nginx"', { now: 30 * MIN }).action, 'pass')
  assert.equal(run(st, 'ssh prod.example.com "systemctl restart nginx"', { now: 32 * MIN }).kind, 'risky')
  assert.equal(run(st, 'ssh prod.example.com "systemctl restart nginx"', { now: 33 * MIN }).action, 'pass')
  assert.equal(run(st, 'ssh prod.example.com "systemctl restart apache"', { now: 33 * MIN }).kind, 'risky') // a changed command is new
})

test('first contact with a risky command denies once, not twice', () => {
  const st = newGateState()
  assert.equal(run(st, 'ssh prod.example.com "rm -rf /srv/old"').kind, 'first')
  assert.equal(run(st, 'ssh prod.example.com "rm -rf /srv/old"').action, 'pass')
})

test('each agent loop makes its own first contact', () => {
  const st = newGateState()
  run(st, 'ssh prod.example.com ls')
  assert.equal(run(st, 'ssh prod.example.com ls').action, 'pass')
  const d = run(st, 'ssh prod.example.com ls', { loop: 'a1' })
  assert.equal(d.kind, 'first')
  assert.match(sshDenyMessage(d), /report to the caller; do not retry/)
  assert.doesNotMatch(sshDenyMessage({ ...d, loop: 'main' }), /report to the caller/)
})

test('read-only agents: read-only commands pass, anything else is a plain deny every time', () => {
  const st = newGateState()
  assert.equal(run(st, 'ssh prod.example.com ls', { loop: 'r1', readOnly: true }).action, 'pass')
  const d = run(st, 'ssh prod.example.com "rm x"', { loop: 'r1', readOnly: true })
  assert.equal(d.kind, 'readonly')
  assert.match(sshDenyMessage(d), /cannot be retried/)
  assert.equal(run(st, 'ssh prod.example.com "rm x"', { loop: 'r1', readOnly: true }).kind, 'readonly')
  assert.equal(st.contacted.size, 0)
})

test('warn mode never denies; it warns on first contact and on risky commands', () => {
  const st = newGateState()
  const first = run(st, 'ssh prod.example.com ls', { mode: 'warn' })
  assert.deepEqual([first.action, first.kind], ['warn', 'first'])
  assert.match(sshWarnContext(first), /first contact/)
  assert.equal(run(st, 'ssh prod.example.com ls', { mode: 'warn' }).action, 'pass')
  const risky = run(st, 'ssh prod.example.com reboot', { mode: 'warn' })
  assert.deepEqual([risky.action, risky.kind], ['warn', 'risky'])
  assert.equal(run(st, 'ssh prod.example.com reboot', { mode: 'warn' }).action, 'warn')
})

test('off mode and no production hosts: nothing to do', () => {
  const st = newGateState()
  assert.equal(run(st, 'ssh prod.example.com reboot', { mode: 'off' }).action, 'pass')
  assert.deepEqual(sshAssess('ssh prod.example.com reboot', { ...SSH, prodHosts: [] }), [])
  assert.deepEqual(sshAssess('ssh prod.example.com reboot', { ...SSH, mode: 'off' }), [])
})

test('unknown parses are risky: a variable host, a heredoc, a nested ssh', () => {
  const st = newGateState()
  const v = run(st, 'ssh $HOST uptime')
  assert.equal(v.kind, 'risky')
  assert.ok(v.unknown)
  assert.match(sshDenyMessage(v), /could not be fully read/)
  assert.equal(run(st, 'ssh $HOST uptime').action, 'pass')
  run(st, 'ssh prod.example.com ls')
  assert.equal(run(st, 'ssh prod.example.com <<EOF\nls\nEOF').kind, 'risky')
  const nested = sshAssess('ssh staging "ssh prod.example.com rm x"', SSH)
  assert.equal(nested.length, 1)
  assert.equal(nested[0].verdict.kind, 'unknown')
  assert.equal(sshAssess('bash -c "ssh prod.example.com rm x"', SSH)[0].verdict.kind, 'risky')
  assert.equal(sshAssess('scp dump.sql prod.example.com:/tmp/', SSH)[0].verdict.kind, 'risky')
  assert.equal(sshAssess('ssh -J prod.example.com inner ls', SSH).length, 1) // a production jump host counts
  assert.deepEqual(sshAssess('echo prod.example.com', SSH), [])
  // ssh-family words inside paths or other program names are not ssh calls.
  assert.deepEqual(sshAssess('cat ~/.ssh/config | grep prod.example.com', SSH), [])
  assert.deepEqual(sshAssess('ssh-keygen -R prod.example.com', SSH), [])
  assert.deepEqual(sshAssess('ssh-keyscan prod.example.com', SSH), [])
})

test('gate state stays bounded', () => {
  const st = newGateState()
  for (let i = 0; i < MAX_STATE + 50; i++) run(st, `ssh prod.example.com "touch /x${i}"`, { loop: 'l' + i })
  assert.ok(st.contacted.size <= MAX_STATE)
  assert.ok(st.commands.size <= MAX_STATE)
})

test('messages and clipping', () => {
  assert.equal(normaliseCommand('  a \n b  '), 'a b')
  assert.equal(clipText('x'.repeat(200)).length, 80)
  assert.equal(clipText('a\n b'), 'a b')
  assert.match(ruleDenyMessage({ rule: 'rm-rf', text: 'rm -rf on /' }), /^crew-chief guard \[rm-rf\] BLOCKED: rm -rf on \/\. Do not retry/)
})
