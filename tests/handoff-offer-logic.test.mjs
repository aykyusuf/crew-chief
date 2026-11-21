// Run: node --test tests/handoff-offer-logic.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  HANDOFF_FILE_NAMES,
  LATER_SECONDS,
  answerKind,
  answerLabels,
  appendRecord,
  hasHandoffBlock,
  isHandoffName,
  isProjectFolder,
  lastRecord,
  markerFresh,
  recordLine,
  recordSilences,
  resolveDataDir,
  setupPrompt,
  skipRoot,
  subdirsToSearch,
} from '../hooks/handoff-offer-logic.mjs'
import { MESSAGES } from '../hooks/saver-i18n.mjs'

const HOME = '/Users/me'

test('skipRoot: home, the file system root, temp folders, empty and quoted paths', () => {
  assert.equal(skipRoot('/Users/me/proj', HOME), false)
  for (const bad of [HOME, HOME + '/', '/', '/tmp', '/tmp/x', '/private/tmp/x', '/private/var/folders/ab/T/x', '/var/folders/x', '', undefined, "/Users/me/it's"]) {
    assert.equal(skipRoot(bad, HOME), true, String(bad))
  }
  assert.equal(skipRoot('/tmpfoo/x', HOME), false, 'a name that only starts with tmp is a project')
})

test('isProjectFolder: a real, non-empty folder that is not one of the home directory plain folders', () => {
  assert.equal(isProjectFolder('/Users/me/play', HOME, ['a.py']), true)
  assert.equal(isProjectFolder('/Users/me/play', HOME, []), false)
  assert.equal(isProjectFolder('/Users/me/play', HOME, ['.DS_Store']), false)
  assert.equal(isProjectFolder(HOME, HOME, ['a']), false)
  assert.equal(isProjectFolder('/tmp/x', HOME, ['a']), false)
  assert.equal(isProjectFolder('/Users/me/Downloads', HOME, ['a']), false)
  assert.equal(isProjectFolder('/Users/me/Downloads/app', HOME, ['a']), true)
})

test('handoff file names are the shell script list', () => {
  assert.deepEqual([...HANDOFF_FILE_NAMES].sort(), ['HANDOFF.md', 'PROGRESS.md', 'STATUS.md', 'claude-progress.txt', 'durum.md', 'feature_list.json', 'ilerleme.md', 'tasks.json'])
  assert.equal(isHandoffName('STATUS.md'), true)
  assert.equal(isHandoffName('README.md'), false)
})

test('subdirsToSearch: folders only, no hidden ones, capped', () => {
  const entries = [{ name: 'a', kind: 'dir' }, { name: '.git', kind: 'dir' }, { name: 'f.txt', kind: 'file' }, { name: 'b', kind: 'dir' }]
  assert.deepEqual(subdirsToSearch(entries), ['a', 'b'])
  assert.deepEqual(subdirsToSearch(entries, 1), ['a'])
  assert.deepEqual(subdirsToSearch(undefined), [])
})

test('hasHandoffBlock', () => {
  assert.equal(hasHandoffBlock('x\n<!-- crew-chief:handoff:start -->'), true)
  assert.equal(hasHandoffBlock('# nothing'), false)
  assert.equal(hasHandoffBlock(undefined), false)
})

test('lastRecord: the last line for the root wins; a path that is a prefix of another does not match', () => {
  const tsv = '/a\tnever\n/ab\tinstalled\n/a\tlater\t100\n/b\tlater\t5\n'
  assert.deepEqual(lastRecord(tsv, '/a'), { answer: 'later', when: 100 })
  assert.deepEqual(lastRecord(tsv, '/ab'), { answer: 'installed', when: undefined })
  assert.equal(lastRecord(tsv, '/c'), undefined)
  assert.equal(lastRecord('', '/a'), undefined)
  assert.deepEqual(lastRecord('/a\tlater\t12\r\n', '/a'), { answer: 'later', when: 12 }, 'CRLF is tolerated')
  assert.deepEqual(lastRecord('/a\tlater\tabc\n', '/a'), { answer: 'later', when: undefined }, 'a bad time is no time')
})

test('recordSilences: installed and never always; later for 7 days; a later without a usable time does not', () => {
  const now = 1_000_000
  assert.equal(recordSilences(undefined, now), false)
  assert.equal(recordSilences({ answer: 'installed' }, now), true)
  assert.equal(recordSilences({ answer: 'never' }, now), true)
  assert.equal(recordSilences({ answer: 'later', when: now - 100 }, now), true)
  assert.equal(recordSilences({ answer: 'later', when: now - LATER_SECONDS + 1 }, now), true)
  assert.equal(recordSilences({ answer: 'later', when: now - LATER_SECONDS }, now), false)
  assert.equal(recordSilences({ answer: 'later', when: undefined }, now), false)
  assert.equal(recordSilences({ answer: 'other', when: now }, now), false)
})

test('recordLine and appendRecord write the shell format and keep the lines apart', () => {
  assert.equal(recordLine('/p', 'later', 1792000000), '/p\tlater\t1792000000\n')
  assert.equal(recordLine('/p', 'never', 1792000000), '/p\tnever\n')
  assert.equal(appendRecord('', 'x\n'), 'x\n')
  assert.equal(appendRecord(undefined, 'x\n'), 'x\n')
  assert.equal(appendRecord('a\n', 'x\n'), 'a\nx\n')
  assert.equal(appendRecord('a', 'x\n'), 'a\nx\n')
})

test('markerFresh: digits only, younger than 14 days', () => {
  const now = 2_000_000_000
  assert.equal(markerFresh(`${now - 10}\n`, now), true)
  assert.equal(markerFresh(`${now - 13 * 86400}`, now), true)
  assert.equal(markerFresh(`${now - 15 * 86400}`, now), false)
  for (const bad of ['', 'abc', '1.5', undefined]) assert.equal(markerFresh(bad, now), false, String(bad))
})

test('resolveDataDir: the variable, then the cache folder, then the inline folder, else nothing', () => {
  assert.deepEqual(resolveDataDir({ env: '/d/x', pluginRoot: '/r', pluginName: 'crew-chief', home: HOME }), { dir: '/d/x', source: 'env' })
  assert.deepEqual(
    resolveDataDir({ env: undefined, pluginRoot: '/Users/me/.claude/plugins/cache/crew-chief/crew-chief/0.12.3', pluginName: 'crew-chief', home: HOME }),
    { dir: '/Users/me/.claude/plugins/data/crew-chief-crew-chief', source: 'derived' },
  )
  assert.deepEqual(
    resolveDataDir({ env: '', pluginRoot: '/work/crew-chief', pluginName: 'crew-chief', home: HOME }),
    { dir: '/Users/me/.claude/plugins/data/crew-chief-inline', source: 'inline' },
  )
  assert.deepEqual(
    resolveDataDir({ pluginRoot: '/work/crew-chief', pluginName: 'crew-chief', home: HOME, configDir: '/cfg/claude/' }),
    { dir: '/cfg/claude/plugins/data/crew-chief-inline', source: 'inline' },
  )
  assert.equal(resolveDataDir({ pluginRoot: '/work/crew-chief', pluginName: 'crew-chief' }), undefined)
})

test('answers: three in a git repo, four without; the yes first, Never last; the labels differ', () => {
  for (const lang of Object.keys(MESSAGES)) {
    const m = MESSAGES[lang]
    const withGit = answerLabels(m, true)
    const noGit = answerLabels(m, false)
    assert.equal(withGit.length, 3)
    assert.equal(noGit.length, 4)
    assert.equal(withGit[0], m.ho_setup)
    assert.equal(withGit[2], m.ho_never)
    assert.equal(noGit[0], m.ho_git_setup)
    assert.equal(noGit[3], m.ho_never)
    assert.equal(new Set(noGit).size, 4, lang)
    assert.equal(answerKind(m, true, m.ho_setup), 'setup')
    assert.equal(answerKind(m, false, m.ho_git_setup), 'git-setup')
    assert.equal(answerKind(m, false, m.ho_nogit_setup), 'nogit-setup')
    assert.equal(answerKind(m, true, m.ho_later), 'later')
    assert.equal(answerKind(m, false, m.ho_never), 'never')
    assert.equal(answerKind(m, true, 'something else'), 'later', 'an unknown answer is Later')
    assert.equal(answerKind(m, true, undefined), 'later')
    assert.equal(answerKind(m, true, m.ho_git_setup), 'later', 'a git answer is not offered in a repo')
  }
})

test('setupPrompt: says the user already said yes; carries the git choice', () => {
  const plain = setupPrompt('setup', '/p')
  assert.match(plain, /crew-chief:crew-handoff/)
  assert.match(plain, /already said yes/)
  assert.match(plain, /same turn/)
  assert.doesNotMatch(plain, /git init/)
  const git = setupPrompt('git-setup', '/p')
  assert.match(git, /run `git init` in \/p first/)
  assert.match(git, /new repository root/)
  const none = setupPrompt('nogit-setup', '/p')
  assert.match(none, /without git/)
  assert.match(none, /pass \/p as the directory argument/)
})

test('resolveDataDir: a plugin read from a local marketplace folder gets <name>-<marketplace>, not -inline', () => {
  const marketplaces = { 'crew-chief-dev': { source: { source: 'directory', path: '/h/.claude/local-marketplaces/crew-chief-dev' }, installLocation: '/h/.claude/local-marketplaces/crew-chief-dev' } }
  const got = resolveDataDir({ pluginRoot: '/h/.claude/local-marketplaces/crew-chief-dev/crew-chief', pluginName: 'crew-chief', home: '/h', marketplaces })
  assert.deepEqual(got, { dir: '/h/.claude/plugins/data/crew-chief-crew-chief-dev', source: 'marketplace' })
  // --plugin-dir (no marketplace holds the path) stays -inline; the env still wins
  assert.equal(resolveDataDir({ pluginRoot: '/work/crew-chief', pluginName: 'crew-chief', home: '/h', marketplaces }).source, 'inline')
  assert.equal(resolveDataDir({ env: '/e', pluginRoot: '/h/.claude/local-marketplaces/crew-chief-dev/crew-chief', pluginName: 'crew-chief', home: '/h', marketplaces }).dir, '/e')
  // a marketplace whose folder only shares a prefix does not match
  assert.equal(resolveDataDir({ pluginRoot: '/h/.claude/local-marketplaces/crew-chief-dev2/crew-chief', pluginName: 'crew-chief', home: '/h', marketplaces }).source, 'inline')
})
