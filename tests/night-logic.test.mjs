// Run: node --test tests/night-logic.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  NIGHT_DEFAULTS,
  NIGHT_NUDGES_PER_HOUR,
  nightArmedStatus,
  nightDefaults,
  nightEventLine,
  nightHoldText,
  nightLeft,
  nightLimitHit,
  nightNoAnswerLabel,
  nightNudgeAllowed,
  nightNudgeText,
  nightOverStatus,
  nightQuietStatus,
  nightStatusText,
  nightText,
  nightWatchdogAction,
  parseNightState,
} from '../hooks/night-logic.mjs'

test('defaults: the file wins where its numbers are usable, the built-in values elsewhere', () => {
  assert.deepEqual(nightDefaults(undefined), NIGHT_DEFAULTS)
  assert.deepEqual(nightDefaults('not json'), NIGHT_DEFAULTS)
  const d = nightDefaults(JSON.stringify({ askMin: 2, limitPct: 90, maxAgents: -1, wrapMin: 'x', extra: 1 }))
  assert.equal(d.askMin, 2)
  assert.equal(d.limitPct, 90)
  assert.equal(d.maxAgents, 20)
  assert.equal(d.wrapMin, 30)
  assert.equal(d.extra, undefined)
})

test('state: only an object with a known status is a night', () => {
  assert.equal(parseNightState(''), undefined)
  assert.equal(parseNightState('{bad'), undefined)
  assert.equal(parseNightState('[]'), undefined)
  assert.equal(parseNightState(JSON.stringify({ status: 'sleeping' })), undefined)
  assert.equal(parseNightState(JSON.stringify({ status: 'armed', deadline: 5 })).deadline, 5)
})

test('quiet while opening, armed or wrapup; armed only for armed and wrapup; over for the three ends', () => {
  for (const s of ['opening', 'armed', 'wrapup']) assert.equal(nightQuietStatus(s), true)
  for (const s of ['done', 'stalled', 'stopped', undefined, '']) assert.equal(nightQuietStatus(s), false)
  assert.equal(nightArmedStatus('opening'), false)
  assert.equal(nightArmedStatus('armed'), true)
  assert.equal(nightArmedStatus('wrapup'), true)
  for (const s of ['done', 'stalled', 'stopped']) assert.equal(nightOverStatus(s), true)
  assert.equal(nightOverStatus('armed'), false)
})

test('the NO_ANSWER label names the minutes and says to park it', () => {
  assert.equal(nightNoAnswerLabel(20), 'NO_ANSWER: nobody answered within 20 minutes; park it in QUESTIONS.md and continue')
})

test('limit: the 5-hour window or the weekly limit at 95 percent, nothing below, nothing else', () => {
  assert.equal(nightLimitHit([], 95), undefined)
  assert.equal(nightLimitHit(undefined, 95), undefined)
  assert.equal(nightLimitHit([{ kind: 'five_hour', percentUsed: 94.9 }], 95), undefined)
  assert.deepEqual(nightLimitHit([{ kind: 'five_hour', percentUsed: 95 }], 95), { kind: 'five_hour', percent: 95 })
  assert.deepEqual(nightLimitHit([{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 96.5 }], 95), { kind: 'seven_day', percent: 96.5 })
  assert.deepEqual(nightLimitHit([{ kind: 'five_hour', percentUsed: 99 }, { kind: 'seven_day', percentUsed: 97 }], 95), { kind: 'five_hour', percent: 99 })
  assert.equal(nightLimitHit([{ kind: 'spend_limit', percentUsed: 120 }], 95), undefined)
})

test('nudges: at most six in a rolling hour', () => {
  const now = 10_000_000
  const five = [1, 2, 3, 4, 5].map((m) => now - m * 60_000)
  assert.equal(nightNudgeAllowed(five, now), true)
  const six = [...five, now - 59 * 60_000]
  assert.equal(six.length, NIGHT_NUDGES_PER_HOUR)
  assert.equal(nightNudgeAllowed(six, now), false)
  assert.equal(nightNudgeAllowed(six, now + 60_000), true) // the oldest left the hour
})

test('watchdog: nudge after 4 idle minutes, never while busy, fallback 2 minutes past the deadline', () => {
  const now = 100_000_000
  const base = { status: 'armed', deadline: now / 1000 + 3600, nowMs: now, lastActivityMs: now - 4 * 60_000, inFlight: false, compactBusy: false, agentsRunning: 0 }
  assert.equal(nightWatchdogAction(base), 'nudge')
  assert.equal(nightWatchdogAction({ ...base, lastActivityMs: now - 3 * 60_000 }), 'none')
  assert.equal(nightWatchdogAction({ ...base, status: 'opening' }), 'none')
  assert.equal(nightWatchdogAction({ ...base, status: 'done' }), 'none')
  assert.equal(nightWatchdogAction({ ...base, inFlight: true }), 'none')
  assert.equal(nightWatchdogAction({ ...base, inFlight: true, lastActivityMs: now - 31 * 60_000 }), 'nudge') // a lost turn end
  assert.equal(nightWatchdogAction({ ...base, compactBusy: true }), 'none')
  assert.equal(nightWatchdogAction({ ...base, agentsRunning: 1 }), 'none')
  assert.equal(nightWatchdogAction({ ...base, status: 'wrapup' }), 'nudge')
  const past = { ...base, deadline: (now - 60_000) / 1000 }
  assert.equal(nightWatchdogAction(past), 'none')
  const late = { ...base, deadline: (now - 2 * 60_000) / 1000 }
  assert.equal(nightWatchdogAction(late), 'fallback')
  assert.equal(nightWatchdogAction({ ...late, reportDone: true }), 'none')
  assert.equal(nightWatchdogAction({ ...late, fallbackDone: true }), 'none')
  assert.equal(nightWatchdogAction({ ...late, inFlight: true, lastActivityMs: now - 60_000 }), 'none')
})

test('texts: time left, the nudge, the event line, the hold', () => {
  assert.equal(nightLeft(0), '0m')
  assert.equal(nightLeft(-5), '0m')
  assert.equal(nightLeft(12 * 60_000 + 59_000), '12m')
  assert.equal(nightLeft(125 * 60_000), '2h 05m')
  const st = { status: 'armed', deadline: 7200, dir: '/r/night/abcd1234' }
  const nudge = nightNudgeText(st, 0, 'idle')
  assert.ok(!nudge.startsWith('/'))
  assert.match(nudge, /2h 00m left/)
  assert.match(nudge, /\/r\/night\/abcd1234\/NIGHT\.md/)
  assert.match(nightNudgeText(st, 0, 'compaction'), /just compacted/)
  assert.match(nightNudgeText({ ...st, status: 'wrapup' }, 0, 'idle'), /start nothing new/)
  assert.equal(nightEventLine(Date.UTC(2026, 10, 21, 3, 4, 5, 678), 'a\nb  c'), '2026-11-21T03:04:05Z mod a b c')
  assert.equal(nightHoldText(1_000_500), '1600\n')
})

test('status: phase, time left, current task, counts', () => {
  const now = 1_000_000_000
  const text = nightStatusText(
    { status: 'armed', deadline: now / 1000 + 3 * 3600, softWrap: now / 1000 + 2.5 * 3600, current: { id: 'AUTH-01', since: now / 1000 - 600 }, blocks: 4, noProgress: 1, spawned: 3 },
    now,
    NIGHT_DEFAULTS,
    '/r/night/abcd1234',
  )
  assert.match(text, /crew-chief night: armed/)
  assert.match(text, /3h 00m left/)
  assert.match(text, /task AUTH-01 for 10m/)
  assert.match(text, /stop blocks 4/)
  assert.match(text, /no-progress 1\/3/)
  assert.match(text, /subagents 3\/20/)
  assert.match(text, /folder: \/r\/night\/abcd1234/)
  assert.match(nightStatusText({ status: 'stopped', reason: 'off' }, now), /reason: off/)
})

test('toasts in English and Turkish, with the window named', () => {
  assert.equal(nightText('en', 'limit', { window: 'seven_day', percent: 95 }), 'Night: weekly limit at 95%, wrapping up.')
  assert.equal(nightText('tr', 'limit', { window: 'five_hour', percent: 96 }), 'Gece: 5 saatlik limiti %96, toparlama başladı.')
  assert.equal(nightText('xx', 'off'), 'Night mode is off.')
})

test('nightQuietState: quiet while open, not 10 minutes past the deadline', async () => {
  const { nightQuietState } = await import('../hooks/night-logic.mjs')
  const dl = 1_800_000_000
  assert.equal(nightQuietState({ status: 'armed', deadline: dl }, (dl - 60) * 1000), true)
  assert.equal(nightQuietState({ status: 'armed', deadline: dl }, (dl + 300) * 1000), true)
  assert.equal(nightQuietState({ status: 'armed', deadline: dl }, (dl + 601) * 1000), false)
  assert.equal(nightQuietState({ status: 'opening', deadline: 0 }, dl * 1000), true)
  assert.equal(nightQuietState({ status: 'done', deadline: dl }, (dl - 60) * 1000), false)
  assert.equal(nightQuietState(undefined, 0), false)
})
