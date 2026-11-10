import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULTS,
  enforceDue,
  isCommit,
  isCountedPath,
  isHandoffPath,
  limitNear,
  looksLikeRule,
  newState,
  noteCall,
  ordinaryDue,
  ordinaryText,
  sentOrdinary,
  wrote,
} from '../hooks/handoff-nudge-logic.mjs'

const ROOT = '/work'
const MIN = 60_000
const edit = (path) => ({ tool: 'Edit', file_path: path })

test('what counts: project files only, not generated ones, not the handoff files', () => {
  assert.equal(isCountedPath('/work/src/a.js', ROOT), true)
  assert.equal(isCountedPath('/other/src/a.js', ROOT), false)
  assert.equal(isCountedPath('/work/node_modules/x/index.js', ROOT), false)
  assert.equal(isCountedPath('/work/package-lock.json', ROOT), false)
  assert.equal(isCountedPath('/work/lib/model.g.dart', ROOT), false)
  assert.equal(isCountedPath('/work/dist/app.min.js', ROOT), false)
  assert.equal(isCountedPath('/work/STATUS.md', ROOT), false)
  assert.equal(isCountedPath('/workshop/a.js', ROOT), false) // a sibling folder with the same prefix
  assert.equal(isHandoffPath('/work/docs/tasks.json'), true)
  assert.equal(isHandoffPath('/work/durum.md'), true)
})

test('edits are counted by distinct file; a handoff write restarts the stretch', () => {
  const s = newState()
  assert.equal(noteCall(s, edit('/work/a.js'), ROOT, 1000), 'counted')
  assert.equal(noteCall(s, edit('/work/a.js'), ROOT, 2000), 'counted')
  assert.equal(noteCall(s, { tool: 'Write', file_path: '/work/b.js' }, ROOT, 3000), 'counted')
  assert.equal(s.files.size, 2)
  assert.equal(s.edits, 3)
  assert.equal(s.since, 1000)
  assert.equal(noteCall(s, { tool: 'Bash', command: 'ls' }, ROOT, 4000), undefined)
  assert.equal(noteCall(s, edit('/work/STATUS.md'), ROOT, 5000), 'wrote')
  assert.equal(s.files.size, 0)
  assert.equal(s.since, undefined)
})

test('a reminder is due after enough files, or fewer files after enough time; not for nothing', () => {
  const cfg = { ...DEFAULTS }
  const s = newState()
  assert.equal(ordinaryDue(s, cfg, 0), false)
  for (let i = 0; i < 5; i++) noteCall(s, edit(`/work/f${i}.js`), ROOT, 0)
  assert.equal(ordinaryDue(s, cfg, 10 * MIN), false) // 5 files, 10 minutes
  assert.equal(ordinaryDue(s, cfg, 50 * MIN), true) // enough time with a third of the files
  noteCall(s, edit('/work/f5.js'), ROOT, 0)
  assert.equal(ordinaryDue(s, cfg, MIN), true) // 6 files
  assert.equal(ordinaryDue({ ...s, files: new Set(['/work/a.js']), since: 0 }, cfg, 500 * MIN), false) // one file is never enough
  assert.equal(ordinaryDue(s, { ...cfg, mode: 'off' }, MIN), false)
})

test('reminders are spaced, capped, and stop after three unanswered', () => {
  const cfg = { ...DEFAULTS, files: 3 }
  const s = newState()
  for (let i = 0; i < 3; i++) noteCall(s, edit(`/work/f${i}.js`), ROOT, 0)
  assert.equal(ordinaryDue(s, cfg, 0), true)
  sentOrdinary(s, 0)
  noteCall(s, edit('/work/g.js'), ROOT, 1)
  assert.equal(ordinaryDue(s, cfg, 2 * MIN), false) // too soon and too few new files
  for (let i = 0; i < 3; i++) noteCall(s, edit(`/work/h${i}.js`), ROOT, 1)
  assert.equal(ordinaryDue(s, cfg, 11 * MIN), true)
  sentOrdinary(s, 11 * MIN)
  for (let i = 0; i < 3; i++) noteCall(s, edit(`/work/i${i}.js`), ROOT, 1)
  sentOrdinary(s, 30 * MIN)
  assert.equal(s.unanswered, 3)
  assert.equal(ordinaryDue(s, cfg, 90 * MIN), false) // the person is ignoring them: stop
  wrote(s, 123)
  assert.equal(s.unanswered, 0)
  assert.equal(s.baseline, 123)
})

test('the text gets louder when the first one went unanswered, and always carries the routine', () => {
  const s = newState()
  for (let i = 0; i < 6; i++) noteCall(s, edit(`/work/f${i}.js`), ROOT, 0)
  const first = ordinaryText(s, 20 * MIN)
  assert.ok(first.includes('6 files') && first.includes('20 min') && first.includes('ignore this'))
  sentOrdinary(s, 20 * MIN)
  const second = ordinaryText(s, 40 * MIN)
  assert.ok(second.includes('reminder 2') && second.includes('without warning') && !second.includes('ignore this'))
  assert.ok(second.includes('status and evidence change'))
})

test('the extra turn (mode turn) needs unanswered reminders and a pile twice the trigger, once', () => {
  const cfg = { ...DEFAULTS, mode: 'turn', files: 4 }
  const s = newState()
  for (let i = 0; i < 8; i++) noteCall(s, edit(`/work/f${i}.js`), ROOT, 0)
  assert.equal(enforceDue(s, cfg, MIN), false) // no reminder was sent yet
  sentOrdinary(s, 0)
  assert.equal(enforceDue(s, cfg, MIN), true)
  assert.equal(enforceDue(s, { ...cfg, mode: 'nudge' }, MIN), false)
  s.enforced = true
  assert.equal(enforceDue(s, cfg, MIN), false)
})

test('rules, commits and limits are recognised in English and Turkish', () => {
  assert.equal(looksLikeRule('Never touch the generated client from now on'), true)
  assert.equal(looksLikeRule('asla kendi kararınla branch açma'), true)
  assert.equal(looksLikeRule('bundan sonra testleri çalıştırmadan commit yok'), true)
  assert.equal(looksLikeRule('fix the login bug'), false)
  assert.equal(looksLikeRule('/crew-config'), false)
  assert.equal(looksLikeRule('yapma'), false) // too short to be a rule on its own
  assert.equal(isCommit('git commit -m "x"'), true)
  assert.equal(isCommit('git -c user.name=x commit --amend'), true)
  assert.equal(isCommit('git commit --dry-run'), false)
  assert.equal(isCommit('git log'), false)
  assert.equal(limitNear([{ kind: 'five_hour', percentUsed: 91 }]), true)
  assert.equal(limitNear([{ kind: 'five_hour', percentUsed: 80 }, { kind: 'seven_day', percentUsed: 94 }]), false)
  assert.equal(limitNear(undefined), false)
})
