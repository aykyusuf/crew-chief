import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agentSegments,
  bandLines,
  bar,
  demoContent,
  ctxChip,
  effortMeter,
  familyOf,
  lineText,
  modeLabels,
  modelChip,
  quietFacts,
  sparkline,
  spinnerWord,
  tailText,
  statusSegments,
  tokenLabel,
  untilLabel,
  windowChip,
} from '../hooks/ui-logic.mjs'

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

test('statusSegments leaves out what is unknown', () => {
  assert.deepEqual(statusSegments({}), [])
  assert.equal(lineText(statusSegments({ guard: { on: false } })), 'guard off')
  assert.equal(lineText(statusSegments({ guard: { on: true, held: 0 } })), 'guard on')
})

test('agentSegments: name, model, effort meter, bar, tokens, step', () => {
  const line = agentSegments({ name: 'deep-reader', model: 'claude-sonnet-5-5', effort: 'medium', tokens: 12_400, pct: 40, step: 'reading auth' })
  assert.equal(lineText(line), 'deep-reader        sonnet-5.5 ●●○○○ medium ▓▓░░░░ 40%  12k  reading auth')
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
  assert.equal(lineText(statusSegments(quietFacts(busy))), 'ctx 75% 750k/1M   7d 96%   guard on · 2 held   saver on   [1] compact')
  assert.equal(quietFacts({ ctx: ctxChip({ tokens: 450_000, window: 1_000_000 }, 400_000) }).ctx.past, true) // past the compaction size, though under 70 %
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
  assert.equal(d.agents.length, 3)
  assert.equal(d.facts.week.percent, 96)
  assert.equal(d.facts.compactKey, true)
  const lines = bandLines({ status: statusSegments(d.facts), agents: d.agents, maxLines: 4 })
  assert.equal(lines.length, 4)
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
  assert.equal(lineText(line), 'implementer-hard   opus-5.5 ●●●●● max')
  assert.equal(line.at(-1).tone, 'max')
  assert.equal(agentSegments({ name: 'a', model: 'claude-opus-5-5', effort: 'xhigh' }).filter((s) => s.tone.startsWith('rb')).length, 0)
})
