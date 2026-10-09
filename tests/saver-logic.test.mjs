// Run: node --test tests/saver-logic.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FIVE_HOUR_DEFAULT,
  SEVEN_DAY_DEFAULT,
  capEffort,
  crossing,
  formatDuration,
  modelTier,
  parseThresholds,
  tokensLabel,
} from '../hooks/saver-logic.mjs'

test('defaults are the agreed thresholds', () => {
  assert.deepEqual(FIVE_HOUR_DEFAULT, [70, 80, 90])
  assert.deepEqual(SEVEN_DAY_DEFAULT, [50, 75, 85, 90])
})

test('parseThresholds', () => {
  assert.deepEqual(parseThresholds('60, 80,95', [1]), [60, 80, 95])
  assert.deepEqual(parseThresholds('90,70,70', [1]), [70, 90])
  assert.deepEqual(parseThresholds(undefined, [70, 80]), [70, 80])
  assert.deepEqual(parseThresholds('', [70, 80]), [70, 80])
  assert.deepEqual(parseThresholds('abc, 0, 101, -5, 1.5', [70]), [70])
  assert.deepEqual(parseThresholds('abc, 40', [70]), [40])
  const fallback = [70]
  parseThresholds(undefined, fallback).push(1)
  assert.deepEqual(fallback, [70], 'the fallback list is copied, not shared')
})

test('crossing asks once for the highest new threshold and marks the lower ones', () => {
  const seen = new Set()
  let c = crossing(65, [70, 80, 90], seen, 'five|x|')
  assert.equal(c.top, undefined)
  assert.deepEqual(c.crossed, [])
  c = crossing(83, [70, 80, 90], seen, 'five|x|')
  assert.equal(c.top, 80)
  assert.deepEqual(c.crossed, ['five|x|70', 'five|x|80'])
  c.crossed.forEach((k) => seen.add(k))
  assert.equal(crossing(85, [70, 80, 90], seen, 'five|x|').top, undefined)
  assert.equal(crossing(90, [70, 80, 90], seen, 'five|x|').top, 90)
  assert.equal(crossing(83, [70, 80, 90], seen, 'five|y|').top, 80, 'a new window (other key) asks again')
})

test('crossing ignores nonsense', () => {
  assert.deepEqual(crossing(undefined, [70], new Set(), 'k'), { top: undefined, crossed: [] })
  assert.deepEqual(crossing(Number.NaN, [70], new Set(), 'k'), { top: undefined, crossed: [] })
  assert.equal(crossing(100, [70], new Set(), 'k').top, 70)
})

test('modelTier', () => {
  for (const m of ['claude-opus-5-5', 'opus', 'Claude-Opus-4-8', 'fable', 'claude-fable-5-1']) assert.equal(modelTier(m), 'heavy', m)
  for (const m of ['claude-sonnet-5-5', 'sonnet', 'sonnet[1m]']) assert.equal(modelTier(m), 'sonnet', m)
  for (const m of ['claude-haiku-5-5', 'haiku', '', undefined, null, 42]) assert.equal(modelTier(m), 'other', String(m))
})

test('capEffort: Opus and Fable stop at medium', () => {
  for (const effort of ['high', 'xhigh', 'max']) {
    const r = capEffort('claude-opus-5-5', effort)
    assert.deepEqual([r.effort, r.capped, r.from, r.tier], ['medium', true, effort, 'heavy'], effort)
  }
  assert.equal(capEffort('opus', 'medium').capped, false)
  assert.equal(capEffort('opus', 'low').capped, false)
  assert.equal(capEffort('claude-fable-5-1', 'xhigh').effort, 'medium')
})

test('capEffort: Sonnet only loses xhigh and max', () => {
  assert.equal(capEffort('claude-sonnet-5-5', 'xhigh').effort, 'high')
  assert.equal(capEffort('claude-sonnet-5-5', 'max').effort, 'high')
  for (const effort of ['low', 'medium', 'high']) assert.equal(capEffort('claude-sonnet-5-5', effort).capped, false, effort)
})

test('capEffort: Haiku, unknown models, and odd efforts are untouched', () => {
  assert.equal(capEffort('claude-haiku-5-5', 'max').capped, false)
  assert.equal(capEffort('some-other-model', 'xhigh').capped, false)
  assert.equal(capEffort('claude-opus-5-5', undefined).capped, false)
  assert.equal(capEffort('claude-opus-5-5', 8000).capped, false)
  assert.equal(capEffort('claude-opus-5-5', 'ultra').capped, false)
  assert.equal(capEffort('claude-opus-5-5', 8000).effort, 8000)
})

test('formatDuration', () => {
  assert.equal(formatDuration(0), '<1m')
  assert.equal(formatDuration(-5), '<1m')
  assert.equal(formatDuration(undefined), '<1m')
  assert.equal(formatDuration(1), '1m')
  assert.equal(formatDuration(90_000), '2m')
  assert.equal(formatDuration(6_300_000), '1h 45m')
  assert.equal(formatDuration(3_600_000), '1h 0m')
  assert.equal(formatDuration(2 * 86_400_000 + 3 * 3_600_000), '2d 3h')
})

test('formatDuration takes other unit letters', () => {
  const tr = { d: 'g', h: 'sa', m: 'dk', lt: '<1dk' }
  assert.equal(formatDuration(6_300_000, tr), '1sa 45dk')
  assert.equal(formatDuration(2 * 86_400_000 + 3 * 3_600_000, tr), '2g 3sa')
  assert.equal(formatDuration(0, tr), '<1dk')
})

test('tokensLabel', () => {
  assert.equal(tokensLabel(999), '999')
  assert.equal(tokensLabel(150_400), '150k')
  assert.equal(tokensLabel(undefined), '?')
})
