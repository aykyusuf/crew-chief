import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FRESH_CALLS, FRESH_MS, freshPct, nudgeText, observe, parseReport } from '../hooks/progress-logic.mjs'

const REPORT = ": 'crew-progress 40 | reading auth | slow tests'"

test('parseReport reads the no-op the same way the shell hook does', () => {
  assert.deepEqual(parseReport(REPORT), { pct: 40, step: 'reading auth', delay: 'slow tests' })
  assert.deepEqual(parseReport(": 'crew-progress 15%'"), { pct: 15, step: '', delay: '' })
  assert.equal(parseReport(": 'crew-progress 250 | x'").pct, 100)
  assert.equal(parseReport(": 'crew-progress ?? | x | y'").pct, undefined)
  assert.equal(parseReport(": 'crew-progress 40 | a\tb  c'").step, 'a b c')
})

test('parseReport only takes the exact no-op, not a command that merely contains it', () => {
  for (const c of ['ls', ": 'crew-progress 40' && rm x", "echo ': crew-progress 40'", ": crew-progress 40", ": 'crew-progress 40'; ls", undefined, 7]) {
    assert.equal(parseReport(c), null, String(c))
  }
})

test('observe counts calls and asks for a reminder every 10 calls without a report', () => {
  const m = new Map()
  const due = []
  for (let i = 1; i <= 25; i++) due.push(observe(m, 'a', 'Read', undefined, 1000))
  assert.deepEqual(due.map((n, i) => (n ? i + 1 : 0)).filter(Boolean), [10, 20])
  assert.equal(due[9], 10)
  assert.equal(m.get('a').tools, 25)
})

test('a report restarts the count and is not itself counted', () => {
  const m = new Map()
  for (let i = 0; i < 9; i++) observe(m, 'a', 'Bash', 'ls', 1)
  assert.equal(observe(m, 'a', 'Bash', REPORT, 2), 0)
  assert.equal(m.get('a').tools, 9)
  for (let i = 0; i < 9; i++) assert.equal(observe(m, 'a', 'Bash', 'ls', 3), 0)
  assert.equal(observe(m, 'a', 'Bash', 'ls', 4), 10)
  // a report on a tool that is not Bash does not count as one
  assert.equal(observe(new Map(), 'b', 'Read', REPORT, 1), 0)
})

test('agents are tracked apart and the map stays bounded', () => {
  const m = new Map()
  for (let i = 0; i < 9; i++) observe(m, 'a', 'Read', undefined, 1)
  assert.equal(observe(m, 'b', 'Read', undefined, 1), 0)
  assert.equal(observe(m, 'a', 'Read', undefined, 1), 10)
  for (let i = 0; i < 300; i++) observe(m, 'x' + i, 'Read', undefined, 1)
  assert.ok(m.size <= 200)
})

test('freshPct: only a number, under 25 calls and 10 minutes old', () => {
  const entry = { tools: 30, rtools: 30 - (FRESH_CALLS - 1), pct: 40, rts: 1000 }
  assert.equal(freshPct(entry, 1000 + FRESH_MS - 1), 40)
  assert.equal(freshPct(entry, 1000 + FRESH_MS), undefined)
  assert.equal(freshPct({ ...entry, rtools: 30 - FRESH_CALLS }, 1000), undefined)
  assert.equal(freshPct({ ...entry, pct: undefined }, 1000), undefined)
  assert.equal(freshPct(undefined, 1000), undefined)
})

test('the reminder text is the one the shell hook sends', () => {
  assert.match(nudgeText(10), /you have made 10 tool calls since your last progress report/)
  assert.match(nudgeText(10), /'crew-progress NN \| what you are on \| why it is slow \(empty if not\)'/)
})
