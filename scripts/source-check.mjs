#!/usr/bin/env node
// crew-chief source checker (ONERILER-26 item 10a). Node 22, no dependencies. READ ONLY use of the network: it fetches the URLs
// named in claims with GET and checks whether the claimed quote really appears on the page. It cannot judge meaning (a verifier
// agent does that); it only answers "is the page alive and does this text appear on it".
//
// Usage: node source-check.mjs <claims.json | dir | report.md>... [--timeout=15000] [--concurrency=4] [--max-bytes=2097152]
//                                [--out <file>] [--strict]
//   input      a claims JSON (an array of claims, or {"claims": [...]}; a researcher's file works as is), a folder (every *.json
//              in it), or a Markdown report (best effort: every http(s) URL, plus the nearest FOLLOWING double-quoted "..." or
//              curly or blockquote ("> ...") passage of 20+ characters; a claim is {id, url, quote}).
//   --out      also write the result JSON to this file. Refused (exit 2) unless the path is inside the crew-chief reports
//              folder, ${TMPDIR:-/tmp}/crew-chief-reports.
//   --strict   exit 1 if any claim is not_found or dead_link (exit 0 otherwise). Without it the exit code is 0 whatever the result.
// Output: stdout is ONE JSON array, one object per claim on its own line:
//   { "id": "g1-3", "url": "https://...", "http": 200, "status": "found", "reason": "quote_found" }
// status is one of
//   found       the page was read and the quote (normalised) appears in it; a quote with "..." or an ellipsis character is
//               split and every part must appear, in order
//   not_found   the page was read normally (200, readable text) and the quote does not appear: the only refutation signal
//   dead_link   HTTP 404 or 410, or the host name does not exist (reason http_404, http_410, dns_failure)
//   unverified  could not be checked; NEVER a refutation. reason is one of: js_rendered_or_empty, pdf, unsupported_type,
//               too_large (the body was cut at --max-bytes before the quote was seen), too_short_quote (under 20 characters),
//               no_quote, no_url, bad_url, blocked_scheme, blocked_address, http_<status> (401, 403, 429, 5xx, other 4xx),
//               timeout, too_many_redirects, redirect_without_location, connection_error, tls_error, dns_temporary
// A one-line summary (counts per status) goes to stderr. Page text is never printed, not even on errors.
// Safety: only http and https; no credentials in the URL; no cookies; a generic User-Agent (crew-chief-source-check) and the URL
// are all that is sent; at most 5 redirects, 2 MB per page, --timeout per page (15 s). Addresses in loopback, private,
// link-local, CGNAT, multicast and reserved ranges (IPv4 and IPv6, including IPv4-mapped) are refused, checked at connect time
// from the resolved address (so a DNS answer cannot change between the check and the connection) and again on every redirect.
// Test hook: the option allowLocal (CLI: env CREW_CHIEF_SOURCE_CHECK_ALLOW_LOCAL=1) lifts the loopback block only.
// Limits: JavaScript-rendered pages, PDFs, paywalls and 403s give unverified, not proof either way.

import { mkdirSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const UA = 'crew-chief-source-check'
const MAX_REDIRECTS = 5
const MIN_QUOTE = 20
const TEXT_TYPES = /^(text\/(html|plain|xml|markdown)|application\/(xhtml\+xml|xml|json)|[a-z]+\/[a-z0-9.+-]*\+(xml|json))$/i

// ---------------------------------------------------------------- addresses

const BLOCKED = new net.BlockList()
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCKED.addSubnet(a, p, 'ipv4')
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) BLOCKED.addSubnet(a, p, 'ipv6')
const LOOPBACK = new net.BlockList()
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4')
LOOPBACK.addAddress('::1', 'ipv6')

// An IPv4-mapped IPv6 address (::ffff:a.b.c.d or ::ffff:7f00:1) is judged as its IPv4 address.
function unmap(addr) {
  let m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr)
  if (m) return m[1]
  m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr)
  if (m) {
    const hi = parseInt(m[1], 16)
    const lo = parseInt(m[2], 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  return addr
}

export function isBlockedAddress(addr, { allowLocal = false } = {}) {
  const a = unmap(String(addr).replace(/^\[|\]$/g, ''))
  const v = net.isIP(a)
  if (!v) return true // not an address we can judge: refuse
  const type = v === 4 ? 'ipv4' : 'ipv6'
  if (allowLocal && LOOPBACK.check(a, type)) return false
  return BLOCKED.check(a, type)
}

function blockedHostName(host, opts) {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost')) return !opts.allowLocal
  const bare = h.replace(/^\[|\]$/g, '')
  if (net.isIP(bare)) return isBlockedAddress(bare, opts)
  return false
}

function guardedLookup(opts) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') {
      cb = options
      options = {}
    }
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err)
      if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address, opts))) {
        const e = new Error('blocked address')
        e.code = 'EBLOCKED'
        return cb(e)
      }
      if (options && options.all) return cb(null, addrs)
      return cb(null, addrs[0].address, addrs[0].family)
    })
  }
}

// ---------------------------------------------------------------- text

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', laquo: '"', raquo: '"', copy: '(c)', reg: '(r)', trade: '(tm)', middot: '.', bull: '*', shy: '', zwj: '', zwnj: '' }
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ' '
      try {
        return String.fromCodePoint(code)
      } catch {
        return ' '
      }
    }
    const v = NAMED[body.toLowerCase()]
    return v === undefined ? all : v
  })
}

// Same normalisation for the page and the quote: NFKC, one kind of quote and dash, no invisible characters, lower case, single spaces.
export function normalise(s) {
  return decodeEntities(String(s))
    .normalize('NFKC')
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[­​-‍⁠﻿]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const INLINE = new Set(['a', 'b', 'i', 'em', 'strong', 'span', 'code', 'sup', 'sub', 'u', 'small', 'mark', 'abbr', 'cite', 'font', 'kbd', 'q', 's', 'tt', 'var', 'time', 'bdi', 'bdo', 'data', 'dfn', 'wbr', 'ins', 'del'])
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg'])

// One linear pass (no backtracking regexes over the page): drops comments and script/style/noscript/template/svg blocks, removes
// inline tags without a gap (so text split across <b>...</b> stays joined) and turns every other tag into a space.
export function htmlToText(html) {
  const out = []
  const n = html.length
  let i = 0
  let skipped = 0
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      out.push(html.slice(i))
      break
    }
    out.push(html.slice(i, lt))
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      if (end < 0) break
      out.push(' ')
      i = end + 3
      continue
    }
    const c = html[lt + 1]
    if (!c || !/[A-Za-z/!?]/.test(c)) {
      out.push('<')
      i = lt + 1
      continue
    }
    const gt = html.indexOf('>', lt + 1)
    if (gt < 0) break
    const m = /^(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(lt + 1, Math.min(gt, lt + 60)))
    const name = m ? m[2].toLowerCase() : ''
    i = gt + 1
    if (m && !m[1] && SKIP.has(name)) {
      const close = new RegExp(`</${name}\\b[^>]*>`, 'ig')
      close.lastIndex = i
      const hit = close.exec(html)
      skipped += 1
      if (!hit) break
      i = hit.index + hit[0].length
      out.push(' ')
      continue
    }
    out.push(INLINE.has(name) ? '' : ' ')
  }
  htmlToText.lastSkipped = skipped
  return out.join('')
}

// A quote with an ellipsis ("..." or the ellipsis character, optionally in brackets) is split; every part must appear, in order.
export function quoteParts(quote) {
  return String(quote)
    .split(/\[\s*(?:…|\.{3})\s*\]|…|\.{3}/)
    .map(normalise)
    .map((p) => p.replace(/^["']+|["']+$/g, '').trim())
    .filter(Boolean)
}

export function quoteInText(quote, pageNorm) {
  const parts = quoteParts(quote)
  const length = parts.join('').length
  let at = 0
  for (const p of parts) {
    const i = pageNorm.indexOf(p, at)
    if (i < 0) return { found: false, length }
    at = i + p.length
  }
  return { found: parts.length > 0, length }
}

// ---------------------------------------------------------------- network

function classifyError(err) {
  const code = err && err.code
  if (code === 'EBLOCKED') return { status: 'unverified', reason: 'blocked_address' }
  if (code === 'ENOTFOUND') return { status: 'dead_link', reason: 'dns_failure' }
  if (code === 'EAI_AGAIN') return { status: 'unverified', reason: 'dns_temporary' }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'ECREWTIMEOUT') return { status: 'unverified', reason: 'timeout' }
  if (typeof code === 'string' && /^(ERR_TLS|ERR_SSL|CERT_|DEPTH_|UNABLE_TO_|SELF_SIGNED|HOSTNAME_MISMATCH|EPROTO)/.test(code)) return { status: 'unverified', reason: 'tls_error' }
  return { status: 'unverified', reason: 'connection_error' }
}

// One GET, no redirect following. Resolves {http, headers, body, truncated} or {error}. Never rejects.
function getOnce(url, opts) {
  return new Promise((done) => {
    const lib = url.protocol === 'https:' ? https : http
    let finished = false
    let req
    const finish = (v) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      done(v)
    }
    const timer = setTimeout(() => {
      const e = new Error('timeout')
      e.code = 'ECREWTIMEOUT'
      if (req) req.destroy()
      finish({ error: e })
    }, opts.timeout)
    try {
      req = lib.request(
        url,
        {
          method: 'GET',
          headers: { 'user-agent': UA, accept: 'text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1', 'accept-encoding': 'gzip, deflate, br' },
          lookup: guardedLookup(opts),
          agent: false,
        },
        (res) => {
          const status = res.statusCode || 0
          if (status >= 300 && status < 400) {
            res.resume()
            return finish({ http: status, headers: res.headers, body: Buffer.alloc(0), truncated: false })
          }
          let stream = res
          const enc = String(res.headers['content-encoding'] || '').toLowerCase()
          if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip())
          else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
          else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress())
          const chunks = []
          let size = 0
          let truncated = false
          stream.on('data', (c) => {
            if (truncated) return
            size += c.length
            chunks.push(c)
            if (size >= opts.maxBytes) {
              truncated = true
              req.destroy()
              finish({ http: status, headers: res.headers, body: Buffer.concat(chunks).subarray(0, opts.maxBytes), truncated: true })
            }
          })
          stream.on('end', () => finish({ http: status, headers: res.headers, body: Buffer.concat(chunks), truncated: false }))
          stream.on('error', (e) => (truncated ? undefined : finish({ error: e })))
          res.on('error', (e) => (truncated ? undefined : finish({ error: e })))
        },
      )
      req.on('error', (e) => finish({ error: e }))
      req.end()
    } catch (e) {
      finish({ error: e })
    }
  })
}

function decodeBody(buf, contentType) {
  let label = (/charset\s*=\s*["']?([\w-]+)/i.exec(contentType) || [])[1]
  if (!label) {
    const head = buf.subarray(0, 2048).toString('latin1')
    label = (/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head) || [])[1]
  }
  try {
    return new TextDecoder(label || 'utf-8').decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

function jsonStrings(v, out) {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) jsonStrings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) jsonStrings(x, out)
  return out
}

// Fetches one page, following up to 5 redirects with the address check on every hop. Resolves
// {status, reason, http} for a page that cannot be read, or {page: <normalised text>, http, truncated, thin}.
export async function fetchPage(rawUrl, opts) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return { status: 'unverified', reason: 'bad_url', http: null }
  }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { status: 'unverified', reason: 'blocked_scheme', http: null }
    if (url.username || url.password) return { status: 'unverified', reason: 'bad_url', http: null }
    if (blockedHostName(url.hostname, opts)) return { status: 'unverified', reason: 'blocked_address', http: null }
    const r = await getOnce(url, opts)
    if (r.error) {
      const c = classifyError(r.error)
      return { ...c, http: null }
    }
    const code = r.http
    if (code >= 300 && code < 400) {
      const loc = r.headers.location
      if (!loc) return { status: 'unverified', reason: 'redirect_without_location', http: code }
      if (hop >= MAX_REDIRECTS) return { status: 'unverified', reason: 'too_many_redirects', http: code }
      try {
        url = new URL(loc, url)
      } catch {
        return { status: 'unverified', reason: 'bad_url', http: code }
      }
      continue
    }
    if (code === 404 || code === 410) return { status: 'dead_link', reason: `http_${code}`, http: code }
    if (code < 200 || code >= 300) return { status: 'unverified', reason: `http_${code}`, http: code }
    const ctype = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (ctype === 'application/pdf') return { status: 'unverified', reason: 'pdf', http: code }
    if (ctype && !TEXT_TYPES.test(ctype)) return { status: 'unverified', reason: 'unsupported_type', http: code }
    const raw = decodeBody(r.body, String(r.headers['content-type'] || ''))
    let text
    let thin = false
    if (ctype === 'application/json' || /\+json$/.test(ctype)) {
      try {
        text = jsonStrings(JSON.parse(raw), []).join(' ')
      } catch {
        text = raw
      }
    } else if (ctype === 'text/plain' || ctype === 'text/markdown') text = raw
    else {
      text = htmlToText(raw)
    }
    const page = normalise(text)
    // Little visible text out of a bigger document: a script-built page. Not proof of anything.
    if (page.length < 200 || (/html/.test(ctype || 'html') && page.length < 1000 && raw.length > page.length * 20)) thin = true
    return { page, http: code, truncated: r.truncated, thin }
  }
}

// ---------------------------------------------------------------- checking

export async function checkClaim(claim, opts, cache = new Map()) {
  const id = claim.id === undefined || claim.id === null ? '' : String(claim.id)
  const url = typeof claim.url === 'string' ? claim.url.trim() : ''
  const base = { id, url }
  if (!url) return { ...base, http: null, status: 'unverified', reason: 'no_url' }
  const quote = typeof claim.quote === 'string' ? claim.quote : ''
  let pending = cache.get(url)
  if (!pending) {
    pending = fetchPage(url, opts)
    cache.set(url, pending)
  }
  const page = await pending
  if (page.page === undefined) return { ...base, http: page.http, status: page.status, reason: page.reason }
  if (!quote.trim()) return { ...base, http: page.http, status: 'unverified', reason: 'no_quote' }
  const q = quoteInText(quote, page.page)
  if (q.length < MIN_QUOTE) return { ...base, http: page.http, status: 'unverified', reason: 'too_short_quote' }
  if (q.found) return { ...base, http: page.http, status: 'found', reason: 'quote_found' }
  if (page.truncated) return { ...base, http: page.http, status: 'unverified', reason: 'too_large' }
  if (page.thin) return { ...base, http: page.http, status: 'unverified', reason: 'js_rendered_or_empty' }
  return { ...base, http: page.http, status: 'not_found', reason: 'quote_absent_on_page' }
}

export async function checkClaims(claims, options = {}) {
  const opts = { timeout: 15000, concurrency: 4, maxBytes: 2 * 1024 * 1024, allowLocal: false, ...options }
  const results = new Array(claims.length)
  const cache = new Map()
  let next = 0
  const worker = async () => {
    while (next < claims.length) {
      const i = next++
      results[i] = await checkClaim(claims[i] || {}, opts, cache)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, claims.length)) }, worker))
  return results
}

// ---------------------------------------------------------------- input

export function claimsFromJson(data, label = 'claims') {
  const list = Array.isArray(data) ? data : data && Array.isArray(data.claims) ? data.claims : []
  return list
    .map((c, i) => (c && typeof c === 'object' ? { id: c.id !== undefined && c.id !== null ? String(c.id) : `${label}#${i + 1}`, url: c.url, quote: c.quote } : null))
    .filter(Boolean)
}

// Best effort: every http(s) URL in the text, with the nearest following quoted or blockquoted passage of 20+ characters
// (before the next URL); failing that, a quoted passage earlier on the same line.
export function claimsFromMarkdown(text, label = 'report') {
  const urls = []
  const re = /https?:\/\/[^\s<>)\]"'`]+/g
  let m
  while ((m = re.exec(text))) urls.push({ url: m[0].replace(/[.,;:!?]+$/, ''), start: m.index, end: m.index + m[0].length })
  const quoteRes = [/"([^"\n]{20,500})"/, /“([^”\n]{20,500})”/, /^>\s*(.{20,})$/m]
  const firstQuote = (s) => {
    let best = null
    for (const r of quoteRes) {
      const q = r.exec(s)
      if (q && (!best || q.index < best.index)) best = { index: q.index, text: q[1].trim() }
    }
    return best
  }
  return urls.map((u, i) => {
    // The text after a URL runs up to the next URL, but a quote on the next URL's own line (before it) belongs to that URL.
    let limit = text.length
    if (i + 1 < urls.length) {
      const nextLine = text.lastIndexOf('\n', urls[i + 1].start) + 1
      limit = nextLine > u.end ? nextLine : urls[i + 1].start
    }
    const q = firstQuote(text.slice(u.end, Math.min(limit, u.end + 800)))
    let quote = q ? q.text : ''
    if (!quote) {
      const lineStart = text.lastIndexOf('\n', u.start) + 1
      const before = firstQuote(text.slice(lineStart, u.start))
      if (before) quote = before.text
    }
    return { id: `${label}#${i + 1}`, url: u.url, quote }
  })
}

export function loadClaims(inputs) {
  const claims = []
  const warnings = []
  const readOne = (file) => {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      warnings.push(`cannot read ${file}: ${e.code || e.message}`)
      return
    }
    const label = basename(file).replace(/\.[^.]+$/, '')
    if (/\.json$/i.test(file) || /^\s*[[{]/.test(text)) {
      try {
        claims.push(...claimsFromJson(JSON.parse(text), label))
      } catch {
        warnings.push(`not valid JSON: ${file}`)
      }
    } else claims.push(...claimsFromMarkdown(text, label))
  }
  for (const p of inputs) {
    let st
    try {
      st = statSync(p)
    } catch {
      warnings.push(`no such file or folder: ${p}`)
      continue
    }
    if (st.isDirectory()) {
      for (const n of readdirSync(p).sort()) if (/\.json$/i.test(n)) readOne(join(p, n))
    } else readOne(p)
  }
  return { claims, warnings }
}

// ---------------------------------------------------------------- --out

export function reportsDir() {
  return resolve(String(process.env.TMPDIR || '/tmp').replace(/\/+$/, '') || '/tmp', 'crew-chief-reports')
}

// Returns the absolute path to write, or throws when the path is not inside the reports folder (dot segments, symlinks out,
// or a symlinked target file are all refused).
export function safeOutPath(file) {
  if (/(^|[\\/])\.\.([\\/]|$)/.test(file)) throw new Error('--out may not contain ..')
  const rd = reportsDir()
  const target = resolve(file)
  if (!target.startsWith(rd + sep)) throw new Error(`--out must be inside the crew-chief reports folder (${rd})`)
  mkdirSync(dirname(target), { recursive: true })
  const realRd = realpathSync(rd)
  const realDir = realpathSync(dirname(target))
  if (realDir !== realRd && !realDir.startsWith(realRd + sep)) throw new Error('--out resolves outside the crew-chief reports folder')
  try {
    if (lstatSync(target).isSymbolicLink()) throw new Error('--out is a symlink')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  return target
}

// ---------------------------------------------------------------- CLI

export function formatResults(results) {
  return results.length ? '[\n' + results.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]' : '[]'
}

function summary(results) {
  const c = { found: 0, not_found: 0, unverified: 0, dead_link: 0 }
  for (const r of results) c[r.status] += 1
  return `source-check: ${results.length} claim${results.length === 1 ? '' : 's'}: ${c.found} found, ${c.not_found} not_found, ${c.unverified} unverified, ${c.dead_link} dead_link`
}

async function main(argv) {
  const inputs = []
  const opt = { timeout: 15000, concurrency: 4, maxBytes: 2 * 1024 * 1024 }
  let out
  let strict = false
  try {
    for (let i = 0; i < argv.length; i++) {
      let a = argv[i]
      let v
      const eq = a.indexOf('=')
      if (a.startsWith('--') && eq > 0) {
        v = a.slice(eq + 1)
        a = a.slice(0, eq)
      }
      const val = () => (v !== undefined ? v : argv[++i])
      const int = (name, min) => {
        const x = val()
        if (!/^\d+$/.test(String(x ?? '')) || Number(x) < min) throw new Error(`${name} needs a whole number of at least ${min}`)
        return Number(x)
      }
      if (a === '--strict') strict = true
      else if (a === '--out') {
        out = val()
        if (!out) throw new Error('--out needs a file')
      } else if (a === '--timeout') opt.timeout = int('--timeout', 1)
      else if (a === '--concurrency') opt.concurrency = int('--concurrency', 1)
      else if (a === '--max-bytes') opt.maxBytes = int('--max-bytes', 1)
      else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
      else inputs.push(a)
    }
    if (!inputs.length) throw new Error('give at least one claims file, folder or report')
  } catch (e) {
    console.error(`source-check: ${e.message}`)
    console.error('usage: node source-check.mjs <claims.json | dir | report.md>... [--timeout=15000] [--concurrency=4] [--max-bytes=N] [--out <file>] [--strict]')
    return 2
  }
  let outPath
  if (out) {
    try {
      outPath = safeOutPath(out)
    } catch (e) {
      console.error(`source-check: ${e.message}`)
      return 2
    }
  }
  const { claims, warnings } = loadClaims(inputs)
  for (const w of warnings) console.error(`source-check: ${w}`)
  const results = await checkClaims(claims, { ...opt, allowLocal: process.env.CREW_CHIEF_SOURCE_CHECK_ALLOW_LOCAL === '1' })
  const json = formatResults(results)
  console.log(json)
  console.error(summary(results))
  if (outPath) {
    try {
      writeFileSync(outPath, json + '\n')
    } catch (e) {
      console.error(`source-check: cannot write ${outPath}: ${e.code || e.message}`)
      return 2
    }
  }
  return strict && results.some((r) => r.status === 'not_found' || r.status === 'dead_link') ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2)).then((c) => (process.exitCode = c))
