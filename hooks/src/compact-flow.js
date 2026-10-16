// crew-chief compact flow: gets a long conversation compacted at a good moment, with nothing important
// lost, and only after the person says yes. Part of the mod in hooks/register.js (Claude Code 2.1.287+).
//
// How it works (every step below was checked live on Claude Code 2.1.300, see CHANGELOG 0.6.0):
//   1. Past the "arm" size (250k tokens on a 1M window, 60 % of a small one) the next prompt carries a
//      one-time note telling Claude to call the tool crew_compact_checkpoint at the next natural phase
//      boundary (never mid-task). Claude decides when a phase is over.
//   2. The tool asks the person. If Claude never calls it, the person is asked between turns once the
//      "ask" size is passed (400k, 85 % of a small window). Nothing is compacted without a yes.
//   3. On yes, Claude updates STATUS.md / tasks.json / PROGRESS.md (the handoff files, when the project
//      has them). Compaction waits until STATUS.md has changed (the gate) or the person overrides.
//   4. The compaction runs between turns with a detailed brief for the summarizer (compact-logic.mjs).
//      The same brief is added to a /compact the person types and to an automatic compaction.
//   5. After any compaction: the raw summary is saved, the summary is checked for the person's pinned
//      constraints and the open tasks, a toast says what was missing, and the transcript is checked for
//      lost lines. scripts/compact-restore.sh (SessionStart, compact) puts the pinned lines back.
// Environment: CREW_CHIEF_COMPACT=off turns the whole flow off; CREW_CHIEF_COMPACT_FOCUS=off only stops
// the brief being added to compactions; CREW_CHIEF_COMPACT_ARM / CREW_CHIEF_COMPACT_ASK set the sizes
// ("250k", "400k"). Nothing leaves the machine.
import { open } from './coord.mjs'
import { findHandoff } from './handoff.mjs'
import { statsNoteBoundary } from './stats-flow.mjs'
import { resolveLang } from './lang.mjs'
import { t } from './saver-i18n.mjs'
import { tokensLabel } from './saver-logic.mjs'
import {
  backgroundNote,
  backupName,
  backupsToPrune,
  checkSummary,
  compactThresholds,
  openTasks,
  parseStatus,
  parseTokens,
  pluginDataDir,
  projectDirName,
  withFocus,
} from './compact-logic.mjs'

export const TOOL_NAME = 'crew_compact_checkpoint'
const TOOL_MATCH = /^mcp__.+__crew_compact_checkpoint$/
const REARM_GROWTH_TOKENS = 100_000
const COMPACT_DELAY_MS = 1200
const RETRY_MS = 3000
const MAX_RETRIES = 3
const SUMMARIES_KEPT = 5
const TRANSCRIPTS_KEPT = 3
const MAX_UPDATE_RETRIES = 2
const AGENT_WAIT_MS = 5000
const MAX_AGENT_WAITS = 36
// `waiting` is a subagent held on background work it owns (a server it started), on a plan's approval or
// on another agent: none of these is work that a compaction would cut in half, and a subagent that left a
// dev server running stays `waiting` for as long as the server lives, so it must never hold a compaction back.
const RUNNING_STATES = ['pending', 'running']

const TOOL_DESCRIPTION =
  'Propose compacting the conversation. Call it once, and only when a note from crew-chief says the context is large AND you have just finished a phase (a task done, tests passing, before an unrelated area). Never call it in the middle of work. It asks the user; if they decline, do not call it again.'

const UPDATE_TEXT =
  'Update the handoff files of this project now, for those that exist: STATUS.md (Now, Next, Constraints = every rule the user gave, copied verbatim; keep the lines already there and only add new ones, Decisions, Failed attempts), tasks.json (only status and evidence change), PROGRESS.md (one dated line). If STATUS.md has no Constraints section, do not invent one; say so in your reply. Do not start any new work. Finish with one short line; the conversation is compacted right after your turn ends.'

// A project with no handoff files has nowhere to pin the user's rules, so the person is offered them first
// (the crew-handoff skill shows a preview and creates only what is missing; it needs a yes of its own).
const SETUP_TEXT =
  'This project has no handoff files (STATUS.md, tasks.json, PROGRESS.md), so nothing would put the user\'s rules back after the compaction. Before it runs, ask the user once (AskUserQuestion) whether to set them up now: run the crew-chief:crew-handoff skill, which shows a preview and creates only what is missing. If they agree, run it, then copy every rule the user gave in this conversation, verbatim, under Constraints in STATUS.md. If they decline, do nothing more about it. Do not start any new work. Finish with one short line; the conversation is compacted right after your turn ends.'

async function updateText($) {
  return (await findHandoff($)) ? UPDATE_TEXT : SETUP_TEXT
}

const RESULTS = {
  declined: 'The user declined for now. Carry on with the work and do not call this tool again until you are told the context has grown.',
  never: 'The user does not want compaction proposals for the rest of this session. Carry on and do not call this tool again.',
  unavailable: 'The user cannot be asked right now. Carry on with the work.',
  notNeeded: 'Not needed yet. Keep working; crew-chief will say when to propose a compaction.',
  subagents: 'Subagents are still running. Call this tool again after they have finished and their results are in.',
  busy: 'A compaction is already being arranged. Nothing more to do about it.',
}

function freshCompact(toolReady = false) {
  return {
    armed: false,
    nudged: false,
    never: false,
    asking: false,
    askedFallback: false,
    rearmAt: 0,
    plan: null,
    compacting: false,
    toolReady,
    bgTasks: [],
  }
}

let ck = freshCompact()

// session.start does not fire after /clear, so the tool registered at the start is still there: keep
// toolReady across a reset, and let compactSessionStart (a real start) decide it afresh.
export function resetCompact() {
  ck = freshCompact(ck.toolReady)
  open.compact = false
}

// Each compaction starts a freshCompact cycle: arm again at the arm size, note again, ask again, and no plan
// left over from before it.
function cycleDone() {
  ck.armed = false
  ck.nudged = false
  ck.askedFallback = false
  ck.rearmAt = 0
  ck.plan = null
  statsNoteBoundary()
}

// A mod must spell environment variable names as literals in $.env.get, so each switch is written out.
async function disabled($) {
  return (await safe(() => $.env.get('CREW_CHIEF_COMPACT'), undefined)) === 'off'
}

async function focusOff($) {
  return (await disabled($)) || (await safe(() => $.env.get('CREW_CHIEF_COMPACT_FOCUS'), undefined)) === 'off'
}

// ---- the project's handoff files ------------------------------------------------------------

async function mtimeOf($, path) {
  if (!path) return undefined
  const stat = await safe(() => $.fs.stat(path), undefined)
  return stat ? stat.mtimeMs : undefined
}

// The gate: the main handoff file has been written since the person approved. A project without
// handoff files has nothing to wait for.
async function gateSatisfied($, plan) {
  const h = await findHandoff($)
  if (!h) return true
  const main = h.status ?? h.tasks
  const changed = await mtimeOf($, main)
  return changed !== undefined && changed > plan.approvedAt
}

// ---- thresholds and the one-time note -------------------------------------------------------

async function limits($, usage) {
  const arm = parseTokens(await safe(() => $.env.get('CREW_CHIEF_COMPACT_ARM'), undefined))
  const ask = parseTokens(await safe(() => $.env.get('CREW_CHIEF_COMPACT_ASK'), undefined))
  return compactThresholds(usage?.context?.window, { arm, ask })
}

// Called after every measurement and finished turn. Arms the flow at the arm size; after a "not now"
// it arms again only once the context has grown by another 100k.
export async function compactUpdate($, usage) {
  if (await disabled($)) return
  const tokens = usage?.context?.tokens
  if (typeof tokens !== 'number' || ck.never || ck.plan || ck.compacting) return
  const lim = await limits($, usage)
  if (!ck.armed && tokens >= Math.max(lim.arm, ck.rearmAt)) {
    ck.armed = true
    ck.nudged = false
    ck.askedFallback = false
  }
}

// The text added (once per arming) to the next prompt, or undefined.
export async function compactNudge($) {
  if (!ck.armed || ck.nudged || ck.never || ck.plan || ck.compacting || !ck.toolReady) return undefined
  if (await disabled($)) return undefined
  ck.nudged = true
  const usage = await safe(() => $.session.usage(), undefined)
  const tokens = usage?.context?.tokens
  const name = `mcp__${$.plugin.name}__${TOOL_NAME}`
  return `[crew-chief] The context is about ${tokensLabel(tokens)} tokens; quality and cost both get worse from here. At the next natural phase boundary (a task finished, tests passing, before starting an unrelated area; never in the middle of work) call the tool ${name} once with a one-line phase summary. It asks the user whether to compact. If they decline, carry on and do not call it again.`
}

// ---- asking and planning --------------------------------------------------------------------

// ---- what is running right now ---------------------------------------------------------------
// Subagents always end and bring a result back, so a compaction waits for them. A dev server or watcher
// left open in the background never ends and compaction does not touch it, so those only get shown (and
// named to the summarizer), never waited for. The processes come from the Stop event's background_tasks.

async function agentCounts($) {
  const list = await safe(() => $.agent.list(), [])
  return {
    running: list.filter((a) => RUNNING_STATES.includes(a.status)).length,
    waiting: list.filter((a) => a.status === 'waiting').length,
  }
}

async function runningAgents($) {
  return (await agentCounts($)).running
}

async function dirtyFiles($) {
  const r = await safe(() => $.process.run(['git', 'status', '--porcelain']), undefined)
  if (!r || r.exitCode !== 0) return undefined
  return r.stdout.split('\n').filter((line) => line.trim() !== '').length
}

function processNames() {
  return ck.bgTasks.map((task) => task.command || task.description || task.id).filter(Boolean)
}

// With the task id: after a compaction Claude no longer remembers the handles of background tasks it started
// (anthropics/claude-code#29193), so the summary should keep them.
function processHandles() {
  return ck.bgTasks.map((task) => (task.id ? task.id + ': ' : '') + (task.command || task.description || '')).filter(Boolean)
}

async function stateLine($, lang, agents, waiting) {
  const parts = [t(lang, 'ck_state_agents', { n: agents })]
  if (waiting > 0) parts.push(t(lang, 'ck_state_waiting', { n: waiting }))
  const names = processNames()
  if (names.length > 0) parts.push(t(lang, 'ck_state_shells', { n: names.length, list: names.slice(0, 3).map((n) => n.slice(0, 40)).join(', ') }))
  const dirty = await dirtyFiles($)
  if (dirty !== undefined) parts.push(t(lang, 'ck_state_dirty', { n: dirty }))
  return t(lang, 'ck_state', { parts: parts.join(', ') })
}

async function askAndPlan($, why) {
  if (ck.asking || open.saver || open.reset) return 'busy'
  const { running: agents, waiting } = await agentCounts($)
  if (agents > 0) return 'subagents'
  ck.asking = true
  open.compact = true
  try {
    const lang = await resolveLang($)
    const usage = await safe(() => $.session.usage(), undefined)
    const tokens = usage?.context?.tokens
    const answers = [t(lang, 'ck_yes'), t(lang, 'ck_later'), t(lang, 'ck_never')]
    const phase = why.phase ? t(lang, 'ck_phase', { phase: why.phase }) : ''
    const state = await stateLine($, lang, agents, waiting)
    let answer
    try {
      answer = await $.ui.ask(t(lang, 'ck_ask', { tokens: tokensLabel(tokens), phase, state }), answers)
    } catch (err) {
      return 'unavailable'
    }
    if (answer === answers[0]) {
      ck.plan = { approvedAt: await $.clock.now(), retries: 0 }
      return 'approved'
    }
    if (answer === answers[2]) {
      ck.never = true
      return 'never'
    }
    ck.armed = false
    ck.rearmAt = (typeof tokens === 'number' ? tokens : 0) + REARM_GROWTH_TOKENS
    return 'declined'
  } finally {
    ck.asking = false
    open.compact = false
  }
}

// Asks Claude, in a new turn, to update the handoff files (the path with no tool call to answer).
async function requestStateUpdate($) {
  const text = 'crew-chief: the user approved compacting this conversation. ' + (await updateText($))
  $.prompt.submit({ text }).catch(() => {})
}

async function askFallback($) {
  const outcome = await askAndPlan($, {})
  if (outcome === 'approved') requestStateUpdate($)
  else if (outcome === 'busy' || outcome === 'subagents') ck.askedFallback = false
}

async function advancePlan($) {
  const plan = ck.plan
  if (!plan || ck.asking || open.saver || open.reset) return
  if (await gateSatisfied($, plan)) {
    scheduleCompaction($)
    return
  }
  const lang = await resolveLang($)
  const answers = [t(lang, 'ck_gate_anyway'), t(lang, 'ck_gate_retry'), t(lang, 'ck_gate_cancel')]
  ck.asking = true
  open.compact = true
  let answer
  try {
    answer = await $.ui.ask(t(lang, 'ck_gate_ask'), answers)
  } catch (err) {
    answer = answers[2]
  } finally {
    ck.asking = false
    open.compact = false
  }
  if (answer === answers[0]) {
    scheduleCompaction($)
  } else if (answer === answers[1] && plan.retries < MAX_UPDATE_RETRIES) {
    plan.retries += 1
    requestStateUpdate($)
  } else {
    const usage = await safe(() => $.session.usage(), undefined)
    const tokens = usage?.context?.tokens
    ck.plan = null
    ck.armed = false
    ck.rearmAt = (typeof tokens === 'number' ? tokens : 0) + REARM_GROWTH_TOKENS
  }
}

// Called after each finished main turn.
// `reason` is how the turn ended. Only a turn that ended with an answer counts as a phase boundary: after an
// interrupt (Esc) the update may be half done, and after an error or a refusal nothing was finished.
export async function compactTurnComplete($, usage, reason) {
  if (await disabled($)) return
  await compactUpdate($, usage)
  const clean = reason === undefined || reason === 'answer'
  if (ck.plan) {
    if (clean) await advancePlan($)
    return
  }
  if (!clean) return
  const tokens = usage?.context?.tokens
  if (!ck.armed || ck.never || ck.compacting || ck.asking || ck.askedFallback || typeof tokens !== 'number') return
  const lim = await limits($, usage)
  if (tokens >= lim.ask) {
    ck.askedFallback = true
    askFallback($) // not awaited: the hook must not wait for the person
  }
}

// ---- running the compaction -----------------------------------------------------------------

function scheduleCompaction($) {
  ck.plan = null
  ck.compacting = true
  $.clock.after(COMPACT_DELAY_MS, () => runCompaction($, 0))
}

async function runCompaction($, attempt, waited = 0) {
  let retry = false
  // Subagents started since the approval would lose their place in a summary: wait until they are done.
  if ((await runningAgents($)) > 0) {
    if (waited < MAX_AGENT_WAITS) {
      $.clock.after(AGENT_WAIT_MS, () => runCompaction($, attempt, waited + 1))
    } else {
      ck.compacting = false
      await failed($, t(await resolveLang($), 'ck_agents_still'))
    }
    return
  }
  try {
    const before = await transcriptLines($)
    await copyTranscriptIfNeeded($)
    const args = (await focusOff($)) ? {} : { instructions: withFocus('', backgroundNote(processHandles())) }
    const result = await $.session.compact(args)
    if (result && result.skip) {
      await failed($, String(result.skip))
    } else if (result && result.messages) {
      cycleDone()
      await afterCompaction($, result, before)
    }
  } catch (err) {
    const message = String(err && err.message ? err.message : err)
    // Mostly "a turn is running" (compaction waits for a gap between turns); a headless run can never do it.
    if (attempt < MAX_RETRIES && !/headless|not available/i.test(message)) {
      retry = true
      $.clock.after(RETRY_MS, () => runCompaction($, attempt + 1))
    } else {
      await failed($, message)
    }
  } finally {
    if (!retry) ck.compacting = false
  }
}

async function failed($, reason) {
  const lang = await resolveLang($)
  $.ui.toast(t(lang, 'toast_compact_failed', { reason: reason.slice(0, 160) }), { timeoutMs: 12000 })
}

// ---- after a compaction ---------------------------------------------------------------------

async function dataDir($) {
  const fromEnv = await safe(() => $.env.get('CLAUDE_PLUGIN_DATA'), undefined)
  if (fromEnv) return fromEnv
  const home = await safe(() => $.env.get('HOME'), undefined)
  const derived = pluginDataDir($.plugin.root, home)
  if (derived) return derived
  const tmp = (await safe(() => $.env.get('TMPDIR'), undefined)) || '/tmp'
  return `${tmp.replace(/\/+$/, '')}/crew-chief-compact`
}

async function prune($, dir, prefix, keep) {
  const entries = await safe(() => $.fs.list(dir), [])
  for (const name of backupsToPrune(entries.map((e) => e.name), prefix, keep)) {
    await safe(() => $.process.run(['rm', '-f', `${dir}/${name}`]), undefined)
  }
}

async function backupSummary($, summary) {
  const dir = `${await dataDir($)}/compact-summaries`
  const path = `${dir}/${backupName('compact', await $.clock.now())}`
  await $.fs.write(path, summary + '\n')
  await safe(() => $.process.run(['chmod', '600', path]), undefined)
  await prune($, dir, 'compact', SUMMARIES_KEPT)
  return path
}

async function transcriptPath($) {
  const home = await safe(() => $.env.get('HOME'), undefined)
  const cwd = await safe(() => $.session.cwd(), undefined)
  const id = await safe(() => $.session.id(), undefined)
  if (!home || !cwd || !id) return undefined
  const path = `${home}/.claude/projects/${projectDirName(cwd)}/${id}.jsonl`
  return (await safe(() => $.fs.exists(path), false)) ? path : undefined
}

async function transcriptLines($) {
  const path = await transcriptPath($)
  if (!path) return undefined
  const r = await safe(() => $.process.run(['wc', '-l', path]), undefined)
  const n = r && r.exitCode === 0 ? Number(r.stdout.trim().split(/\s+/)[0]) : NaN
  return Number.isFinite(n) ? n : undefined
}

// Claude Code appends to the transcript across a compaction, so the lines from before it stay
// searchable (checked live on 2.1.300). If that ever stops being true the first compaction shows it,
// and every later one copies the file first.
async function copyTranscriptIfNeeded($) {
  const kept = await safe(() => $.store.get('transcript_kept'), undefined)
  if (kept !== 'false') return
  const path = await transcriptPath($)
  if (!path) return
  const dir = `${await dataDir($)}/transcripts`
  const copy = `${dir}/${backupName('session', await $.clock.now(), 'jsonl')}`
  await safe(async () => {
    await $.process.run(['mkdir', '-p', dir])
    await $.process.run(['cp', '-p', path, copy])
    await $.process.run(['chmod', '600', copy])
    await prune($, dir, 'session', TRANSCRIPTS_KEPT)
  }, undefined)
}

async function verifyTranscript($, before) {
  if (before === undefined) return
  const after = await transcriptLines($)
  if (after === undefined) return
  const lost = after < before
  await safe(() => $.store.set('transcript_kept', lost ? 'false' : 'true'), undefined)
  if (lost) {
    const lang = await resolveLang($)
    $.ui.toast(t(lang, 'toast_transcript_lost'), { timeoutMs: 12000 })
  }
}

// What the person's files say should survive, checked against the summary Claude Code wrote.
async function pinnedItems($) {
  const h = await findHandoff($)
  if (!h) return { constraints: [], tasks: [] }
  const status = h.status ? await safe(() => $.fs.read(h.status), '') : ''
  const tasks = h.tasks ? await safe(() => $.fs.read(h.tasks), '') : ''
  return { constraints: parseStatus(typeof status === 'string' ? status : '').constraints, tasks: openTasks(typeof tasks === 'string' ? tasks : '') }
}

async function afterCompaction($, result, linesBefore) {
  try {
    const lang = await resolveLang($)
    const summary = result.messages.map((m) => m.text).join('\n')
    const path = await safe(() => backupSummary($, summary), undefined)
    const found = checkSummary(summary, await pinnedItems($))
    const missing = found.missingConstraints.length + found.missingTasks.length
    if (missing > 0) $.ui.toast(t(lang, 'toast_compact_missing', { n: missing }), { timeoutMs: 15000 })
    else $.ui.toast(path ? t(lang, 'toast_compact_done', { path }) : t(lang, 'toast_compact_done_plain'), { timeoutMs: 10000 })
    await verifyTranscript($, linesBefore)
  } catch (err) {
    // The compaction itself succeeded; the extras are best effort.
  }
}

// ---- registration ---------------------------------------------------------------------------

// Called from the mod's session.start hook (a module may register each event only once).
export async function compactSessionStart($) {
  resetCompact()
  ck.toolReady = false
  if (await disabled($)) return
  try {
    await $.tool.register({
      name: TOOL_NAME,
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          phase: { type: 'string', description: 'One line: the phase that was just finished.' },
          next: { type: 'string', description: 'One line: what comes next.' },
        },
      },
      isDeferred: false,
    })
    ck.toolReady = true
  } catch (err) {
    // An older Claude Code, or the name is taken: the fallback question still works.
  }
  try {
    await $.command.register({
      name: 'crew-compact',
      description: t(await resolveLang($), 'cmd_compact_description'),
      argumentHint: '',
    })
  } catch (err) {
    // The name is taken: the tool and the fallback question still work.
  }
}

const clip = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 200) : '')

export function registerCompact(on) {
  // The Stop event carries the session's background tasks; the processes among them are remembered for the
  // question and for the summarizer. (Settings-hook events do not reach a mod where an organization manages
  // Claude Code; the list then stays empty and only subagents are waited for.)
  on('classic.Stop', async ($, e, next) => {
    const tasks = Array.isArray(e.background_tasks) ? e.background_tasks : []
    ck.bgTasks = tasks.filter((task) => task && typeof task.command === 'string' && task.command !== '' && !task.agent_type)
    return next(e)
  })

  on('tool.call', { tool: TOOL_MATCH }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'Only the main conversation can propose a compaction.' }
    if (!ck.armed || ck.never) return { result: RESULTS.notNeeded }
    if (ck.plan || ck.compacting) return { result: RESULTS.busy }
    const outcome = await askAndPlan($, { phase: clip(e.phase) })
    if (outcome === 'approved') return { result: 'The user approved compaction. ' + (await updateText($)) }
    return { result: RESULTS[outcome] ?? RESULTS.busy }
  })

  // Every compaction a person, the engine or another plugin starts passes here. (One this plugin starts
  // does not: the call "runs through every hook but the calling one", so runCompaction passes the brief
  // itself.)
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || (await focusOff($))) return next(e)
    const before = e.trigger === 'precompute' ? undefined : await transcriptLines($)
    if (e.trigger !== 'precompute') await copyTranscriptIfNeeded($)
    // The engine always sends the transcript with the event; a call without it is passed on without one.
    const input = e.messages === undefined ? (({ messages, ...rest }) => rest)(e) : e
    const result = await next({ ...input, instructions: withFocus(e.instructions, backgroundNote(processHandles())) })
    if (e.trigger !== 'precompute' && result && result.messages) {
      cycleDone()
      await afterCompaction($, result, before)
    }
    return result
  })

  on('command.run', { command: 'crew-compact' }, async ($) => {
    const lang = await resolveLang($)
    if (await disabled($)) return { text: t(lang, 'cmd_compact_off') }
    if (ck.plan || ck.compacting || ck.asking) return { text: t(lang, 'cmd_compact_busy') }
    ck.never = false
    // A command must not hold the turn while the person answers; ask when the loop is free.
    $.clock.after(300, async () => {
      const outcome = await askAndPlan($, {})
      if (outcome === 'approved') requestStateUpdate($)
      else if (outcome === 'subagents') $.ui.toast(t(await resolveLang($), 'ck_wait_agents'), { timeoutMs: 10000 })
    })
    return { text: t(lang, 'cmd_compact_ok') }
  })
}
