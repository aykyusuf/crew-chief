// The screenshot script's argument checks (no browser needed). Run: node --test tests/ui-shot.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = new URL('../scripts/ui-shot.mjs', import.meta.url).pathname
const dir = mkdtempSync(join(tmpdir(), 'ui-shot-test-'))
const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8', env: { ...process.env, CHROME_PATH: '/nonexistent' } })

test('usage, url scheme, slug, wait and out dir are checked before any browser starts', () => {
  for (const [args, msg] of [
    [[], 'usage'],
    [['ftp://x', dir, 'a'], 'http://'],
    [['https://x', dir, '../a'], 'slug'],
    [['https://x', dir, '.a'], 'slug'],
    [['https://x', dir, 'a', '--wait=99999999'], '--wait'],
    [['https://x', join(dir, 'nope'), 'a'], 'out dir does not exist'],
  ]) {
    const r = run(...args)
    assert.equal(r.status, 2, args.join(' '))
    assert.ok(r.stderr.includes(msg), r.stderr)
  }
})

test('the header says why plain headless Chrome is not used for mobile shots', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(script, 'utf8')
  assert.ok(src.includes('cannot go below about 500 px wide'))
  assert.ok(src.includes("'Emulation.setDeviceMetricsOverride'"))
})
