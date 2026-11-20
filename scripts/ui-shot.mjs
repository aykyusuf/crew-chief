#!/usr/bin/env node
// crew-chief UI screenshots with real mobile emulation (Node 22+, Chrome or Chromium).
//
// Headless Chrome's --window-size cannot go below about 500 px wide: a "390 wide" shot taken that way is a
// 500 px layout cut off at 390 (seen 2026-11-20). This script drives Chrome over the DevTools protocol instead,
// so the page is laid out at the real width, and measures horizontal overflow at the same time.
//
// Usage: node ui-shot.mjs <url> <out dir> <slug> [--webgl] [--wait=ms]
//   writes <out dir>/<slug>-desktop.png (1440x900) and <slug>-mobile.png (390x844, mobile, DPR 2) and prints
//   one JSON line: { shots: [...], overflow: [{ width, scrollWidth, innerWidth, overflow, wide: [...] }] }
//   for 1440, 390 and 360. --webgl turns on software GL so a WebGL canvas renders; --wait is the settle time
//   per page (default 3500, 8000 with --webgl). Writes nothing else; the Chrome profile is a temp folder that
//   is removed at the end. CHROME_PATH picks the browser binary.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]))
const [url, outDir, slug] = args.filter((a) => !a.startsWith('--'))
const waitArg = args.find((a) => a.startsWith('--wait='))
const webgl = flags.has('--webgl')
const wait = waitArg ? Number(waitArg.slice(7)) : webgl ? 8000 : 3500

let atExit = () => {}
function fail(msg) {
  atExit()
  console.error('ui-shot: ' + msg)
  process.exit(2)
}

if (!url || !outDir || !slug) fail('usage: node ui-shot.mjs <url> <out dir> <slug> [--webgl] [--wait=ms]')
if (!/^(https?|file):\/\//.test(url)) fail('the url must start with http://, https:// or file://')
if (!/^[A-Za-z0-9._-]+$/.test(slug) || slug.startsWith('.')) fail('the slug may hold only letters, digits, dot, dash and underscore')
if (!Number.isFinite(wait) || wait < 0 || wait > 60000) fail('--wait must be 0..60000')
if (typeof WebSocket !== 'function') fail('Node 22 or newer is needed (global WebSocket); take the shots with plain headless Chrome and note that the mobile one is a 500 px layout')
if (!existsSync(outDir)) fail('the out dir does not exist: ' + outDir)

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (existsSync(mac)) return mac
  for (const dir of (process.env.PATH || '').split(':')) {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      if (dir && existsSync(join(dir, name))) return join(dir, name)
    }
  }
  return undefined
}

const bin = chromePath()
if (!bin) fail('no Chrome or Chromium found (set CHROME_PATH)')

const profile = mkdtempSync(join(tmpdir(), 'crew-chief-shot-'))
const chromeArgs = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check']
if (webgl) chromeArgs.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle')
chromeArgs.push('about:blank')
const chrome = spawn(bin, chromeArgs, { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

atExit = cleanup
function cleanup() {
  try {
    chrome.kill()
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
}

const MEASURE = `(() => {
  const d = document.documentElement
  const wide = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.right > innerWidth + 1
  }).slice(0, 6).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).join('.') : '') + ' right=' + Math.round(e.getBoundingClientRect().right))
  return { scrollWidth: d.scrollWidth, innerWidth, overflow: d.scrollWidth > innerWidth, wide }
})()`

try {
  let port
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100)
    try {
      port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim()
    } catch {}
  }
  if (!port) fail('Chrome did not start')
  let page
  for (let i = 0; i < 50 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
    } catch {}
    if (!page) await sleep(100)
  }
  if (!page) fail('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d)
      pending.delete(d.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  const runs = [
    { width: 1440, height: 900, mobile: false, scale: 1, shot: `${slug}-desktop.png` },
    { width: 390, height: 844, mobile: true, scale: 2, shot: `${slug}-mobile.png` },
    { width: 360, height: 780, mobile: true, scale: 1 },
  ]
  const out = { shots: [], overflow: [] }
  for (const run of runs) {
    await send('Emulation.setDeviceMetricsOverride', { width: run.width, height: run.height, deviceScaleFactor: run.scale, mobile: run.mobile })
    await send('Page.navigate', { url })
    await sleep(wait)
    const r = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true })
    const v = r.result?.result?.value
    out.overflow.push(v ? { width: run.width, ...v } : { width: run.width, error: 'could not measure' })
    if (run.shot) {
      const s = await send('Page.captureScreenshot', { format: 'png' })
      if (s.result?.data) {
        const path = join(outDir, run.shot)
        writeFileSync(path, Buffer.from(s.result.data, 'base64'))
        out.shots.push(path)
      }
    }
  }
  ws.close()
  console.log(JSON.stringify(out))
} finally {
  cleanup()
}
process.exit(0)
