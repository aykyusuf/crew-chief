// Run: node --test tests/compact-logic.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ARM_TOKENS,
  backgroundNote,
  ASK_TOKENS,
  FOCUS_BLOCK,
  FOCUS_MARKER,
  anchorsOf,
  backupName,
  backupsToPrune,
  checkSummary,
  compactThresholds,
  lineSurvives,
  openTasks,
  parseStatus,
  parseTokens,
  pluginDataDir,
  projectDirName,
  splitProgress,
  withFocus,
} from '../hooks/compact-logic.mjs'

test('parseTokens reads k and m suffixes and refuses nonsense', () => {
  assert.equal(parseTokens('250k'), 250_000)
  assert.equal(parseTokens(' 1M '), 1_000_000)
  assert.equal(parseTokens('300000'), 300_000)
  assert.equal(parseTokens('1.5m'), 1_500_000)
  assert.equal(parseTokens('abc'), undefined)
  assert.equal(parseTokens('5'), undefined) // below 10k: a typo, not a threshold
  assert.equal(parseTokens(undefined), undefined)
})

test('thresholds: absolute on a 1M window, scaled down on a small one', () => {
  assert.deepEqual(compactThresholds(1_000_000), { arm: ARM_TOKENS, ask: ASK_TOKENS })
  assert.deepEqual(compactThresholds(200_000), { arm: 120_000, ask: 170_000 })
  assert.deepEqual(compactThresholds(undefined), { arm: ARM_TOKENS, ask: ASK_TOKENS })
})

test('thresholds: overrides win, and ask stays above arm', () => {
  assert.deepEqual(compactThresholds(1_000_000, { arm: 100_000, ask: 150_000 }), { arm: 100_000, ask: 150_000 })
  const t = compactThresholds(1_000_000, { arm: 500_000, ask: 300_000 })
  assert.ok(t.ask > t.arm)
})

test('withFocus: the person\'s text stays first, the brief follows once', () => {
  assert.equal(withFocus(undefined), FOCUS_BLOCK)
  assert.equal(withFocus('   '), FOCUS_BLOCK)
  const merged = withFocus('keep the API changes')
  assert.ok(merged.startsWith('keep the API changes\n\n' + FOCUS_MARKER))
  assert.equal(withFocus(merged), merged) // idempotent
})

test('the brief names every default section, the verbatim rule and the unconfirmed rule', () => {
  for (const word of ['Primary request', 'Constraints', 'VERBATIM', 'Decisions', 'Files and code', 'Errors and fixes', 'UNCONFIRMED', 'CONFIRMED', 'user messages', 'Pending tasks', 'Do not call tools']) {
    assert.ok(FOCUS_BLOCK.includes(word), word)
  }
  assert.ok(FOCUS_BLOCK.length < 16_384) // the documented API limit for instructions
})

const STATUS = `# Proje: status

## Now
- Working: login ekranı
- Verified: \`npm test\` geçti

## Constraints (rules the user set)
- Do not modify \`lib/legacy/\`
- "no commits" until the user says so
- ...

## Next
1. AUTH-01 bitir

## Decisions and assumptions
| Topic | Decision / assumption |
|---|---|
| DB | Postgres, not SQLite |

## Failed attempts and lessons
- <what was tried> -> <why> -> <what replaced it>
- cache denendi -> eski veri döndü -> kaldırıldı
`

test('parseStatus: sections found by heading, placeholders and table chrome skipped', () => {
  const s = parseStatus(STATUS)
  assert.deepEqual(s.constraints, ['- Do not modify `lib/legacy/`', '- "no commits" until the user says so'])
  assert.deepEqual(s.now, ['- Working: login ekranı', '- Verified: `npm test` geçti'])
  assert.deepEqual(s.next, ['1. AUTH-01 bitir'])
  assert.deepEqual(s.decisions, ['| DB | Postgres, not SQLite |'])
  assert.deepEqual(s.failed, ['- cache denendi -> eski veri döndü -> kaldırıldı'])
})

test('parseStatus: Turkish headings work, and junk gives empty sections', () => {
  const s = parseStatus('## Kısıtlar\n- `lib/` dosyalarına dokunma\n## Kararlar\n- Supabase\n')
  assert.deepEqual(s.constraints, ['- `lib/` dosyalarına dokunma'])
  assert.deepEqual(s.decisions, ['- Supabase'])
  assert.deepEqual(parseStatus(undefined).constraints, [])
  assert.deepEqual(parseStatus('no headings at all').now, [])
})

test('openTasks: only unfinished tasks, bad JSON gives nothing', () => {
  const json = JSON.stringify({
    tasks: [
      { id: 'A-1', title: 'one', status: 'done', done_when: 'x' },
      { id: 'A-2', title: 'two', status: 'in_progress', done_when: 'tests pass' },
      { id: 'A-3', title: 'three', status: 'blocked', done_when: 'y' },
      { id: 'A-4', title: 'four', status: 'todo' },
    ],
  })
  const open = openTasks(json)
  assert.deepEqual(open.map((t) => t.id), ['A-2', 'A-3', 'A-4'])
  assert.equal(open[0].doneWhen, 'tests pass')
  assert.deepEqual(openTasks('{not json'), [])
  assert.deepEqual(openTasks('{"tasks": 5}'), [])
})

test('anchorsOf: code, quotes, ids and paths are strong; plain prose falls back to long words', () => {
  assert.deepEqual(anchorsOf('Do not modify `lib/legacy/`').items.sort(), ['lib/legacy/'].sort().concat([]).sort())
  assert.equal(anchorsOf('"no commits" until told').kind, 'strong')
  assert.deepEqual(anchorsOf('finish AUTH-01 today').items, ['AUTH-01'])
  assert.equal(anchorsOf('always answer politely and briefly').kind, 'words')
})

test('lineSurvives: a rewording that keeps the anchor survives, a lost anchor does not', () => {
  assert.ok(lineSurvives('The user said not to touch lib/legacy/ at all.', 'Do not modify `lib/legacy/`'))
  assert.ok(!lineSurvives('The user wants a login screen.', 'Do not modify `lib/legacy/`'))
  assert.ok(lineSurvives('Reminder: NO COMMITS until told.', '"no commits" until the user says so'))
})

test('lineSurvives: prose lines need half of their long words; no anchor means nothing to test', () => {
  const line = 'always answer politely and briefly in turkish'
  assert.ok(lineSurvives('Answer politely, briefly, in Turkish.', line))
  assert.ok(!lineSurvives('Something unrelated happened here.', line))
  assert.ok(lineSurvives('anything', 'ok'))
})

test('checkSummary lists what the summary lost', () => {
  const tasks = [
    { id: 'AUTH-01', title: 'Login screen', status: 'todo', doneWhen: '' },
    { id: 'DB-02', title: 'Migration script', status: 'blocked', doneWhen: '' },
  ]
  const r = checkSummary('Working on AUTH-01. Keep lib/legacy/ untouched.', {
    constraints: ['Do not modify `lib/legacy/`', '"no commits" until the user says so'],
    tasks,
  })
  assert.deepEqual(r.missingConstraints, ['"no commits" until the user says so'])
  assert.deepEqual(r.missingTasks.map((t) => t.id), ['DB-02'])
  const clean = checkSummary('AUTH-01 and DB-02; lib/legacy/ is off limits; no commits yet', {
    constraints: ['Do not modify `lib/legacy/`', '"no commits" until the user says so'],
    tasks,
  })
  assert.deepEqual(clean, { missingConstraints: [], missingTasks: [] })
})

const LOG = `# Proje: progress

Task status lives in tasks.json.

## Log
- 2026-10-12: newest. evidence.
  second line of the newest.
- 2026-08-01: old one.
- 2026-07-30: older one.
- not a dated line, belongs to the previous entry
- 2026-13-45: impossible date stays
`

test('splitProgress: only dated entries older than the cutoff move, the rest keeps its order', () => {
  const now = Date.UTC(2026, 9, 15) // 15 Oct 2026
  const r = splitProgress(LOG, now, 60)
  assert.equal(r.count, 2)
  assert.ok(r.archived.includes('2026-08-01: old one.'))
  assert.ok(r.archived.includes('not a dated line, belongs to the previous entry'))
  assert.ok(r.archived.includes('2026-07-30: older one.'))
  assert.ok(r.keep.includes('2026-10-12: newest.'))
  assert.ok(r.keep.includes('second line of the newest.'))
  assert.ok(r.keep.includes('2026-13-45: impossible date stays'))
  assert.ok(r.keep.startsWith('# Proje: progress'))
  assert.ok(!r.keep.includes('old one'))
})

test('splitProgress: nothing old means nothing archived and the text is unchanged in substance', () => {
  const r = splitProgress(LOG, Date.UTC(2026, 9, 15), 400)
  assert.equal(r.count, 0)
  assert.equal(r.archived, '')
  assert.equal(r.keep.trim(), LOG.trim())
})

test('splitProgress: a non-dated section after an old entry stays where it is', () => {
  const text = '# Progress\n\n- 2026-01-01: old one\n- 2026-01-02: old two\n\n## Conventions\nKeep one line per day.\n'
  const r = splitProgress(text, Date.UTC(2026, 9, 15), 60)
  assert.equal(r.count, 2)
  assert.ok(r.keep.includes('## Conventions'))
  assert.ok(r.keep.includes('Keep one line per day.'))
  assert.ok(r.keep.startsWith('# Progress'))
  assert.ok(!r.archived.includes('Conventions'))
  assert.ok(r.archived.includes('2026-01-01: old one'))
})

test('pluginDataDir maps the cache folder to the data folder, a plain directory to nothing', () => {
  assert.equal(
    pluginDataDir('/Users/me/.claude/plugins/cache/crew-chief/crew-chief/0.5.0', '/Users/me'),
    '/Users/me/.claude/plugins/data/crew-chief-crew-chief',
  )
  assert.equal(pluginDataDir('/work/crew-chief', '/Users/me'), undefined)
  assert.equal(pluginDataDir('/Users/me/.claude/plugins/cache/only', '/Users/me'), undefined)
})

test('projectDirName replaces every non-alphanumeric character', () => {
  assert.equal(projectDirName('/private/tmp/claude-501/-Users-x/.y'), '-private-tmp-claude-501--Users-x--y')
})

test('backup names sort by time and old ones are pruned', () => {
  const a = backupName('compact', Date.UTC(2026, 9, 15, 10, 0, 0))
  const b = backupName('compact', Date.UTC(2026, 9, 15, 11, 0, 0))
  const c = backupName('compact', Date.UTC(2026, 9, 16, 9, 0, 0))
  assert.equal(a, 'compact-20261015T100000Z.md')
  assert.deepEqual(backupsToPrune([c, a, b, 'other-1.md'], 'compact', 2), [a])
  assert.deepEqual(backupsToPrune([a, b], 'compact', 5), [])
  assert.equal(backupName('../evil', 0), 'evil-19700101T000000Z.md')
})

test('withFocus: an extra line follows the brief; backgroundNote names the processes, at most five', () => {
  const merged = withFocus('mine', 'EXTRA LINE')
  assert.ok(merged.startsWith('mine\n\n' + FOCUS_MARKER))
  assert.ok(merged.endsWith('\nEXTRA LINE'))
  assert.equal(withFocus(merged, 'EXTRA LINE'), merged)
  assert.equal(backgroundNote([]), '')
  assert.equal(backgroundNote(undefined), '')
  const note = backgroundNote(['npm run dev', 'uvicorn app:app', 'a', 'b', 'c', 'd'])
  assert.ok(note.includes('npm run dev; uvicorn app:app'))
  assert.ok(!note.includes('; d'))
  assert.ok(note.includes('with their ids and commands, so nobody starts them a second time'))
})
