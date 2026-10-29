// Pure helpers for the crew-ui band (hooks/src/crew-ui.js). Never sees `$`.
//
// The band is a few lines drawn above the prompt. Everything here returns plain data: a line is an array of
// segments `{ t: text, tone, bold? }`, where `tone` is a meaning (ok, warn, hot, crit, dim, info, opus, ...)
// and the drawing part maps it to a colour. That keeps the layout testable without a terminal.
//
//   ctx 52% 520k/1M   5h 4% ~4h20m   7d 96% ~6d13h   guard on · 1 held   [1] compact
//   deep-reader  sonnet-5.5 ●●○○○ medium ▓▓▓░░░ 40%  12k  reading auth

const EFFORT_STEP = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }
const EFFORT_TONE = ['dim', 'ok', 'warn', 'hot', 'crit', 'max']
const RAINBOW = ['rb0', 'rb1', 'rb2', 'rb3', 'rb4'] // the five dots of max, red to magenta

// ●○○○○ low, ●●○○○ medium, ●●●○○ high, ●●●●○ xhigh, ●●●●● max (a rainbow where colour is drawn). Full-height
// glyphs so they sit on the text line.
// No effort (a model without the parameter) -> undefined: nothing is drawn.
export function effortMeter(effort) {
  const step = EFFORT_STEP[String(effort ?? '').toLowerCase()]
  if (step === undefined) return undefined
  return { glyph: '●'.repeat(step) + '○'.repeat(5 - step), tone: EFFORT_TONE[step], label: String(effort).toLowerCase(), rainbow: step === 5 }
}

// pct 0..100 -> '▓▓▓░░░' of `width` cells; a number that is not a number draws nothing.
export function bar(pct, width = 6) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return ''
  const filled = Math.max(0, Math.min(width, Math.round((Math.max(0, Math.min(100, pct)) / 100) * width)))
  return '▓'.repeat(filled) + '░'.repeat(width - filled)
}

export function familyOf(model) {
  const m = String(model ?? '').toLowerCase()
  for (const f of ['opus', 'sonnet', 'haiku', 'fable']) if (m.includes(f)) return f
  return 'other'
}

// 950 -> '950', 41234 -> '41k', 1_250_000 -> '1.2M'.
export function tokenLabel(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return ''
  if (n >= 1_000_000) return Math.floor(n / 100_000) / 10 + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'k'
  return String(Math.floor(n))
}

// 'in 4h20m' style, from an ISO timestamp and `now` in ms; past or unreadable -> ''.
export function untilLabel(iso, now) {
  const at = Date.parse(iso)
  if (!Number.isFinite(at) || typeof now !== 'number') return ''
  const s = Math.floor((at - now) / 1000)
  if (s <= 0) return ''
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `~${d}d${h}h`
  if (h > 0) return `~${h}h${String(m).padStart(2, '0')}m`
  return `~${m}m`
}

const toneFor = (pct, warnAt, critAt) => (pct >= critAt ? 'crit' : pct >= warnAt ? 'warn' : 'ok')

// One rate-limit window: { label: '5h', percent: 4, tone, reset: '~4h20m' }, or undefined without a reading.
export function windowChip(rateLimits, kind, now) {
  const w = (Array.isArray(rateLimits) ? rateLimits : []).find((r) => r && r.kind === kind)
  if (!w || typeof w.percentUsed !== 'number') return undefined
  const percent = Math.round(w.percentUsed)
  return { label: kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind, percent, tone: toneFor(percent, 70, 90), reset: untilLabel(w.resetsAt, now) }
}

const SPARK = '▁▂▃▄▅▆▇█'

// 0..100 values -> one block per value ('▁▂▃▅▇'), the last `width` of them; fewer than 3 values -> ''.
export function sparkline(values, width = 12) {
  const list = (Array.isArray(values) ? values : []).filter((v) => typeof v === 'number' && Number.isFinite(v)).slice(-width)
  if (list.length < 3) return ''
  return list.map((v) => SPARK[Math.max(0, Math.min(SPARK.length - 1, Math.floor((Math.max(0, Math.min(100, v)) / 100) * SPARK.length)))]).join('')
}

// The context: { percent, tokens: '520k', window: '1M', tone, past, spark } where `past` says the compaction
// threshold (`askAt` tokens) has been reached and `spark` is the graph of `history` (percent per turn), or ''.
export function ctxChip(context, askAt, history) {
  if (!context || typeof context.tokens !== 'number' || typeof context.window !== 'number' || context.window <= 0) return undefined
  const percent = Math.round((context.tokens / context.window) * 100)
  return { percent, tokens: tokenLabel(context.tokens), window: tokenLabel(context.window), tone: toneFor(percent, 50, 75), past: typeof askAt === 'number' && context.tokens >= askAt, spark: sparkline(history) }
}

// The Spinner word for a model family: a fixed, calm word instead of the engine's random one (opt-in).
export function spinnerWord(model) {
  const family = familyOf(model)
  return { opus: 'Pondering', sonnet: 'Working', haiku: 'Skimming', fable: 'Dreaming' }[family]
}

// 'sonnet ●●○○○': the model family and the effort meter, for the plain-text spots (the turn line, the spinner)
// that cannot take colour. No model known -> ''.
export function modelChip(model, effort) {
  const family = familyOf(model)
  if (family === 'other' && !model) return ''
  const meter = effortMeter(effort)
  return (family === 'other' ? String(model).replace(/^claude-/, '').slice(0, 14) : family) + (meter ? ' ' + meter.glyph : '')
}

// The one thing worth saying after the prompt's hint line: the most pressing window or the context, else ''.
export function tailText(facts) {
  const loud = [facts.five, facts.week].filter((w) => w && w.percent >= 70).sort((a, b) => b.percent - a.percent)[0]
  if (loud) return `${loud.label} ${loud.percent}%${loud.reset ? ' ' + loud.reset : ''}`
  if (facts.ctx && (facts.ctx.past || facts.ctx.percent >= 70)) return `ctx ${facts.ctx.percent}%`
  return ''
}

// What to add to the footer's mode labels: the saver while it is on, the guard once it has stopped something.
export function modeLabels(facts) {
  const parts = []
  if (facts.saver) parts.push('saver on')
  if (facts.guard && facts.guard.held > 0) parts.push(`guard ${facts.guard.held} held`)
  return parts.length > 0 ? ['crew-chief: ' + parts.join(' · ')] : []
}

const seg = (t, tone, bold) => (bold ? { t, tone, bold: true } : { t, tone })

// Quiet mode: only what is worth a look. The context and the windows from 70 %, the guard once it has stopped
// something, the saver while a window is high, the compact key when compaction is due. Everything fine -> the
// band has nothing to say (and, with no agent running, is not drawn at all).
export function quietFacts(facts) {
  const loud = (w) => (w && w.percent >= 70 ? w : undefined)
  const five = loud(facts.five)
  const week = loud(facts.week)
  return {
    ctx: facts.ctx && (facts.ctx.past || facts.ctx.percent >= 70) ? facts.ctx : undefined,
    five,
    week,
    guard: facts.guard && facts.guard.held > 0 ? facts.guard : undefined,
    saver: Boolean(facts.saver && (five || week)),
    compactKey: facts.compactKey,
  }
}

// The status line of the band: context, windows, guard, saver, and the compact key when it applies.
// facts: { ctx, five, week, guard: { on, held } | undefined, saver: boolean, compactKey: boolean }
export function statusSegments(facts) {
  const out = []
  const gap = () => out.length > 0 && out.push(seg('   ', 'dim'))
  if (facts.ctx) {
    gap()
    out.push(seg('ctx ', 'dim'))
    if (facts.ctx.spark) out.push(seg(facts.ctx.spark + ' ', facts.ctx.tone))
    out.push(seg(`${facts.ctx.percent}%`, facts.ctx.tone, true), seg(` ${facts.ctx.tokens}/${facts.ctx.window}`, 'dim'))
  }
  for (const w of [facts.five, facts.week]) {
    if (!w) continue
    gap()
    out.push(seg(`${w.label} `, 'dim'), seg(`${w.percent}%`, w.tone, true))
    if (w.reset) out.push(seg(` ${w.reset}`, 'dim'))
  }
  if (facts.guard) {
    gap()
    out.push(seg('guard ', 'dim'), facts.guard.on ? seg('on', 'ok') : seg('off', 'crit'))
    if (facts.guard.on && facts.guard.held > 0) out.push(seg(` · ${facts.guard.held} held`, 'warn'))
  }
  if (facts.saver) {
    gap()
    out.push(seg('saver on', 'info'))
  }
  if (facts.compactKey) {
    gap()
    out.push({ ...seg('[1] compact', 'info', true), key: 'compact' })
  }
  return out
}

function clip(text, n) {
  const s = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim()
  return n > 0 && s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s
}

// One subagent: name, model family+version, effort meter, progress bar, tokens, current step.
// agent: { name, model, effort, tokens, pct, step }
export function agentSegments(agent, width = 100) {
  const out = [seg(clip(String(agent.name ?? 'agent').replace(/^.*:/, ''), 18).padEnd(18), 'info', true), seg(' ', 'dim')]
  const model = String(agent.model ?? '').replace(/^claude-/, '').replace(/\[[^\]]*\]$/, '').replace(/-([0-9]+)-([0-9]+)(-[0-9]{8})?$/, '-$1.$2') || 'starting'
  out.push(seg(clip(model, 14), familyOf(agent.model)))
  const meter = effortMeter(agent.effort)
  if (meter && meter.rainbow) out.push(seg(' ', 'dim'), ...RAINBOW.map((tone) => seg('●', tone)), seg(' ', 'dim'), seg(meter.label, 'max', true))
  else if (meter) out.push(seg(' ' + meter.glyph + ' ', meter.tone), seg(meter.label, 'dim'))
  if (typeof agent.pct === 'number') {
    const b = bar(agent.pct)
    const filled = b.indexOf('░') === -1 ? b.length : b.indexOf('░')
    out.push(seg(' ', 'dim'), seg(b.slice(0, filled), 'ok'), seg(b.slice(filled), 'dim'), seg(` ${Math.round(agent.pct)}%`, 'info', true))
  }
  const tok = tokenLabel(agent.tokens)
  if (tok) out.push(seg('  ' + tok, 'dim'))
  const used = out.reduce((n, s) => n + s.t.length, 0)
  const room = width - used - 2
  if (agent.step && room >= 8) out.push(seg('  ' + clip(agent.step, room), 'dim'))
  return out
}

// All lines of the band, at most `maxLines`: the status line first, then one line per agent; agents that do
// not fit become "+N more". No facts and no agents -> [] (the band draws nothing).
export function bandLines({ status, agents, maxLines = 4, width = 100 }) {
  const lines = []
  if (status.length > 0) lines.push(status)
  const room = Math.max(0, maxLines - lines.length)
  const list = Array.isArray(agents) ? agents : []
  const shown = list.length > room ? Math.max(0, room - 1) : list.length
  for (const a of list.slice(0, shown)) lines.push(agentSegments(a, width))
  if (list.length > shown && room > 0) lines.push([seg(`+${list.length - shown} more agents`, 'dim')])
  return lines
}

// Sample content for `/crew-ui demo on`: every part of the band at once, so a style can be judged without
// waiting for a busy session.
export function demoContent(now) {
  const rl = [
    { kind: 'five_hour', percentUsed: 41, resetsAt: new Date(now + (3 * 3600 + 5 * 60) * 1000).toISOString() },
    { kind: 'seven_day', percentUsed: 96, resetsAt: new Date(now + (5 * 86400 + 13 * 3600) * 1000).toISOString() },
  ]
  return {
    facts: {
      ctx: ctxChip({ tokens: 520_000, window: 1_000_000 }, 400_000),
      five: windowChip(rl, 'five_hour', now),
      week: windowChip(rl, 'seven_day', now),
      guard: { on: true, held: 2 },
      saver: true,
      compactKey: true,
    },
    agents: [
      { name: 'deep-reader', model: 'claude-sonnet-5-5', effort: 'medium', tokens: 48_100, pct: 40, step: 'reading auth module' },
      { name: 'implementer-hard', model: 'claude-opus-5-5', effort: 'high', tokens: 212_000, pct: 75, step: 'running the test suite' },
      { name: 'scanner', model: 'claude-haiku-5-5', effort: 'low', tokens: 9_300, pct: 90, step: 'grep routes' },
    ],
  }
}

export const lineText = (line) => line.map((s) => s.t).join('')
