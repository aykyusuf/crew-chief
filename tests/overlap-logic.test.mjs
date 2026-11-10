import test from 'node:test'
import assert from 'node:assert/strict'
import { briefPaths, isWriterType, overlapping } from '../hooks/overlap-logic.mjs'

test('briefPaths finds files and folders by shape, not urls or versions', () => {
  const brief = 'Edit `hooks/src/guard.js` and ./tests/guard.test.ts, then README.md. See https://example.com/a/b.html and v1.2.3, e.g. nothing.'
  assert.deepEqual(briefPaths(brief).sort(), ['hooks/src/guard.js', 'readme.md', 'tests/guard.test.ts'])
  assert.deepEqual(briefPaths('Refactor the src/ folder.'), ['src'])
  assert.deepEqual(briefPaths('no files here'), [])
  assert.deepEqual(briefPaths(undefined), [])
})

test('overlapping: the same file, or a folder that holds it', () => {
  assert.deepEqual(overlapping(['a/b.js', 'c.js'], ['a/b.js']), ['a/b.js'])
  assert.deepEqual(overlapping(['src/x/y.js'], ['src']), ['src/x/y.js'])
  assert.deepEqual(overlapping(['src2/y.js'], ['src']), [])
  assert.deepEqual(overlapping([], ['a.js']), [])
})

test('isWriterType: crew-chief writers only', () => {
  assert.ok(isWriterType('crew-chief:implementer') && isWriterType('implementer-hard') && isWriterType('crew-chief:mechanic'))
  assert.ok(!isWriterType('crew-chief:reviewer') && !isWriterType('scanner') && !isWriterType(undefined))
})
