import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ART_KINDS,
  BAR_WIDTH,
  agentArt,
  agentBar,
  agentFace,
  artEscape,
  artKind,
  artPrefix,
  artTokens,
  effortDotsText,
  effortStep,
  effortWord,
  modelColor,
  modelLabel,
  saverBadge,
  speedFor,
} from '../hooks/panel-art-logic.mjs'

const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const NOW = 1_800_000_000_000

// Tags open and close in order (no XML parser in Node: a stack over the tags is enough for markup we write).
function balanced(svg) {
  const stack = []
  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g
  let m
  let last = 0
  while ((m = re.exec(svg))) {
    const between = svg.slice(last, m.index)
    if (between.includes('<') || between.includes('>')) return `stray bracket near ${m.index}`
    last = re.lastIndex
    const [, close, name, attrs, self] = m
    if (/["']/.test(attrs.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, ''))) return `bad quotes in <${name}>`
    if (self) continue
    if (close) {
      if (stack.pop() !== name) return `</${name}> closes the wrong tag`
    } else stack.push(name)
  }
  if (svg.slice(last).includes('<')) return 'stray bracket at the end'
  return stack.length === 0 ? '' : `unclosed: ${stack.join(',')}`
}

function checkSafe(source) {
  assert.equal(balanced(source), '')
  assert.ok(source.startsWith('<svg') && source.endsWith('</svg>'))
  assert.ok(!/<script/i.test(source), 'no script')
  assert.ok(!/href/i.test(source), 'no href')
  assert.ok(!/url\(/i.test(source), 'no url(')
  assert.ok(!/\son\w+=/i.test(source), 'no event attribute')
  assert.ok(source.length < 131_072)
  const frames = [...source.matchAll(/@keyframes\s+([\w-]+)\{((?:[^{}]*\{[^{}]*\})*)\}/g)]
  for (const [, , body] of frames) {
    for (const decl of body.matchAll(/\{([^{}]*)\}/g)) {
      for (const prop of decl[1].split(';').filter(Boolean)) {
        assert.ok(/^\s*(transform|opacity)\s*:/.test(prop), 'only transform and opacity animate: ' + prop)
      }
    }
  }
  if (/animation:/.test(source)) assert.ok(/@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none!important/.test(source), 'reduced motion stops it')
}

test('model labels: family capitalised and the version with a dot', () => {
  assert.equal(modelLabel('claude-sonnet-5-5'), 'Sonnet 5.5')
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5')
  assert.equal(modelLabel('claude-fable-5-2'), 'Fable 5.2')
  assert.equal(modelLabel('claude-opus-5-5[1m]'), 'Opus 5.5')
  assert.equal(modelLabel('claude-opus-4'), 'Opus 4')
  assert.equal(modelLabel(undefined), 'starting')
  assert.equal(modelLabel('some-very-long-experimental-model-name'), 'some-very-lon…')
  assert.equal(modelLabel('claude-mystery-2'), 'mystery-2')
})

test('effort: step, word, spaced dots and speed', () => {
  assert.deepEqual(EFFORTS.map(effortStep), [1, 2, 3, 4, 5])
  assert.deepEqual(EFFORTS.map(effortWord), ['Low', 'Medium', 'High', 'XHigh', 'Max'])
  assert.equal(effortDotsText('high'), '● ● ● ○ ○')
  assert.equal(effortDotsText('max'), '● ● ● ● ●')
  assert.equal(effortDotsText(undefined), '')
  assert.deepEqual(EFFORTS.map(speedFor), [1.7, 1.35, 1.0, 0.78, 0.6])
  assert.equal(speedFor('weird'), 1)
})

test('colours, kinds, tokens, escaping and prefixes', () => {
  assert.equal(modelColor('claude-haiku-5-5'), '#5fe0b0')
  assert.equal(modelColor('claude-sonnet-5-5'), '#7ab8ff')
  assert.equal(modelColor('claude-opus-5-5'), '#ff9a5a')
  assert.equal(modelColor('claude-fable-5-2'), '#d98aff')
  assert.equal(modelColor('gpt'), '#9aa3b5')
  assert.equal(artKind('crew-chief:deep-reader'), 'deep-reader')
  assert.equal(artKind('Explore'), 'generic')
  assert.equal(artTokens(41_234), '41.2k')
  assert.equal(artTokens(12_000), '12.0k')
  assert.equal(artTokens(950), '950')
  assert.equal(artEscape('<a&"\'>'), '&lt;a&amp;&quot;&#39;&gt;')
  assert.notEqual(artPrefix('a1capsule'), artPrefix('a2capsule'))
  assert.match(artPrefix('x'), /^c[0-9a-z]+$/)
})

test('8 kinds x 4 models x 5 efforts x 2 styles: valid, safe, small', () => {
  let max = 0
  for (const name of ART_KINDS) {
    for (const model of MODELS) {
      for (const effort of EFFORTS) {
        for (const style of ['capsule', 'cat']) {
          for (const pct of [62, undefined]) {
            const art = agentArt({ id: name + model, name: 'crew-chief:' + name, model, effort, tokens: 41_234, elapsedMs: 130_000, pct, step: 'reading the auth module' }, { style, now: NOW })
            checkSafe(art.source)
            max = Math.max(max, art.source.length)
            // At most six moving nodes for one agent.
            assert.ok((art.source.match(/style="animation:/g) ?? []).length <= 6, `${name} ${style}: ${(art.source.match(/style="animation:/g) ?? []).length} animations`)
            assert.equal((art.source.match(/r="4" fill=/g) ?? []).length, effortStep(effort), 'filled effort dots')
          }
        }
      }
    }
  }
  assert.ok(max < 8192, 'a row stays under 8k characters: ' + max)
})

test('the text says the full model name and effort word, no call count', () => {
  const art = agentArt({ id: 'a', name: 'deep-reader', model: 'claude-sonnet-5-5', effort: 'high', tokens: 41_234, elapsedMs: 130_000, pct: 62, calls: 34 }, { now: NOW })
  assert.match(art.source, />Sonnet 5\.5</)
  assert.match(art.source, />High</)
  assert.match(art.source, />~62%</)
  assert.doesNotMatch(art.source, /calls/)
  assert.equal(art.alt, 'deep-reader Sonnet 5.5 ● ● ● ○ ○ High 41.2k 2m10s ~62%')
})

test('progress: fresh ends in a dot, stale is faded and marked old, none is a dotted line with no number', () => {
  const base = { id: 'a', name: 'reviewer', model: 'claude-opus-5-5', effort: 'max', tokens: 1000 }
  const fresh = agentArt({ ...base, pct: 62 }, { now: NOW }).source
  assert.match(fresh, /<circle cx="[\d.]+" cy="34" r="1\.5" fill="#ff9a5a"\/>/)
  const stale = agentArt({ ...base, pct: 62, stale: true }, { now: NOW }).source
  assert.match(stale, />old</)
  assert.match(stale, /<g opacity="\.4">/)
  const none = agentArt({ ...base }, { now: NOW }).source
  assert.match(none, /no estimate/)
  assert.doesNotMatch(none, /%</)
  assert.match(none, /stroke-dasharray="0 4"/)
  for (const s of [fresh, stale, none]) assert.doesNotMatch(s, /keyframes c\w+(sh|ind)\{/)
})

test('unknown type, model and effort draw without trouble', () => {
  for (const style of ['capsule', 'cat']) {
    const art = agentArt({ name: 'Explore', model: 'gpt-x', effort: undefined }, { style, now: NOW })
    checkSafe(art.source)
    assert.match(art.source, /#9aa3b5/)
    const unknown = agentArt({ name: 'x', unknown: true }, { style })
    checkSafe(unknown.source)
    assert.doesNotMatch(unknown.source, /starting/)
  }
})

test('agent text is escaped: a hostile name or step stays text', () => {
  const art = agentArt({ id: 'z', name: '<script>&"x', model: 'claude-sonnet-5-5', effort: 'low', step: '</svg><script>alert(1)</script> & "q"' }, { now: NOW })
  checkSafe(art.source)
  assert.ok(!art.source.includes('<script'))
})

test('rolling digits: only within 300 ms of a change, the old value leaves and the new one stays at rest', () => {
  const a = { id: 'r', name: 'scanner', model: 'claude-haiku-5-5', effort: 'low', tokens: 12_500, elapsedMs: 21_000 }
  const rolling = agentArt(a, { now: NOW, prev: { tokens: '12.4k', tokensAt: NOW - 100, time: '21s', timeAt: NOW - 5000 } }).source
  checkSafe(rolling)
  assert.match(rolling, /keyframes c\w+rIn\{from\{transform:translateY/)
  assert.match(rolling, /opacity="0"[^>]*>4</) // the old digit, hidden at rest
  assert.match(rolling, />12\.</) // the unchanged head stays still
  assert.match(rolling, /animation:c\w+rIn 300ms ease-out -100ms both/)
  const settled = agentArt(a, { now: NOW, prev: { tokens: '12.4k', tokensAt: NOW - 400 } }).source
  assert.doesNotMatch(settled, /rIn/)
  assert.match(settled, />12\.5k</)
})

test('the full card blinks on across redraws (negative delay from now)', () => {
  const a = { id: 'p', name: 'scanner', model: 'claude-haiku-5-5', effort: 'high' }
  const delay = (now) => {
    const m = /animation:\w+bl ([\d.]+)s \S+ (-?\d+)ms infinite/.exec(agentArt(a, { now }).source)
    return { cycle: Number(m[1]) * 1000, delay: Number(m[2]) }
  }
  const s1 = delay(1000)
  const s2 = delay(1500)
  assert.equal((((s1.delay - s2.delay) % s1.cycle) + s1.cycle) % s1.cycle, 500)
})

test('saver badges', () => {
  for (const kind of ['save', 'ultra']) {
    const badge = saverBadge(kind, NOW)
    checkSafe(badge.source)
    assert.match(badge.source, /rx="8"/)
    assert.equal(badge.alt, kind === 'ultra' ? 'ultra-saver on' : 'saver on')
  }
  assert.match(saverBadge('ultra', NOW).source, /ring/)
})

test('the bar is still: no keyframes, no animation; a 5% step changes its source', () => {
  const a = { id: 'x', name: 'scanner', model: 'claude-haiku-5-5', effort: 'low' }
  const lo = agentBar({ ...a, pct: 41 })
  const hi = agentBar({ ...a, pct: 58 })
  assert.notEqual(lo.source, hi.source)
  for (const b of [lo, hi, agentBar({ ...a, pct: 41, stale: true }), agentBar(a), agentBar({ ...a, pct: 0 }), agentBar({ ...a, pct: 100 })]) {
    checkSafe(b.source)
    assert.ok(!/@keyframes|animation/.test(b.source), 'nothing moves in the bar')
    assert.equal(b.sheen, undefined)
    assert.equal(b.width, BAR_WIDTH)
  }
  // The fill ends in a bright dot with a halo where the percent ends; the start is fainter than the end.
  const dot = /<circle cx="([\d.]+)" cy="3" r="1\.5" fill="#5fe0b0"\/>/.exec(lo.source)
  assert.ok(dot, 'a dot at the fill end')
  assert.equal(Number(dot[1]), 3 + ((BAR_WIDTH - 6) * 40) / 100)
  assert.match(lo.source, new RegExp(`<circle cx="${dot[1]}" cy="3" r="3" fill="#5fe0b0" fill-opacity="[\\d.]+"/>`))
  const shades = [...lo.source.matchAll(/<rect [^>]*fill-opacity="([\d.]+)"/g)].map((m) => Number(m[1]))
  assert.ok(shades.length > 2 && shades[0] < 0.4 && shades.at(-1) === 1)
  assert.ok(shades.every((v, i) => i === 0 || v >= shades[i - 1]), 'lighter at the start, full at the end')
  // Stale: the same line, fainter.
  assert.match(agentBar({ ...a, pct: 41, stale: true }).source, /<g opacity="\.4">/)
})

test('the bar with no estimate: a dotted line in the model colour, no dot, no percent', () => {
  const none = agentBar({ id: 'x', name: 'scanner', model: 'claude-sonnet-5-5', effort: 'medium' })
  assert.equal(none.alt, 'no estimate')
  assert.match(none.source, /<line [^>]*stroke="#7ab8ff" stroke-opacity="\.4"[^>]*stroke-linecap="round" stroke-dasharray="0 4"\/>/)
  assert.doesNotMatch(none.source, /<circle/)
  assert.doesNotMatch(none.source, /@keyframes|animation/)
})

test('the face in performance mode: fully still, no keyframes, no animation style, no clock', () => {
  for (const name of [...ART_KINDS, 'Explore']) {
    for (const style of ['capsule', 'cat']) {
      for (const id of ['a1', 'a2', 'a3']) {
        const f = agentFace({ id, name: 'crew-chief:' + name, model: 'claude-sonnet-5-5', effort: 'medium' }, { style, perf: true })
        checkSafe(f.source)
        assert.equal((f.source.match(/@keyframes/g) ?? []).length, 0, `${name} ${style}: zero keyframes`)
        assert.doesNotMatch(f.source, /animation|<style/, `${name} ${style}: no animation style`)
        // The rest pose is still drawn: the eyes are there, open.
        assert.match(f.source, /<circle cx="1\d(\.\d+)?" cy="1\d(\.\d+)?" r="/)
        // No clock: the same agent draws the same face at any time.
        assert.equal(agentFace({ id, name: 'crew-chief:' + name, model: 'claude-sonnet-5-5', effort: 'medium' }, { style, perf: true }).source, f.source)
      }
    }
  }
})

// The keyframe names of a picture without its class prefix.
const names = (src) => {
  const P = /\.(c\w+?)a\{animation:none/.exec(src)[1]
  return [...src.matchAll(/@keyframes (\w+)\{/g)].map((m) => m[1].slice(P.length))
}

test('the face by default moves fully: its tool and body motions, a phase from the id, no clock', () => {
  const tools = { scanner: 'spin', 'deep-reader': 'read', implementer: 'ham', 'implementer-hard': 'rev', reviewer: 'lens', planner: 'pen', mechanic: 'wr', 'ui-tester': 'cur' }
  const face = (id, name, style) => agentFace({ id, name: 'crew-chief:' + name, model: 'claude-sonnet-5-5', effort: 'medium' }, { style }).source
  for (const [name, motion] of Object.entries(tools)) {
    for (const style of ['capsule', 'cat']) {
      const src = face('a1', name, style)
      checkSafe(src)
      const frames = names(src)
      assert.ok(frames.includes(motion), `${name} ${style}: the ${motion} motion in ${frames}`)
      assert.ok(frames.includes('bl'), 'and the blink')
      assert.ok(frames.includes(style === 'cat' ? 'tail' : 'bob'), 'and the body')
      assert.match(src, /prefers-reduced-motion:reduce/)
      assert.equal(face('a1', name, style), src, 'the same agent draws the same face')
      assert.notEqual(face('a2', name, style), src, 'another agent moves in a phase of its own')
      // Two drawings 5 s apart: byte-identical, so the frame the band draws it in is never loaded again.
      const at = (now) => agentFace({ id: 'a1', name: 'crew-chief:' + name, model: 'claude-sonnet-5-5', effort: 'medium' }, { style, now }).source
      assert.equal(at(1_000_000), at(1_005_000), 'no clock in the source')
      assert.equal(at(1_000_000), src, 'the same with or without now')
    }
  }
  // The perf face holds no motion at all.
  const still = agentFace({ id: 'a1', name: 'crew-chief:implementer', model: 'claude-sonnet-5-5', effort: 'medium' }, { perf: true }).source
  assert.doesNotMatch(still, /@keyframes|animation/)
})
