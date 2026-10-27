import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ROW_MAX, formatRow, jqMatters, kilo, platformFromOs, rowMode, rowWanted, shortModel, usageTokens } from '../hooks/row-logic.mjs'

test('shortModel follows the shell row rules', () => {
  assert.equal(shortModel('claude-opus-5-5'), 'opus-5.5')
  assert.equal(shortModel('claude-haiku-4-5-20251001'), 'haiku-4.5')
  assert.equal(shortModel('claude-sonnet-5-5[1m]'), 'sonnet-5.5')
  assert.equal(shortModel('claude-fable-5'), 'fable-5')
  assert.equal(shortModel('opus'), 'opus')
  assert.equal(shortModel(undefined), 'starting')
  assert.equal(shortModel(''), 'starting')
  assert.equal(shortModel(null), 'starting')
})

test('kilo cuts like the shell row', () => {
  assert.equal(kilo(950), '950')
  assert.equal(kilo(1000), '1k')
  assert.equal(kilo(41_299), '41.2k')
  assert.equal(kilo(1_259_000), '1.2M')
  assert.equal(kilo(0), '')
  assert.equal(kilo(undefined), '')
  assert.equal(kilo('12'), '')
})

test('usageTokens is the latest request: input + cache + output', () => {
  assert.equal(usageTokens({ input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 }), 100)
  assert.equal(usageTokens({ input_tokens: 5 }), 5)
  assert.equal(usageTokens({}), undefined)
  assert.equal(usageTokens(null), undefined)
})

test('formatRow joins agents, drops the plugin prefix, empty clears', () => {
  const line = formatRow([
    { name: 'crew-chief:scanner', model: 'claude-haiku-5-5', effort: 'low', tokens: 3100 },
    { name: 'implementer', model: 'claude-opus-5-5', effort: 'medium', tokens: 12_000 },
    { name: 'Explore' },
  ])
  assert.equal(line, 'scanner haiku-5.5·low 3.1k | implementer opus-5.5·medium 12k | Explore starting·default')
  assert.equal(formatRow([]), undefined)
  assert.equal(formatRow(undefined), undefined)
})

test('formatRow drops tokens first, then effort, then agents', () => {
  const agents = [
    { name: 'aaaaaaaaaa', model: 'claude-opus-5-5', effort: 'medium', tokens: 12_000 },
    { name: 'bbbbbbbbbb', model: 'claude-sonnet-5-5', effort: 'high', tokens: 4000 },
  ]
  const full = formatRow(agents, 200)
  assert.equal(full, 'aaaaaaaaaa opus-5.5·medium 12k | bbbbbbbbbb sonnet-5.5·high 4k')
  assert.equal(formatRow(agents, full.length - 1), 'aaaaaaaaaa opus-5.5·medium | bbbbbbbbbb sonnet-5.5·high')
  assert.equal(formatRow(agents, 50), 'aaaaaaaaaa opus-5.5 | bbbbbbbbbb sonnet-5.5')
  assert.equal(formatRow(agents, 40), 'aaaaaaaaaa opus-5.5 | +1 more')
})

test('formatRow never passes the limit, "+N more" included', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ name: 'agent-number-' + i, model: 'claude-sonnet-5-5', effort: 'high', tokens: 99_000 }))
  const line = formatRow(many)
  assert.ok(line.length <= ROW_MAX, String(line.length))
  assert.match(line, / \| \+\d+ more$/)
  const tiny = formatRow([{ name: 'x'.repeat(40), model: 'claude-opus-5-5' }, { name: 'y' }], 20)
  assert.ok(tiny.length <= 20, tiny)
  assert.match(tiny, /\+1 more$/)
})

test('formatRow cleans control characters and caps long names', () => {
  const line = formatRow([{ name: 'bad\u001b[31mname', model: 'claude-opus-5-5', effort: 'low' }])
  assert.ok(!line.includes('\u001b'))
  const long = formatRow([{ name: 'n'.repeat(60), model: 'claude-opus-5-5', effort: 'low' }])
  assert.ok(long.startsWith('n'.repeat(31) + '… '))
})

test('rowMode and platformFromOs', () => {
  assert.equal(rowMode(undefined), 'auto')
  assert.equal(rowMode(' OFF '), 'off')
  assert.equal(rowMode('on'), 'on')
  assert.equal(rowMode('maybe'), 'auto')
  assert.equal(platformFromOs('Windows_NT'), 'win32')
  assert.equal(platformFromOs(undefined), 'other')
})

test('rowWanted: auto mode', () => {
  const base = { mode: undefined, platform: 'other', hasJq: true }
  assert.equal(rowWanted({ ...base, surfaces: ['vscode'] }), true)
  assert.equal(rowWanted({ ...base, surfaces: ['desktop'] }), true)
  assert.equal(rowWanted({ ...base, surfaces: ['terminal', 'mobile'] }), true)
  assert.equal(rowWanted({ ...base, surfaces: ['terminal'] }), false)
  assert.equal(rowWanted({ ...base, surfaces: ['terminal'], hasJq: false }), true)
  assert.equal(rowWanted({ ...base, surfaces: ['terminal'], platform: 'win32' }), true)
  assert.equal(rowWanted({ ...base, surfaces: [] }), false)
  assert.equal(rowWanted({ ...base, surfaces: undefined }), false)
})

test('rowWanted: on and off', () => {
  assert.equal(rowWanted({ mode: 'off', surfaces: ['vscode'], platform: 'win32', hasJq: false }), false)
  assert.equal(rowWanted({ mode: 'on', surfaces: ['terminal'], platform: 'other', hasJq: true }), true)
  assert.equal(rowWanted({ mode: 'on', surfaces: [], platform: 'other', hasJq: true }), false)
})

test('jqMatters only for auto on a plain terminal outside Windows', () => {
  assert.equal(jqMatters({ mode: 'auto', surfaces: ['terminal'], platform: 'other' }), true)
  assert.equal(jqMatters({ mode: undefined, surfaces: ['terminal'], platform: 'other' }), true)
  assert.equal(jqMatters({ mode: 'auto', surfaces: ['terminal'], platform: 'win32' }), false)
  assert.equal(jqMatters({ mode: 'auto', surfaces: ['vscode'], platform: 'other' }), false)
  assert.equal(jqMatters({ mode: 'on', surfaces: ['terminal'], platform: 'other' }), false)
  assert.equal(jqMatters({ mode: 'auto', surfaces: [], platform: 'other' }), false)
})
