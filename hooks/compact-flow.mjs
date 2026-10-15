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

const TOOL_DESCRIPTION =
  'Propose compacting the conversation. Call it once, and only when a note from crew-chief says the context is large AND you have just finished a phase (a task done, tests passing, before an unrelated area). Never call it in the middle of work. It asks the user; if they decline, do not call it again.'

const UPDATE_TEXT =
  'Update the handoff files of this project now, for those that exist: STATUS.md (Now, Next, Constraints = every rule the user gave, copied verbatim, Decisions, Failed attempts), tasks.json (only status and evidence change), PROGRESS.md (one dated line). If STATUS.md has no Constraints section, do not invent one; say so in your reply. Do not start any new work. Finish with one short line; the conversation is compacted right after your turn ends.'

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
  busy: 'A compaction is already being arranged. Nothing more to do about it.',
}

function fresh(toolReady = false) {
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
  }
}

let st = fresh()

// session.start does not fire after /clear, so the tool registered at the start is still there: keep
// toolReady across a reset, and let compactSessionStart (a real start) decide it afresh.
export function resetCompact() {
  st = fresh(st.toolReady)
  open.compact = false
}

// Each compaction starts a fresh cycle: arm again at the arm size, note again, ask again, and no plan
// left over from before it.
function cycleDone() {
  st.armed = false
  st.nudged = false
  st.askedFallback = false
  st.rearmAt = 0
  st.plan = null
  statsNoteBoundary()
}

async function safe(fn, fallback) {
  try {
    return await fn()
  } catch (err) {
    return fallback
  }
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
  if (typeof tokens !== 'number' || st.never || st.plan || st.compacting) return
  const lim = await limits($, usage)
  if (!st.armed && tokens >= Math.max(lim.arm, st.rearmAt)) {
    st.armed = true
    st.nudged = false
    st.askedFallback = false
  }
}

// The text added (once per arming) to the next prompt, or undefined.
export async function compactNudge($) {
  if (!st.armed || st.nudged || st.never || st.plan || st.compacting || !st.toolReady) return undefined
  if (await disabled($)) return undefined
  st.nudged = true
  const usage = await safe(() => $.session.usage(), undefined)
  const tokens = usage?.context?.tokens
  const name = `mcp__${$.plugin.name}__${TOOL_NAME}`
  return `[crew-chief] The context is about ${tokensLabel(tokens)} tokens; quality and cost both get worse from here. At the next natural phase boundary (a task finished, tests passing, before starting an unrelated area; never in the middle of work) call the tool ${name} once with a one-line phase summary. It asks the user whether to compact. If they decline, carry on and do not call it again.`
}

// ---- asking and planning --------------------------------------------------------------------

async function askAndPlan($, why) {
  if (st.asking || open.saver || open.reset) return 'busy'
  st.asking = true
  open.compact = true
  try {
    const lang = await resolveLang($)
    const usage = await safe(() => $.session.usage(), undefined)
    const tokens = usage?.context?.tokens
    const answers = [t(lang, 'ck_yes'), t(lang, 'ck_later'), t(lang, 'ck_never')]
    const phase = why.phase ? t(lang, 'ck_phase', { phase: why.phase }) : ''
    let answer
    try {
      answer = await $.ui.ask(t(lang, 'ck_ask', { tokens: tokensLabel(tokens), phase }), answers)
    } catch (err) {
      return 'unavailable'
    }
    if (answer === answers[0]) {
      st.plan = { approvedAt: await $.clock.now(), retries: 0 }
      return 'approved'
    }
    if (answer === answers[2]) {
      st.never = true
      return 'never'
    }
    st.armed = false
    st.rearmAt = (typeof tokens === 'number' ? tokens : 0) + REARM_GROWTH_TOKENS
    return 'declined'
  } finally {
    st.asking = false
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
  else if (outcome === 'busy') st.askedFallback = false
}

async function advancePlan($) {
  const plan = st.plan
  if (!plan || st.asking || open.saver || open.reset) return
  if (await gateSatisfied($, plan)) {
    scheduleCompaction($)
    return
  }
  const lang = await resolveLang($)
  const answers = [t(lang, 'ck_gate_anyway'), t(lang, 'ck_gate_retry'), t(lang, 'ck_gate_cancel')]
  st.asking = true
  open.compact = true
  let answer
  try {
    answer = await $.ui.ask(t(lang, 'ck_gate_ask'), answers)
  } catch (err) {
    answer = answers[2]
  } finally {
    st.asking = false
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
    st.plan = null
    st.armed = false
    st.rearmAt = (typeof tokens === 'number' ? tokens : 0) + REARM_GROWTH_TOKENS
  }
}

// Called after each finished main turn.
export async function compactTurnComplete($, usage, aborted) {
  if (await disabled($)) return
  await compactUpdate($, usage)
  if (st.plan) {
    // An interrupted turn (Esc) may have stopped halfway through the update: wait for a finished one.
    if (!aborted) await advancePlan($)
    return
  }
  const tokens = usage?.context?.tokens
  if (!st.armed || st.never || st.compacting || st.asking || st.askedFallback || typeof tokens !== 'number') return
  const lim = await limits($, usage)
  if (tokens >= lim.ask) {
    st.askedFallback = true
    askFallback($) // not awaited: the hook must not wait for the person
  }
}

// ---- running the compaction -----------------------------------------------------------------

function scheduleCompaction($) {
  st.plan = null
  st.compacting = true
  $.clock.after(COMPACT_DELAY_MS, () => runCompaction($, 0))
}

async function runCompaction($, attempt) {
  let retry = false
  try {
    const before = await transcriptLines($)
    await copyTranscriptIfNeeded($)
    const args = (await focusOff($)) ? {} : { instructions: withFocus('') }
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
    if (!retry) st.compacting = false
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
  st.toolReady = false
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
    st.toolReady = true
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
  on('tool.call', { tool: TOOL_MATCH }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'Only the main conversation can propose a compaction.' }
    if (!st.armed || st.never) return { result: RESULTS.notNeeded }
    if (st.plan || st.compacting) return { result: RESULTS.busy }
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
    const result = await next({ ...input, instructions: withFocus(e.instructions) })
    if (e.trigger !== 'precompute' && result && result.messages) {
      cycleDone()
      await afterCompaction($, result, before)
    }
    return result
  })

  on('command.run', { command: 'crew-compact' }, async ($) => {
    const lang = await resolveLang($)
    if (await disabled($)) return { text: t(lang, 'cmd_compact_off') }
    if (st.plan || st.compacting || st.asking) return { text: t(lang, 'cmd_compact_busy') }
    st.never = false
    // A command must not hold the turn while the person answers; ask when the loop is free.
    $.clock.after(300, async () => {
      const outcome = await askAndPlan($, {})
      if (outcome === 'approved') requestStateUpdate($)
    })
    return { text: t(lang, 'cmd_compact_ok') }
  })
}
