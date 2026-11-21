// Run: node --test tests/stale-scan.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkBrief } from '../scripts/brief-check.mjs'
import { defaultTargets, expandTargets, memorySlug, scanFiles, scanText } from '../scripts/stale-scan.mjs'

const CLI = new URL('../scripts/stale-scan.mjs', import.meta.url).pathname
const FIXTURE = new URL('./fixtures/stale/', import.meta.url).pathname
const rules = (text) => scanText(text).map((h) => h.rule)

test('always-delegate, English and Turkish', () => {
  for (const l of ['Always delegate to a subagent.', 'always use agents for everything', 'Always use a subagent.', 'Her zaman delege et.', 'Her zaman ajan kullan.', 'hep ajan çağır']) {
    assert.deepEqual(rules(l), ['always-delegate'], l)
  }
  assert.deepEqual(rules('Delegate when the work is parallel and self-contained.'), [])
})

test('token-budget, English and Turkish', () => {
  for (const l of ['Keep a token budget of 50k.', 'Budget: 200,000 tokens.', 'bütçe 50k token', 'tokens: 5000']) assert.deepEqual(rules(l), ['token-budget'], l)
  assert.deepEqual(rules('Use at most 3 agents.'), [])
})

test('absolute-never is a warn; a scope word makes the line clean', () => {
  for (const l of ['Never push to main.', 'Asla dosya silme.', 'Hiçbir zaman commit etme.', 'Kesinlikle dokunma.']) {
    const h = scanText(l)
    assert.deepEqual(h.map((x) => x.rule), ['absolute-never'], l)
    assert.equal(h[0].severity, 'warn')
  }
  for (const l of ['Never push unless the user asks.', 'Never delete files, because the caller owns them.', 'Never push without asking.', 'Asla push yapma, önce onay al.', 'Never commit before the tests pass.', 'Never touch X, ask first.']) {
    assert.deepEqual(rules(l), [], l)
  }
  assert.deepEqual(rules('Do not use the task list.'), [])
})

test('the keep marker skips its own line and the line below', () => {
  assert.deepEqual(rules('Never push to main. crew-chief:keep'), [])
  assert.deepEqual(rules('<!-- crew-chief:keep -->\nNever push to main.\nNever push to main.'), ['absolute-never'])
})

test('a hit carries line, rule, text and a fix', () => {
  const h = scanText('ok\nAlways delegate everything.')[0]
  assert.equal(h.line, 2)
  assert.equal(h.rule, 'always-delegate')
  assert.match(h.fix, /self-contained and parallel/)
})

test('memory folder slug replaces / and . with -', () => {
  assert.equal(memorySlug('/Users/yusufayik/Documents/personal-projects/crew-chief'), '-Users-yusufayik-Documents-personal-projects-crew-chief')
  assert.equal(memorySlug('/a/b.c/d'), '-a-b-c-d')
})

test('default scope covers the project, user and memory files, skips what is missing, and never lists STATUS.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'stale-scan-'))
  try {
    const home = join(root, 'home')
    const cwd = join(root, 'my.proj')
    mkdirSync(join(cwd, 'agents'), { recursive: true })
    mkdirSync(join(home, '.claude', 'projects', memorySlug(cwd), 'memory'), { recursive: true })
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true })
    writeFileSync(join(cwd, 'CLAUDE.md'), 'Always delegate.\n')
    writeFileSync(join(cwd, 'STATUS.md'), 'Never push. Always delegate.\n')
    writeFileSync(join(cwd, 'agents', 'a.md'), 'Never do it.\n')
    writeFileSync(join(home, '.claude', 'projects', memorySlug(cwd), 'memory', 'MEMORY.md'), 'budget of 50k tokens\n')
    writeFileSync(join(home, '.claude', 'agents', 'h.md'), 'fine\n')
    const targets = defaultTargets({ cwd, home })
    for (const want of [join(cwd, 'CLAUDE.md'), join(cwd, 'CLAUDE.local.md'), join(home, '.claude', 'CLAUDE.md'), join(cwd, 'agents', 'a.md'), join(home, '.claude', 'agents', 'h.md')]) assert.ok(targets.includes(want), want)
    assert.ok(targets.some((t) => t.endsWith('memory/MEMORY.md')))
    const files = expandTargets([...targets, join(cwd, 'STATUS.md'), join(root, 'does-not-exist')])
    assert.ok(!files.some((f) => f.endsWith('STATUS.md')))
    assert.ok(!files.some((f) => f.endsWith('CLAUDE.local.md')))
    assert.deepEqual(scanFiles(files).map((h) => h.rule).sort(), ['absolute-never', 'always-delegate', 'token-budget'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the CLI on the planted fixture: --strict exits 1 and lists the planted lines; no file is written', () => {
  const file = FIXTURE + 'CLAUDE.md'
  const before = { text: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs }
  const r = spawnSync('node', [CLI, '--strict', FIXTURE], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  for (const l of [2, 3, 4, 5, 6, 7]) assert.match(r.stdout, new RegExp(`CLAUDE.md:${l}: `))
  assert.doesNotMatch(r.stdout, /CLAUDE.md:(8|9):/)
  assert.match(r.stdout, /stale-scan: 6 hits in 1 file/)
  const lenient = spawnSync('node', [CLI, FIXTURE], { encoding: 'utf8' })
  assert.equal(lenient.status, 0)
  const json = JSON.parse(spawnSync('node', [CLI, '--json', FIXTURE], { encoding: 'utf8' }).stdout)
  assert.equal(json.length, 6)
  assert.equal(readFileSync(file, 'utf8'), before.text)
  assert.equal(statSync(file).mtimeMs, before.mtime)
  assert.equal(spawnSync('node', [CLI, '--nope'], { encoding: 'utf8' }).status, 2)
})

test('a missing path is skipped, not an error', () => {
  const r = spawnSync('node', [CLI, '--strict', '/definitely/not/here'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /0 hits in 0 files/)
})

test('the scan and the brief checker agree: a scope limit is clean in one and accepted by the other', () => {
  const limit = 'Use at most 3 agents and at most 12 searches. Stop as soon as it is answered.'
  assert.deepEqual(scanText(limit), [])
  assert.equal(checkBrief(limit + ' Verify independently. Write the result to the reports folder.').ok, true)
  const budget = 'Use a budget of 50k tokens.'
  assert.deepEqual(scanText(budget).map((h) => h.rule), ['token-budget'])
  assert.equal(checkBrief(budget).errors[0].rule, 'token-budget')
})
