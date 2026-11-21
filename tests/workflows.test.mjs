// Static checks of the research workflows and the crew-research skill, plus a run of both workflow
// scripts against a stubbed runtime (the real one is the Workflow tool: not available in tests).
// Run: node --test tests/workflows.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'

const root = new URL('..', import.meta.url).pathname
const wfDir = join(root, 'workflows')
const skillDir = join(root, 'skills', 'crew-research')
const assetsDir = join(skillDir, 'assets')
const WORKFLOWS = ['research-sweep', 'research-verify']
const read = (p) => readFileSync(p, 'utf8')
const src = Object.fromEntries(WORKFLOWS.map((n) => [n, read(join(wfDir, n + '.js'))]))

// ---- helpers ----------------------------------------------------------------------------

// The text between the parens of every `agent(` call, found by balanced scanning that skips string literals.
function agentCalls(fullText) {
  const text = fullText.replace(/^\s*\/\/.*$/gm, '') // full-line comments only
  const calls = []
  const re = /(?<![\w.])agent\(/g
  let m
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length
    const start = i
    let depth = 1
    while (i < text.length && depth > 0) {
      const c = text[i]
      if (c === "'" || c === '"' || c === '`') {
        const q = c
        i++
        while (i < text.length && text[i] !== q) i += text[i] === '\\' ? 2 : 1
      } else if (c === '(') depth++
      else if (c === ')') depth--
      i++
    }
    calls.push(text.slice(start, i - 1))
  }
  return calls
}

// The literal after `export const meta = `, evaluated in an empty sandbox: any identifier or call in it throws.
function metaOf(text) {
  assert.ok(text.startsWith('export const meta = {'), 'export const meta must be the first statement of the file')
  const start = text.indexOf('{')
  let depth = 0
  let i = start
  for (; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"') {
      const q = c
      i++
      while (text[i] !== q) i += text[i] === '\\' ? 2 : 1
    } else if (c === '{') depth++
    else if (c === '}' && --depth === 0) break
  }
  const literal = text.slice(start, i + 1)
  assert.ok(!literal.includes('`') && !literal.includes('...'), 'meta must not use template strings or spread')
  return vm.runInNewContext('(' + literal + ')', Object.create(null))
}

// Run a workflow script against stubs. `handler(prompt, opts)` plays the agent; every call is recorded.
async function runWorkflow(text, args, handler) {
  const calls = []
  const logs = []
  const body = text.replace(/^export const meta/, 'const meta')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', body)
  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts })
    return handler(prompt, opts)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const pipeline = (items, ...stages) =>
    Promise.all(
      items.map(async (item, i) => {
        try {
          let prev = item
          for (const s of stages) prev = await s(prev, item, i)
          return prev
        } catch {
          return null
        }
      }),
    )
  const phase = () => {}
  const result = await fn(agent, parallel, pipeline, (m) => logs.push(m), phase, args, { total: null, spent: () => 0, remaining: () => Infinity })
  return { result, calls, logs }
}

// ---- static checks -----------------------------------------------------------------------

test('the plugin ships exactly the two research workflows', () => {
  assert.deepEqual(readdirSync(wfDir).filter((f) => f.endsWith('.js')).sort(), WORKFLOWS.map((n) => n + '.js'))
})

test('meta is the first statement, a pure literal, and named like the file', () => {
  for (const n of WORKFLOWS) {
    const meta = metaOf(src[n])
    assert.equal(meta.name, n)
    assert.ok(meta.description && meta.description.length < 400, n + ' description')
    assert.ok(Array.isArray(meta.phases) && meta.phases.length > 0, n + ' phases')
  }
})

test('phase titles in the code are exactly the titles in meta.phases', () => {
  for (const n of WORKFLOWS) {
    const titles = metaOf(src[n]).phases.map((p) => p.title)
    assert.equal(new Set(titles).size, titles.length, n + ' duplicate phase title')
    const body = src[n].slice(src[n].indexOf('\n}\n') + 3)
    const used = new Set([...body.matchAll(/\bphase\(\s*'([^']+)'/g)].map((m) => m[1]).concat([...body.matchAll(/\bphase:\s*'([^']+)'/g)].map((m) => m[1])))
    assert.deepEqual([...used].sort(), [...titles].sort(), n)
  }
})

test('no clock, randomness, imports, file or process access in a workflow script', () => {
  for (const n of WORKFLOWS) {
    const body = src[n].replace(/^export const meta/, 'const meta')
    for (const re of [/Date\.now\(/, /Math\.random\(/, /new Date\(/, /\bimport\b/, /\brequire\(/, /\bprocess\./, /\bfetch\(/, /\bfs\./]) {
      assert.ok(!re.test(body), n + ' uses ' + re)
    }
    assert.ok(!/\bexport\b/.test(body), n + ' exports something besides meta')
  }
})

test('every agent() call sets agentType (crew-chief:*) and an explicit model, never Fable', () => {
  let total = 0
  for (const n of WORKFLOWS) {
    const calls = agentCalls(src[n])
    assert.ok(calls.length > 0, n + ' has no agent() call')
    for (const c of calls) {
      total++
      assert.match(c, /agentType:\s*'crew-chief:(researcher|verifier)'/, n + ': agentType missing in ' + c.slice(0, 60))
      assert.match(c, /\bmodel:\s*'(sonnet|opus)'/, n + ': explicit model missing in ' + c.slice(0, 60))
      assert.match(c, /\beffort:\s*'(low|medium|high)'/, n + ': effort missing in ' + c.slice(0, 60))
    }
  }
  assert.ok(total >= 5)
})

test('Fable appears nowhere in the workflows, and in the skill and templates only in a "no/never Fable" line', () => {
  for (const n of WORKFLOWS) assert.ok(!/fable/i.test(src[n]), n + ' mentions Fable')
  const files = [join(skillDir, 'SKILL.md'), ...readdirSync(assetsDir).filter((f) => f.endsWith('.md')).map((f) => join(assetsDir, f))]
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      if (/fable/i.test(line)) assert.match(line, /\b(no|never)\b[^.]*fable/i, f + ': ' + line.slice(0, 80))
      assert.ok(!/model:\s*["']?fable/i.test(line), f)
    }
  }
})

// ---- the skill and its templates --------------------------------------------------------

test('the skill is main-session only and carries the decisions it was asked to', () => {
  const s = read(join(skillDir, 'SKILL.md'))
  assert.match(s, /^---\nname: crew-research\ndescription: "[^"]+"\nargument-hint: "\[question\]"\n---\n/)
  for (const must of [
    'Main session only',
    'AskUserQuestion',
    'Ekonomik',
    'Tam',
    'at most 4 agents',
    'research-cost.mjs',
    'source-check.mjs',
    'brief-check.mjs',
    'crew-chief:research-sweep',
    'crew-chief:research-verify',
    'one-group trial',
    'plain agents',
    'Workflows are not available',
    'night',
    'Workflow tool is denied',
    'Opus at medium',
    'doğrulanamadı',
    'crew-chief:verifier',
    'never instructions',
    'No Fable anywhere',
  ]) assert.ok(s.includes(must), 'skill text lacks: ' + must)
  assert.ok(!/\d+\s*[kKmM]?\s*tokens?\b[^.]*budget|token budget of/i.test(s))
})

test('brief templates have the parts the research briefs need and no token numbers', () => {
  const names = readdirSync(assetsDir).filter((f) => f.endsWith('.md')).sort()
  assert.deepEqual(names, ['brief-counter.md', 'brief-reporter.md', 'brief-researcher.md', 'brief-verifier.md'])
  for (const f of names) {
    const t = read(join(assetsDir, f))
    assert.match(t, /\bstop\b/i, f + ' stop rule')
    assert.match(t, /Output path:/, f + ' output path')
    assert.match(t, /\bverif/i, f + ' verification')
    assert.ok(!/\d[\d,.]*\s*[kKmM]?\s*tokens?\b/.test(t), f + ' has a token number')
    assert.ok(!/\bnever\b/i.test(t.replace(/never gives/g, '')), f + ' has an unscoped "never"')
    assert.match(t, /(data|not give you instructions)/, f + ' says page text is data')
  }
  const r = read(join(assetsDir, 'brief-researcher.md'))
  for (const p of ['{{QUESTION}}', '{{ASSUMPTION}}', '{{OUT_FILE}}', '{{MAX_SEARCHES}}', '{{MAX_CLAIMS}}', '{{TODAY}}']) assert.ok(r.includes(p), p)
})

test('brief-check accepts every filled template (skipped until scripts/brief-check.mjs exists)', { skip: !existsSync(join(root, 'scripts', 'brief-check.mjs')) && 'scripts/brief-check.mjs not built yet' }, () => {
  const kinds = { 'brief-researcher.md': 'research', 'brief-counter.md': 'research', 'brief-verifier.md': 'agent', 'brief-reporter.md': 'agent' }
  for (const [f, kind] of Object.entries(kinds)) {
    const filled = read(join(assetsDir, f))
      .replace(/\{\{(OUT_FILE)\}\}/g, '/tmp/crew-chief-reports/research-101010/g1.json')
      .replace(/\{\{RUN_DIR\}\}/g, '/tmp/crew-chief-reports/research-101010')
      .replace(/\{\{[A-Z_]+\}\}/g, '3')
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'brief-check.mjs'), '-', '--kind', kind], { input: filled, encoding: 'utf8' })
    assert.equal(r.status, 0, f + ': ' + r.stdout + r.stderr)
  }
})

// ---- research-sweep, run against stubs --------------------------------------------------

const okResult = (g) => ({ file: '/r/' + g + '.json', claims_count: 3, gaps_count: 1, stop_reason: 'answered', summary: 'ok' })
const sweepArgs = (n) => ({ today: '2026-11-21', runDir: '/r', groups: Array.from({ length: n }, (_, i) => ({ id: 'g' + (i + 1), question: 'q' + i, brief: 'BRIEF g' + (i + 1) })) })

test('sweep: one researcher per group, brief passed through, explicit model, files returned', async () => {
  const { result, calls } = await runWorkflow(src['research-sweep'], sweepArgs(3), (p, o) => okResult(o.label))
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map((c) => c.prompt), ['BRIEF g1', 'BRIEF g2', 'BRIEF g3'])
  for (const c of calls) {
    assert.equal(c.opts.agentType, 'crew-chief:researcher')
    assert.equal(c.opts.model, 'sonnet')
    assert.ok(c.opts.schema && c.opts.schema.properties.file)
  }
  assert.deepEqual(result.files, ['/r/g1.json', '/r/g2.json', '/r/g3.json'])
  assert.deepEqual(result.dropped, [])
})

test('sweep: a dead agent and a call_limit stop are reported, not hidden', async () => {
  const { result, logs } = await runWorkflow(src['research-sweep'], sweepArgs(3), (p, o) => {
    if (o.label === 'g2') return null
    return o.label === 'g3' ? { ...okResult('g3'), stop_reason: 'call_limit' } : okResult(o.label)
  })
  assert.deepEqual(result.dropped, ['g2'])
  assert.deepEqual(result.limited, ['g3'])
  assert.deepEqual(result.files, ['/r/g1.json', '/r/g3.json'])
  assert.ok(logs.some((l) => l.includes('g2')) && logs.some((l) => l.includes('call_limit')))
})

test('sweep: more than 8 groups, no groups, a duplicate id or an empty brief throw before any agent starts', async () => {
  for (const a of [sweepArgs(9), { groups: [] }, undefined, { groups: [{ id: 'a', brief: 'x' }, { id: 'a', brief: 'y' }] }, { groups: [{ id: 'a', brief: ' ' }] }]) {
    let started = 0
    await assert.rejects(runWorkflow(src['research-sweep'], a, () => { started++; return null }), /research-sweep/)
    assert.equal(started, 0)
  }
  const { calls } = await runWorkflow(src['research-sweep'], sweepArgs(8), (p, o) => okResult(o.label))
  assert.equal(calls.length, 8)
})

// ---- research-verify, run against stubs -------------------------------------------------

// Claims and what the tool, the verifier and (on a disagreement) the re-check say about each.
//   [id, tool, verifier verdict, quote_supports, recheck verdict or null, counter names it?, expected status, expected reason]
const MATRIX = [
  ['a', 'found', 'confirmed', true, null, false, 'confirmed', 'quote_found_and_confirmed'],
  ['b', 'found', 'confirmed', true, null, true, 'contested', 'counter_evidence'],
  ['c', 'not_found', 'refuted', true, null, false, 'refuted', 'quote_not_on_page'],
  ['d', 'not_found', 'unverified', false, null, false, 'refuted', 'quote_not_on_page'],
  ['e', 'found', 'refuted', true, 'refuted', false, 'unverified', 'tool_verifier_disagree'],
  ['f', 'found', 'refuted', true, 'confirmed', false, 'confirmed', 'quote_found_and_confirmed'],
  ['g', 'not_found', 'confirmed', true, 'refuted', false, 'refuted', 'quote_not_on_page'],
  ['h', 'unverified', 'confirmed', true, null, false, 'unverified', 'tool_could_not_check'],
  ['i', 'dead_link', 'refuted', true, null, false, 'refuted', 'verifier_refuted'],
  ['j', 'found', 'unverified', false, null, false, 'unverified', 'verifier_could_not_check'],
  ['k', undefined, 'confirmed', true, null, false, 'unverified', 'tool_could_not_check'],
  ['l', 'found', 'confirmed', false, null, false, 'unverified', 'verifier_could_not_check'],
  ['m', 'not_found', 'confirmed', true, 'unverified', false, 'unverified', 'tool_verifier_disagree'],
  ['n', 'found', 'refuted', true, 'NULL', false, 'unverified', 'tool_verifier_disagree'],
  ['o', 'not_found', 'NOANSWER', true, null, false, 'refuted', 'quote_not_on_page'],
  ['p', 'found', 'NOANSWER', true, null, true, 'unverified', 'verifier_could_not_check'],
  ['q', 'not_found', 'refuted', true, null, true, 'refuted', 'quote_not_on_page'],
]

function verifyArgs() {
  const ids = MATRIX.map((r) => r[0])
  const batches = []
  for (let i = 0; i < ids.length; i += 8) batches.push({ id: 'b' + batches.length, file: '/r/g1.json', ids: ids.slice(i, i + 8) })
  batches[0].file = '/r/g1.json'
  return {
    today: '2026-11-21',
    runDir: '/r',
    groups: [{ id: 'g1', question: 'q1', assumption: 'A1', file: '/r/g1.json' }, { id: 'g2', question: 'q2', assumption: 'A2', file: '/r/g2.json' }, { id: 'g3', question: 'q3', assumption: 'A3', file: '/r/g3.json' }],
    batches,
    sourceCheck: Object.fromEntries(MATRIX.filter((r) => r[1]).map((r) => [r[0], r[1] === 'unverified' ? { status: 'unverified', reason: 'js_rendered_or_empty' } : r[1]])),
    briefs: { verify: 'VERIFY BRIEF', counter: 'COUNTER BRIEF', report: 'REPORT BRIEF' },
  }
}

function verifyHandler(opts = {}) {
  return (prompt, o) => {
    if (o.label.startsWith('report')) return { file: '/r/REPORT.md', summary: 'done' }
    if (o.label.startsWith('counter')) {
      return { counter: [{ against_id: 'b', claim: 'c', url: 'https://x', accessed: '2026-11-21', quote: 'q' }, { against_id: 'p', claim: 'c', url: 'https://x', accessed: '2026-11-21', quote: 'q' }, { against_id: 'q', claim: 'c', url: 'https://x', accessed: '2026-11-21', quote: 'q' }, { against_id: 'zzz', claim: 'unknown id', url: 'https://x', accessed: '2026-11-21', quote: 'q' }, { against_id: '', claim: 'general', url: 'https://x', accessed: '2026-11-21', quote: 'q' }], searched: ['s'] }
    }
    const ids = [...prompt.matchAll(/Claim ids to check \(only these\): ([^\n]+)/g)][0][1].split(', ')
    if (o.label.startsWith('recheck')) {
      const row = MATRIX.find((r) => r[0] === ids[0])
      if (row[4] === 'NULL') return null
      return { verdicts: [{ id: ids[0], verdict: row[4], quote_supports_claim: true, why: 'w' }] }
    }
    return {
      verdicts: ids.filter((id) => MATRIX.find((r) => r[0] === id)[2] !== 'NOANSWER').map((id) => {
        const r = MATRIX.find((x) => x[0] === id)
        return { id, verdict: r[2], quote_supports_claim: r[3], why: 'w' }
      }),
    }
  }
}

test('verify: the merge rule gives the expected status and reason for every combination', async () => {
  const { result } = await runWorkflow(src['research-verify'], verifyArgs(), verifyHandler())
  for (const row of MATRIX) {
    const got = result.results.find((r) => r.id === row[0])
    assert.equal(got.status, row[6], 'status of ' + row[0] + ' (' + row.slice(1, 6).join('/') + ')')
    assert.equal(got.reason, row[7], 'reason of ' + row[0])
  }
  const sum = Object.values(result.counts).reduce((a, b) => a + b, 0)
  assert.equal(sum, MATRIX.length)
  assert.equal(result.counts.contested, 1)
})

test('verify: only disagreements are re-checked, once each, on Opus at medium, with the verifier agent', async () => {
  const { result, calls } = await runWorkflow(src['research-verify'], verifyArgs(), verifyHandler())
  const rechecks = calls.filter((c) => c.opts.label.startsWith('recheck'))
  assert.deepEqual(result.rechecked.sort(), ['e', 'f', 'g', 'm', 'n'])
  assert.equal(rechecks.length, 5)
  for (const c of rechecks) {
    assert.equal(c.opts.model, 'opus')
    assert.equal(c.opts.effort, 'medium')
    assert.equal(c.opts.agentType, 'crew-chief:verifier')
  }
  assert.equal(new Set(rechecks.map((c) => c.opts.label)).size, 5)
})

test('verify: batches of claims go to sonnet at high effort, counters and report to the researcher on sonnet', async () => {
  const { calls } = await runWorkflow(src['research-verify'], verifyArgs(), verifyHandler())
  const verify = calls.filter((c) => c.opts.label.startsWith('verify '))
  assert.equal(verify.length, 3)
  for (const c of verify) {
    assert.equal(c.opts.model, 'sonnet')
    assert.equal(c.opts.effort, 'high')
    assert.equal(c.opts.agentType, 'crew-chief:verifier')
    assert.ok(c.prompt.startsWith('VERIFY BRIEF'))
    assert.ok(c.prompt.includes('Claims file: /r/g1.json'))
  }
  const counters = calls.filter((c) => c.opts.label.startsWith('counter'))
  assert.equal(counters.length, 2, 'three groups make two pairs')
  assert.ok(counters[0].prompt.includes('assumption to refute: A1') && counters[0].prompt.includes('assumption to refute: A2'))
  assert.ok(counters[1].prompt.includes('A3') && !counters[1].prompt.includes('A1'))
  for (const c of counters) assert.deepEqual([c.opts.agentType, c.opts.model], ['crew-chief:researcher', 'sonnet'])
  const rep = calls.filter((c) => c.opts.label === 'report')
  assert.equal(rep.length, 1)
  assert.deepEqual([rep[0].opts.agentType, rep[0].opts.model], ['crew-chief:researcher', 'sonnet'])
  assert.ok(rep[0].prompt.startsWith('REPORT BRIEF') && rep[0].prompt.includes('"status":"contested"'))
  for (const c of calls) assert.ok(['sonnet', 'opus'].includes(c.opts.model) && c.opts.agentType)
})

test('verify: the verifier prompt carries ids and the file, not claim text or the author\'s fields', async () => {
  const { calls } = await runWorkflow(src['research-verify'], verifyArgs(), verifyHandler())
  const c = calls.find((x) => x.opts.label === 'verify b0')
  assert.ok(c.prompt.includes('Claim ids to check (only these): a, b, c, d, e, f, g, h'))
  assert.ok(c.prompt.includes('ignore every other field'))
  assert.ok(!c.prompt.includes('A1'), 'assumptions are not shown to the verifier')
})

test('verify: counter-evidence naming no known claim is returned as unattached, not merged', async () => {
  const { result } = await runWorkflow(src['research-verify'], verifyArgs(), verifyHandler())
  assert.equal(result.unattached.length, 4, 'two pairs each return the unknown-id and the empty-id counter-claims')
  const q = result.results.find((r) => r.id === 'q')
  assert.equal(q.status, 'refuted')
})

test('verify: dropped agents are logged and never turn a claim into refuted', async () => {
  const handler = verifyHandler()
  const { result, logs } = await runWorkflow(src['research-verify'], verifyArgs(), (p, o) => (o.label === 'verify b1' || o.label.startsWith('counter') ? null : handler(p, o)))
  assert.ok(result.dropped.includes('b1'))
  assert.ok(logs.some((l) => l.includes('b1')) && logs.some((l) => l.includes('counter')))
  const p = result.results.find((r) => r.id === 'p')
  assert.equal(p.status, 'unverified')
  assert.equal(result.results.find((r) => r.id === 'b').status, 'confirmed', 'no counter search ran, so nothing contests it')
  assert.ok(result.results.every((r) => r.status))
})

test('verify: input limits throw before any agent starts', async () => {
  const base = verifyArgs
  const cases = [
    { ...base(), batches: [] },
    { ...base(), batches: [{ id: 'x', file: '/f', ids: Array.from({ length: 9 }, (_, i) => 'c' + i) }] },
    { ...base(), batches: Array.from({ length: 13 }, (_, i) => ({ id: 'x' + i, file: '/f', ids: ['id' + i] })) },
    { ...base(), batches: [{ id: 'x', file: '/f', ids: ['a'] }, { id: 'y', file: '/f', ids: ['a'] }] },
    { ...base(), groups: Array.from({ length: 9 }, (_, i) => ({ id: 'g' + i, question: 'q', file: '/f' })) },
    { ...base(), briefs: { verify: 'v', counter: '', report: 'r' } },
    { ...base(), runDir: undefined },
  ]
  for (const a of cases) {
    let started = 0
    await assert.rejects(runWorkflow(src['research-verify'], a, () => { started++; return null }), /research-verify/)
    assert.equal(started, 0)
  }
})
