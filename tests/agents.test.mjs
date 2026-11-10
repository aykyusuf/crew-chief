import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('../agents/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
const front = (name) => {
  const text = readFileSync(new URL(name, dir), 'utf8')
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  assert.ok(m, name + ': frontmatter')
  return Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))
}

test('every agent has name = file name, description, model, effort and a turn limit', () => {
  assert.ok(files.length >= 9)
  for (const f of files) {
    const fm = front(f)
    assert.equal(fm.name, f.replace(/\.md$/, ''), f)
    assert.ok(fm.description.length > 60, f + ': description')
    assert.ok(['haiku', 'sonnet', 'opus'].includes(fm.model), f + ': model')
    assert.ok(['low', 'medium', 'high'].includes(fm.effort), f + ': effort')
    assert.ok(Number(fm.maxTurns) > 0, f + ': maxTurns')
  }
})

test('mechanic is a cheap writer and planner a read-only Opus, both named in the policy and the routing skill', () => {
  const mech = front('mechanic.md')
  assert.equal(mech.model, 'haiku')
  assert.ok(mech.tools.includes('Edit') && !mech.tools.includes('Write'))
  const plan = front('planner.md')
  assert.equal(plan.model, 'opus')
  assert.ok(!plan.tools.includes('Edit'))
  const policy = readFileSync(new URL('../scripts/session-policy.sh', import.meta.url), 'utf8')
  const skill = readFileSync(new URL('../skills/crew-routing/SKILL.md', import.meta.url), 'utf8')
  const guard = readFileSync(new URL('../scripts/readonly-guard.sh', import.meta.url), 'utf8')
  for (const n of ['mechanic', 'planner']) {
    assert.ok(policy.includes('crew-chief:' + n), n + ' in policy')
    assert.ok(skill.includes('crew-chief:' + n), n + ' in routing skill')
  }
  assert.ok(guard.includes('crew-chief:planner'))
  assert.ok(!guard.includes('crew-chief:mechanic'))
})

test('every read-only agent that can write reports is covered by the read-only guard', () => {
  const guard = readFileSync(new URL('../scripts/readonly-guard.sh', import.meta.url), 'utf8')
  for (const f of files) {
    const fm = front(f)
    if (!fm.tools.includes('Edit')) assert.ok(guard.includes('crew-chief:' + fm.name) || fm.name.startsWith('ui-tester'), fm.name)
  }
})

test('writing agents ask the caller about a missing dependency instead of installing; the routing skill says what the caller does', () => {
  for (const n of ['implementer', 'implementer-hard', 'mechanic']) {
    const text = readFileSync(new URL(n + '.md', dir), 'utf8')
    assert.ok(text.includes('install packages'), n)
    assert.ok(text.includes('declared dependency is missing'), n + ': dependency protocol')
    assert.ok(text.includes('the caller owns'), n + ': reason given')
  }
  const skill = readFileSync(new URL('../skills/crew-routing/SKILL.md', import.meta.url), 'utf8')
  assert.ok(skill.includes('dependency is missing') && skill.includes('ask the user first'))
  assert.ok(skill.includes('If your own model is Fable'))
  const policy = readFileSync(new URL('../scripts/session-policy.sh', import.meta.url), 'utf8')
  assert.ok(policy.includes('If your own model is Fable'))
})

test('every agent says why it is read-only or limited, batches independent calls, and the web agents check the date', () => {
  for (const n of ['scanner', 'deep-reader', 'planner', 'reviewer']) {
    assert.ok(/owns? (every|the) change/.test(readFileSync(new URL(n + '.md', dir), 'utf8')), n + ': reason for being read-only')
  }
  for (const n of ['scanner', 'deep-reader', 'planner', 'reviewer', 'implementer', 'implementer-hard', 'mechanic']) {
    assert.ok(/[Bb]atch independent/.test(readFileSync(new URL(n + '.md', dir), 'utf8')), n + ': batching')
  }
  for (const n of ['deep-reader', 'planner']) assert.ok(readFileSync(new URL(n + '.md', dir), 'utf8').includes('date +%F'), n + ': date')
  for (const n of ['implementer', 'implementer-hard']) assert.ok(readFileSync(new URL(n + '.md', dir), 'utf8').includes('special-cases the test inputs'), n + ': no hardcoding')
})

test('the handoff routine reviews stale constraints without deleting them', () => {
  const routine = readFileSync(new URL('../skills/crew-handoff/assets/claude-md-routine.md', import.meta.url), 'utf8')
  assert.ok(routine.includes('do not delete it') && routine.includes('reason and scope'))
})
