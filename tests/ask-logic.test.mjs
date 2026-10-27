import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NEVER_LABELS, minutesLabel, parseAskTimeout, pickFallback } from '../hooks/ask-logic.mjs'
import { t } from '../hooks/saver-i18n.mjs'

const MIN = 60_000

test('the deadline defaults to 20 minutes', () => {
  assert.equal(parseAskTimeout(undefined), 20 * MIN)
  assert.equal(parseAskTimeout(null), 20 * MIN)
  assert.equal(parseAskTimeout(''), 20 * MIN)
})

test('whole minutes from 1 to 30 are taken; more is clamped to 30', () => {
  assert.equal(parseAskTimeout('1'), 1 * MIN)
  assert.equal(parseAskTimeout(' 5 '), 5 * MIN)
  assert.equal(parseAskTimeout('30'), 30 * MIN)
  assert.equal(parseAskTimeout('31'), 30 * MIN)
  assert.equal(parseAskTimeout('600'), 30 * MIN)
})

test('"off" and "0" mean no deadline', () => {
  assert.equal(parseAskTimeout('off'), 0)
  assert.equal(parseAskTimeout('OFF'), 0)
  assert.equal(parseAskTimeout('0'), 0)
})

test('anything else is the default', () => {
  for (const raw of ['abc', '-5', '2.5', '10m', 'on', '1e3']) assert.equal(parseAskTimeout(raw), 20 * MIN, raw)
})

test('the fallback must be one of the answers, and not the first (the yes)', () => {
  assert.equal(pickFallback(['Yes', 'Not now', 'Never'], 'Not now'), 'Not now')
  assert.equal(pickFallback(['Yes', 'No'], 'No'), 'No')
  assert.equal(pickFallback(['Yes', 'Not now'], 'Yes'), undefined)
  assert.equal(pickFallback(['Yes', 'Not now'], 'Maybe'), undefined)
  assert.equal(pickFallback(['Yes'], 'Yes'), undefined)
  assert.equal(pickFallback(undefined, 'No'), undefined)
  assert.equal(pickFallback(['Yes', 'No'], undefined), undefined)
})

test('a "don\'t ask again" label is never a fallback, in either language', () => {
  for (const lang of ['en', 'tr']) {
    for (const key of ['answer_never', 'ck_never', 'limit_never', 'advisor_answer_never']) {
      const never = t(lang, key)
      assert.ok(NEVER_LABELS.has(never), key)
      assert.equal(pickFallback(['Yes', 'Later', never], never), undefined, lang + ' ' + key)
    }
  }
})

test('every fallback the mod uses is accepted', () => {
  for (const lang of ['en', 'tr']) {
    const cases = [
      [['answer_on', 'answer_not_now', 'answer_never'], 1],
      [['advisor_answer_on', 'advisor_answer_later', 'advisor_answer_never'], 1],
      [['ck_yes', 'ck_later', 'ck_never'], 1],
      [['ck_gate_anyway', 'ck_gate_retry', 'ck_gate_cancel'], 2],
      [['limit_yes', 'limit_no', 'limit_never'], 1],
      [['tidy_archive_yes', 'tidy_archive_no'], 1],
    ]
    for (const [keys, at] of cases) {
      const answers = keys.map((k) => t(lang, k))
      assert.equal(pickFallback(answers, answers[at]), answers[at], lang + ' ' + keys[at])
    }
  }
})

test('the toast shows whole minutes, at least 1', () => {
  assert.equal(minutesLabel(20 * MIN), 20)
  assert.equal(minutesLabel(1000), 1)
})
