import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VIEW_LINE_MAX,
  msgFallback,
  msgPending,
  msgShown,
  msgTrack,
  msgView,
  trDative,
  agentListLine,
  argSummary,
  clockSpan,
  cleanLine,
  cutLine,
  nativeWanted,
  notifyText,
  notifyWanted,
  mdInline,
  paneChips,
  paneDetail,
  paneGroups,
  paneRow,
  pickSelected,
  reportBlocks,
  reportFold,
  reportLines,
  resultSummary,
  shortPaths,
  summaryText,
  throttlePlan,
  transcriptEntries,
} from '../hooks/agent-view-logic.mjs'
import { formatSetting, parseSetting, resolveSetting } from '../hooks/config-logic.mjs'

const text = (lines) => lines.map((l) => l.map((s) => s.t).join(''))

test('cleanLine drops escape sequences whole, control and direction characters, and folds spaces', () => {
  assert.equal(cleanLine('\u001b[31mred\u001b[0m  text'), 'red text')
  assert.equal(cleanLine('a\u001b]0;title\u0007b'), 'ab')
  assert.equal(cleanLine('tab\there\r\nnext\u0000'), 'tab here next')
  assert.equal(cleanLine('evil‮root'), 'evilroot')
  assert.equal(cleanLine(undefined), '')
})

test('cutLine keeps a line to its limit, the last character an ellipsis', () => {
  const long = 'x'.repeat(500)
  assert.equal(cutLine(long).length, VIEW_LINE_MAX)
  assert.ok(cutLine(long).endsWith('…'))
  assert.equal(cutLine('short'), 'short')
})

test('clockSpan: m:ss, h:mm:ss, nothing for what is not a duration', () => {
  assert.equal(clockSpan(215_000), '3:35')
  assert.equal(clockSpan(4000), '0:04')
  assert.equal(clockSpan(3_725_000), '1:02:05')
  assert.equal(clockSpan(undefined), '')
  assert.equal(clockSpan(-5), '')
})

test('argSummary names what a call was about', () => {
  assert.equal(argSummary('Bash', { command: 'npm test' }), 'npm test')
  assert.equal(argSummary('Read', { file_path: '/w/a.js' }), '/w/a.js')
  assert.equal(argSummary('Grep', { pattern: 'TODO', path: 'src' }), 'TODO in src')
  assert.equal(argSummary('Agent', { subagent_type: 'scanner', description: 'find x' }), 'scanner: find x')
  assert.equal(argSummary('mcp__x__y', { anything: 'value' }), 'value')
  assert.equal(argSummary('Bash', { command: 'echo ' + 'a'.repeat(300) }).length, 100)
  assert.equal(argSummary('Nothing', {}), '')
})

const MESSAGES = [
  { role: 'user', text: 'Find the auth bug\nin src/auth', toolUses: [] },
  {
    role: 'assistant',
    text: 'Looking at the auth module.',
    toolUses: [
      { tool_use_id: 'u1', tool: 'Read', input: { file_path: '/w/src/auth.js' }, text: 'line one\nline two' },
      { tool_use_id: 'u2', tool: 'Bash', input: { command: 'npm test' }, text: 'FAIL auth', isError: true },
    ],
  },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'u1', text: 'line one', isError: false }] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'u3', tool: 'Grep', input: { pattern: 'token' } }] },
]

test('transcriptEntries: brief, text, tool calls with the first result line; tool-result-only messages skipped', () => {
  const entries = transcriptEntries(MESSAGES)
  assert.deepEqual(
    entries.map((e) => e.kind),
    ['brief', 'text', 'tool', 'tool', 'tool'],
  )
  assert.equal(entries[2].tool, 'Read')
  assert.equal(entries[2].result, 'line one')
  assert.equal(entries[3].error, true)
  assert.equal(entries[4].pending, true)
  assert.deepEqual(transcriptEntries(undefined), [])
  assert.deepEqual(transcriptEntries([null, 5, { role: 'assistant' }]), [])
})

test('paneDetail: a running agent gets a title, its task and its last steps, results summarised', () => {
  const d = paneDetail({ name: 'crew-chief:deep-reader', messages: MESSAGES, done: false }, { now: 0 })
  assert.equal(d.title.name, 'deep-reader')
  assert.equal(d.title.statusText, 'running')
  assert.equal(d.task, 'Find the auth bug in src/auth')
  assert.equal(d.report, undefined)
  assert.deepEqual(
    d.steps.map((x) => (x.kind === 'tool' ? x.tool + ' ' + x.arg + ' | ' + x.summary : '› ' + x.text)),
    ['› Looking at the auth module.', 'Read /w/src/auth.js | line one  +1 lines', 'Bash npm test | FAIL auth', 'Grep token | running…'],
  )
  assert.equal(d.steps[2].tone, 'crit')
  assert.equal(d.steps[3].pending, true)
})

test('paneDetail: a finished agent keeps its whole report as paragraphs, markdown taken out', () => {
  const answer = '## Findings\n**Root cause:** the `token` check\n- one **thing**\n- two\n' + Array.from({ length: 20 }, (_, i) => 'finding ' + (i + 1) + ' ' + 'x'.repeat(200)).join('\n')
  const d = paneDetail({ name: 'scanner', row: { id: 'a', name: 'scanner', status: 'done', startMs: 0, endMs: 6000, tokens: 34_000 }, messages: MESSAGES, answer, done: true }, { lang: 'tr', now: 9000 })
  assert.equal(d.title.statusText, 'bitti')
  assert.equal(d.title.time, '0:06')
  assert.equal(d.title.tokens, '34k')
  assert.deepEqual(d.report.slice(0, 4), [
    { kind: 'heading', text: 'Findings' },
    { kind: 'para', text: 'Root cause: the token check' },
    { kind: 'bullet', text: 'one thing' },
    { kind: 'bullet', text: 'two' },
  ])
  assert.ok(d.report.some((b) => b.text.startsWith('finding 12 ') && b.text.length > 200), 'not cut at 160')
  assert.ok(!d.report.some((b) => /\*\*|`/.test(b.text)))
  const fold = reportFold(d.report)
  assert.ok(fold.shown.length >= 1 && fold.hidden > 0)
  assert.equal(reportFold(d.report, { open: true }).hidden, 0)
})

test('paneDetail: an agent that cannot be read says so and still shows a kept report', () => {
  const d = paneDetail({ name: 'scanner', deny: 'agent a1 finished and has no saved transcript', answer: 'All done.', done: true })
  assert.match(d.deny, /scanner: its content cannot be read \(agent a1 finished/)
  assert.deepEqual(d.report, [{ kind: 'para', text: 'All done.' }])
  assert.deepEqual(d.steps, [])
  const tr = paneDetail({ name: 'scanner', deny: 'nope' }, { lang: 'tr' })
  assert.equal(tr.deny, 'scanner: içeriği okunamıyor (nope).')
  assert.equal(tr.report, undefined)
})

test('paneDetail: the last 8 steps, the rest counted; a handback is named, not repeated', () => {
  const many = [{ role: 'user', text: 'brief', toolUses: [] }]
  for (let i = 0; i < 20; i++) many.push({ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'u' + i, tool: 'Bash', input: { command: 'step ' + i }, text: 'ok' }] })
  many.push({ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'h', tool: 'SubagentHandback', input: { message: 'the whole report' }, text: '{"success":true,"delivered":true}' }] })
  const d = paneDetail({ name: 'a', messages: many })
  assert.equal(d.steps.length, 8)
  assert.equal(d.hidden, 13)
  assert.equal(d.steps[0].arg, 'step 13')
  const last = d.steps[7]
  assert.equal(last.tool, 'SubagentHandback')
  assert.equal(last.arg, '')
  assert.equal(last.summary, 'handed its report back')
  assert.equal(paneDetail({ name: 'a', messages: [] }).empty, true)
})

test('resultSummary: never raw JSON', () => {
  assert.equal(summaryText(resultSummary('{"success":true,"id":"x"}')), 'ok')
  assert.equal(summaryText(resultSummary('{"success":false,"error":"no route"}')), 'failed: no route')
  assert.equal(summaryText(resultSummary('[1,2,3]'), 'tr'), '3 öğe')
  assert.equal(summaryText(resultSummary('{"message":"Sent to the lead.\\nmore"}')), 'Sent to the lead.')
  assert.equal(summaryText(resultSummary('{"a":1,"b":2}')), '{ a, b }')
  assert.equal(summaryText(resultSummary('{"success":true,"data":{"x":')), 'ok') // cut short
  assert.equal(summaryText(resultSummary('{"items":[1,2')), '{ items, … }')
  assert.equal(summaryText(resultSummary('first\nsecond\nthird')), 'first  +2 lines')
  assert.equal(summaryText(resultSummary('')), '')
})

test('resultSummary: the engine\'s own words as plain words, no tags, no long paths', () => {
  const said = (x, lang = 'en') => summaryText(resultSummary(x), lang)
  assert.equal(said('<tool_use_error>Blocked: standalone sleep 300. To wait, use Monitor.</tool_use_error>', 'tr'), 'engellendi: standalone sleep 300')
  assert.equal(said('Exit code 1\n/bin/sh: x: command not found'), 'error (exit 1): /bin/sh: x: command not found')
  assert.equal(said('Exit code 2', 'tr'), 'hata (çıkış 2)')
  assert.equal(said('Command running in background with ID: b1. Output is being written to: /private/tmp/a/b/c.output', 'tr'), 'arka planda başladı')
  assert.equal(said('(Bash completed with no output)', 'tr'), 'tamam (çıktı yok)')
  assert.equal(said('<tool_use_error>File does not exist.</tool_use_error>'), 'File does not exist.')
  assert.equal(said('wrote /Users/me/work/project/src/a.js'), 'wrote …/src/a.js')
  assert.equal(shortPaths('/work/login.js'), '/work/login.js') // short paths stay whole
})

test('mdInline and reportBlocks: marks out, code kept, tables and rules folded', () => {
  assert.equal(mdInline('a **b** __c__ `d` [e](http://x)'), 'a b c d e')
  const b = reportBlocks('# T\n---\n```\nconst x = 1\n```\n| a | b |\n|---|---|\n1. first\n')
  assert.deepEqual(b, [
    { kind: 'heading', text: 'T' },
    { kind: 'code', text: 'const x = 1' },
    { kind: 'para', text: 'a · b' },
    { kind: 'bullet', text: '1. first', numbered: true },
  ])
  const capped = reportBlocks('y'.repeat(5000))
  assert.ok(capped[0].text.length <= 4000)
})

test('reportLines falls back to the last assistant text', () => {
  const r = reportLines(undefined, [{ role: 'assistant', text: 'one\ntwo', toolUses: [] }, { role: 'assistant', text: '', toolUses: [] }])
  assert.deepEqual(r, { lines: ['one', 'two'], more: 0 })
})

test('agentListLine: status, name, model and effort, duration, tokens', () => {
  const now = 1_000_000
  const line = agentListLine({ id: 'a1', name: 'crew-chief:implementer', model: 'claude-opus-5-5', effort: 'medium', status: 'running', startMs: now - 215_000, tokens: 58_000 }, { now, selected: true }).map((s) => s.t).join('')
  assert.match(line, /^▶ ⠋ implementer/)
  assert.match(line, /opus-5\.5·medium/)
  assert.match(line, /3:35/)
  assert.match(line, /58k/)
  const done = agentListLine({ id: 'a2', name: 'scanner', status: 'error', startMs: 0, endMs: 4000 }, { now }).map((s) => s.t).join('')
  assert.match(done, /^ {2}✗ scanner/)
  assert.match(done, /0:04/)
})

test('paneRow, paneChips, paneGroups: the list as data, running first, finished folded past 8', () => {
  const now = 1_000_000
  const r = paneRow({ id: 'a1', name: 'crew-chief:implementer', model: 'claude-sonnet-5-5', effort: 'medium', status: 'done', startMs: now - 6000, endMs: now, tokens: 34_000 }, now)
  assert.deepEqual([r.glyph, r.name, r.model, r.time, r.tokens, r.live], ['✓', 'implementer', 'sonnet-5.5 · medium', '0:06', '34k', false])
  assert.equal(paneRow({ id: 'x', status: 'waiting' }, now).live, true)
  const rows = [{ status: 'running' }, { status: 'waiting' }, { status: 'done' }, { status: 'error' }]
  assert.deepEqual(paneChips(rows, 'tr').map((c) => c.text), ['2 çalışıyor', '1 bitti', '1 hata'])
  assert.deepEqual(paneChips([{ status: 'done' }]).map((c) => c.text), ['1 done'])
  const list = [{ id: 'r', status: 'running' }, ...Array.from({ length: 13 }, (_, i) => ({ id: 'f' + i, status: 'done' }))]
  const g = paneGroups(list, { selected: 'f12' })
  assert.deepEqual(g.running.map((x) => x.id), ['r'])
  assert.equal(g.finished.length, 9) // the newest 8 and the picked one
  assert.equal(g.finished[8].id, 'f12')
  assert.equal(g.hidden, 4)
  assert.equal(paneGroups(list, { all: true }).hidden, 0)
})

test('an agent waiting on its background work is listed under running, with its own status word, its time counting', () => {
  const now = 1_000_000
  const r = paneRow({ id: 'b1', name: 'implementer', status: 'background', startMs: now - 90_000 }, now)
  assert.deepEqual([r.status, r.live, r.glyph, r.tone, r.time], ['background', true, '◌', 'dim', '1:30'])
  const g = paneGroups([{ id: 'b1', status: 'background' }, { id: 'd1', status: 'done' }])
  assert.deepEqual(g.running.map((x) => x.id), ['b1'])
  assert.deepEqual(g.finished.map((x) => x.id), ['d1'])
  assert.deepEqual(paneChips([{ status: 'background' }], 'tr').map((c) => c.text), ['1 çalışıyor'])
  assert.equal(pickSelected([{ id: 'd1', status: 'done' }, { id: 'b1', status: 'background' }], undefined), 'b1')
  const d = paneDetail({ name: 'implementer', row: { id: 'b1', status: 'background', startMs: now - 1000 }, messages: [] }, { lang: 'tr', now })
  assert.equal(d.title.statusText, 'arka planda bekliyor')
  assert.equal(paneDetail({ row: { id: 'b1', status: 'background' }, messages: [] }, { lang: 'en', now }).title.statusText, 'waiting on background work')
  assert.match(agentListLine({ id: 'b1', name: 'implementer', status: 'background', startMs: 0 }, { now: 5000 }).map((s) => s.t).join(''), /◌ implementer/)
})

test('pickSelected keeps a listed pick, else the newest running, else the newest', () => {
  const rows = [
    { id: 'c', status: 'done' },
    { id: 'b', status: 'running' },
    { id: 'a', status: 'done' },
  ]
  assert.equal(pickSelected(rows, 'a'), 'a')
  assert.equal(pickSelected(rows, 'gone'), 'b')
  assert.equal(pickSelected([{ id: 'x', status: 'done' }], undefined), 'x')
  assert.equal(pickSelected([], undefined), undefined)
})

test('throttlePlan: now, one trailing run, or nothing while one is booked', () => {
  assert.deepEqual(throttlePlan(undefined, 1000), { run: 'now' })
  assert.deepEqual(throttlePlan(1000, 2600, 1500), { run: 'now' })
  assert.deepEqual(throttlePlan(1000, 1400, 1500), { run: 'later', delayMs: 1100 })
  assert.deepEqual(throttlePlan(1000, 1400, 1500, true), { run: 'skip' })
})

test('notifyWanted: listed agents only, no teammates, no repeats, no stopped runs, a minimum length', () => {
  const base = { known: true, teammate: false, reason: 'answer', durationMs: 60_000, minSec: 10 }
  assert.equal(notifyWanted(base), true)
  assert.equal(notifyWanted({ ...base, known: false }), false) // an engine fork
  assert.equal(notifyWanted({ ...base, teammate: true }), false)
  assert.equal(notifyWanted({ ...base, already: true }), false)
  assert.equal(notifyWanted({ ...base, reason: 'aborted' }), false)
  assert.equal(notifyWanted({ ...base, durationMs: 4000 }), false)
  assert.equal(notifyWanted({ ...base, durationMs: 4000, reason: 'error' }), true) // an error is always said
  assert.equal(notifyWanted({ ...base, durationMs: 4000, minSec: 0 }), true)
  assert.equal(notifyWanted({ ...base, durationMs: undefined }), true)
})

test('notifyText: one run with what is known, several in one line', () => {
  assert.equal(notifyText('en', [{ name: 'crew-chief:implementer', durationMs: 215_000, tokens: 58_000, calls: 14 }]), 'implementer finished: 3:35 · 58k · 14 calls')
  assert.equal(notifyText('tr', [{ name: 'implementer', durationMs: 215_000, tokens: 58_000, calls: 14 }]), 'implementer bitti: 3:35 · 58k · 14 çağrı')
  assert.equal(notifyText('en', [{ name: 'scanner' }]), 'scanner finished')
  assert.equal(notifyText('tr', [{ name: 'scanner', durationMs: 4000, error: true }]), 'scanner hatayla bitti: 0:04')
  const many = [1, 2, 3, 4, 5, 6].map((i) => ({ name: 'agent' + i, durationMs: i * 60_000, error: i === 2 }))
  assert.equal(notifyText('en', many), '6 agents finished: agent1 1:00, agent2 2:00 ✗, agent3 3:00, agent4 4:00, +2 more')
  assert.equal(notifyText('tr', many.slice(0, 2)), '2 ajan bitti: agent1 1:00, agent2 2:00 ✗')
  assert.equal(notifyText('en', []), '')
})

test('nativeWanted: off by setting, or when a main turn ended after the run (the host says it then)', () => {
  assert.equal(nativeWanted({ nativeOn: true, mainEndedAt: 100, firstEndAt: 500 }), true)
  assert.equal(nativeWanted({ nativeOn: true, mainEndedAt: 600, firstEndAt: 500 }), false)
  assert.equal(nativeWanted({ nativeOn: true, mainEndedAt: undefined, firstEndAt: 500 }), true)
  assert.equal(nativeWanted({ nativeOn: false, mainEndedAt: undefined, firstEndAt: 500 }), false)
})

test('the notify settings: on/off switches and a number of seconds', () => {
  assert.deepEqual(resolveSetting('notify.agent', undefined, undefined), { value: 'on', source: 'default' })
  assert.deepEqual(resolveSetting('notify.agent', 'off', undefined), { value: 'off', source: 'env' })
  assert.deepEqual(resolveSetting('notify.native', undefined, 'off'), { value: 'off', source: 'saved' })
  assert.deepEqual(parseSetting('notify.min', '30'), { ok: true, value: 30 })
  assert.equal(parseSetting('notify.min', '-1').ok, false)
  assert.equal(parseSetting('notify.min', '99999').ok, false)
  assert.equal(formatSetting('notify.min', 10), '10 s')
})

// ---- an agent opened in the band ----

import { BAND_EXTRA_MAX, MESSAGE_MAX, bandExtraRows, bandSection, checkMessage, fitSections, sendPlan, toggleOpen } from '../hooks/agent-view-logic.mjs'

const lineOf = (line) => line.map((s) => s.t).join('')

test('toggleOpen opens and closes one agent, keeps the opening order and drops the oldest past the cap', () => {
  assert.deepEqual(toggleOpen([], 'a'), ['a'])
  assert.deepEqual(toggleOpen(['a', 'b'], 'a'), ['b'])
  assert.deepEqual(toggleOpen(['a', 'b'], 'c'), ['a', 'b', 'c'])
  assert.deepEqual(toggleOpen(['a', 'b', 'c', 'd'], 'e'), ['b', 'c', 'd', 'e'])
  assert.deepEqual(toggleOpen(['a'], ''), ['a'])
  assert.deepEqual(toggleOpen(undefined, 'x'), ['x'])
  const given = ['a']
  toggleOpen(given, 'b')
  assert.deepEqual(given, ['a']) // the list given is left alone
})

const BAND_MSGS = [
  { role: 'user', text: 'Fix the login bug' },
  { role: 'assistant', text: 'Reading the module.\nSecond line.', toolUses: [{ tool: 'Read', input: { file_path: '/work/login.js' }, text: 'export function login() {}\nmore' }] },
  { role: 'assistant', text: '', toolUses: [{ tool: 'Bash', input: { command: 'npm test' } }] },
]

test('bandSection: a running agent shows its last steps on one line each, the newest last, kept from the tail', () => {
  const s = bandSection({ name: 'x:implementer', messages: BAND_MSGS, done: false })
  assert.equal(s.keep, 'tail')
  const text = s.lines.map(lineOf)
  assert.deepEqual(text, ['› Reading the module.', '• Read /work/login.js ⎿ export function login() {}', '• Bash npm test ⎿ running…'])
  assert.ok(!text.some((l) => l.includes('Fix the login bug'))) // the brief is not a step
})

test('bandSection: at most the last 5 steps, each line at most 120 characters, escapes cleaned', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ role: 'assistant', text: '', toolUses: [{ tool: 'Grep', input: { pattern: 'p' + i + '\u001b[31m' + 'x'.repeat(200) }, text: 'hit' }] }))
  const s = bandSection({ messages: many })
  assert.equal(s.lines.length, 5)
  assert.ok(lineOf(s.lines[0]).startsWith('• Grep p4'))
  for (const l of s.lines) {
    assert.ok(lineOf(l).length <= 120)
    assert.ok(!lineOf(l).includes('\u001b'))
  }
})

test('bandSection: a finished agent shows its report first with time, tokens and calls, cut to 6 lines', () => {
  const answer = Array.from({ length: 9 }, (_, i) => 'line ' + (i + 1)).join('\n')
  const s = bandSection({ name: 'scanner', messages: BAND_MSGS, done: true, answer, durationMs: 215_000, tokens: 13_000, calls: 4 })
  assert.equal(s.keep, 'head')
  const text = s.lines.map(lineOf)
  assert.equal(text[0], '✓ Report · 3:35 · 13k · 4 calls')
  assert.deepEqual(text.slice(1, 7), ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'])
  assert.equal(text[7], '+3 more lines')
  const tr = bandSection({ done: true, error: true, answer: 'x', durationMs: 1000 }, { lang: 'tr' })
  assert.equal(lineOf(tr.lines[0]), '✗ Rapor · 0:01')
})

test('bandSection: a transcript that cannot be read says so; an empty one says nothing ran yet', () => {
  const d = bandSection({ name: 'x:scanner', deny: 'no saved transcript' })
  assert.match(lineOf(d.lines[0]), /scanner: its content cannot be read \(no saved transcript\)/)
  assert.equal(d.lines.length, 1)
  assert.deepEqual(bandSection({ messages: [] }).lines.map(lineOf), ['Nothing in its transcript yet.'])
})

test('bandExtraRows: what the band has left, never more than 12, never below 0', () => {
  assert.equal(BAND_EXTRA_MAX, 12)
  assert.equal(bandExtraRows(20, 5), 12)
  assert.equal(bandExtraRows(10, 4), 6)
  assert.equal(bandExtraRows(5, 9), 0)
  assert.equal(bandExtraRows(undefined, 1), 0)
})

const L = (n, p = 'l') => Array.from({ length: n }, (_, i) => [{ t: p + i, tone: 'dim' }])

test('fitSections: everything fits as it is', () => {
  const out = fitSections([{ id: 'a', lines: L(3), keep: 'head', fixed: 1 }], 12)
  assert.deepEqual(out, [{ id: 'a', lines: L(3), more: 0, hidden: false }])
})

test('fitSections: the newest is served first; the oldest is cut, then hidden; a running one keeps its tail', () => {
  const sections = [
    { id: 'old', lines: L(5, 'o'), keep: 'head', fixed: 1 },
    { id: 'mid', lines: L(5, 'm'), keep: 'tail', fixed: 1 },
    { id: 'new', lines: L(4, 'n'), keep: 'tail', fixed: 2 },
  ]
  const out = fitSections(sections, 10)
  assert.deepEqual(out[2], { id: 'new', lines: L(4, 'n'), more: 0, hidden: false }) // 6 rows
  assert.equal(out[1].more, 2) // 4 rows left: 1 fixed + 3 lines
  assert.deepEqual(out[1].lines.map(lineOf), ['m2', 'm3', 'm4'])
  assert.deepEqual(out[0], { id: 'old', lines: [], more: 5, hidden: true })
  const head = fitSections([{ id: 'a', lines: L(5), keep: 'head', fixed: 1 }], 3)
  assert.deepEqual(head[0].lines.map(lineOf), ['l0', 'l1'])
  assert.equal(head[0].more, 3)
  assert.equal(fitSections([{ id: 'a', lines: L(2), fixed: 1 }], 0)[0].hidden, true)
})

test('checkMessage: never empty, at most 2000 characters, trimmed', () => {
  assert.equal(MESSAGE_MAX, 2000)
  assert.deepEqual(checkMessage('  stop after this file \n'), { ok: true, text: 'stop after this file' })
  assert.deepEqual(checkMessage('   '), { ok: false, error: 'empty' })
  assert.deepEqual(checkMessage(undefined), { ok: false, error: 'empty' })
  assert.deepEqual(checkMessage('x'.repeat(2001)), { ok: false, error: 'long' })
  assert.equal(checkMessage('x'.repeat(2000)).ok, true)
})

test('sendPlan: a finished agent is restarted by a message, so its button says so and asks first', () => {
  assert.deepEqual(sendPlan(false), { label: 'Write', confirm: false, noteKey: 'band_note_live' })
  assert.deepEqual(sendPlan(true), { label: 'Restart and send', confirm: true, noteKey: 'band_note_done' })
  assert.equal(sendPlan(true, 'tr').label, 'Yeniden başlat ve gönder')
  assert.equal(sendPlan(false, 'tr').label, 'Mesaj yaz')
})

test('pane messages: delivered -> read when the transcript holds the text after the brief -> replied with the first line', () => {
  const b = (id, text, state = 'delivered') => ({ id, text, at: 1000, state, callsAt: 2 })
  const sent = [b('m1', 'check the  tests'), b('m2', 'check the tests'), b('m3', 'x', 'failed')]
  const brief = { role: 'user', text: 'check the tests and fix them' } // the task holds the same words: not a read
  assert.deepEqual(msgTrack(sent, [brief]).map((x) => x.state), ['delivered', 'delivered', 'failed'])
  const one = [brief, { role: 'assistant', text: '' }, { role: 'user', text: '<peer>Check the tests</peer>' }]
  assert.deepEqual(msgTrack(sent, one).map((x) => x.state), ['read', 'delivered', 'failed']) // the same text twice: two reads
  const two = [...one, { role: 'assistant', text: 'All green.\nmore' }, { role: 'user', text: 'check the tests' }]
  const moved = msgTrack(sent, two)
  assert.deepEqual(moved.map((x) => x.state), ['replied', 'read', 'failed'])
  assert.equal(moved[0].reply, 'All green.')
  assert.deepEqual(msgTrack(moved, [brief]).map((x) => x.state), ['replied', 'read', 'failed']) // never back
  assert.equal(msgTrack(sent, undefined), sent)
  // Delivered inside a tool result: read all the same.
  const inResult = [brief, { role: 'user', text: '', toolResults: [{ tool_use_id: 'u', text: 'ok\n<peer>check the tests</peer>' }] }]
  assert.equal(msgTrack(sent, inResult)[0].state, 'read')
  // A readable transcript that does not show it, then a tool call after the send: the fallback reads it.
  assert.equal(msgFallback(msgTrack(sent, [brief]), { calls: 3 })[0].state, 'read')
  assert.equal(msgPending(moved), true)
  assert.equal(msgPending([b('m', 'x', 'replied')]), false)
})

test('pane messages: without a transcript, a later tool call reads it and the run ending after it answers it', () => {
  const sent = [{ id: 'm1', text: 'go', at: 1000, state: 'delivered', callsAt: 3 }]
  assert.equal(msgFallback(sent, { calls: 3 })[0].state, 'delivered')
  assert.equal(msgFallback(sent, { calls: 4 })[0].state, 'read')
  const done = msgFallback(sent, { calls: 3, endedAt: 2000, answer: 'Done.\nrest' })[0]
  assert.equal(done.state, 'replied')
  assert.equal(done.reply, 'Done.')
  assert.equal(msgFallback(sent, { endedAt: 500 })[0].state, 'delivered') // an end before the send says nothing
})

test('pane messages: the bubble view says the state, the time and a restart in words; long text is cut at four lines', () => {
  const v = msgView(
    [
      { id: 'a', text: 'hi', at: 0, state: 'sending' },
      { id: 'b', text: 'go on', at: 0, state: 'delivered', restarted: true },
      { id: 'c', text: 'x', at: 0, state: 'failed', reason: 'gone' },
      { id: 'd', text: 'y', at: 0, state: 'replied', reply: 'ok' },
    ],
    { now: 3 * 60_000, lang: 'tr' },
  )
  assert.deepEqual(v.map((x) => x.status), ['◌ gönderiliyor…', '✓ iletildi · yeniden başlatıldı', '✗ iletilemedi: gone', '✓✓ yanıtladı'])
  assert.deepEqual(v.map((x) => x.tone), ['dim', 'info', 'crit', 'ok'])
  assert.equal(v[0].ago, '3 dk önce')
  assert.equal(v[3].reply, 'yanıt: ok')
  assert.equal(msgShown('1\n2\n3\n4\n5'), '1\n2\n3\n4…')
  assert.equal(msgShown('a'.repeat(400)).length, 320)
})

test('trDative: English agent names take the ending they are said with', () => {
  assert.equal(trDative('implementer'), "implementer'a")
  assert.equal(trDative('reviewer'), "reviewer'a")
  assert.equal(trDative('mechanic'), "mechanic'e")
  assert.equal(trDative('deep-reader'), "deep-reader'a")
  assert.equal(trDative('kuzu'), "kuzu'ya")
})
