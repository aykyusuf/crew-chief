// Run: node --test tests/brief-check.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkBrief, findTokenBudget, formatResult } from '../scripts/brief-check.mjs'

const CLI = new URL('../scripts/brief-check.mjs', import.meta.url).pathname

const PARTS = {
  objective: 'Objective: find out which version of the library added streaming support.',
  'stop-rule': 'Stop as soon as it is answered.',
  verification: 'Every claim carries a URL and a verbatim quote so it can be verified independently.',
  'output-path': 'Write the result to the crew-chief reports folder as JSON and return the path.',
  'cost-limit': 'Use at most 12 searches and fetches.',
  'assumption-to-verify': 'Hypothesis: streaming arrived in 2.0. You do not have to confirm it.',
  'sources-guidance': 'Prefer official pages over blogs.',
}
const REQUIRED = ['stop-rule', 'verification', 'output-path', 'cost-limit']
const brief = (omit = []) => Object.entries(PARTS).filter(([k]) => !omit.includes(k)).map(([, v]) => v).join('\n')

test('a complete brief passes, for both kinds', () => {
  for (const kind of ['agent', 'research']) {
    const r = checkBrief(brief(), { kind })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(r.missing, [])
    assert.deepEqual(r.errors, [])
  }
  assert.deepEqual(checkBrief(brief(), { kind: 'research' }).warnings, [])
})

test('each required part removed in turn fails with that name and a suggested sentence', () => {
  for (const part of REQUIRED) {
    const r = checkBrief(brief([part]), { kind: 'agent' })
    assert.equal(r.ok, false, part)
    assert.deepEqual(r.missing.map((m) => m.part), [part])
    assert.ok(r.missing[0].suggestion.length > 20)
    assert.match(formatResult(r), new RegExp('missing: ' + part))
  }
})

test('research parts are only warnings', () => {
  for (const part of ['objective', 'assumption-to-verify', 'sources-guidance']) {
    const r = checkBrief(brief([part]), { kind: 'research' })
    assert.equal(r.ok, true, part)
    assert.deepEqual(r.warnings.map((w) => w.rule), [part])
    assert.deepEqual(checkBrief(brief([part]), { kind: 'agent' }).warnings, [])
  }
})

test('Turkish phrasing is understood', () => {
  const tr = [
    'Amaç: hangi sürümün akış desteği eklediğini bul.',
    'Cevap bulununca dur; yeterliyse daha fazla kaynak arama.',
    'Her iddiayı bağımsız olarak doğrula, URL ve birebir alıntı ver.',
    'Sonucu rapor klasörüne yaz.',
    'En fazla 12 arama yap.',
  ].join('\n')
  const r = checkBrief(tr, { kind: 'agent' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(checkBrief(tr.replace('En fazla 12 arama yap.', ''), { kind: 'agent' }).missing[0].part, 'cost-limit')
})

test('a path counts as an output path; a scope word counts as a cost limit', () => {
  const base = brief(['output-path', 'cost-limit'])
  assert.equal(checkBrief(base + '\nWrite to ${TMPDIR:-/tmp}/crew-chief-reports/g1.json\nRead only one directory.').ok, true)
  assert.equal(checkBrief(base + '\nresult: <runDir>/g1.json\nAt most 3 agents.').ok, true)
  assert.equal(checkBrief(base + '\nresult: <runDir>/g1.json\nthe brief is short').ok, false)
})

test('a token number is an error, in every shape; a count limit is not', () => {
  for (const line of ['token budget of 50k', 'Budget: 200,000 tokens', 'bütçe 50k token', 'Use a 50k-token cap', 'tokens: 5000', 'budget of 50k']) {
    assert.ok(findTokenBudget(line), line)
    const r = checkBrief(brief() + '\n' + line)
    assert.equal(r.ok, false, line)
    assert.equal(r.errors[0].rule, 'token-budget')
    assert.equal(r.errors[0].line, Object.keys(PARTS).length + 1)
  }
  for (const line of ['at most 3 agents', 'budget of 20 agents', 'Use at most 20 searches', 'stop when answered']) assert.equal(findTokenBudget(line), null, line)
})

test('an absolute never without a case is a warning, with a scope word it is clean', () => {
  const r = checkBrief(brief() + '\nNever edit anything.')
  assert.equal(r.ok, true)
  assert.deepEqual(r.warnings.map((w) => w.rule), ['absolute-never'])
  assert.deepEqual(checkBrief(brief() + '\nNever edit files, because the caller owns every change.').warnings, [])
  assert.deepEqual(checkBrief(brief() + '\nAsla push yapma, önce onay al.').warnings, [])
})

test('the CLI: exit codes, stdin, json, bad input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brief-check-'))
  try {
    const good = join(dir, 'good.md')
    const bad = join(dir, 'bad.md')
    writeFileSync(good, brief())
    writeFileSync(bad, brief(['stop-rule', 'cost-limit']))
    const run = (args, input) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', input })
    let r = run([good, '--kind', 'research'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^brief-check: ok/)
    r = run([bad])
    assert.equal(r.status, 1)
    assert.match(r.stdout, /missing: stop-rule, cost-limit/)
    r = run(['-', '--json'], brief(['verification']))
    assert.equal(r.status, 1)
    assert.deepEqual(JSON.parse(r.stdout).missing.map((m) => m.part), ['verification'])
    assert.equal(run([join(dir, 'nope.md')]).status, 2)
    assert.equal(run([good, '--kind', 'x']).status, 2)
    assert.equal(run([good, '--bogus']).status, 2)
    assert.equal(run([]).status, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the crew-research role templates, when they exist, pass as research briefs', () => {
  const dir = new URL('../skills/crew-research/assets/', import.meta.url)
  if (!existsSync(dir)) return
  for (const f of readdirSync(dir).filter((n) => /^brief-.*\.md$/.test(n))) {
    const text = readFileSync(new URL(f, dir), 'utf8').replace(/\{\{[^}]*\}\}|<[A-Za-z_ -]+>/g, 'sample text')
    const r = checkBrief(text, { kind: 'research' })
    assert.equal(r.ok, true, f + ': ' + formatResult(r))
  }
})
