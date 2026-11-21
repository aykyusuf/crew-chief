// Run: node --test tests/source-check.test.mjs   (no outside network: a node:http server on 127.0.0.1 with fixtures)
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import zlib from 'node:zlib'
import { checkClaims, claimsFromJson, claimsFromMarkdown, htmlToText, isBlockedAddress, loadClaims, normalise, quoteInText, quoteParts } from '../scripts/source-check.mjs'

const CLI = new URL('../scripts/source-check.mjs', import.meta.url).pathname
const FILLER = '<p>' + 'The library keeps a long and boring description here for padding. '.repeat(8) + '</p>'
const page = (body) => `<!doctype html><html><head><title>t</title><style>.x{}</style><script>var a="hidden secret text in a script";</script></head><body>${FILLER}${body}</body></html>`
const SECRET = 'SECRET-PAGE-MARKER'

let server
let base
const hits = []

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url)
    const send = (code, type, body, extra = {}) => {
      res.writeHead(code, { 'content-type': type, ...extra })
      res.end(body)
    }
    switch (req.url) {
      case '/ok':
        return send(200, 'text/html; charset=utf-8', page(`<p>Streaming was added in version 2.1 of the &ldquo;Example&rdquo; library &mdash; see the notes. ${SECRET}</p>`))
      case '/split':
        return send(200, 'text/html', page('<p>The <b>quick</b> brown <a href="/x">fox jumps</a> over <span>the</span> lazy dog every morning.</p>'))
      case '/two':
        return send(200, 'text/html', page('<p>First part of a long sentence about streaming support.</p><p>Second part of the story that ends here with more words.</p>'))
      case '/gzip':
        return send(200, 'text/html', zlib.gzipSync(page('<p>Compressed pages are decoded before the quote is searched for.</p>')), { 'content-encoding': 'gzip' })
      case '/json':
        return send(200, 'application/json', JSON.stringify({ a: { note: 'The API returns a “cursor” field in every response body.' } }))
      case '/404':
        return send(404, 'text/html', 'gone')
      case '/410':
        return send(410, 'text/html', 'gone')
      case '/403':
        return send(403, 'text/html', 'no')
      case '/500':
        return send(500, 'text/html', 'no')
      case '/js':
        return send(200, 'text/html', '<html><head><script>window.app={}</script></head><body><div id="root"></div><noscript>Enable JavaScript</noscript></body></html>')
      case '/pdf':
        return send(200, 'application/pdf', '%PDF-1.4')
      case '/image':
        return send(200, 'image/png', 'x')
      case '/huge': {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.write(page('<p>The quote near the start of a very large page is found early.</p>'))
        const chunk = 'x'.repeat(65536)
        let n = 0
        const t = setInterval(() => {
          if (res.destroyed || n++ > 80) {
            clearInterval(t)
            res.end()
          } else res.write(chunk)
        }, 0)
        return
      }
      case '/loop':
        return send(302, 'text/html', '', { location: '/loop' })
      case '/to-private':
        return send(302, 'text/html', '', { location: 'http://169.254.169.254/latest/meta-data/' })
      case '/to-ok':
        return send(301, 'text/html', '', { location: '/ok' })
      case '/slow':
        return // never answers
      default:
        return send(404, 'text/plain', 'nope')
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => {
  server.closeAllConnections()
  server.close()
})

const L = { allowLocal: true, timeout: 5000 }
const one = async (path, quote, extra = {}) => (await checkClaims([{ id: 'c', url: base + path, quote }], { ...L, ...extra }))[0]

test('normaliser: entities, curly quotes, dashes, case and space', () => {
  assert.equal(normalise('  A &amp; B &ldquo;x&rdquo; — it’s&#x41;&#66;\n\tdone '), 'a & b "x" - it\'sab done')
  assert.equal(normalise('co­operate​'), 'cooperate')
  assert.deepEqual(quoteParts('alpha beta ... gamma … delta [...] eps'), ['alpha beta', 'gamma', 'delta', 'eps'])
  assert.equal(quoteInText('one two ... four five', 'one two three four five six').found, true)
  assert.equal(quoteInText('four five ... one two', 'one two three four five six').found, false)
})

test('htmlToText drops scripts and styles, joins inline tags, separates blocks, and is linear on hostile input', () => {
  assert.equal(normalise(htmlToText('<p>The <b>quick</b>fox</p><p>next</p><script>bad()</script><style>.a{}</style>!<!-- c -->')), 'the quickfox next !')
  const t0 = Date.now()
  htmlToText('<'.repeat(500000) + '<script>'.repeat(20000))
  htmlToText('<a'.repeat(300000))
  assert.ok(Date.now() - t0 < 3000)
})

test('found: entities, curly quotes and a dash in the page match a plain quote', async () => {
  const r = await one('/ok', 'Streaming was added in version 2.1 of the "Example" library - see the notes.')
  assert.deepEqual({ status: r.status, http: r.http, reason: r.reason }, { status: 'found', http: 200, reason: 'quote_found' })
})

test('found: text split across tags, an ellipsis quote, a gzip page and a JSON page', async () => {
  assert.equal((await one('/split', 'The quick brown fox jumps over the lazy dog every morning.')).status, 'found')
  assert.equal((await one('/two', 'First part of a long sentence ... Second part of the story that ends here')).status, 'found')
  assert.equal((await one('/gzip', 'Compressed pages are decoded before the quote is searched for.')).status, 'found')
  assert.equal((await one('/json', 'The API returns a "cursor" field in every response body.')).status, 'found')
  assert.equal((await one('/two', 'Second part of the story ... First part of a long sentence')).status, 'not_found')
})

test('not_found only for a normally read page; script text is not page text', async () => {
  assert.equal((await one('/ok', 'This sentence was never written on the page at all.')).status, 'not_found')
  assert.equal((await one('/ok', 'hidden secret text in a script')).status, 'not_found')
})

test('dead_link, and unverified reasons that are never refutations', async () => {
  const q = 'A perfectly good quote of more than twenty characters.'
  const expect = { '/404': ['dead_link', 'http_404'], '/410': ['dead_link', 'http_410'], '/403': ['unverified', 'http_403'], '/500': ['unverified', 'http_500'], '/js': ['unverified', 'js_rendered_or_empty'], '/pdf': ['unverified', 'pdf'], '/image': ['unverified', 'unsupported_type'], '/loop': ['unverified', 'too_many_redirects'], '/to-private': ['unverified', 'blocked_address'] }
  for (const [path, [status, reason]] of Object.entries(expect)) {
    const r = await one(path, q)
    assert.deepEqual([r.status, r.reason], [status, reason], path)
  }
  assert.equal((await one('/to-ok', 'Streaming was added in version 2.1 of the "Example" library - see the notes.')).status, 'found')
})

test('unverified: short quote, no quote, no url, bad url, scheme, timeout', async () => {
  assert.equal((await one('/ok', 'too short')).reason, 'too_short_quote')
  assert.equal((await one('/ok', '')).reason, 'no_quote')
  const rows = await checkClaims([{ id: 'a', quote: 'x'.repeat(30) }, { id: 'b', url: 'not a url', quote: 'x'.repeat(30) }, { id: 'c', url: 'file:///etc/passwd', quote: 'x'.repeat(30) }, { id: 'd', url: 'ftp://example.com/a', quote: 'x'.repeat(30) }, { id: 'e', url: 'http://user:pw@127.0.0.1/', quote: 'x'.repeat(30) }], L)
  assert.deepEqual(rows.map((r) => r.reason), ['no_url', 'bad_url', 'blocked_scheme', 'blocked_scheme', 'bad_url'])
  const slow = await one('/slow', 'x'.repeat(30), { timeout: 300 })
  assert.deepEqual([slow.status, slow.reason], ['unverified', 'timeout'])
})

test('a huge body is cut at the cap: found if the quote came first, unverified too_large otherwise', async () => {
  assert.equal((await one('/huge', 'The quote near the start of a very large page is found early.', { maxBytes: 200000 })).status, 'found')
  const r = await one('/huge', 'A sentence that would only be at the end of the page.', { maxBytes: 200000 })
  assert.deepEqual([r.status, r.reason], ['unverified', 'too_large'])
})

test('loopback is refused without the test hook, and no request reaches the server', async () => {
  const before = hits.length
  const r = (await checkClaims([{ id: 'x', url: base + '/ok', quote: 'x'.repeat(30) }, { id: 'y', url: 'http://localhost:1/', quote: 'x'.repeat(30) }, { id: 'z', url: 'http://[::1]:1/', quote: 'x'.repeat(30) }], { timeout: 2000 })).map((x) => x.reason)
  assert.deepEqual(r, ['blocked_address', 'blocked_address', 'blocked_address'])
  assert.equal(hits.length, before)
})

test('address classes', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '[::1]', 'garbage']) assert.equal(isBlockedAddress(a), true, a)
  for (const a of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(isBlockedAddress(a), false, a)
  assert.equal(isBlockedAddress('127.0.0.1', { allowLocal: true }), false)
  assert.equal(isBlockedAddress('10.0.0.1', { allowLocal: true }), true)
})

test('one row per claim id, even when claims share a (url, quote); the page is fetched once', async () => {
  const before = hits.filter((h) => h === '/ok').length
  const q = 'Streaming was added in version 2.1 of the "Example" library - see the notes.'
  const rows = await checkClaims([{ id: 'a', url: base + '/ok', quote: q }, { id: 'b', url: base + '/ok', quote: q }, { id: 'c', url: base + '/ok', quote: 'Never on this page, but long enough to count.' }], L)
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [['a', 'found'], ['b', 'found'], ['c', 'not_found']])
  assert.equal(hits.filter((h) => h === '/ok').length - before, 1)
})

test('inputs: claims JSON (array and object), a folder, a markdown report', () => {
  assert.deepEqual(claimsFromJson({ claims: [{ id: 'g1-1', claim: 'c', url: 'u', quote: 'q' }, null, { url: 'v', quote: 'w' }] }, 'f'), [{ id: 'g1-1', url: 'u', quote: 'q' }, { id: 'f#3', url: 'v', quote: 'w' }])
  assert.equal(claimsFromJson([{ id: 1, url: 'u' }])[0].id, '1')
  const md = [
    'Streaming arrived in 2.1 ([docs](https://example.com/a)): "Streaming support was added in version 2.1 of the client."',
    '',
    'Second: https://example.com/b.',
    '> The cursor field is returned on every response of the list endpoint.',
    '',
    'Third https://example.com/c with no quote at all',
    '',
    '“A curly quoted passage that sits before its source” https://example.com/d',
  ].join('\n')
  const c = claimsFromMarkdown(md, 'r')
  assert.deepEqual(c.map((x) => x.url), ['https://example.com/a', 'https://example.com/b', 'https://example.com/c', 'https://example.com/d'])
  assert.equal(c[0].quote, 'Streaming support was added in version 2.1 of the client.')
  assert.equal(c[1].quote, 'The cursor field is returned on every response of the list endpoint.')
  assert.equal(c[2].quote, '')
  assert.equal(c[3].quote, 'A curly quoted passage that sits before its source')
  const dir = mkdtempSync(join(tmpdir(), 'sc-in-'))
  try {
    writeFileSync(join(dir, 'g1.json'), JSON.stringify({ group: 'g1', claims: [{ id: 'g1-1', url: 'u', quote: 'q' }] }))
    writeFileSync(join(dir, 'g2.json'), JSON.stringify([{ id: 'g2-1', url: 'u', quote: 'q' }]))
    writeFileSync(join(dir, 'note.md'), 'ignored in a folder')
    writeFileSync(join(dir, 'bad.json'), '{ nope')
    const r = loadClaims([dir, join(dir, 'missing.json')])
    assert.deepEqual(r.claims.map((x) => x.id), ['g2-1', 'g1-1'].sort())
    assert.equal(r.warnings.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI: rows for every claim on stdout, exit 0 unless --strict, page text never printed, --out only in the reports folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sc-cli-'))
  const tmp = join(root, 'tmp')
  mkdirSync(tmp)
  try {
    const file = join(root, 'claims.json')
    writeFileSync(file, JSON.stringify({ claims: [{ id: 'g1-1', claim: 'x', url: base + '/ok', quote: 'Streaming was added in version 2.1 of the "Example" library - see the notes.' }, { id: 'g1-2', url: base + '/ok', quote: 'Not on the page, though it is long enough.' }, { id: 'g1-3', url: base + '/403', quote: 'x'.repeat(30) }, { id: 'g1-4', url: base + '/404', quote: 'x'.repeat(30) }] }))
    const env = { ...process.env, TMPDIR: tmp, CREW_CHIEF_SOURCE_CHECK_ALLOW_LOCAL: '1' }
    // Async, because the fixture server lives in this process and spawnSync would block it.
    const run = (...a) => new Promise((done) => execFile('node', [CLI, ...a], { encoding: 'utf8', env }, (err, stdout, stderr) => done({ status: err ? err.code : 0, stdout, stderr })))
    let r = await run(file)
    assert.equal(r.status, 0)
    const rows = JSON.parse(r.stdout)
    assert.deepEqual(rows.map((x) => [x.id, x.status]), [['g1-1', 'found'], ['g1-2', 'not_found'], ['g1-3', 'unverified'], ['g1-4', 'dead_link']])
    for (const x of rows) assert.deepEqual(Object.keys(x), ['id', 'url', 'http', 'status', 'reason'])
    assert.match(r.stderr, /4 claims: 1 found, 1 not_found, 1 unverified, 1 dead_link/)
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET))
    assert.equal((await run(file, '--strict')).status, 1)
    const okFile = join(root, 'ok.json')
    writeFileSync(okFile, JSON.stringify([{ id: 'a', url: base + '/403', quote: 'x'.repeat(30) }]))
    assert.equal((await run(okFile, '--strict')).status, 0)
    // --out
    const rd = join(tmp, 'crew-chief-reports')
    r = await run(file, '--out', join(rd, 'sub', 'sc.json'))
    assert.equal(r.status, 0)
    assert.deepEqual(JSON.parse(readFileSync(join(rd, 'sub', 'sc.json'), 'utf8')), rows)
    for (const bad of [join(root, 'out.json'), join(rd, '..', 'out.json'), join(tmp, 'other', 'out.json'), join(rd, 'x', '..', '..', 'out.json')]) {
      r = await run(file, '--out', bad)
      assert.equal(r.status, 2, bad)
      assert.match(r.stderr, /reports folder|\.\./)
      assert.ok(!existsSync(bad))
    }
    mkdirSync(join(root, 'elsewhere'))
    symlinkSync(join(root, 'elsewhere'), join(rd, 'link'))
    assert.equal((await run(file, '--out', join(rd, 'link', 'o.json'))).status, 2)
    assert.ok(!existsSync(join(root, 'elsewhere', 'o.json')))
    // usage errors
    assert.equal((await run()).status, 2)
    assert.equal((await run(file, '--nope')).status, 2)
    assert.equal((await run(file, '--timeout=x')).status, 2)
    assert.equal((await run(join(root, 'missing.json'))).stdout.trim(), '[]')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
