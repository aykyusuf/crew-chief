import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agentSegments,
  bandRows,
  bandLines,
  bar,
  cardBudget,
  cardGrid,
  cardRowsFit,
  cardLine1Cells,
  cardNeedCells,
  cardTextRoom,
  demoContent,
  ctxAlert,
  ctxChip,
  effortMeter,
  elapsedLabel,
  familyOf,
  lineText,
  modeLabels,
  modelChip,
  questionRows,
  quietFacts,
  sparkline,
  spinnerWord,
  tailText,
  statusSegments,
  tokenLabel,
  untilLabel,
  windowChip,
} from '../hooks/ui-logic.mjs'
import { agentCardText } from '../hooks/panel-art-logic.mjs'

test('effortMeter: dots grow with the effort, no effort draws nothing', () => {
  assert.deepEqual(effortMeter('low'), { glyph: '●○○○○', tone: 'ok', label: 'low', rainbow: false })
  assert.equal(effortMeter('medium').glyph, '●●○○○')
  assert.equal(effortMeter('high').glyph, '●●●○○')
  assert.equal(effortMeter('xhigh').glyph, '●●●●○')
  assert.equal(effortMeter('xhigh').tone, 'crit')
  assert.equal(effortMeter('max').glyph, '●●●●●') // max is its own level now
  assert.equal(effortMeter('max').rainbow, true)
  assert.equal(effortMeter('xhigh').rainbow, false)
  assert.equal(effortMeter('MAX').tone, 'max')
  for (const none of [undefined, null, '', 'turbo', 7]) assert.equal(effortMeter(none), undefined, String(none))
})

test('bar fills to the percentage and clamps', () => {
  assert.equal(bar(0), '░░░░░░')
  assert.equal(bar(40), '▓▓░░░░')
  assert.equal(bar(100), '▓▓▓▓▓▓')
  assert.equal(bar(250), '▓▓▓▓▓▓')
  assert.equal(bar(-5), '░░░░░░')
  assert.equal(bar(50, 4), '▓▓░░')
  assert.equal(bar(undefined), '')
  assert.equal(bar(NaN), '')
})

test('familyOf and tokenLabel', () => {
  assert.equal(familyOf('claude-opus-5-5'), 'opus')
  assert.equal(familyOf('claude-haiku-4-5-20251001'), 'haiku')
  assert.equal(familyOf('whatever'), 'other')
  assert.equal(familyOf(undefined), 'other')
  assert.equal(tokenLabel(950), '950')
  assert.equal(tokenLabel(41_234), '41k')
  assert.equal(tokenLabel(1_250_000), '1.2M')
  assert.equal(tokenLabel(0), '')
  assert.equal(tokenLabel('12'), '')
})

test('untilLabel counts to an ISO time', () => {
  const now = Date.parse('2026-10-28T20:00:00Z')
  assert.equal(untilLabel('2026-10-29T00:20:00Z', now), '~4h20m')
  assert.equal(untilLabel('2026-11-03T09:00:00Z', now), '~5d13h')
  assert.equal(untilLabel('2026-10-28T20:09:00Z', now), '~9m')
  assert.equal(untilLabel('2026-10-28T19:00:00Z', now), '') // past
  assert.equal(untilLabel('nonsense', now), '')
  assert.equal(untilLabel(undefined, now), '')
})

test('windowChip: tone by use, undefined without a reading', () => {
  const now = Date.parse('2026-10-28T20:00:00Z')
  const rl = [
    { kind: 'five_hour', percentUsed: 4.4, resetsAt: '2026-10-29T00:20:00Z' },
    { kind: 'seven_day', percentUsed: 96, resetsAt: '2026-11-03T09:00:00Z' },
  ]
  assert.deepEqual(windowChip(rl, 'five_hour', now), { label: '5h', percent: 4, tone: 'ok', reset: '~4h20m' })
  assert.equal(windowChip(rl, 'seven_day', now).tone, 'crit')
  assert.equal(windowChip([{ kind: 'five_hour', percentUsed: 75 }], 'five_hour', now).tone, 'warn')
  assert.equal(windowChip([], 'five_hour', now), undefined)
  assert.equal(windowChip(undefined, 'five_hour', now), undefined)
  assert.equal(windowChip([{ kind: 'five_hour' }], 'five_hour', now), undefined)
})

test('ctxChip: percent, labels, tone and the compaction threshold', () => {
  assert.deepEqual(ctxChip({ tokens: 520_000, window: 1_000_000 }, 400_000), { percent: 52, tokens: '520k', window: '1M', tone: 'warn', past: true, spark: '' })
  assert.equal(ctxChip({ tokens: 100_000, window: 1_000_000 }, 400_000).past, false)
  assert.equal(ctxChip({ tokens: 800_000, window: 1_000_000 }).tone, 'crit')
  assert.equal(ctxChip({ tokens: 100_000, window: 1_000_000 }).past, false)
  assert.equal(ctxChip({ tokens: undefined, window: 1_000_000 }), undefined)
  assert.equal(ctxChip({ tokens: 1, window: 0 }), undefined)
  assert.equal(ctxChip(undefined), undefined)
})

test('statusSegments puts the chips on one line, the compact key last', () => {
  const now = Date.parse('2026-10-28T20:00:00Z')
  const line = statusSegments({
    ctx: ctxChip({ tokens: 520_000, window: 1_000_000 }, 400_000),
    five: windowChip([{ kind: 'five_hour', percentUsed: 4, resetsAt: '2026-10-29T00:20:00Z' }], 'five_hour', now),
    week: windowChip([{ kind: 'seven_day', percentUsed: 96, resetsAt: '2026-11-03T09:00:00Z' }], 'seven_day', now),
    guard: { on: true, held: 1 },
    saver: true,
    compactKey: true,
  })
  assert.equal(lineText(line), 'ctx 52% 520k/1M   5h 4% ~4h20m   7d 96% ~5d13h   guard on · 1 held   saver on   [1] compact')
  assert.deepEqual(line.find((s) => s.t === '96%'), { t: '96%', tone: 'crit', bold: true })
  assert.equal(line.at(-1).bold, true)
  assert.equal(line.at(-1).key, 'compact') // the drawing part turns this one into a button
})

test('statusSegments: the compact key names its shortcut only when asked to', () => {
  assert.equal(lineText(statusSegments({ compactKey: true })), '[1] compact')
  assert.equal(lineText(statusSegments({ compactKey: true }, true)), '[1] compact')
  const plain = statusSegments({ compactKey: true }, false)
  assert.equal(lineText(plain), 'compact')
  assert.equal(plain[0].key, 'compact') // still the button
})

test('statusSegments leaves out what is unknown', () => {
  assert.deepEqual(statusSegments({}), [])
  assert.equal(lineText(statusSegments({ guard: { on: false } })), 'guard off')
  assert.equal(lineText(statusSegments({ guard: { on: true, held: 0 } })), 'guard on')
})

test('agentSegments: name, model, effort meter, bar, tokens, step', () => {
  const line = agentSegments({ name: 'deep-reader', model: 'claude-sonnet-5-5', effort: 'medium', tokens: 12_400, pct: 40, step: 'reading auth' })
  assert.equal(lineText(line), 'deep-reader        Sonnet 5.5 ● ● ○ ○ ○ Medium ▓▓░░░░ 40%  12k  reading auth')
  assert.equal(line[2].tone, 'sonnet')
})

test('agentSegments drops the plugin prefix of the name', () => {
  assert.ok(lineText(agentSegments({ name: 'crew-chief:scanner', model: 'claude-haiku-5-5' })).startsWith('scanner '))
})

test('agentSegments with nothing known yet, and a step cut to the room left', () => {
  assert.equal(lineText(agentSegments({ name: 'Explore' })), 'Explore            starting')
  const line = agentSegments({ name: 'scanner', model: 'claude-haiku-5-5', effort: 'low', step: 'x'.repeat(200) }, 60)
  assert.ok(lineText(line).length <= 60, lineText(line))
  assert.ok(lineText(line).endsWith('…'))
  assert.equal(lineText(agentSegments({ name: 'a', model: 'claude-haiku-5-5', step: 'abc' }, 20)).includes('abc'), false) // no room
})

test('bandLines: status first, then agents, the rest as "+N more"; nothing known -> no lines', () => {
  const status = [{ t: 'ctx 5%', tone: 'ok' }]
  const agents = [1, 2, 3, 4, 5].map((n) => ({ name: 'a' + n, model: 'claude-haiku-5-5' }))
  const lines = bandLines({ status, agents, maxLines: 4 })
  assert.equal(lines.length, 4)
  assert.equal(lineText(lines[0]), 'ctx 5%')
  assert.equal(lineText(lines.at(-1)), '+3 more agents')
  assert.equal(bandLines({ status, agents: agents.slice(0, 3), maxLines: 4 }).length, 4)
  assert.deepEqual(bandLines({ status: [], agents: [] }), [])
  assert.equal(bandLines({ status: [], agents: agents.slice(0, 2) }).length, 2)
  assert.equal(bandLines({ status, agents, maxLines: 1 }).length, 1)
})

test('quietFacts keeps only what is worth a look', () => {
  const now = Date.parse('2026-10-28T20:00:00Z')
  const calm = {
    ctx: ctxChip({ tokens: 100_000, window: 1_000_000 }, 400_000),
    five: windowChip([{ kind: 'five_hour', percentUsed: 4 }], 'five_hour', now),
    week: windowChip([{ kind: 'seven_day', percentUsed: 10 }], 'seven_day', now),
    guard: { on: true, held: 0 },
    saver: true,
    compactKey: false,
  }
  assert.equal(lineText(statusSegments(quietFacts(calm))), '') // nothing to say
  const busy = {
    ...calm,
    ctx: ctxChip({ tokens: 750_000, window: 1_000_000 }, 400_000),
    week: windowChip([{ kind: 'seven_day', percentUsed: 96 }], 'seven_day', now),
    guard: { on: true, held: 2 },
    compactKey: true,
  }
  assert.equal(lineText(statusSegments(quietFacts(busy))), '7d 96%   guard on · 2 held   saver on   [1] compact') // no ctx in quiet mode, however full
  assert.equal(quietFacts({ ctx: ctxChip({ tokens: 450_000, window: 1_000_000 }, 400_000) }).ctx, undefined)
  assert.equal(quietFacts({ saver: true }).saver, false) // the saver only matters next to a high window
})

test('modelChip: family and effort meter for the plain-text spots', () => {
  assert.equal(modelChip('claude-sonnet-5-5', 'medium'), 'sonnet ●●○○○')
  assert.equal(modelChip('claude-opus-5-5', 'xhigh'), 'opus ●●●●○')
  assert.equal(modelChip('claude-opus-5-5', 'max'), 'opus ●●●●●')
  assert.equal(modelChip('claude-haiku-5-5', undefined), 'haiku') // no effort parameter
  assert.equal(modelChip('claude-someday-7', 'low'), 'someday-7 ●○○○○')
  assert.equal(modelChip(undefined, 'low'), '')
})

test('tailText: the most pressing window, else a loud context, else nothing', () => {
  const now = Date.parse('2026-10-28T20:00:00Z')
  const week = windowChip([{ kind: 'seven_day', percentUsed: 96, resetsAt: '2026-11-03T09:00:00Z' }], 'seven_day', now)
  const five = windowChip([{ kind: 'five_hour', percentUsed: 75 }], 'five_hour', now)
  assert.equal(tailText({ week, five }), '7d 96% ~5d13h')
  assert.equal(tailText({ five }), '5h 75%')
  assert.equal(tailText({ ctx: ctxChip({ tokens: 450_000, window: 1_000_000 }, 400_000) }), 'ctx 45%')
  assert.equal(tailText({ ctx: ctxChip({ tokens: 100_000, window: 1_000_000 }, 400_000) }), '')
  assert.equal(tailText({}), '')
})

test('modeLabels: the saver while on, the guard once it stopped something', () => {
  assert.deepEqual(modeLabels({ saver: true, guard: { on: true, held: 2 } }), ['crew-chief: saver on · guard 2 held'])
  assert.deepEqual(modeLabels({ saver: true }), ['crew-chief: saver on'])
  assert.deepEqual(modeLabels({ guard: { on: true, held: 0 } }), [])
  assert.deepEqual(modeLabels({}), [])
})

test('the bar of an agent line is two segments: filled in colour, empty dim', () => {
  const line = agentSegments({ name: 'a', model: 'claude-haiku-5-5', pct: 50 })
  const i = line.findIndex((s) => s.t === '▓▓▓')
  assert.equal(line[i].tone, 'ok')
  assert.equal(line[i + 1].t, '░░░')
  assert.equal(line[i + 1].tone, 'dim')
  assert.equal(lineText(agentSegments({ name: 'a', model: 'claude-haiku-5-5', pct: 100 })).includes('▓▓▓▓▓▓ 100%'), true)
})

test('demoContent has every part of the band', () => {
  const d = demoContent(Date.parse('2026-10-28T20:00:00Z'))
  assert.equal(d.agents.length, 4) // fresh, stale and no estimate, plus a type and model the art does not know
  assert.equal(d.facts.week.percent, 96)
  assert.equal(d.facts.compactKey, true)
  const lines = bandLines({ status: statusSegments(d.facts), agents: d.agents, maxLines: 5 })
  assert.equal(lines.length, 5)
  assert.ok(lineText(lines[0]).includes('[1] compact'))
})

test('sparkline: one block per value, the last 12, nothing under 3 values', () => {
  assert.equal(sparkline([0, 12, 25, 50, 75, 100]), '▁▁▃▅▇█')
  assert.equal(sparkline([10, 20]), '')
  assert.equal(sparkline(undefined), '')
  assert.equal(sparkline([5, 'x', NaN, 10, 15]), '▁▁▂') // not numbers are dropped
  assert.equal(sparkline(Array.from({ length: 30 }, (_, i) => i * 3)).length, 12)
  assert.equal(sparkline([-50, 500, 50]), '▁█▅') // clamped
})

test('the context chip carries its graph, and the status line shows it', () => {
  const chip = ctxChip({ tokens: 520_000, window: 1_000_000 }, 400_000, [10, 20, 30, 40, 52])
  assert.equal(chip.spark, '▁▂▃▄▅')
  assert.equal(lineText(statusSegments({ ctx: chip })), 'ctx ▁▂▃▄▅ 52% 520k/1M')
  assert.equal(ctxChip({ tokens: 1, window: 2 }, undefined, [1]).spark, '')
})

test('spinnerWord by model family', () => {
  assert.equal(spinnerWord('claude-opus-5-5'), 'Pondering')
  assert.equal(spinnerWord('claude-sonnet-5-5'), 'Working')
  assert.equal(spinnerWord('claude-haiku-5-5'), 'Skimming')
  assert.equal(spinnerWord('mystery'), undefined)
})

test('an agent on max effort draws five dots in five colours, then the word in its own tone', () => {
  const line = agentSegments({ name: 'implementer-hard', model: 'claude-opus-5-5', effort: 'max' })
  assert.deepEqual(line.filter((s) => s.t === '●').map((s) => s.tone), ['rb0', 'rb1', 'rb2', 'rb3', 'rb4'])
  assert.equal(lineText(line), 'implementer-hard   Opus 5.5 ● ● ● ● ● Max')
  assert.equal(line.at(-1).tone, 'max')
  assert.equal(agentSegments({ name: 'a', model: 'claude-opus-5-5', effort: 'xhigh' }).filter((s) => s.tone.startsWith('rb')).length, 0)
})

test('elapsedLabel: seconds, minutes, hours; nothing under a second or for a non-number', () => {
  assert.equal(elapsedLabel(38_000), '38s')
  assert.equal(elapsedLabel(252_000), '4m12s')
  assert.equal(elapsedLabel(3_900_000), '1h05m')
  assert.equal(elapsedLabel(400), '')
  assert.equal(elapsedLabel(undefined), '')
  assert.equal(elapsedLabel(NaN), '')
})

test('an agent whose model never reached us draws no model or effort, not a "starting" that stays', () => {
  const line = agentSegments({ name: 'implementer-hard', unknown: true, calls: 34, elapsedMs: 252_000 })
  assert.equal(lineText(line), 'implementer-hard     4m12s')
  assert.ok(!lineText(line).includes('starting'))
  assert.ok(lineText(agentSegments({ name: 'Explore' })).includes('starting')) // a young agent still says so
})

test('tempo: only the time, never a call count', () => {
  const none = lineText(agentSegments({ name: 'a', model: 'claude-haiku-5-5', calls: 12, elapsedMs: 75_000 }))
  assert.ok(none.endsWith('Haiku 5.5  1m15s'), none)
  const reported = lineText(agentSegments({ name: 'a', model: 'claude-haiku-5-5', calls: 12, pct: 40, elapsedMs: 75_000 }))
  assert.ok(reported.includes('40%') && reported.endsWith('1m15s') && !reported.includes('calls'), reported)
})

test('max effort: five rainbow dots apart and the word Max', () => {
  const line = agentSegments({ name: 'r', model: 'claude-opus-5-5', effort: 'max' })
  assert.ok(lineText(line).includes('Opus 5.5 ● ● ● ● ● Max'), lineText(line))
})

test('bandRows says which line is which', () => {
  const rows = bandRows({ status: [{ t: 'guard on', tone: 'ok' }], agents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], maxLines: 3 })
  assert.deepEqual(rows.map((r) => r.kind), ['status', 'agent', 'more'])
  assert.equal(rows[1].agent.name, 'a')
})

test('busy note: shown in quiet mode, with the count; ultra-saver stays visible in quiet mode', () => {
  const facts = { ctx: undefined, five: undefined, week: undefined, saver: 'ultra', busy: 6 }
  const q = quietFacts(facts)
  assert.equal(q.busy, 6)
  assert.equal(q.saver, 'ultra')
  const text = statusSegments(q).map((s) => s.t).join('')
  assert.ok(text.includes('6 agents running') && text.includes('ultra-saver on'))
  assert.equal(quietFacts({ saver: true }).saver, false)
})

test('a first run of an agent type is marked, a later one is not', () => {
  const text = (a) => agentSegments(a, 100).map((s) => s.t).join('')
  assert.ok(text({ name: 'crew-chief:planner', model: 'claude-opus-5-5', effort: 'high', fresh: true }).includes('first run'))
  assert.ok(!text({ name: 'crew-chief:planner', model: 'claude-opus-5-5', effort: 'high' }).includes('first run'))
})

test('ctxAlert: one toast per crossing, again only after dropping below', () => {
  const chip = (tokens) => ctxChip({ tokens, window: 1_000_000 }, 400_000)
  let r = ctxAlert(chip(100_000), undefined)
  assert.equal(r.fire, false)
  r = ctxAlert(chip(450_000), r.state) // past the compaction size, under 70 %
  assert.equal(r.fire, true)
  r = ctxAlert(chip(500_000), r.state) // still past: quiet
  assert.equal(r.fire, false)
  r = ctxAlert(chip(750_000), r.state) // 70 % newly crossed: one more
  assert.equal(r.fire, true)
  assert.equal(ctxAlert(chip(800_000), r.state).fire, false)
  r = ctxAlert(chip(50_000), r.state) // compacted
  assert.equal(r.fire, false)
  assert.equal(ctxAlert(chip(450_000), r.state).fire, true)
  assert.equal(ctxAlert(undefined, r.state).fire, false)
})

import { placeFolder, statusLineSegments, STATUS_LINE_SEP } from '../hooks/ui-logic.mjs'

test('statusLineSegments: the Desktop status line, in order, with what is missing left out', () => {
  const now = Date.parse('2026-11-15T12:00:00Z')
  const week = windowChip([{ kind: 'seven_day', percentUsed: 47.4, resetsAt: '2026-11-19T04:00:00Z' }], 'seven_day', now)
  const line = statusLineSegments({ folder: 'shop', branch: 'main', week, ctx: { percent: 12 }, tokens: 116_900, model: 'claude-haiku-5-5', effort: 'medium' })
  assert.equal(lineText(line), 'shop   |   main   |   7d: %47 ~3d 16h   |   ctx:12%   |   116k   |   Haiku 5.5 ●●○○○ Medium')
  assert.deepEqual(line.filter((s) => s.t === STATUS_LINE_SEP).map((s) => s.tone), ['dim', 'dim', 'dim', 'dim', 'dim'])
  assert.equal(line[0].color, '#ff3030')
  assert.equal(line[2].color, '#2ecc40')
  assert.equal(line[line.length - 1].color, '#ff5fff')
  const five = windowChip([{ kind: 'five_hour', percentUsed: 4, resetsAt: '2026-11-15T16:20:00Z' }], 'five_hour', now)
  assert.equal(lineText(statusLineSegments({ five, tokens: 1_240_000 })), '5h: %4 ~4h 20m   |   1.2M')
  assert.deepEqual(statusLineSegments({}), [])
})

test('placeFolder: the last part of the path, never a spare folder of the Desktop app', () => {
  assert.equal(placeFolder('/Users/me/projects/shop'), 'shop')
  assert.equal(placeFolder('/Users/me/projects/shop/'), 'shop')
  assert.equal(placeFolder('/Users/me/.claude/spares/spare-hYNb89'), '')
  assert.equal(placeFolder(undefined), '')
})

// ---- agent cards: the width one needs and the grid ----------------------------------------------------------

const crewCard = (name, model, effort) => agentCardText({ name: 'crew-chief:' + name, model, effort })
const CREW = [
  crewCard('scanner', 'claude-haiku-5-5', 'low'),
  crewCard('deep-reader', 'claude-sonnet-5-5', 'medium'),
  crewCard('implementer', 'claude-sonnet-5-5', 'medium'),
  crewCard('mechanic', 'claude-haiku-5-5', 'low'),
  crewCard('reviewer', 'claude-opus-5-5', 'high'),
]

test('cardGrid: five agents at 145 columns go two to a row (2, 2, 1); wide bands take three, narrow ones one', () => {
  const needs = CREW.map((c) => cardNeedCells(c, 'details ›'))
  const g = cardGrid(145, needs)
  assert.equal(g.per, 2)
  assert.ok(g.cell >= g.need && g.minWidth <= g.cell)
  assert.equal(cardGrid(230, needs).per, 3) // 3 and 2
  const narrow = cardGrid(60, needs)
  assert.equal(narrow.per, 1)
  assert.ok(narrow.minWidth <= 60)
})

test('cardGrid: the longest line 1 (implementer-hard, Sonnet, Medium, details ›) still fits two to a row at 145', () => {
  const need = cardNeedCells(crewCard('implementer-hard', 'claude-sonnet-5-5', 'medium'), 'details ›')
  assert.equal(cardGrid(145, [need, need, need]).per, 2)
})

test('cardGrid: a lone card is not stretched past 1.5x its need (an empty cell takes the rest); balanced rows', () => {
  const need = cardNeedCells(CREW[2], 'details ›')
  assert.equal(cardGrid(145, [need]).per, 2)
  assert.equal(cardGrid(100, [need]).per, 1) // under 1.5x: the card takes the row
  assert.equal(cardGrid(230, [need, need, need, need, need]).per, 3)
})

test('the first-run tag is drawn only where line 1 has room for it', () => {
  const c = crewCard('implementer-hard', 'claude-sonnet-5-5', 'medium')
  assert.ok(cardLine1Cells(c, true) > cardLine1Cells(c))
  assert.ok(cardLine1Cells(c, true) > cardTextRoom(71.5, 'details ›'))
  assert.ok(cardLine1Cells(crewCard('scanner', 'claude-haiku-5-5', 'low'), true) <= cardTextRoom(71.5, 'details ›'))
})

test('cardRowsFit: whole rows of cards (3 rows and a gap each) in what the frame, lines and a question leave', () => {
  assert.equal(cardRowsFit({ maxRows: 14, frame: 2, line: 1, status: 1 }), 2) // 10 left: 3 + 1 + 3, not a third
  assert.equal(cardRowsFit({ maxRows: 15, frame: 2, line: 1, status: 1 }), 3) // 11 left: 3 + 1 + 3 + 1 + 3
  assert.equal(cardRowsFit({ maxRows: 6, frame: 2, line: 1, status: 1, question: 4 }), 1) // never none by default
  assert.equal(cardRowsFit({ maxRows: 6, frame: 2, line: 1, status: 1, question: 4 }, 3, 0), 0) // a question first: none
  assert.equal(cardRowsFit({}), 1)
})

test('questionRows: the Desktop card counts its frame, head, facts and wrapped answers; the strip its wrapped text', () => {
  const look = { kind: 'card', topic: 'Token saver', question: 'Turn on?', facts: ['5-hour 82%'], note: 'a note', labels: ['Turn on saver', 'Ultra', 'Not now', "Don't ask again"] }
  const q = { text: 'Your 5-hour limit is 82% used. Turn on the token saver?', answers: ['a', 'b', 'c', 'd'], look }
  assert.equal(questionRows(q, true, 100), 6) // frame 2, head, facts, one row of answers, the gap after it
  assert.ok(questionRows(q, true, 40) > 6) // the answers wrap in a narrow band
  assert.equal(questionRows({ ...q, look: { ...look, facts: [], note: '' } }, true, 100), 5)
  assert.equal(questionRows(q, false, 100), 2)
  assert.ok(questionRows({ ...q, text: 'x'.repeat(300) }, false, 100) >= 4)
  assert.equal(questionRows(undefined, true, 100), 0)
})

test('cardBudget: every cell that fits holds a card; the agents past them are only counted (a chip outside the cards)', () => {
  const needs = (n) => Array.from({ length: n }, () => 60)
  const all = cardBudget(145, needs(4), 2)
  assert.deepEqual([all.cells, all.shown, all.more, all.rows], [4, 4, 0, 4])
  for (const [n, rows] of [[7, 2], [7, 1], [9, 3], [12, 2]]) {
    const b = cardBudget(145, needs(n), rows, 6)
    const drawnRows = Math.ceil(b.shown / b.grid.per)
    assert.ok(drawnRows <= rows, `${n} agents in ${rows} rows: ${drawnRows} drawn`)
    assert.ok(b.cells <= 6)
    assert.equal(b.shown + b.more, n)
    assert.ok(b.more > 0 && b.shown === b.cells, 'no cell is given to the chip')
    assert.equal(b.rows, b.shown)
    assert.deepEqual(cardBudget(145, needs(n), rows, 6), b, 'the same agents and room, the same layout')
  }
  // Five agents, four cells (two rows of two): four cards and one more, not three and '+2'.
  const four = cardBudget(145, needs(5), 2, 4)
  assert.deepEqual([four.shown, four.more], [4, 1])
  // One card to a row (a narrow band): every cell is a card.
  const narrow = cardBudget(60, needs(5), 2, 6)
  assert.equal(narrow.grid.per, 1)
  assert.deepEqual([narrow.shown, narrow.more, narrow.rows], [2, 3, 2])
  // No room at all (a question took it): no card, every agent counted.
  assert.deepEqual([cardBudget(145, needs(3), 0).shown, cardBudget(145, needs(3), 0).more], [0, 3])
})

test('statusSegments: the agents past the cards come first in the row, as a small chip', () => {
  assert.equal(lineText(statusSegments({ more: '+1 more', busy: 5 })), '+1 more   5 agents running · more than you can follow')
  assert.equal(quietFacts({ more: '+2 more' }).more, '+2 more')
})

import { PERF_ASK, perfArg, perfChoices, perfIcon, perfParts } from '../hooks/ui-logic.mjs'

test('perfArg: no argument asks, a scope or on sets it, anything else is refused', () => {
  assert.equal(perfArg(''), PERF_ASK)
  assert.equal(perfArg(undefined), PERF_ASK)
  for (const v of ['all', 'agents', 'theme', 'off']) assert.equal(perfArg(' ' + v.toUpperCase() + ' '), v)
  assert.equal(perfArg('on'), 'all')
  assert.equal(perfArg('toggle'), undefined)
  assert.equal(perfArg('maybe'), undefined)
})

test('perfParts: agents and theme stilled by their scope and by all', () => {
  assert.deepEqual(perfParts('off'), { agents: false, theme: false })
  assert.deepEqual(perfParts('agents'), { agents: true, theme: false })
  assert.deepEqual(perfParts('theme'), { agents: false, theme: true })
  assert.deepEqual(perfParts('all'), { agents: true, theme: true })
})

test('perfChoices: all, agents, theme, and off only while something is on; the current one marked by index', () => {
  assert.deepEqual(perfChoices('off'), { scopes: ['all', 'agents', 'theme'], current: -1 })
  assert.deepEqual(perfChoices('agents'), { scopes: ['all', 'agents', 'theme', 'off'], current: 1 })
  assert.deepEqual(perfChoices('theme'), { scopes: ['all', 'agents', 'theme', 'off'], current: 2 })
  assert.deepEqual(perfChoices('all'), { scopes: ['all', 'agents', 'theme', 'off'], current: 0 })
})

test('perfIcon: dim ⚡ off, ⚡a agents only, ⚡t theme only, bold ⚡ for all', () => {
  assert.deepEqual(perfIcon('off'), { text: '⚡', lit: false, bold: false })
  assert.deepEqual(perfIcon('agents'), { text: '⚡a', lit: true, bold: false })
  assert.deepEqual(perfIcon('theme'), { text: '⚡t', lit: true, bold: false })
  assert.deepEqual(perfIcon('all'), { text: '⚡', lit: true, bold: true })
})
