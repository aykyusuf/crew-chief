import test from 'node:test'
import assert from 'node:assert/strict'
import { SETTING_KEYS, SETTINGS, checkSettings, formatSetting, parseSetting, resolveSetting, storeText } from '../hooks/config-logic.mjs'
import { compactThresholds } from '../hooks/compact-logic.mjs'

test('every setting has a default that its own parser accepts back', () => {
  for (const key of SETTING_KEYS) {
    const def = SETTINGS[key]
    const again = parseSetting(key, storeText(key, def.def))
    assert.equal(again.ok, true, key)
    assert.deepEqual(again.value, def.def, key)
  }
})

test('parse: tokens, on/off, lists, minutes and whole numbers', () => {
  assert.deepEqual(parseSetting('compact.arm', '300k'), { ok: true, value: 300_000 })
  assert.deepEqual(parseSetting('compact.ask', '1m'), { ok: true, value: 1_000_000 })
  assert.equal(parseSetting('compact.arm', '5').ok, false) // below 10k: a typo
  assert.deepEqual(parseSetting('compact.fallback', 'OFF'), { ok: true, value: 'off' })
  assert.equal(parseSetting('compact.fallback', 'maybe').ok, false)
  assert.deepEqual(parseSetting('saver.five', '80, 95'), { ok: true, value: [80, 95] })
  assert.equal(parseSetting('saver.five', '80,abc').ok, false) // refused, not silently shortened
  assert.equal(parseSetting('saver.five', '101').ok, false)
  assert.deepEqual(parseSetting('ask.timeout', 'off'), { ok: true, value: 0 })
  assert.deepEqual(parseSetting('ask.timeout', '90'), { ok: true, value: 30 }) // clamped like the env variable always was
  assert.equal(parseSetting('ask.timeout', '2.5').ok, false)
  assert.deepEqual(parseSetting('compact.quiet', '30'), { ok: true, value: 30 })
  assert.equal(parseSetting('compact.quiet', '0').ok, false)
  assert.equal(parseSetting('nope', '1').error, 'unknown')
  assert.equal(parseSetting('compact.arm', '').error, 'empty')
})

test('resolve: environment, then saved, then default; a bad value is skipped at its level', () => {
  assert.deepEqual(resolveSetting('compact.arm', '300k', '200k'), { value: 300_000, source: 'env' })
  assert.deepEqual(resolveSetting('compact.arm', undefined, '200k'), { value: 200_000, source: 'saved' })
  assert.deepEqual(resolveSetting('compact.arm', 'junk', '200k'), { value: 200_000, source: 'saved' })
  assert.deepEqual(resolveSetting('compact.arm', 'junk', 'junk'), { value: 250_000, source: 'default' })
  assert.deepEqual(resolveSetting('compact.arm', undefined, ''), { value: 250_000, source: 'default' }) // reset stores ''
  assert.deepEqual(resolveSetting('saver.ask', 'off', undefined), { value: 'off', source: 'env' })
})

test('format reads back what a person typed', () => {
  assert.equal(formatSetting('compact.arm', 300_000), '300k')
  assert.equal(formatSetting('compact.ask', 1_000_000), '1m')
  assert.equal(formatSetting('ask.timeout', 0), 'off')
  assert.equal(formatSetting('saver.five', [70, 80]), '70,80')
})

test('checkSettings warns when asking is not above arming', () => {
  const ok = Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTINGS[k].def]))
  assert.deepEqual(checkSettings(ok), [])
  assert.equal(checkSettings({ ...ok, 'compact.ask': 200_000 }).length, 1)
})

test('percent settings scale the sizes on a small window, and the defaults are unchanged', () => {
  assert.deepEqual(compactThresholds(200_000), { arm: 120_000, ask: 170_000 })
  assert.deepEqual(compactThresholds(200_000, { armFraction: 0.4, askFraction: 0.5 }), { arm: 80_000, ask: 100_000 })
  assert.deepEqual(compactThresholds(1_000_000, { arm: 300_000, ask: 500_000, armFraction: 0.4 }), { arm: 300_000, ask: 500_000 })
  // A size the person set wins on a small window; the percent only scales the defaults.
  assert.deepEqual(compactThresholds(200_000, { arm: 150_000 }), { arm: 150_000, ask: 170_000 })
  assert.deepEqual(compactThresholds(200_000, { arm: 150_000, ask: 190_000 }), { arm: 150_000, ask: 190_000 })
})
