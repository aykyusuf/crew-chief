import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guardPane, taskPane, timelinePane } from '../hooks/panes-logic.mjs'

const text = (line) => line.map((s) => s.t).join('')

test('taskPane orders in-progress, blocked, todo by priority, done last, with counts', () => {
  const json = JSON.stringify({
    tasks: [
      { id: 'DONE-1', title: 'old', status: 'done', priority: 1 },
      { id: 'TODO-2', title: 'second', status: 'todo', priority: 2 },
      { id: 'TODO-1', title: 'first', status: 'todo', priority: 1 },
      { id: 'WIP-1', title: 'working on it', status: 'in_progress', priority: 3 },
      { id: 'BLK-1', title: 'stuck', status: 'blocked', priority: 1 },
    ],
  })
  const { header, lines } = taskPane(json)
  assert.equal(text(header), 'tasks 5  ◐ 1  ✖ 1  ○ 2  ● 1')
  assert.deepEqual(lines.map(text).map((l) => l.split('  ')[0].slice(2)), ['WIP-1', 'BLK-1', 'TODO-1', 'TODO-2', 'DONE-1'])
  assert.equal(lines[0][0].tone, 'warn')
  assert.equal(lines.at(-1)[2].tone, 'dim')
})

test('taskPane cuts long lists and titles, and reports bad JSON', () => {
  const many = JSON.stringify({ tasks: Array.from({ length: 20 }, (_, i) => ({ id: 'T-' + i, title: 'x'.repeat(200), status: 'todo', priority: i })) })
  const { lines } = taskPane(many, { width: 60, maxLines: 5 })
  assert.equal(lines.length, 5)
  assert.equal(text(lines.at(-1)), '+16 more')
  assert.ok(text(lines[0]).length <= 62)
  assert.equal(taskPane('{').error, 'tasks.json is not valid JSON')
  assert.deepEqual(taskPane('{"tasks": 3}').lines, [])
})

test('timelinePane: a bar of when each agent ran inside the whole span, status and tone', () => {
  const rows = [
    { name: 'crew-chief:scanner', model: 'claude-haiku-5-5', effort: 'low', status: 'done', startMs: 0, endMs: 30_000, tokens: 9_300 },
    { name: 'deep-reader', model: 'claude-sonnet-5-5', effort: 'medium', status: 'running', startMs: 30_000, tokens: 48_100, pct: 40 },
  ]
  const { header, lines } = timelinePane(rows, 120_000, { barWidth: 12 })
  assert.equal(text(header), 'agents 2  over 2m00s')
  assert.ok(text(lines[0]).startsWith('scanner'))
  assert.ok(text(lines[0]).includes('███░░░░░░░░░'))
  assert.ok(text(lines[0]).includes('done'))
  assert.ok(text(lines[1]).includes('░░░█████████'))
  assert.ok(text(lines[1]).includes('running'))
  assert.ok(text(lines[1]).includes('40%'))
  assert.ok(text(lines[1]).includes('●●○○○'))
  assert.equal(lines[0].find((s) => s.t.trim() === 'done').tone, 'dim')
})

test('timelinePane with nothing yet', () => {
  assert.equal(text(timelinePane([], 0).header), 'agents none yet')
  assert.deepEqual(timelinePane([{ name: 'x' }], 0).lines, []) // no start time: not a row
})

test('guardPane: newest first, counts, clock labels', () => {
  const events = [
    { at: 1, kind: 'held', text: 'a destructive statement [sql-destructive]' },
    { at: 2, kind: 'warn', text: 'rm -rf inside the project' },
    { at: 3, kind: 'deny', text: 'git push --force' },
  ]
  const { header, lines } = guardPane(events, { clock: (ms) => '00:0' + ms })
  assert.equal(text(header), 'guard 1 held  1 denied  1 warned')
  assert.equal(text(lines[0]), '00:03  deny  git push --force')
  assert.equal(text(lines[2]).startsWith('00:01  held '), true)
  assert.equal(guardPane([], {}).lines.length, 0)
  assert.equal(guardPane(Array.from({ length: 30 }, (_, i) => ({ at: i, kind: 'warn', text: 'x' })), { maxLines: 4 }).lines.length, 4)
})
