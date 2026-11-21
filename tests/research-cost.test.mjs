// Run: node --test tests/research-cost.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULTS, estimate, fmt, loadConfig, mergeConfig } from '../scripts/research-cost.mjs'

const CLI = new URL('../scripts/research-cost.mjs', import.meta.url).pathname
const DATA = new URL('../data/research-cost.json', import.meta.url).pathname
const cfg = loadConfig(DATA)

test('the shipped constants file is valid and equals the built-in defaults', () => {
  assert.deepEqual(cfg, DEFAULTS)
})

test('full example: 6 groups and 40 claims make 15 agents (6 + 5 + 3 + 1) and up to 4 re-checks', () => {
  const e = estimate({ mode: 'full', groups: 6, claims: 40 }, cfg)
  assert.deepEqual(e.agents, { researcher: 6, verifier: 5, counter: 3, reporter: 1, total: 15, rechecksUpTo: 4, maxTotal: 19 })
  assert.equal(e.tokens.low, 6 * 60000 + 5 * 40000 + 3 * 50000 + 20000)
  assert.equal(e.tokens.high, 6 * 250000 + 5 * 150000 + 3 * 200000 + 60000 + 4 * 100000)
  assert.equal(e.trialFirst, true)
  assert.match(e.formula, /= 15 agents, plus up to 4 re-checks/)
})

test('economic: G researchers plus one verifier, no reporter or counters', () => {
  const e = estimate({ mode: 'economic', groups: 3, claims: 10 }, cfg)
  assert.deepEqual(e.agents, { researcher: 3, verifier: 1, counter: 0, reporter: 0, total: 4, rechecksUpTo: 1, maxTotal: 5 })
  assert.equal(e.trialFirst, false)
  assert.deepEqual(e.warnings, [])
})

test('claims default to groups x claimsPerGroup; counters are capped at 4; verifiers batch per 8', () => {
  assert.equal(estimate({ mode: 'full', groups: 2 }, cfg).claims, 12)
  assert.equal(estimate({ mode: 'full', groups: 8, claims: 17 }, cfg).agents.counter, 4)
  assert.equal(estimate({ mode: 'full', groups: 1, claims: 8 }, cfg).agents.verifier, 1)
  assert.equal(estimate({ mode: 'full', groups: 1, claims: 9 }, cfg).agents.verifier, 2)
  assert.equal(estimate({ mode: 'full', groups: 1, claims: 100 }, cfg).agents.rechecksUpTo, 6)
  assert.equal(estimate({ mode: 'full', groups: 1, claims: 0 }, cfg).agents.rechecksUpTo, 0)
})

test('thresholds: many agents, a high token figure, and an out-of-range group count warn', () => {
  const big = estimate({ mode: 'full', groups: 8, claims: 100 }, cfg)
  assert.ok(big.warnings.some((w) => /agents at most is more than 25/.test(w)))
  assert.ok(big.warnings.some((w) => /above 1\.5M/.test(w)))
  assert.ok(estimate({ mode: 'economic', groups: 4 }, cfg).warnings.some((w) => /more than economic mode takes \(3\)/.test(w)))
  assert.ok(estimate({ mode: 'full', groups: 9 }, cfg).warnings.some((w) => /more than full mode takes \(8\)/.test(w)))
  const small = estimate({ mode: 'economic', groups: 1, claims: 3 }, cfg)
  assert.deepEqual(small.warnings, [])
})

test('a malformed or missing config falls back to the built-in defaults, key by key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-cost-'))
  try {
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ not json')
    assert.deepEqual(loadConfig(bad), DEFAULTS)
    assert.deepEqual(loadConfig(join(dir, 'missing.json')), DEFAULTS)
    const partial = mergeConfig({ roles: { researcher: { low: 'x', high: 5 }, verifier: { low: 1, high: 2 } }, batchSize: -3, warnAgents: 10, recheckShare: 7 })
    assert.deepEqual(partial.roles.researcher, DEFAULTS.roles.researcher)
    assert.deepEqual(partial.roles.verifier, { low: 1, high: 2 })
    assert.equal(partial.batchSize, DEFAULTS.batchSize)
    assert.equal(partial.warnAgents, 10)
    assert.equal(partial.recheckShare, DEFAULTS.recheckShare)
    assert.deepEqual(mergeConfig([1, 2]), DEFAULTS)
    const r = spawnSync('node', [CLI, '--mode', 'full', '--groups', '6', '--claims', '40', '--config', bad, '--json'], { encoding: 'utf8' })
    assert.equal(JSON.parse(r.stdout).agents.total, 15)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--calibrate replaces the researcher range with 0.8x to 1.25x of the measured figure', () => {
  const base = estimate({ mode: 'economic', groups: 2, claims: 0 }, cfg)
  const cal = estimate({ mode: 'economic', groups: 2, claims: 0, calibrate: 100000 }, cfg)
  assert.equal(cal.calibrated, true)
  assert.equal(cal.tokens.low, 2 * 80000 + 40000)
  assert.equal(cal.tokens.high, 2 * 125000 + 150000)
  assert.notEqual(cal.tokens.low, base.tokens.low)
})

test('number formatting', () => {
  assert.equal(fmt(730000), '730k')
  assert.equal(fmt(3300000), '3.3M')
  assert.equal(fmt(1000000), '1M')
  assert.equal(fmt(900), '900')
})

test('the CLI prints 15 agents for the documented example, accepts aliases, and rejects bad arguments', () => {
  const run = (...a) => spawnSync('node', [CLI, ...a], { encoding: 'utf8' })
  const r = run('--mode', 'full', '--groups', '6', '--claims', '40')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /15 agents \(up to 4 re-checks more\), about 730k to 3\.3M tokens/)
  assert.match(run('--mode=tam', '--groups=1').stdout, /full mode, 1 group,/)
  assert.match(run('--mode', 'ekonomik', '--groups', '2').stdout, /economic mode/)
  const j = JSON.parse(run('--mode', 'economic', '--groups', '2', '--json').stdout)
  assert.equal(j.agents.total, 3)
  for (const bad of [[], ['--mode', 'x', '--groups', '1'], ['--mode', 'full'], ['--mode', 'full', '--groups', '0'], ['--mode', 'full', '--groups', 'a'], ['--mode', 'full', '--groups', '1', '--nope']]) {
    const b = run(...bad)
    assert.equal(b.status, 2, bad.join(' '))
    assert.match(b.stderr, /usage:/)
  }
})
