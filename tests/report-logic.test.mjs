// Run: node --test tests/report-logic.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addStep,
  classifyGap,
  fmtTokens,
  fmtUsd,
  newStats,
  nextHint,
  parseHint,
  routingShare,
  shouldWarnCold,
  statsRows,
} from '../hooks/report-logic.mjs'

const MIN = 60_000

test('addStep adds up per role and model; unknown numbers count as zero', () => {
  const stats = newStats()
  addStep(stats, { role: 'main', family: 'sonnet', usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5, output_tokens: 20 }, usd: 0.5 })
  addStep(stats, { role: 'main', family: 'sonnet', usage: { input_tokens: 1, output_tokens: 2 }, usd: -3 })
  addStep(stats, { role: 'subagent', family: 'haiku', usage: null, usd: undefined })
  const rows = statsRows(stats)
  assert.equal(rows.length, 2)
  const main = rows.find((r) => r.role === 'main')
  assert.deepEqual({ ...main }, { role: 'main', family: 'sonnet', requests: 2, input: 11, cacheRead: 100, cacheWrite: 5, output: 22, usd: 0.5 })
  assert.equal(rows.find((r) => r.family === 'haiku').requests, 1)
})

test('routingShare: output tokens by subagents and below the heavy tier', () => {
  const rows = [
    { role: 'main', family: 'opus', output: 100 },
    { role: 'subagent', family: 'haiku', output: 100 },
    { role: 'subagent', family: 'sonnet', output: 200 },
  ]
  assert.deepEqual(routingShare(rows), { total: 400, subagent: 75, cheaper: 75 })
  assert.deepEqual(routingShare([]), { total: 0, subagent: 0, cheaper: 0 })
})

test('formatting', () => {
  assert.equal(fmtTokens(950), '950')
  assert.equal(fmtTokens(12_400), '12k')
  assert.equal(fmtTokens(2_450_000), '2.5M')
  assert.equal(fmtTokens(undefined), '?')
  assert.equal(fmtUsd(0.456), '$0.46')
  assert.equal(fmtUsd(123.4), '$123.4')
  assert.equal(fmtUsd(NaN), '?')
})

test('classifyGap: expired needs a gap of 4+ minutes, a big context, and almost no cache reads', () => {
  assert.equal(classifyGap({ gapMs: 6 * MIN, input: 500, cacheRead: 1000, cacheWrite: 90_000 }), 'expired')
  assert.equal(classifyGap({ gapMs: 6 * MIN, input: 500, cacheRead: 95_000, cacheWrite: 1000 }), 'alive')
  assert.equal(classifyGap({ gapMs: 2 * MIN, input: 500, cacheRead: 1000, cacheWrite: 90_000 }), undefined) // too soon
  assert.equal(classifyGap({ gapMs: 6 * MIN, input: 100, cacheRead: 100, cacheWrite: 900 }), undefined) // too small
  assert.equal(classifyGap({ gapMs: 6 * MIN, input: 20_000, cacheRead: 40_000, cacheWrite: 40_000 }), undefined) // mixed
})

test('nextHint keeps the shortest expiry and the longest survival', () => {
  let h = nextHint({}, 10 * MIN, 'expired')
  h = nextHint(h, 7 * MIN, 'expired')
  h = nextHint(h, 20 * MIN, 'expired')
  h = nextHint(h, 5 * MIN, 'alive')
  h = nextHint(h, 3 * MIN, 'alive')
  assert.deepEqual(h, { expiredMs: 7 * MIN, aliveMs: 5 * MIN })
  assert.deepEqual(nextHint({ expiredMs: 1 }, 99, undefined), { expiredMs: 1 })
})

test('shouldWarnCold: silent until an expiry was seen, quiet for small contexts, and never past a seen survival', () => {
  assert.equal(shouldWarnCold({}, 30 * MIN, 300_000), false)
  assert.equal(shouldWarnCold(undefined, 30 * MIN, 300_000), false)
  assert.equal(shouldWarnCold({ expiredMs: 6 * MIN }, 3 * MIN, 300_000), false) // shorter than any seen expiry
  assert.equal(shouldWarnCold({ expiredMs: 6 * MIN }, 8 * MIN, 300_000), true)
  assert.equal(shouldWarnCold({ expiredMs: 6 * MIN }, 8 * MIN, 50_000), false)
  assert.equal(shouldWarnCold({ expiredMs: 6 * MIN, aliveMs: 40 * MIN }, 30 * MIN, 300_000), false) // a 1h cache was seen alive
  assert.equal(shouldWarnCold({ expiredMs: 6 * MIN, aliveMs: 20 * MIN }, 30 * MIN, 300_000), true)
})

test('parseHint reads what nextHint wrote, and refuses junk', () => {
  assert.deepEqual(parseHint(JSON.stringify({ expiredMs: 360000, aliveMs: 100 })), { expiredMs: 360000, aliveMs: 100 })
  assert.deepEqual(parseHint('not json'), {})
  assert.deepEqual(parseHint(JSON.stringify({ expiredMs: -5, aliveMs: 'x' })), { expiredMs: undefined, aliveMs: undefined })
})
