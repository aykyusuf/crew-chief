// Pure drawings for the band outside the terminal (hooks/src/crew-ui.js): one Svg per running subagent, the
// saver icons and badges, and the limit meter of the saver question. Never sees `$`; every function returns
// a string of SVG markup (or plain text) from plain data, so tests/panel-art-logic.test.mjs can check it.
//
// Two characters, chosen with panel.style: `capsule` (default; a yellow capsule buddy whose overalls, straps,
// legs and goggle band take the model's colour) and `cat` (a blue point kitten; the model's colour is only on
// its collar bell and beads). The agent type picks an accessory and a tool, the model a colour, the effort
// the speed of the motion and how many of the five dots are filled. In performance mode (panel.perf) a character
// stands fully still in its rest pose (no keyframes, no animation at all); the progress bar never moves.
//
// Rules every drawing keeps (the tests check them):
//   - no script, no `href`, no `url(`: nothing is loaded and no id can collide between drawings;
//   - every class and keyframes name starts with a prefix of its own drawing;
//   - only `transform` and `opacity` are animated, and under prefers-reduced-motion nothing moves and the
//     still frame is the right one (the new digits shown, the bar at its value);
//   - a new image is drawn on every band redraw, so each looping animation is given a negative delay from
//     `now`: a redraw picks the motion up where it was instead of starting it again;
//   - text from an agent (its name, its step) is escaped.
const EFFORT_STEPS = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }

// 4m12s, 38s, 1h05m (the same as ui-logic's elapsedLabel; kept here so this file imports nothing).
export function artElapsed(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 1000) return ''
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export const ART_WIDTH = 500
export const ART_HEIGHT = 48
export const ART_STYLES = ['capsule', 'cat', 'text']
export const ART_KINDS = ['scanner', 'deep-reader', 'implementer', 'implementer-hard', 'reviewer', 'planner', 'mechanic', 'ui-tester']

const MODEL_COLOR = { haiku: '#5fe0b0', sonnet: '#7ab8ff', opus: '#ff9a5a', fable: '#d98aff', other: '#9aa3b5' }
const SPEED = [1, 1.7, 1.35, 1.0, 0.78, 0.6] // by effort step; no effort -> 1
const EFFORT_WORD = ['', 'Low', 'Medium', 'High', 'XHigh', 'Max']
// The card takes the theme behind it: see-through light tints instead of fixed colours (a navy card clashed
// with a red or purple theme). The text is neutral so it reads on any dark backdrop.
const INK = '#ececf1'
const MUTE = '#a6a8b3'
const BAR_TRACK = 'rgba(255,255,255,.12)'
const CARD = 'rgba(255,255,255,.045)'
const LINE = 'rgba(255,255,255,.13)'
const FONT = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
const ROLL_MS = 300

export function artEscape(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function artClip(text, n) {
  const s = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim()
  return n > 0 && s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s
}

export function artFamily(model) {
  const m = String(model ?? '').toLowerCase()
  for (const f of ['opus', 'sonnet', 'haiku', 'fable']) if (m.includes(f)) return f
  return 'other'
}

export function modelColor(model) {
  return MODEL_COLOR[artFamily(model)]
}

// 'claude-sonnet-5-5' -> 'Sonnet 5.5', 'claude-haiku-4-5-20251001' -> 'Haiku 4.5', 'claude-opus-5-5[1m]' ->
// 'Opus 5.5', 'claude-opus-4' -> 'Opus 4'; anything else -> the raw name without 'claude-', at most 14
// characters; nothing yet -> 'starting'.
export function modelLabel(model) {
  if (model === undefined || model === null || model === '') return 'starting'
  const raw = String(model).trim().replace(/^claude-/i, '').replace(/\[[^\]]*\]$/, '').replace(/-[0-9]{8}$/, '')
  const m = /^(haiku|sonnet|opus|fable)-([0-9]+)(?:[-.]([0-9]+))?$/i.exec(raw)
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + ' ' + m[2] + (m[3] !== undefined ? '.' + m[3] : '')
  return artClip(raw, 14)
}

// 1..5 for low..max, undefined for anything else.
export function effortStep(effort) {
  return EFFORT_STEPS[String(effort ?? '').trim().toLowerCase()]
}

export function effortWord(effort) {
  const step = effortStep(effort)
  return step === undefined ? '' : EFFORT_WORD[step]
}

// '● ● ○ ○ ○': the meter with a plain space between the dots, for text lines.
export function effortDotsText(effort) {
  const step = effortStep(effort)
  if (step === undefined) return ''
  return Array.from({ length: 5 }, (_, i) => (i < step ? '●' : '○')).join(' ')
}

export function speedFor(effort) {
  return SPEED[effortStep(effort) ?? 0]
}

// 'crew-chief:deep-reader' -> 'deep-reader'; a type the art does not know -> 'generic'.
export function artKind(name) {
  const n = String(name ?? '').replace(/^.*:/, '').trim().toLowerCase()
  return ART_KINDS.includes(n) ? n : 'generic'
}

// 950 -> '950', 41234 -> '41.2k', 1250000 -> '1.2M' (cut, not rounded).
export function artTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return ''
  if (n >= 1_000_000) return Math.floor(n / 100_000) / 10 + 'M'
  if (n >= 1000) return (Math.floor(n / 100) / 10).toFixed(1) + 'k'
  return String(Math.floor(n))
}

// A small hash, for a prefix of class names that differs between drawings.
export function artPrefix(seed) {
  let h = 2166136261
  for (const ch of String(seed ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return 'c' + (h >>> 0).toString(36).slice(0, 6)
}

const r2 = (n) => Math.round(n * 100) / 100

// One drawing's motion: keyframes and class rules collected while it is built.
function motion(P, now) {
  const frames = new Map()
  const t = typeof now === 'number' && Number.isFinite(now) ? now : 0
  return {
    frames,
    // `name` keyframes `body`; the element style for it: duration (s), timing, alternate or not, a phase from `now`.
    anim(name, body, dur, { ease = 'ease-in-out', alt = true, origin, box = 'view-box', delayMs } = {}) {
      frames.set(name, body)
      const cycle = dur * 1000 * (alt ? 2 : 1)
      const delay = delayMs !== undefined ? delayMs : -Math.round(t % cycle)
      const parts = [`animation:${P}${name} ${r2(dur)}s ${ease} ${delay}ms infinite${alt ? ' alternate' : ''}`]
      if (box) parts.push(`transform-box:${box}`)
      if (origin) parts.push(`transform-origin:${origin}`)
      return `class="${P}a" style="${parts.join(';')}"`
    },
    once(name, body, durMs, agoMs) {
      frames.set(name, body)
      return `class="${P}a" style="animation:${P}${name} ${durMs}ms ease-out ${-Math.max(0, Math.round(agoMs))}ms both"`
    },
  }
}

function styleBlock(P, mo, extra = '') {
  // Nothing moves (a still face): no style at all, so not one animation rule is left for the host to run.
  if (mo.frames.size === 0 && extra === '') return ''
  const kf = [...mo.frames].map(([name, body]) => `@keyframes ${P}${name}{${body}}`).join('')
  return `<style>${extra}${kf}@media (prefers-reduced-motion:reduce){.${P}a{animation:none!important}.${P}m{display:none}}</style>`
}

// ---- the characters ------------------------------------------------------------------------------------

// The full card's (agentArt) one motion: a short blink (BLINK_MS) once a cycle of 6 to 8 s; the rest of the time
// it stands still in its rest pose. The cycle and the phase come from `seed` (the agent), so cards do not blink
// together. The face in performance mode has not even this: it stands fully still (the user's call, 2026-11-15).
const BLINK_MS = 180
// A motion that never moves: the character drawn in its rest pose, no keyframes collected.
const STILL = { anim: () => '' }

// The character's body and tool. perf: the rest pose, still but for the blink when `blinks`, fully still otherwise;
// else every motion, at the effort's speed.
function character(a, style, mo, perf, now, blinks = false) {
  const C = a.unknown ? MODEL_COLOR.other : modelColor(a.model)
  const step = a.unknown ? undefined : effortStep(a.effort)
  const kind = artKind(a.name)
  const k = speedFor(a.effort)
  const m = perf ? STILL : mo
  const eyes = perf ? (blinks ? blink(mo, String(a.id ?? a.name ?? 'agent'), now) : '') : undefined
  const body = (style === 'cat' ? cat(kind, C, step, m, k, eyes) : capsule(kind, C, step, m, k, eyes)) + tool(kind, C, m, k)
  // A still motion leaves an empty attribute ('<g >', '<circle  cx'): drop the spaces it leaves (no text in here).
  return perf ? body.replace(/ +>/g, '>').replace(/ {2,}/g, ' ') : body
}

function blink(mo, seed, now = 0) {
  const h = parseInt(artPrefix(seed + 'blink').slice(1), 36)
  const cycleMs = 6000 + (h % 21) * 100
  const shut = r2(100 - (100 * BLINK_MS) / 2 / cycleMs)
  const open = r2(100 - (100 * BLINK_MS) / cycleMs)
  const delayMs = -Math.round((now + Math.floor(h / 21) * 137) % cycleMs)
  return mo.anim('bl', `0%,${open}%,100%{transform:none}${shut}%{transform:scaleY(.1)}`, cycleMs / 1000, { alt: false, box: 'fill-box', origin: '50% 50%', delayMs })
}

// Five effort marks along a row: filled `fill`, empty a thin ring of `ring`.
function marks(xs, ys, step, color, rFull, rRing, sw) {
  return xs.map((x, i) => (i < (step ?? 0) ? `<circle cx="${x}" cy="${ys[i]}" r="${rFull}" fill="${color}"/>` : `<circle cx="${x}" cy="${ys[i]}" r="${rRing}" fill="none" stroke="${color}" stroke-width="${sw}"/>`)).join('')
}

const CAP_HAT = {
  'deep-reader': '<path d="M14.6 5.3q-1.2-2.8-3.4-3.4M15.4 5.3q.4-3.2 2.4-4" stroke="#2a2f45" stroke-width="1" fill="none" stroke-linecap="round"/>',
  mechanic: '<path d="M14.6 5.3q-1.2-2.8-3.4-3.4M15.4 5.3q.4-3.2 2.4-4" stroke="#2a2f45" stroke-width="1" fill="none" stroke-linecap="round"/>',
}

function capsuleAccessory(kind, mo, k) {
  switch (kind) {
    case 'scanner':
      return `<line x1="15" y1="5" x2="15" y2="2.8" stroke="#c9d0e4" stroke-width="1"/><g ${mo.anim('ant', 'from{transform:rotate(-16deg)}to{transform:rotate(16deg)}', 2.2 * k, { origin: '15px 2.8px' })}><path d="M11 1.2Q15 6 19 1.2Z" fill="#e6ebf7" stroke="#9aa3c4" stroke-width=".6"/></g>`
    case 'implementer':
      return '<path d="M6.5 9.2Q6.5 1.6 15 1.6Q23.5 1.6 23.5 9.2Z" fill="#f4f6fb"/><rect x="14" y="1.9" width="2" height="6.6" fill="#c9d0e4"/><rect x="4.5" y="8" width="21" height="2.4" rx="1.2" fill="#c9d0e4"/>'
    case 'implementer-hard':
      return '<path d="M6 10Q6 1.9 15 1.9Q24 1.9 24 10Z" fill="#9aa3c4" stroke="#5d6688" stroke-width=".7"/><path d="M13 2.4L15 .3L17 2.4Z" fill="#e0503f"/><rect x="5" y="8.9" width="20" height="2" rx="1" fill="#5d6688"/>'
    case 'reviewer':
      return '<circle cx="19" cy="17" r="5" fill="none" stroke="#ffd27a" stroke-width="1.1"/><path d="M23.8 18.6q2.2 3 .3 5.8" stroke="#ffd27a" stroke-width=".55" fill="none" stroke-dasharray=".9 .7"/><rect x="11" y=".4" width="8" height="5.4" rx=".8" fill="#23263a"/><rect x="11" y="3.4" width="8" height="1.2" fill="#ff5a7a"/><rect x="8.6" y="5" width="12.8" height="1.6" rx=".8" fill="#23263a"/>'
    case 'planner':
      return '<path d="M7 6.6Q14 .6 22.5 5.8Q23.4 7.2 21 7.4L8.2 7.6Q6.2 7.4 7 6.6Z" fill="#3b4f7d"/><circle cx="14.4" cy="2.4" r="1" fill="#5a71a8"/>'
    case 'ui-tester':
      return '<path d="M3.8 16Q3.8 2.6 15 2.6Q26.2 2.6 26.2 16" stroke="#2b2f45" stroke-width="1.8" fill="none"/><rect x="1.8" y="13.6" width="4.2" height="7.6" rx="2.1" fill="#ff6fa0"/><rect x="24" y="13.6" width="4.2" height="7.6" rx="2.1" fill="#ff6fa0"/>'
    case 'generic':
      return '<path d="M8 8.4Q8 2.6 15 2.6Q22 2.6 22 8.4Z" fill="#6f7c98"/><circle cx="15" cy="2.4" r="1.3" fill="#c9d0e4"/>'
    default:
      return ''
  }
}

function capsule(kind, C, step, mo, k, eyesAttr) {
  const goggle = kind === 'deep-reader' ? '#f3d98b' : kind === 'mechanic' ? '#8a6a52' : '#c3c9da'
  const white = kind === 'mechanic' ? '#e4f6ff' : '#fff'
  const eyes = `<g ${eyesAttr ?? mo.anim('bl', '0%,93%,100%{transform:none}96%{transform:scaleY(.1)}', 4.6, { alt: false, box: 'fill-box', origin: '50% 50%' })}><circle cx="11" cy="17" r="3.5" fill="${white}"/><circle cx="11.55" cy="17.3" r="2.05" fill="#151a2b"/><circle cx="10.65" cy="16.2" r=".85" fill="#fff"/><circle cx="19" cy="17" r="3.5" fill="${white}"/><circle cx="19.55" cy="17.3" r="2.05" fill="#151a2b"/><circle cx="18.65" cy="16.2" r=".85" fill="#fff"/></g>`
  return (
    `<g ${mo.anim('bob', 'to{transform:translateY(-1px)}', 1.2 * k)}>` +
    `<ellipse cx="11" cy="40" rx="3" ry="1.5" fill="#262b40"/><ellipse cx="19" cy="40" rx="3" ry="1.5" fill="#262b40"/><rect x="9.6" y="35.5" width="2.8" height="4" fill="${C}"/><rect x="17.6" y="35.5" width="2.8" height="4" fill="${C}"/>` +
    `<path d="M6.2 24q-3.4 2.6-2.6 6.6M23.8 24q3.4 1.2 4.6 4.4" stroke="#ffcf3d" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="3.7" cy="30.9" r="1.45" fill="#262b40"/><circle cx="28.5" cy="28.8" r="1.45" fill="#262b40"/>` +
    (CAP_HAT[kind] ?? '') +
    `<rect x="5.5" y="5" width="19" height="33" rx="9.5" fill="#ffcf3d"/><path d="M22.6 11V29" stroke="#e8b322" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M5.5 26.6H24.5V28.5A9.5 9.5 0 0 1 5.5 28.5Z" fill="${C}"/><rect x="9.6" y="23.6" width="10.8" height="4" rx="1.2" fill="${C}"/><path d="M10 24L6.4 20.6M20 24L23.6 20.6" stroke="${C}" stroke-width="1.5" stroke-linecap="round"/><rect x="12.6" y="27.6" width="4.8" height="1.6" rx=".8" fill="#1d2236" opacity=".35"/>` +
    marks([9.8, 12.4, 15, 17.6, 20.2], [31.2, 31.2, 31.2, 31.2, 31.2], step, '#fff', 1.05, 0.8, 0.5) +
    `<rect x="5.5" y="15.6" width="19" height="2.8" fill="${C}"/><circle cx="11" cy="17" r="4.5" fill="${goggle}"/><circle cx="19" cy="17" r="4.5" fill="${goggle}"/>` +
    eyes +
    `<path d="M12.8 22.2q2.2 2.3 4.4 0Z" fill="#2a2f45"/>` +
    capsuleAccessory(kind, mo, k) +
    `</g>`
  )
}

function catAccessory(kind) {
  switch (kind) {
    case 'scanner':
      return '<line x1="15" y1="10" x2="15" y2="5.5" stroke="#c9d0e4" stroke-width="1"/><path d="M11 2.5Q15 8 19 2.5Z" fill="#e6ebf7" stroke="#9aa3c4" stroke-width=".6"/>'
    case 'deep-reader':
      return '<g fill="#fff" fill-opacity=".08" stroke="#d9b45a" stroke-width=".9"><circle cx="10.2" cy="21" r="4.5"/><circle cx="19.8" cy="21" r="4.5"/></g><path d="M14.6 20.6q.4-.6.8 0" stroke="#d9b45a" stroke-width=".9" fill="none"/>'
    case 'implementer':
      return '<path d="M7.5 11Q7.5 4 15 4Q22.5 4 22.5 11Z" fill="#ffcc33"/><rect x="6" y="10.2" width="18" height="2.6" rx="1.3" fill="#e6a800"/><rect x="14" y="4.3" width="2" height="6.5" fill="#e6a800"/>'
    case 'implementer-hard':
      return '<path d="M7.5 11.5Q7.5 4.5 15 4.5Q22.5 4.5 22.5 11.5Z" fill="#9aa3c4" stroke="#5d6688" stroke-width=".7"/><path d="M13 5L15 2L17 5Z" fill="#e0503f"/><rect x="6.5" y="10.4" width="17" height="2" rx="1" fill="#5d6688"/>'
    case 'reviewer':
      return '<circle cx="19.8" cy="21" r="4.5" fill="#fff" fill-opacity=".08" stroke="#d9b45a" stroke-width=".9"/><path d="M24.2 22.4q2.2 3 .4 5.6" stroke="#d9b45a" stroke-width=".55" fill="none" stroke-dasharray=".9 .7"/><rect x="11" y="3.4" width="8" height="6.4" rx=".8" fill="#23263a"/><rect x="11" y="6.6" width="8" height="1.3" fill="#ff5a7a"/><rect x="8.6" y="9.4" width="12.8" height="1.8" rx=".9" fill="#23263a"/>'
    case 'planner':
      return '<ellipse cx="13.5" cy="9.6" rx="8" ry="2.8" fill="#3b4f7d"/><path d="M7 9.2Q13 4.6 20.5 8.8" fill="#3b4f7d"/><circle cx="13" cy="5.8" r="1" fill="#5a71a8"/>'
    case 'mechanic':
      return '<path d="M4.5 13.4Q15 10 25.5 13.4" stroke="#5b4a3f" stroke-width="1.6" fill="none"/><g stroke="#5b4a3f" stroke-width=".9" fill="#7fd6ff"><circle cx="11.4" cy="12" r="2.5"/><circle cx="18.6" cy="12" r="2.5"/></g><path d="M10.5 11.1l1-.5M17.7 11.1l1-.5" stroke="#fff" stroke-width=".55" stroke-linecap="round"/>'
    case 'ui-tester':
      return '<path d="M3.6 19Q3.6 6.8 15 6.8Q26.4 6.8 26.4 19" stroke="#2b2f45" stroke-width="1.8" fill="none"/><rect x="1.6" y="15.5" width="4.2" height="8" rx="2.1" fill="#ff6fa0"/><rect x="24.2" y="15.5" width="4.2" height="8" rx="2.1" fill="#ff6fa0"/>'
    case 'generic':
      return '<circle cx="21.5" cy="9.6" r="1.6" fill="#f7b6c7"/><circle cx="23.4" cy="8.4" r="1.1" fill="#f7b6c7"/>'
    default:
      return ''
  }
}

function cat(kind, C, step, mo, k, eyesAttr) {
  const P = '#8592ad'
  return (
    `<g ${mo.anim('tail', 'from{transform:rotate(-12deg)}to{transform:rotate(10deg)}', 1.5 * k, { origin: '9px 39px' })}><path d="M9.5 39.5C3 40 1 33 3.6 28.5" stroke="${P}" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M3.2 31C2.9 30 3.1 29.2 3.6 28.5" stroke="#6f7c98" stroke-width="3.4" fill="none" stroke-linecap="round"/></g>` +
    `<ellipse cx="15" cy="34.8" rx="9.3" ry="7.3" fill="#f8f2e7"/><ellipse cx="15" cy="34" rx="4.8" ry="4.8" fill="#fffaf3"/><ellipse cx="11.3" cy="41" rx="2.9" ry="1.9" fill="${P}"/><ellipse cx="18.7" cy="41" rx="2.9" ry="1.9" fill="${P}"/>` +
    `<g ${mo.anim('head', 'from{transform:rotate(-3deg)}to{transform:rotate(3deg)}', 3.4 * k, { origin: '15px 29px' })}>` +
    `<path d="M4.9 15L5.6 5L12.8 10.2ZM25.1 15L24.4 5L17.2 10.2Z" fill="${P}" stroke="${P}" stroke-width="1.8" stroke-linejoin="round"/><path d="M6.7 12.2L7.1 7.4L10.6 10.3ZM23.3 12.2L22.9 7.4L19.4 10.3Z" fill="#f7b6c7"/>` +
    `<ellipse cx="15" cy="19.8" rx="12.3" ry="10.2" fill="#f8f2e7"/><ellipse cx="15" cy="23" rx="8.4" ry="6" fill="${P}" opacity=".2"/><ellipse cx="15" cy="23.8" rx="6" ry="4.6" fill="${P}" opacity=".26"/><ellipse cx="15" cy="24.8" rx="3.4" ry="2.8" fill="${P}" opacity=".32"/>` +
    `<ellipse cx="13.9" cy="26.3" rx="1.6" ry="1.2" fill="#fbf6ee"/><ellipse cx="16.1" cy="26.3" rx="1.6" ry="1.2" fill="#fbf6ee"/><ellipse cx="6.9" cy="25.2" rx="2.1" ry="1.25" fill="#f7a1b8" opacity=".6"/><ellipse cx="23.1" cy="25.2" rx="2.1" ry="1.25" fill="#f7a1b8" opacity=".6"/>` +
    `<g ${eyesAttr ?? mo.anim('bl', '0%,93%,100%{transform:none}96%{transform:scaleY(.1)}', 6.4, { alt: false, box: 'fill-box', origin: '50% 50%' })}>` +
    `<circle cx="10.2" cy="21" r="3.7" fill="#5fa8e8" stroke="#3e5579" stroke-width=".45"/><ellipse cx="10.45" cy="21.3" rx="2.05" ry="2.55" fill="#1c2740"/><circle cx="9.05" cy="19.6" r="1.25" fill="#fff"/><circle cx="11.4" cy="22.7" r=".6" fill="#fff" opacity=".85"/>` +
    `<circle cx="19.8" cy="21" r="3.7" fill="#5fa8e8" stroke="#3e5579" stroke-width=".45"/><ellipse cx="20.05" cy="21.3" rx="2.05" ry="2.55" fill="#1c2740"/><circle cx="18.65" cy="19.6" r="1.25" fill="#fff"/><circle cx="21" cy="22.7" r=".6" fill="#fff" opacity=".85"/></g>` +
    `<path d="M14.4 24.9h1.2l-.6.7z" fill="#f29ab0" stroke="#f29ab0" stroke-width=".6" stroke-linejoin="round"/><path d="M13.8 26.1q.6.65 1.2 0q.6.65 1.2 0" stroke="#55607c" stroke-width=".5" fill="none" stroke-linecap="round"/>` +
    `<path d="M5.6 24l-3.8-.6M5.6 25.5l-3.8.5M24.4 24l3.8-.6M24.4 25.5l3.8.5" stroke="#fff" stroke-width=".4" opacity=".5" stroke-linecap="round"/>` +
    catAccessory(kind) +
    `</g>` +
    `<path d="M8.5 28.8Q15 31.8 21.5 28.8" stroke="#2a3150" stroke-width="2.3" fill="none" stroke-linecap="round"/>` +
    marks([9.8, 12.4, 15, 17.6, 20.2], [29.04, 29.76, 30, 29.76, 29.04], step, C, 0.95, 0.7, 0.5) +
    `<circle cx="15" cy="32.5" r="1.5" fill="${C}"/><circle cx="14.5" cy="32" r=".45" fill="#fff" opacity=".8"/>`
  )
}

function tool(kind, C, mo, k) {
  switch (kind) {
    case 'scanner':
      return `<circle cx="38.5" cy="22" r="8.5" fill="#0f1c24" stroke="${C}" stroke-width="1.2"/><circle cx="38.5" cy="22" r="4.5" fill="none" stroke="${C}" stroke-width=".6" opacity=".45"/><g ${mo.anim('spin', 'to{transform:rotate(360deg)}', 2.4 * k, { alt: false, ease: 'linear', origin: '38.5px 22px' })}><path d="M38.5 22L38.5 13.5A8.5 8.5 0 0 1 45.86 17.75Z" fill="${C}" opacity=".35"/><line x1="38.5" y1="22" x2="38.5" y2="13.5" stroke="${C}" stroke-width="1.2"/></g><circle ${mo.anim('pul', 'to{opacity:.2}', 1.6 * k)} cx="42" cy="19" r="1.1" fill="#fff"/>`
    case 'deep-reader':
      return `<path d="M29 34L38 32L38 18L29 20ZM38 32L47 34L47 20L38 18Z" fill="#f4ecd8" stroke="${C}" stroke-width=".8" stroke-linejoin="round"/><path d="M31 23L36 21.9M31 26L36 24.9M31 29L35 28.1M40 21.9L45 23M40 24.9L45 26M40 27.9L45 29" stroke="#8b8fa8" stroke-width=".6"/><g ${mo.anim('read', 'from{transform:translateY(0)}to{transform:translateY(7px)}', 1.8 * k)}><path d="M39.6 21.5L45.4 22.8" stroke="${C}" stroke-width="1.6" opacity=".6" stroke-linecap="round"/></g>`
    case 'implementer':
      return `<rect x="33" y="36" width="14" height="5" rx="1" fill="#c77b58"/><path d="M40 36v5" stroke="#0d0f1a" stroke-width=".6"/><rect x="39.4" y="32" width="1.2" height="4" fill="#aab3cc"/><g ${mo.anim('ham', 'from{transform:rotate(-22deg)}to{transform:rotate(4deg)}', 0.9 * k, { origin: '30px 26px' })}><rect x="30" y="25" width="11" height="2" rx="1" fill="#b58a55"/><rect x="38" y="21" width="4.5" height="10" rx="1" fill="#c9d0e4"/></g><circle ${mo.anim('spark', 'to{opacity:0}', 0.45 * k)} cx="40" cy="31.4" r="1.3" fill="#ffd27a"/>`
    case 'implementer-hard':
      return `<g ${mo.anim('spin', 'to{transform:rotate(360deg)}', 3 * k, { alt: false, ease: 'linear', origin: '37px 20px' })}><circle cx="37" cy="20" r="6.5" fill="none" stroke="${C}" stroke-width="3.2" stroke-dasharray="2.6 2.5"/><circle cx="37" cy="20" r="4.6" fill="#12172b" stroke="${C}" stroke-width="1.2"/><circle cx="37" cy="20" r="1.4" fill="${C}"/></g><g ${mo.anim('rev', 'to{transform:rotate(-360deg)}', 2 * k, { alt: false, ease: 'linear', origin: '42.5px 31.5px' })}><circle cx="42.5" cy="31.5" r="4.2" fill="none" stroke="#c9d0e4" stroke-width="2.6" stroke-dasharray="2 1.95"/><circle cx="42.5" cy="31.5" r="2.6" fill="#12172b" stroke="#c9d0e4" stroke-width=".9"/></g>`
    case 'reviewer':
      return `<rect x="30" y="9" width="13" height="27" rx="2" fill="#eef1fa" stroke="${C}" stroke-width=".8"/><rect x="34" y="7.5" width="5" height="3" rx="1" fill="#9aa3c4"/><path d="M31.8 15.5l1.2 1.2l2.2-2.4M31.8 22.5l1.2 1.2l2.2-2.4M31.8 29.5l1.2 1.2l2.2-2.4" stroke="${C}" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M37 15.6H41M37 22.6H41M37 29.6H40" stroke="#9aa3c4" stroke-width=".8"/><g ${mo.anim('lens', 'from{transform:translateY(-2px)}to{transform:translateY(13px)}', 2.6 * k)}><circle cx="42" cy="16" r="3.6" fill="#fff" fill-opacity=".18" stroke="${INK}" stroke-width="1.3"/><line x1="44.6" y1="18.6" x2="47" y2="21.4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/></g>`
    case 'planner':
      return `<rect x="29" y="8" width="18" height="28" rx="2" fill="#0f2a4d" stroke="#4f8fd6" stroke-width=".8"/><path d="M35 8V36M41 8V36M29 15H47M29 22H47M29 29H47" stroke="#4f8fd6" stroke-width=".4" opacity=".45"/><path d="M32 31V22L38 16L44 22V31Z" fill="none" stroke="${C}" stroke-width="1" stroke-linejoin="round" opacity=".55"/><g ${mo.anim('pen', 'from{transform:translateX(0)}to{transform:translateX(12px)}', 2.2 * k)}><path d="M31.6 24.8l1.6.9-4 7-1.6-.9z" fill="#ffd23f"/><path d="M27.6 31.8l-.3 1.9 1.9-1z" fill="#f2c79a"/></g><rect x="32" y="33" width="12" height="1.2" rx=".6" fill="${C}"/>`
    case 'mechanic':
      return `<polygon points="39,18 42.5,20 42.5,24 39,26 35.5,24 35.5,20" fill="#8a93b8" stroke="#5d6688" stroke-width=".7"/><circle cx="39" cy="22" r="1.4" fill="#3a4466"/><g ${mo.anim('wr', 'from{transform:rotate(-16deg)}to{transform:rotate(16deg)}', 1.3 * k, { origin: '39px 22px' })}><path d="M39 15.6A6.4 6.4 0 1 0 39 28.4A6.4 6.4 0 1 0 39 15.6ZM39 17.6A4.4 4.4 0 1 1 39 26.4A4.4 4.4 0 1 1 39 17.6Z" fill="#c9d0e4" fill-rule="evenodd"/><rect x="37.7" y="27.5" width="2.6" height="12" rx="1.3" fill="#c9d0e4"/></g>`
    case 'ui-tester':
      return `<rect x="29.5" y="8" width="17.5" height="26" rx="2" fill="#12172b" stroke="${C}" stroke-width=".8"/><path d="M29.5 10a2 2 0 0 1 2-2h13.5a2 2 0 0 1 2 2v2h-17.5Z" fill="${C}" opacity=".3"/><rect x="32" y="15" width="12.5" height="5" rx="1.2" fill="none" stroke="${C}" stroke-width=".8"/><rect x="32" y="23" width="12.5" height="5" rx="1.2" fill="none" stroke="${C}" stroke-width=".8"/><g ${mo.anim('cur', 'from{transform:translate(0,0)}to{transform:translate(6px,-8px)}', 1.6 * k)}><circle cx="35.5" cy="25.5" r="2.4" fill="none" stroke="${C}" stroke-width=".9"/><path d="M35.5 25.5L35.5 32L37.3 30.5L38.7 33.3L40 32.7L38.6 30L41 30Z" fill="#fff" stroke="#10142a" stroke-width=".4"/></g>`
    default:
      // An agent type the art does not know: a speech bubble with three calm dots.
      return `<path d="M31 14h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-4 4v-4h-2a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2Z" fill="#12172b" stroke="${C}" stroke-width=".9"/><g ${mo.anim('dots', 'to{opacity:.25}', 1.2 * k)}><circle cx="34" cy="21" r="1.3" fill="${C}"/><circle cx="38" cy="21" r="1.3" fill="${C}"/><circle cx="42" cy="21" r="1.3" fill="${C}"/></g>`
  }
}

// ---- the text and the bar -------------------------------------------------------------------------------

// A counter right-aligned at `xr` on baseline `y`, `cw` px per character (the width is forced with textLength,
// so the column holds whatever monospace font the surface has). When the text changed less than ROLL_MS ago,
// the characters from the first that changed slide: the old ones up and out, the new ones up and in.
function counter(P, mo, xr, y, text, prev, agoMs, cw, size, fill, weight = '') {
  const n = text.length
  if (n === 0) return ''
  const x0 = r2(xr - n * cw)
  const attrs = `font-size="${size}" fill="${fill}"${weight}`
  const rolling = typeof prev === 'string' && prev !== '' && prev !== text && typeof agoMs === 'number' && agoMs >= 0 && agoMs < ROLL_MS
  if (!rolling) return `<text x="${x0}" y="${y}" ${attrs} textLength="${r2(n * cw)}">${artEscape(text)}</text>`
  let p = 0
  let q = 0
  if (prev.length === n) {
    while (p < n && prev[p] === text[p]) p++
    while (q < n - p && prev[n - 1 - q] === text[n - 1 - q]) q++
  }
  const head = p > 0 ? `<text x="${x0}" y="${y}" ${attrs} textLength="${r2(p * cw)}">${artEscape(text.slice(0, p))}</text>` : ''
  const after = q > 0 ? `<text x="${r2(x0 + (n - q) * cw)}" y="${y}" ${attrs} textLength="${r2(q * cw)}">${artEscape(text.slice(n - q))}</text>` : ''
  const tail = text.slice(p, n - q)
  const old = prev.slice(p, prev.length - q)
  const h = size + 3
  const wx = r2(x0 + p * cw)
  const ww = r2(Math.max(tail.length, old.length) * cw)
  const by = r2(size - 1)
  return (
    head +
    `<svg x="${wx}" y="${r2(y - size)}" width="${ww}" height="${h}" overflow="hidden">` +
    `<text x="0" y="${by}" ${attrs} textLength="${r2(tail.length * cw)}" ${mo.once('rIn', `from{transform:translateY(${h}px)}`, ROLL_MS, agoMs)}>${artEscape(tail)}</text>` +
    `<text x="0" y="${by}" ${attrs} opacity="0" textLength="${r2(old.length * cw)}" ${mo.once('rOut', `from{opacity:1;transform:none}to{opacity:0;transform:translateY(-${h}px)}`, ROLL_MS, agoMs)}>${artEscape(old)}</text>` +
    `</svg>` +
    after
  )
}

// The bar of the agent's own estimate, still (nothing in it moves): a faint thin track, the done part filled
// from the left in the model's colour, faint at the start and full at the end, ending in a bright dot with a soft
// halo; faded when the estimate is stale; a dotted line in the model's colour when there is none. Drawn centred
// on a line 3 px below `y`, the fill in 3 px steps on whole pixels (no seams between them) and the halo as
// stacked circles (a radial fade with no gradient, no id, no url).
function progressBar(C, x, y, w, pct, stale) {
  const cy = y + 3
  const x0 = x + 3
  const x1 = x + w - 3
  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    return `<line x1="${x0}" y1="${cy}" x2="${x1}" y2="${cy}" stroke="${C}" stroke-opacity=".4" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0 4"/>`
  }
  const p = Math.max(0, Math.min(100, pct))
  const xe = r2(x0 + ((x1 - x0) * p) / 100)
  const track = xe < x1 ? `<line x1="${xe}" y1="${cy}" x2="${x1}" y2="${cy}" stroke="${BAR_TRACK}" stroke-width="1" stroke-linecap="round"/>` : ''
  const len = xe - x0
  const n = Math.max(1, Math.ceil(len / 3))
  const shade = (i) => r2(0.18 + (0.82 * (i + 1)) / n)
  let fill = ''
  if (len > 0) {
    fill = `<g fill="${C}"><path d="M${x0} ${cy - 1}A1 1 0 0 0 ${x0} ${cy + 1}Z" fill-opacity="${shade(0)}"/>`
    for (let i = 0; i < n; i++) {
      const sx = x0 + i * 3
      const ex = Math.min(xe, sx + 3)
      if (ex > sx) fill += `<rect x="${sx}" y="${cy - 1}" width="${r2(ex - sx)}" height="2" fill-opacity="${shade(i)}"/>`
    }
    fill += '</g>'
  }
  const dot =
    [3, 2.4, 1.8].map((r) => `<circle cx="${xe}" cy="${cy}" r="${r}" fill="${C}" fill-opacity=".14"/>`).join('') +
    `<circle cx="${xe}" cy="${cy}" r="1.5" fill="${C}"/><circle cx="${xe}" cy="${cy}" r=".7" fill="#fff" fill-opacity=".85"/>`
  return track + (stale ? `<g opacity=".4">${fill}${dot}</g>` : fill + dot)
}

// The plain line an agent's drawing says, for `alt` (a reader that cannot see it, and the tests).
export function agentArtAlt(a) {
  const parts = [String(a.name ?? 'agent').replace(/^.*:/, '')]
  if (!a.unknown) {
    parts.push(modelLabel(a.model))
    const dots = effortDotsText(a.effort)
    if (dots) parts.push(dots, effortWord(a.effort))
  }
  const tok = artTokens(a.tokens)
  if (tok) parts.push(tok)
  const el = artElapsed(a.elapsedMs)
  if (el) parts.push(el)
  if (typeof a.pct === 'number') parts.push(`~${Math.round(a.pct)}%${a.stale ? ' old' : ''}`)
  if (a.step) parts.push(artClip(a.step, 60))
  return parts.join(' ')
}

// One running subagent as an Svg: { source, alt, width, height }.
// a: { id, name, model, effort, tokens, elapsedMs, pct, stale, step, unknown, fresh }
// opts: { style: 'capsule'|'cat', now, prev: { tokens, time, tokensAt, timeAt } } where prev holds what was
// drawn before and when each changed (crew-ui.js keeps it), for the rolling digits.
export function agentArt(a, opts = {}) {
  const style = opts.style === 'cat' ? 'cat' : 'capsule'
  const now = typeof opts.now === 'number' ? opts.now : 0
  const P = artPrefix(String(a.id ?? a.name ?? 'agent') + style)
  const mo = motion(P, now)
  const C = a.unknown ? MODEL_COLOR.other : modelColor(a.model)
  const step = a.unknown ? undefined : effortStep(a.effort)
  // The whole card is no longer drawn in the band (the split card below is); it keeps the still character with
  // its blink, which keeps it under 8k characters next to the still bar.
  const body = character(a, style, mo, true, now, true)
  const name = artClip(String(a.name ?? 'agent').replace(/^.*:/, ''), 17)
  let line1 = `<text x="56" y="19" font-size="12" font-weight="600" fill="${C}">${artEscape(name)}</text>`
  if (!a.unknown) {
    line1 += `<text x="186" y="19" font-size="11" fill="${MUTE}">${artEscape(modelLabel(a.model))}</text>`
    if (step !== undefined) {
      line1 += marks([262, 272.4, 282.8, 293.2, 303.6], [15, 15, 15, 15, 15], step, C, 4, 3.25, 1.5)
      line1 += `<text x="313" y="19" font-size="11" fill="${MUTE}">${effortWord(a.effort)}</text>`
    }
  }
  const prev = opts.prev ?? {}
  const tok = artTokens(a.tokens)
  const time = artElapsed(a.elapsedMs)
  line1 += counter(P, mo, 432, 19, tok, prev.tokens, now - (prev.tokensAt ?? -Infinity), 7.2, 12, INK)
  line1 += counter(P, mo, 490, 19, time, prev.time, now - (prev.timeAt ?? -Infinity), 6.6, 11, MUTE)
  const hasPct = typeof a.pct === 'number' && Number.isFinite(a.pct)
  let line2 = progressBar(C, 56, 31, 180, hasPct ? a.pct : undefined, a.stale === true)
  let sx = 244
  if (hasPct) {
    const label = `~${Math.round(Math.max(0, Math.min(100, a.pct)))}%`
    line2 += `<text x="${sx}" y="37" font-size="11" font-weight="600" fill="${a.stale ? MUTE : INK}">${label}</text>`
    sx += label.length * 6.6 + 4
    if (a.stale) {
      line2 += `<text x="${r2(sx)}" y="37" font-size="10" fill="${MUTE}" font-style="italic">old</text>`
      sx += 24
    }
  } else {
    line2 += `<text x="${sx}" y="37" font-size="10" fill="${MUTE}">no estimate</text>`
    sx += 76
  }
  // The first run of a type: a tag on the second line (on the first one it overlapped the name).
  if (a.fresh) {
    line2 += `<text x="${r2(sx)}" y="37" font-size="10" font-weight="600" fill="#e9c46a">first run</text>`
    sx += 58
  }
  const room = Math.floor((ART_WIDTH - 8 - sx) / 6)
  if (a.step && room >= 6) line2 += `<text x="${r2(sx)}" y="37" font-size="10" fill="${MUTE}">${artEscape(artClip(a.step, room))}</text>`
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_WIDTH} ${ART_HEIGHT}" width="${ART_WIDTH}" height="${ART_HEIGHT}" font-family="${FONT}">` +
    styleBlock(P, mo) +
    `<rect x=".5" y=".5" width="${ART_WIDTH - 1}" height="${ART_HEIGHT - 1}" rx="9" fill="${CARD}" stroke="${LINE}"/>` +
    `<svg x="2" y="2" width="48" height="44" viewBox="0 0 48 44" overflow="visible">${body}</svg>` +
    line1 +
    line2 +
    `</svg>`
  return { source, alt: agentArtAlt(a), width: ART_WIDTH, height: ART_HEIGHT }
}

// ---- the split card (the user's pick, 2026-11-15) ---------------------------------------------------------
// The Desktop app draws an Svg as an image and loads it again whenever its source changes; a whole card changed
// every second (clock, tokens), so its animations restarted and jumped. The card is now host Text around two small
// pictures whose source never holds a clock: the character (changes with nothing but the agent, its type, model and
// effort; its motions run from a phase of the agent's own, never from the clock) and the still bar (changes when the percent moves a 5% step, or the
// estimate goes stale or away; nothing moves in it, so the reload does not show).

export const FACE_SIZE = 40
export const BAR_WIDTH = 132
export const BAR_HEIGHT = 6

// The character alone: { source, alt, width, height }; opts: { style, perf }. No phase from the clock (it comes
// from the agent's id), so the same agent always gets the same markup and the image is never reloaded under its
// motion. perf (panel.perf on, or an agent waiting on its background work): fully still, the rest pose with no
// keyframes and no animation style at all.
export function agentFace(a, opts = {}) {
  const style = opts.style === 'cat' ? 'cat' : 'capsule'
  const perf = opts.perf === true
  const P = artPrefix(String(a.name ?? 'agent') + String(a.model ?? '') + String(a.effort ?? '') + style + (perf ? 'perf' : '') + 'face')
  // The motions' phase: an offset from the agent's id (cards do not move in step), plus the wall clock when the
  // caller passes `now`. The Desktop app seems to load the image again on redraws (seen live 2026-11-15: the cat's
  // tail snapped back to one pose); with the clock in the phase a reload picks the motion up where it was.
  // Without `now` the source is the same on every call.
  const id = String(a.id ?? a.name ?? 'agent')
  const offset = parseInt(artPrefix(id + 'phase').slice(1), 36) % 60000
  const mo = motion(P, offset + (typeof opts.now === 'number' && Number.isFinite(opts.now) && !perf ? opts.now : 0))
  const body = character(a, style, mo, perf)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 44" width="${FACE_SIZE}" height="${r2((FACE_SIZE * 44) / 48)}" overflow="visible">` +
    styleBlock(P, mo) +
    body +
    `</svg>`
  return { source, alt: String(a.name ?? 'agent').replace(/^.*:/, ''), width: FACE_SIZE, height: r2((FACE_SIZE * 44) / 48) }
}

// The percent the bar draws: a 5% step, so small moves do not reload it; undefined without an estimate.
export function barPct(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return undefined
  return Math.max(0, Math.min(100, Math.round(pct / 5) * 5))
}

// The progress bar alone: { source, alt, width, height }. Still: nothing in it moves, so a new source (a 5% step,
// the estimate going stale or away) reloads it with nothing to jump.
export function agentBar(a) {
  const pct = barPct(a.pct)
  const stale = a.stale === true
  const C = a.unknown ? MODEL_COLOR.other : modelColor(a.model)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BAR_WIDTH} ${BAR_HEIGHT}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}">` +
    progressBar(C, 0, 0, BAR_WIDTH, pct, stale) +
    `</svg>`
  return { source, alt: pct === undefined ? 'no estimate' : `~${pct}%`, width: BAR_WIDTH, height: BAR_HEIGHT }
}

// What the card's text says, piece by piece (crew-ui.js lays it out as Text).
export function agentCardText(a) {
  const pct = typeof a.pct === 'number' && Number.isFinite(a.pct) ? Math.round(Math.max(0, Math.min(100, a.pct))) : undefined
  return {
    name: artClip(String(a.name ?? 'agent').replace(/^.*:/, ''), 18),
    color: a.unknown ? MODEL_COLOR.other : modelColor(a.model),
    model: a.unknown ? '' : modelLabel(a.model),
    dots: a.unknown ? '' : effortDotsText(a.effort),
    effort: a.unknown ? '' : effortStep(a.effort) !== undefined ? effortWord(a.effort) : '',
    tokens: artTokens(a.tokens),
    time: artElapsed(a.elapsedMs),
    pct: pct === undefined ? 'no estimate' : `~${pct}%${a.stale ? ' old' : ''}`,
    hasPct: pct !== undefined,
    fresh: a.fresh === true,
    step: a.step ? artClip(a.step, 48) : '',
  }
}

export const CARD_LOOK = { bg: CARD, border: LINE, ink: INK, mute: MUTE, warn: '#e9c46a' }

// ---- the saver ----------------------------------------------------------------------------------------------

export const SAVER_LOOK = {
  save: { text: '#8fe3cf', bg: '#14282a', border: '#3a8676' },
  ultra: { text: '#ffb08a', bg: '#2a1714', border: '#b5482d' },
}
export const SAVER_RADIUS = 8 // the corner radius of the saver badge

// The status line badge: an icon and the words in one rounded box of SAVER_RADIUS, in the saver's colours.
// Static (the ring of ultra pulses, nothing else moves).
export function saverBadge(kind, now = 0) {
  const ultra = kind === 'ultra'
  const L = ultra ? SAVER_LOOK.ultra : SAVER_LOOK.save
  const words = ultra ? 'ultra-saver on' : 'saver on'
  const P = artPrefix('badge' + kind)
  const mo = motion(P, now)
  const w = Math.round(26 + words.length * 6.9 + 8)
  const icon = ultra
    ? `<circle cx="6" cy="6" r="5.4" fill="none" stroke="#ff7a4d" stroke-width=".8" opacity="0" ${mo.anim('ring', 'from{transform:scale(.8);opacity:.75}to{transform:scale(1.18);opacity:0}', 2.3, { alt: false, ease: 'ease-out', box: 'fill-box', origin: '50% 50%' })}/><path d="M6 1.8L9.4 3.1V5.8C9.4 8 7.9 9.4 6 10.2C4.1 9.4 2.6 8 2.6 5.8V3.1Z" fill="#e2582f"/>`
    : `<path d="M2.5 9.5C2.5 5 5 2.5 9.5 2.5C9.5 7 7.5 9.5 3.5 9.8Z" fill="#5fd0b8"/>`
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 20" width="${w}" height="20" font-family="${FONT}">${styleBlock(P, mo)}` +
    `<rect x=".75" y=".75" width="${w - 1.5}" height="18.5" rx="${SAVER_RADIUS}" fill="${L.bg}" stroke="${L.border}" stroke-width="1.5"/>` +
    `<svg x="7" y="4" width="12" height="12" viewBox="0 0 12 12" overflow="visible">${icon}</svg>` +
    `<text x="24" y="14" font-size="11.5" font-weight="600" fill="${L.text}">${words}</text></svg>`
  return { source, alt: words, width: w, height: 20 }
}
