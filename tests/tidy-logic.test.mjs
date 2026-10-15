// Run: node --test tests/tidy-logic.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractPathRefs, findDuplicateLines, isGlobalPath, kb, measure, memoryIndexLinks, summarizeMcp } from '../hooks/tidy-logic.mjs'

test('measure counts lines and bytes (multi-byte characters count as bytes)', () => {
  assert.deepEqual(measure(''), { lines: 0, bytes: 0 })
  assert.deepEqual(measure('a\nb\n'), { lines: 2, bytes: 4 })
  assert.equal(measure('ı').bytes, 2)
})

test('memoryIndexLinks: relative .md targets only, once each', () => {
  const text = [
    '- [User](user.md) — who',
    '- [Feedback](feedback_testing.md) — why',
    '- [Again](user.md) — dup',
    '- [Site](https://example.com/x.md) — url',
    '- [Abs](/etc/x.md) — absolute',
    '- [Anchor](notes.md#part) — anchor',
  ].join('\n')
  assert.deepEqual(memoryIndexLinks(text), ['user.md', 'feedback_testing.md', 'notes.md'])
})

test('extractPathRefs: real-looking paths in backticks, nothing from fences, urls, globs or placeholders', () => {
  const text = [
    'Edit `lib/legacy/auth.dart` and `README.md`, not `src/**/*.ts`.',
    'See `https://example.com/a/b`, `<path>/x.md`, `$HOME/x.md`, `v1.2.3`, `npm test`, `~/notes/x.md`.',
    '```',
    'cat `fenced/path.txt`',
    '```',
    'Also `scripts/` and `../docs/guide.md`.',
  ].join('\n')
  assert.deepEqual(extractPathRefs(text), ['lib/legacy/auth.dart', 'README.md', 'scripts/', '../docs/guide.md'])
})

test('findDuplicateLines: repeats across files, ignoring short lines, headings and tables', () => {
  const files = [
    { path: 'a.md', text: '# Title\n- Always answer in Turkish unless asked otherwise\nshort\n| a | b |\n' },
    { path: 'b.md', text: '# Title\nAlways answer in Turkish unless asked otherwise\nshort\n| a | b |\n' },
    { path: 'c.md', text: 'unique line that is long enough to count here\n' },
  ]
  const dupes = findDuplicateLines(files)
  assert.equal(dupes.length, 1)
  assert.equal(dupes[0].line, 'Always answer in Turkish unless asked otherwise')
  assert.deepEqual(dupes[0].where, ['a.md', 'b.md'])
})

test('summarizeMcp groups by server and sorts by tokens', () => {
  const rows = summarizeMcp([
    { name: 'a', serverName: 'github', tokens: 1200, isLoaded: true },
    { name: 'b', serverName: 'github', tokens: 800, isLoaded: false },
    { name: 'c', serverName: 'figma', tokens: 5000, isLoaded: true },
  ])
  assert.deepEqual(rows, [
    { server: 'figma', count: 1, tokens: 5000, loaded: 1 },
    { server: 'github', count: 2, tokens: 2000, loaded: 1 },
  ])
  assert.deepEqual(summarizeMcp(undefined), [])
})

test('isGlobalPath: files under ~/.claude are global, project memory is not', () => {
  assert.equal(isGlobalPath('/Users/me/.claude/CLAUDE.md', '/Users/me'), true)
  assert.equal(isGlobalPath('/Users/me/.claude/RTK.md', '/Users/me'), true)
  assert.equal(isGlobalPath('/Users/me/.claude/projects/-x/memory/MEMORY.md', '/Users/me'), false)
  assert.equal(isGlobalPath('/work/CLAUDE.md', '/Users/me'), false)
  assert.equal(isGlobalPath('/Users/me/.claude/CLAUDE.md', ''), false)
})

test('kb formats one decimal', () => {
  assert.equal(kb(2048), '2.0')
  assert.equal(kb(25 * 1024), '25.0')
})
