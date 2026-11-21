export const meta = {
  name: 'research-verify',
  description: 'crew-chief: independent verification of research claims (verifier batches, counter-evidence search, one Opus re-check where the quote tool and the verifier disagree), a deterministic merge, and a written report',
  whenToUse: 'Started by /crew-chief:crew-research in tam mode after the sweep and the source-check step. Needs args { today, runDir, groups: [ { id, question, assumption, file } ], batches: [ { id, file, ids } ], sourceCheck: { <claim id>: status or { status, reason } }, briefs: { verify, counter, report } }.',
  phases: [
    { title: 'Verify', detail: 'independent verifier per batch of at most 8 claims, Sonnet at high effort' },
    { title: 'Counter', detail: 'one counter-evidence search per pair of groups, at most 4' },
    { title: 'Recheck', detail: 'one Opus (medium) look at each claim where the quote tool and the verifier disagree' },
    { title: 'Report', detail: 'one reporter writes REPORT.md' },
  ],
}

// Wiring plus one decision block (the merge rule below), which tests/workflows.test.mjs runs
// against a stubbed runtime. The briefs come from args (composed and brief-checked by the skill);
// the script only appends batch ids and file paths. The script has no filesystem: agents read
// and write the files. Every agent() call names its agentType and an explicit model.

const MAX_BATCH_IDS = 8
const MAX_BATCHES = 12
const MAX_GROUPS = 8
const TOOL_STATUSES = ['found', 'not_found', 'unverified', 'dead_link']

const VERDICT_ITEM = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'unverified'] },
    quote_supports_claim: { type: 'boolean' },
    why: { type: 'string', description: 'One or two sentences' },
  },
  required: ['id', 'verdict', 'quote_supports_claim', 'why'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: { verdicts: { type: 'array', items: VERDICT_ITEM } },
  required: ['verdicts'],
}
const COUNTER_SCHEMA = {
  type: 'object',
  properties: {
    counter: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          against_id: { type: 'string', description: 'Id of the claim this contradicts, or an empty string' },
          claim: { type: 'string' },
          url: { type: 'string' },
          accessed: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['against_id', 'claim', 'url', 'accessed', 'quote'],
      },
    },
    searched: { type: 'array', items: { type: 'string' }, description: 'What you searched for, including searches that found nothing' },
  },
  required: ['counter', 'searched'],
}
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    summary: { type: 'string', description: 'At most 10 lines' },
  },
  required: ['file', 'summary'],
}

// MERGE-RULE-BEGIN (documentation markers: the test runs the whole script, it does not extract this block)
// tool: what the quote tool saw: found | not_found | unverified | dead_link (anything else counts as unverified).
// verifier: what an agent decided: confirmed | refuted | unverified | null (null = no answer).
// Only not_found on a page that was read counts as a refutation signal from the tool. A page that
// could not be read (unverified, dead_link) is never proof that a claim is false.
function normTool(v) {
  const s = v && typeof v === 'object' ? v.status : v
  return TOOL_STATUSES.indexOf(s) >= 0 ? s : 'unverified'
}
function normVerifier(v) {
  if (!v) return null
  if (v.verdict === 'confirmed') return v.quote_supports_claim === true ? 'confirmed' : 'unverified'
  if (v.verdict === 'refuted') return 'refuted'
  return 'unverified'
}
function disagrees(tool, verifier) {
  return (tool === 'found' && verifier === 'refuted') || (tool === 'not_found' && verifier === 'confirmed')
}
function agrees(tool, verifier) {
  return (tool === 'found' && verifier === 'confirmed') || (tool === 'not_found' && verifier === 'refuted')
}
// Call after a disagreement was re-checked once (verifier = the re-check's verdict, null if it failed).
function mergeVerdict(tool, verifier, counterCount) {
  if (tool === 'not_found' || verifier === 'refuted') return { status: 'refuted', reason: tool === 'not_found' ? 'quote_not_on_page' : 'verifier_refuted' }
  if (tool === 'found' && verifier === 'confirmed') {
    return counterCount > 0 ? { status: 'contested', reason: 'counter_evidence' } : { status: 'confirmed', reason: 'quote_found_and_confirmed' }
  }
  return { status: 'unverified', reason: tool !== 'found' ? 'tool_could_not_check' : 'verifier_could_not_check' }
}
// MERGE-RULE-END

function fail(msg) { throw new Error('research-verify: ' + msg) }

const A = args || {}
const groups = Array.isArray(A.groups) ? A.groups : []
const batches = Array.isArray(A.batches) ? A.batches : []
const briefs = A.briefs || {}
const sourceCheck = A.sourceCheck || {}
const runDir = A.runDir
if (!runDir || typeof runDir !== 'string') fail('args.runDir is required')
if (batches.length === 0) fail('args.batches must be a non-empty array of { id, file, ids }')
if (batches.length > MAX_BATCHES) fail(batches.length + ' batches; the cap is ' + MAX_BATCHES + '. Cut scope or run it in two passes.')
if (groups.length > MAX_GROUPS) fail(groups.length + ' groups; the cap is ' + MAX_GROUPS)
for (const k of ['verify', 'counter', 'report']) {
  if (typeof briefs[k] !== 'string' || !briefs[k].trim()) fail('args.briefs.' + k + ' is required')
}
const fileOf = {}
const allIds = []
for (const b of batches) {
  if (!b || typeof b.id !== 'string' || typeof b.file !== 'string' || !Array.isArray(b.ids) || b.ids.length === 0) fail('every batch needs id, file and a non-empty ids array')
  if (b.ids.length > MAX_BATCH_IDS) fail('batch ' + b.id + ' has ' + b.ids.length + ' ids; the cap is ' + MAX_BATCH_IDS)
  for (const id of b.ids) {
    if (fileOf[id]) fail('claim id ' + id + ' appears twice')
    fileOf[id] = b.file
    allIds.push(id)
  }
}

function checkPrompt(base, batchId, file, ids, extra) {
  return base + '\n\nBatch id: ' + batchId + '\nClaims file: ' + file + '\nClaim ids to check (only these): ' + ids.join(', ') +
    '\nRead only the fields id, claim, url and quote of these claims from the file and ignore every other field in it (you check the source, not the author\'s reasoning).' +
    (extra ? '\n' + extra : '')
}

// Counter-evidence: one agent per pair of groups, at most MAX_GROUPS / 2 = 4.
const pairs = []
for (let i = 0; i < groups.length; i += 2) pairs.push(groups.slice(i, i + 2))

phase('Verify')
const [verified, countered] = await Promise.all([
  parallel(batches.map((b) => () =>
    agent(checkPrompt(briefs.verify, b.id, b.file, b.ids), {
      agentType: 'crew-chief:verifier',
      model: 'sonnet',
      effort: 'high',
      label: 'verify ' + b.id,
      phase: 'Verify',
      schema: VERIFY_SCHEMA,
    }))),
  parallel(pairs.map((pair, n) => () =>
    agent(
      briefs.counter + '\n\nPair id: counter-' + (n + 1) + '\nRun folder: ' + runDir + '\nGroups and the assumption to refute in each:\n' +
        pair.map((g) => '- group ' + g.id + ': ' + g.question + ' | assumption to refute: ' + (g.assumption || '(none given: refute the group\'s likely answer)') + ' | claims file: ' + (g.file || '(none)')).join('\n') +
        '\nThe claims file lists the claim ids: put the id of a claim your evidence contradicts in against_id; use an empty string if it contradicts only the assumption.',
      {
        agentType: 'crew-chief:researcher',
        model: 'sonnet',
        effort: 'medium',
        label: 'counter ' + (n + 1),
        phase: 'Counter',
        schema: COUNTER_SCHEMA,
      }))),
])

const verdictOf = {}
const droppedBatches = []
batches.forEach((b, i) => {
  const r = verified[i]
  if (!r || !Array.isArray(r.verdicts)) {
    droppedBatches.push(b.id)
    log('verify batch ' + b.id + ': no answer; its claims keep only the quote tool result')
    return
  }
  for (const v of r.verdicts) if (v && fileOf[v.id] === b.file && b.ids.indexOf(v.id) >= 0) verdictOf[v.id] = v
})

const counterOf = {}
const unattached = []
const droppedCounters = []
pairs.forEach((pair, n) => {
  const r = countered[n]
  if (!r || !Array.isArray(r.counter)) {
    droppedCounters.push('counter-' + (n + 1))
    log('counter-evidence search ' + (n + 1) + ' (groups ' + pair.map((g) => g.id).join(', ') + '): no answer; those groups were not challenged')
    return
  }
  for (const c of r.counter) {
    if (c && fileOf[c.against_id]) (counterOf[c.against_id] = counterOf[c.against_id] || []).push(c)
    else if (c) unattached.push(c)
  }
})

// A claim the tool and the verifier disagree on gets one look from Opus at medium effort.
const first = {}
const toRecheck = []
for (const id of allIds) {
  first[id] = normVerifier(verdictOf[id])
  if (disagrees(normTool(sourceCheck[id]), first[id])) toRecheck.push(id)
}
const second = {}
if (toRecheck.length > 0) {
  phase('Recheck')
  const rechecked = await parallel(toRecheck.map((id) => () =>
    agent(
      checkPrompt(briefs.verify, 'recheck-' + id, fileOf[id], [id], 'This is a second look at one claim: open the page yourself and decide again, independently.'),
      {
        agentType: 'crew-chief:verifier',
        model: 'opus',
        effort: 'medium',
        label: 'recheck ' + id,
        phase: 'Recheck',
        schema: VERIFY_SCHEMA,
      })))
  toRecheck.forEach((id, i) => {
    const r = rechecked[i]
    const v = r && Array.isArray(r.verdicts) ? r.verdicts.find((x) => x && x.id === id) : null
    second[id] = normVerifier(v)
  })
}

const results = allIds.map((id) => {
  const tool = normTool(sourceCheck[id])
  const checked = toRecheck.indexOf(id) >= 0
  const verifier = checked ? second[id] : first[id]
  const counter = counterOf[id] || []
  let m
  if (checked && !agrees(tool, verifier)) m = { status: 'unverified', reason: 'tool_verifier_disagree' }
  else m = mergeVerdict(tool, verifier, counter.length)
  return { id, status: m.status, reason: m.reason, tool, verifier: first[id], recheck: checked ? (second[id] || 'failed') : null, counter }
})
const counts = { confirmed: 0, refuted: 0, contested: 0, unverified: 0 }
for (const r of results) counts[r.status]++

phase('Report')
const report = await agent(
  briefs.report + '\n\nToday: ' + (A.today || '') + '\nRun folder: ' + runDir + '\nClaims files: ' + groups.map((g) => g.file).filter(Boolean).join(', ') +
    '\nAssumptions that were put to the test:\n' + groups.map((g) => '- group ' + g.id + ': ' + g.question + ' | ' + (g.assumption || '(none)')).join('\n') +
    '\nResult table (JSON, authoritative: copy each status as it is; counter lists the counter-evidence naming that claim; the quote tool and the verdicts are already merged):\n' + JSON.stringify(results) +
    '\nCounter-evidence that names no claim (JSON):\n' + JSON.stringify(unattached) +
    '\nNo answer from: ' + (droppedBatches.concat(droppedCounters).join(', ') || 'nothing missing'),
  {
    agentType: 'crew-chief:researcher',
    model: 'sonnet',
    effort: 'medium',
    label: 'report',
    phase: 'Report',
    schema: REPORT_SCHEMA,
  },
)
if (!report) log('the reporter returned nothing; the merged results are in the return value only')

return { counts, results, unattached, report: report || null, dropped: droppedBatches.concat(droppedCounters), rechecked: toRecheck }
