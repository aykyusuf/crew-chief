export const meta = {
  name: 'research-sweep',
  description: 'crew-chief: one researcher per question group (Sonnet), each writes its claims file into the run folder; returns the file paths and short summaries',
  whenToUse: 'Started by /crew-chief:crew-research in tam mode. Needs args { today, runDir, groups: [ { id, question, brief } ] } with at most 8 groups; the briefs are composed and checked by the skill.',
  phases: [{ title: 'Research', detail: 'one researcher per group, Sonnet at medium effort' }],
}

// Wiring only. The prompts (briefs) come from args, composed and brief-checked by the skill; the
// researchers write their claims into args.runDir and return a path plus a short summary, so
// the main session never receives the claims themselves. No dedup agent: the skill's
// source-check step handles duplicates. Every agent() call names its agentType and an explicit
// model (an agent() with no model would run on the session model).

const MAX_GROUPS = 8

const SWEEP_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string', description: 'Path of the claims JSON file you wrote' },
    claims_count: { type: 'integer' },
    gaps_count: { type: 'integer' },
    stop_reason: { type: 'string', enum: ['answered', 'call_limit', 'no_sources'] },
    summary: { type: 'string', description: 'At most 5 lines: what you found and what is still open' },
  },
  required: ['file', 'claims_count', 'gaps_count', 'stop_reason', 'summary'],
}

const groups = args && Array.isArray(args.groups) ? args.groups : null
if (!groups || groups.length === 0) {
  throw new Error('research-sweep: args.groups must be a non-empty array of { id, question, brief }')
}
if (groups.length > MAX_GROUPS) {
  throw new Error('research-sweep: ' + groups.length + ' groups; the cap is ' + MAX_GROUPS + '. Cut scope or run it in two passes.')
}
const seen = new Set()
for (const g of groups) {
  if (!g || typeof g.id !== 'string' || !g.id.trim() || typeof g.brief !== 'string' || !g.brief.trim()) {
    throw new Error('research-sweep: every group needs a string id and a non-empty brief')
  }
  if (seen.has(g.id)) throw new Error('research-sweep: duplicate group id ' + g.id)
  seen.add(g.id)
}

phase('Research')
const results = await pipeline(groups, (g) =>
  agent(g.brief, {
    agentType: 'crew-chief:researcher',
    model: 'sonnet',
    effort: 'medium',
    label: g.id,
    phase: 'Research',
    schema: SWEEP_SCHEMA,
  }),
)

const files = []
const summaries = []
const dropped = []
const limited = []
groups.forEach((g, i) => {
  const r = results[i]
  if (!r || typeof r.file !== 'string') {
    dropped.push(g.id)
    log('group ' + g.id + ': no result (the agent was skipped or failed); its claims are missing from this run')
    return
  }
  files.push(r.file)
  summaries.push({ group: g.id, file: r.file, claims_count: r.claims_count, gaps_count: r.gaps_count, stop_reason: r.stop_reason, summary: r.summary })
  if (r.stop_reason !== 'answered') {
    limited.push(g.id)
    log('group ' + g.id + ': stopped with ' + r.stop_reason + ' (' + r.claims_count + ' claims, ' + r.gaps_count + ' gaps)')
  }
})

return { today: args.today || null, runDir: args.runDir || null, files, summaries, dropped, limited }
