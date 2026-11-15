import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agoShort, guardEntry, guardEntryKey, guardPane, guardView, taskPane, timelinePane } from '../hooks/panes-logic.mjs'

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

// ---- the Desktop guard view ----

test('guardEntry takes apart the shapes guard.js writes, and leaves anything else a plain label', () => {
  assert.deepEqual(guardEntry({ at: 5, kind: 'deny', text: 'git push --force [git-force-push]' }), { kind: 'deny', at: 5, label: 'git push --force', rule: 'git-force-push', hosts: undefined, readOnly: false })
  const ro = guardEntry({ at: 1, kind: 'deny', text: 'DELETE/UPDATE without WHERE (read-only agent)' })
  assert.equal(ro.label, 'DELETE/UPDATE without WHERE')
  assert.equal(ro.readOnly, true)
  const held = guardEntry({ at: 1, kind: 'held', text: 'ssh prod.example.com, db.example.com' })
  assert.deepEqual(held.hosts, ['prod.example.com', 'db.example.com'])
  assert.equal(held.label, '')
  const sshRo = guardEntry({ at: 1, kind: 'deny', text: 'ssh prod.example.com (read-only agent)' })
  assert.deepEqual([sshRo.hosts, sshRo.readOnly], [['prod.example.com'], true])
  const warn = guardEntry({ at: 1, kind: 'warn', text: 'ssh prod.example.com: first contact' })
  assert.deepEqual([warn.label, warn.hosts], ['ssh: first contact', ['prod.example.com']])
  // Several notes joined, a clipped tail, an unknown kind: a plain label, no guessing.
  const joined = guardEntry({ at: 1, kind: 'warn', text: 'ssh a: first contact · edit of .env' })
  assert.deepEqual([joined.label, joined.hosts], ['ssh a: first contact · edit of .env', undefined])
  const clipped = guardEntry({ at: 1, kind: 'deny', text: 'something long [rule-i…' })
  assert.deepEqual([clipped.label, clipped.rule], ['something long [rule-i…', undefined])
  assert.equal(guardEntry({ kind: 'odd', text: '' }).kind, 'warn')
  assert.equal(guardEntry({ kind: 'warn', text: '' }).label, '?')
})

test('agoShort: just now under ten seconds, then s, m, h, d', () => {
  assert.equal(agoShort(9_000), undefined)
  assert.equal(agoShort(45_000), '45s')
  assert.equal(agoShort(4 * 60_000 + 5_000), '4m')
  assert.equal(agoShort(2 * 3_600_000), '2h')
  assert.equal(agoShort(50 * 3_600_000), '2d')
  assert.equal(agoShort(-5), undefined)
})

test('guardView: state, counts, newest first, keys that survive the log dropping its oldest', () => {
  const events = [
    { at: 1_000, kind: 'deny', text: 'rm -rf on / (root, home or bare wildcard) [rm-rf]' },
    { at: 50_000, kind: 'held', text: 'ssh prod.example.com' },
    { at: 190_000, kind: 'warn', text: 'edit of .env' },
  ]
  const v = guardView(events, { summary: { loaded: true, on: true, held: 1 }, now: 200_000 })
  assert.deepEqual([v.title, v.state, v.stateLabel], ['Command guard', 'on', 'on'])
  assert.deepEqual(v.chips.map((c) => [c.kind, c.count, c.tone, c.label]), [['deny', 1, 'crit', 'blocked'], ['held', 1, 'warn', 'held'], ['warn', 1, 'info', 'warned']])
  assert.deepEqual(v.rows.map((r) => r.kind), ['warn', 'held', 'deny'])
  assert.deepEqual(v.rows.map((r) => r.ago), ['10s ago', '2m ago', '3m ago'])
  assert.equal(v.rows[1].label, 'ssh to a production host')
  assert.equal(v.rows[2].rule, 'rm-rf')
  assert.equal(v.empty, undefined)
  assert.equal(v.hint, 'Press an entry for details.')
  assert.deepEqual(v.footer, { command: '/crew-guard off', label: 'turns it off', path: '~/.claude/crew-chief-guard.json' })
  // The key of an entry does not move when an older one is dropped.
  const later = guardView(events.slice(1), { summary: { loaded: true, on: true }, now: 200_000 })
  assert.equal(later.rows[0].key, v.rows[0].key)
  assert.equal(v.rows[0].key, guardEntryKey(events[2]))
  // Two identical entries still get two keys.
  const twin = guardView([events[0], events[0]], {})
  assert.notEqual(twin.rows[0].key, twin.rows[1].key)
})

test('guardView: the pressed entry carries its detail and what to check', () => {
  const events = [
    { at: 1_000, kind: 'held', text: 'ssh prod.example.com, db.example.com' },
    { at: 2_000, kind: 'deny', text: 'git push --force (read-only agent)' },
  ]
  const keys = guardView(events, {}).rows.map((r) => r.key)
  const v = guardView(events, { selected: keys[1] })
  assert.equal(v.rows[0].detail, undefined)
  assert.equal(v.rows[1].selected, true)
  assert.equal(v.rows[1].detail.text, 'ssh to a production host')
  assert.match(v.rows[1].detail.checks[0], /first try was stopped/)
  assert.match(v.rows[1].detail.checks[1], /prod\.example\.com, db\.example\.com/)
  const d = guardView(events, { selected: keys[0] }).rows[0].detail
  assert.match(d.checks[0], /never lets the call through/)
  assert.match(d.checks[1], /read-only agent/)
})

test('guardView: empty states by guard state, the cap, and Turkish', () => {
  assert.match(guardView([], { summary: { loaded: true, on: true } }).empty, /guard is on\. Nothing was stopped/)
  const off = guardView([], { summary: { loaded: true, on: false } })
  assert.match(off.empty, /guard is off/)
  assert.equal(off.footer.command, '/crew-guard on')
  assert.equal(guardView([], { summary: { loaded: false } }).state, 'loading')
  const many = guardView(Array.from({ length: 30 }, (_, i) => ({ at: i, kind: 'warn', text: 'x' + i })), { maxRows: 20 })
  assert.equal(many.rows.length, 20)
  assert.equal(many.moreLabel, '+10 older')
  const tr = guardView([{ at: 0, kind: 'deny', text: 'x [r]' }], { lang: 'tr', now: 120_000, summary: { loaded: true, on: true } })
  assert.deepEqual([tr.title, tr.stateLabel, tr.rows[0].level, tr.rows[0].ago], ['Komut koruması', 'açık', 'engellendi', '2m önce'])
})
