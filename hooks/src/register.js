// crew-chief saver mod: watches your plan limits and asks whether to turn on a token saver.
//
// What it does (Claude Code 2.1.287 or later; older versions never load this file):
//   - When the 5-hour window crosses 70/80/90 % or the weekly window 50/75/85/90 %, asks once per
//     threshold and window whether to turn the saver on for THIS session. A new session, /clear,
//     and /resume always start with the saver off.
//   - While the saver is on, subagent requests are capped: Opus (and Fable) at medium effort,
//     Sonnet at high (no xhigh or max). Haiku and the main session are never touched.
//   - One toast when the session is 8 hours old.
//   - The compact flow (hooks/compact-flow.mjs): at a phase boundary past 250k tokens it proposes a compaction,
//     asks first, has the handoff files updated, and compacts with a detailed brief so nothing is lost.
//   - /saver [on|off|status]
//   - One status line with every running subagent's model, effort and tokens (hooks/src/agent-row.js), for
//     the Desktop app, VS Code and terminals where the shell panel row cannot draw. CREW_CHIEF_ROW_MOD.
//   - Every question the mod asks has a deadline (hooks/src/ask.js): unanswered after
//     CREW_CHIEF_ASK_TIMEOUT_MIN minutes (default 20), it counts as "not now" / "no" / "cancel".
//   - Once, after the first finished turn of a session where the advisor is off: offers to turn on
//     /advisor (a stronger model Claude can ask at hard moments). It asks first, remembers "not now"
//     for a week and "never" for good, and runs /advisor only after a yes.
//   - An opt-in command guard (hooks/src/guard.js): built-in and personal deny/warn rules and an ssh
//     "first contact" gate for production hosts, configured in ~/.claude/crew-chief-guard.json (written with defaults on the first interactive run). CREW_CHIEF_GUARD, CREW_CHIEF_GUARD_AUTOSETUP.
//     A first attempt at a "confirm" command is stopped with a checklist; the identical retry passes.
//     /crew-guard [status|suggestions|on|off]; the tool crew_guard_suggest lets Claude flag what the config misses.
// Environment: CREW_CHIEF_SAVER=off silences the saver questions and toasts (not the advisor offer);
// CREW_CHIEF_SAVER_FIVE_HOUR and CREW_CHIEF_SAVER_SEVEN_DAY set the thresholds ("70,80,90");
// CREW_CHIEF_ADVISOR_OFFER=off never offers the advisor; CREW_CHIEF_COMPACT=off turns the compact flow off;
// CREW_CHIEF_LANG=tr|en forces the language of the messages (otherwise: Claude Code's `language`
// setting, then what you have been writing, then the last language seen, then the locale).
// Kept between sessions, in the plugin's store: the language ("tr" or "en") and the answer to the
// advisor offer ("never", "answered", or "later:<time>"). Nothing leaves the machine.
import { classifyText, t, unitsFor, windowName } from './saver-i18n.mjs'
import { open } from './coord.mjs'
import { registerReset, resetNotePrompt, resetOnUsage, resetResetFlow } from './reset-flow.mjs'
import { registerStats, cacheOnPrompt, statsReset, statsSessionStart, statsStepEnd, statsStepStart } from './stats-flow.mjs'
import { registerTidy, tidySessionStart } from './tidy-flow.mjs'
import { askWithDeadline, registerAsk } from './ask.mjs'
import { cfgGet, configSessionStart, registerConfig } from './config.mjs'
import { overlapObserve, overlapReset } from './overlap.mjs'
import { handoffAfter, handoffOnPrompt, handoffReset, handoffTurnComplete } from './handoff-nudge.mjs'
import { rowSessionEnd, rowSessionStart, rowStepEnd, rowStepStart, rowTurnComplete } from './agent-row.mjs'
import { addLanguageVote, resetLang, resolveLang } from './lang.mjs'
import { progressAfter, progressObserve, progressReset } from './progress.mjs'
import { panesReset, panesSessionStart, registerPanes } from './crew-panes.mjs'
import { avNote, avReset, avSessionStart, avTurnComplete, registerAgentView } from './agent-view.mjs'
import { registerUi, uiNoteContext, uiNoteMainStep, uiSessionStart, uiTouch } from './crew-ui.mjs'
import { guardAfter, guardCheck, guardNudge, guardSessionEnd, guardSessionStart, guardWants, registerGuard } from './guard.mjs'
import { handoffOfferMarker, handoffOfferNote, handoffOfferStart } from './handoff-offer.mjs'
import {
  compactNoteActivity,
  compactNudge,
  compactSessionStart,
  compactTurnComplete,
  compactUpdate,
  registerCompact,
  resetCompact,
} from './compact-flow.mjs'
import {
  SESSION_AGE_TOAST_MS,
  ADVISOR_LATER_MS,
  advisorOfferAllowed,
  advisorPlan,
  agentCallEffort,
  capEffort,
  ASK_STORE_PREFIX,
  askHit,
  askStateNew,
  askStateRestore,
  askStateStale,
  formatDuration,
  isEnvFlag,
  tokensLabel,
  ultraAgentCall,
} from './saver-logic.mjs'

const TURN_STALE_MS = 10 * 60 * 1000
const STEP_STALE_MS = 5 * 60 * 1000

// Per-session state; resetState() puts it back when the session ends, /clear, or /resume.
let saver = false
let ultra = false // a mode of the saver: subagents stay off Opus (hooks/saver-logic.mjs ultraAgentCall)
let ultraOpus = false // the person's standing yes to Opus for the session (/saver ultra opus on)
let ultraToasted = false
let pending = null
let lastPromptAt = 0
let lastCompleteAt = 0
let lastStepAt = 0
let registered = false
let quiet = false
let ageToasted = false
let capToasted = false
let advisorChecked = false
// The saver question's memory ("don't ask again", thresholds already asked), mirrored in the plugin store
// per session id so a module reload, with or without a new session.start, keeps it (askLoad / askSave).
let asks = askStateNew()
let askSid // the session id `asks` is stored under; undefined: not looked up (or no store)
let askLoading = null

function resetState() {
  overlapReset()
  handoffReset()
  saver = false
  ultra = false
  ultraOpus = false
  ultraToasted = false
  open.saver = false
  pending = null
  lastPromptAt = 0
  lastCompleteAt = 0
  lastStepAt = 0
  registered = false
  quiet = false
  ageToasted = false
  capToasted = false
  advisorChecked = false
  resetLang()
  resetResetFlow()
  statsReset()
  progressReset()
  asks = askStateNew()
  askSid = undefined
  askLoading = null
}

async function readConfig($) {
  // saver.ask, saver.five and saver.seven: /crew-config, or the environment variables of the same meaning.
  const off = (await cfgGet($, 'saver.ask')) === 'off'
  const five = await cfgGet($, 'saver.five')
  const week = await cfgGet($, 'saver.seven')
  return { off, five, week }
}

// Brings back this session's saver-question memory after a module reload, and drops other sessions' stale
// copies. Once per module life (and again after resetState); any failure keeps the memory in this module only.
function askLoad($) {
  askLoading ??= (async () => {
    try {
      const sid = await $.session.id()
      if (typeof sid !== 'string' || sid === '') return
      const stored = await $.store.get(ASK_STORE_PREFIX + sid)
      const back = askStateRestore(stored)
      // Kept from both: an answer given while the load was under way is not lost.
      asks = { never: asks.never || back.never, windows: { ...back.windows, ...asks.windows } }
      askSid = sid
      const now = await $.clock.now()
      for (const k of await $.store.keys()) {
        if (k.startsWith(ASK_STORE_PREFIX) && k !== ASK_STORE_PREFIX + sid && askStateStale(await $.store.get(k), now)) await $.store.delete(k)
      }
    } catch (err) {
      // No session id or no store: remembered for this module's lifetime only.
    }
  })()
  return askLoading
}

async function askSave($) {
  await askLoad($)
  if (askSid === undefined) return
  try {
    await $.store.set(ASK_STORE_PREFIX + askSid, { ...asks, savedAt: await $.clock.now() })
  } catch (err) {
    // Remembered for this module's lifetime only.
  }
}

async function askNever($, value) {
  await askLoad($)
  asks.never = value
  await askSave($)
}

// The window that most needs a question, or undefined (hooks/saver-logic.mjs askHit).
async function findHit($, rateLimits, cfg) {
  await askLoad($)
  const { hit, changed } = askHit(asks, rateLimits, { five_hour: cfg.five, seven_day: cfg.week })
  if (changed) await askSave($)
  return hit
}

async function ageNotice($, usage) {
  const now = await $.clock.now()
  if (!ageToasted && typeof usage.startedAt === 'number' && now - usage.startedAt >= SESSION_AGE_TOAST_MS) {
    ageToasted = true
    const lang = await resolveLang($)
    $.ui.toast(t(lang, 'toast_age', { duration: formatDuration(now - usage.startedAt, unitsFor(lang)) }), { timeoutMs: 12000 })
  }
}

async function askUser($, hit) {
  open.saver = true
  try {
    const lang = await resolveLang($)
    // The ultra-saver is offered here and nowhere else on its own; unanswered counts as "not now", never as a yes.
    const answers = [t(lang, 'answer_on'), t(lang, 'answer_ultra'), t(lang, 'answer_not_now'), t(lang, 'answer_never')]
    const now = await $.clock.now()
    const left = hit.resetsAt ? Date.parse(hit.resetsAt) - now : 0
    const duration = left > 0 ? formatDuration(left, unitsFor(lang)) : ''
    const reset = duration !== '' ? t(lang, 'reset_in', { duration }) : ''
    // On Desktop the question is the quiet card (as the compact one): a topic, one short line, the window and its
    // reset as chips, what each mode does in one line, short labels on the same answers.
    const card = {
      kind: 'card',
      topic: t(lang, 'saver_topic'),
      question: t(lang, 'saver_question'),
      facts: [
        t(lang, hit.kind === 'five_hour' ? 'saver_fact_five' : hit.kind === 'seven_day' ? 'saver_fact_week' : 'percent', { percent: hit.percent, n: hit.percent }),
        duration !== '' ? t(lang, 'saver_fact_reset', { duration }) : '',
      ].filter((f) => f !== ''),
      note: t(lang, 'saver_note'),
      labels: [t(lang, 'saver_label_on'), t(lang, 'saver_label_ultra'), t(lang, 'saver_label_not_now'), t(lang, 'saver_label_never')],
      accent: 1, // the ultra answer's text in the saver's ultra colour
      quiet: 3, // "don't ask again": a quiet text button at the end
    }
    const answer = await askWithDeadline($, t(lang, 'ask', { window: windowName(lang, hit.kind), percent: hit.percent, reset }), answers, answers[2], card)
    if (answer === answers[0]) {
      saver = true
      $.ui.toast(t(lang, 'toast_saver_on'), { timeoutMs: 8000 })
    } else if (answer === answers[1]) {
      saver = true
      ultra = true
      $.ui.toast(t(lang, 'toast_ultra_on'), { timeoutMs: 8000 })
    } else if (answer === answers[3]) {
      await askNever($, true)
    }
  } catch (err) {
    // Dismissed, or a run with nobody to ask: treat it as "not now".
  } finally {
    open.saver = false
  }
}

// Ultra-saver: a call asks for the strongest model. Asks the person; no answer, a dismissed dialog or another
// question being open all mean no (the call then runs on Sonnet at high).
async function askOpus($, e) {
  if (open.saver || open.compact || open.reset) return false
  open.saver = true
  try {
    const lang = await resolveLang($)
    const answers = [t(lang, 'ultra_yes'), t(lang, 'ultra_no')]
    const agent = typeof e.subagent_type === 'string' && e.subagent_type !== '' ? e.subagent_type : 'an agent'
    const why = t(lang, typeof e.model === 'string' && e.model !== '' ? 'ultra_why_named' : 'ultra_why_xhigh')
    const answer = await askWithDeadline($, t(lang, 'ultra_ask_opus', { agent, why }), answers, answers[1])
    return answer === answers[0]
  } catch (err) {
    return false
  } finally {
    open.saver = false
  }
}

// Not awaited on purpose: the hook that calls this must not wait for the person to answer.
function launchAsk($) {
  const hit = pending
  if (hit !== null && !open.saver && !open.compact && !open.reset) {
    pending = null
    askUser($, hit)
  }
}

async function evaluate($) {
  const cfg = await readConfig($)
  quiet = cfg.off
  if (cfg.off) return
  const usage = await $.session.usage()
  await ageNotice($, usage)
  await askLoad($)
  if (saver || asks.never || open.saver) return
  const hit = await findHit($, usage.rateLimits, cfg)
  if (hit !== undefined) pending = hit
}

async function onCloudProvider($) {
  // The advisor is a server tool of the Anthropic API; these routes do not have it.
  const flags = [
    await $.env.get('CLAUDE_CODE_USE_BEDROCK'),
    await $.env.get('CLAUDE_CODE_USE_VERTEX'),
    await $.env.get('CLAUDE_CODE_USE_FOUNDRY'),
    await $.env.get('CLAUDE_CODE_USE_ANTHROPIC_AWS'),
    await $.env.get('CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD'),
  ]
  return flags.some(isEnvFlag)
}

async function rememberAdvisorAnswer($, value) {
  try {
    await $.store.set('advisor', value)
  } catch (err) {
    // Not remembered: the offer may come back next session.
  }
}

// The command writes the setting a moment after it returns, so look a few times before giving up.
async function advisorIsSet($) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const settings = await $.settings.read()
    if (settings.advisorModel) return true
    if (attempt < 4) await $.clock.sleep(400)
  }
  return false
}

// Runs outside the hook that scheduled it (a hook the turn waits on may not run commands). Only a
// result that is visible in the settings counts as "answered"; a refusal (a policy, Fable credits)
// is remembered as "never" so the offer does not repeat a command that cannot work.
async function enableAdvisor($, advisor, lang) {
  try {
    await $.command.run({ command: 'advisor', args: advisor })
    if (!(await advisorIsSet($))) throw new Error('the advisor setting did not change')
    await rememberAdvisorAnswer($, 'answered')
    $.ui.toast(t(lang, 'advisor_toast_on', { advisor: t(lang, 'model_' + advisor) }), { timeoutMs: 8000 })
  } catch (err) {
    await rememberAdvisorAnswer($, 'never')
    $.ui.toast(t(lang, 'advisor_toast_failed'), { timeoutMs: 12000 })
  }
}

// Offers the advisor once. Every gate that says "not for this person or this setup" returns
// quietly; a dismissed dialog (or a run with nobody to ask) leaves no trace, so it can come back.
async function offerAdvisor($) {
  if (open.saver || open.compact || open.reset) return
  open.saver = true
  try {
    if ((await $.env.get('CREW_CHIEF_ADVISOR_OFFER')) === 'off') return
    if (isEnvFlag(await $.env.get('CLAUDE_CODE_DISABLE_ADVISOR_TOOL'))) return
    if (await onCloudProvider($)) return
    const settings = await $.settings.read()
    if (settings.advisorModel) return
    const commands = await $.command.list()
    if (!commands.some((c) => c.name === 'advisor')) return
    const plan = advisorPlan(await $.session.model())
    if (plan === undefined) return
    let stored
    try {
      stored = await $.store.get('advisor')
    } catch (err) {
      // No store: treated as never asked.
    }
    const now = await $.clock.now()
    if (!advisorOfferAllowed(stored, now)) return
    const lang = await resolveLang($)
    const answers = [t(lang, 'advisor_answer_on'), t(lang, 'advisor_answer_later'), t(lang, 'advisor_answer_never')]
    const main = t(lang, 'model_' + plan.family)
    const advisor = t(lang, 'model_' + plan.advisor)
    let answer
    try {
      // Unanswered: "remind me in a week", the same as clicking it.
      answer = await askWithDeadline($, t(lang, plan.kind === 'second' ? 'advisor_ask_second' : 'advisor_ask_standard', { main, advisor }), answers, answers[1])
    } catch (err) {
      return
    }
    if (answer === answers[0]) {
      $.clock.after(300, () => enableAdvisor($, plan.advisor, lang))
    } else if (answer === answers[1]) {
      await rememberAdvisorAnswer($, 'later:' + (now + ADVISOR_LATER_MS))
    } else if (answer === answers[2]) {
      await rememberAdvisorAnswer($, 'never')
    }
  } catch (err) {
    // Anything unexpected: stay quiet rather than get in the way.
  } finally {
    open.saver = false
  }
}

// A main-thread turn is running when a prompt or a model request went out after the last finished
// turn. Model requests count too: a prompt queued while the previous turn ran, a turn longer than
// TURN_STALE_MS, and a turn started by a background notification never pass through prompt.submit
// at the right time. Both marks go stale so a lost turn.complete cannot block questions for good.
async function turnInFlight($) {
  const now = await $.clock.now()
  const byPrompt = lastPromptAt > lastCompleteAt && now - lastPromptAt < TURN_STALE_MS
  const byStep = lastStepAt > lastCompleteAt && now - lastStepAt < STEP_STALE_MS
  return byPrompt || byStep
}

async function statusText($) {
  await askLoad($)
  const lang = await resolveLang($)
  const units = unitsFor(lang)
  const usage = await $.session.usage()
  const now = await $.clock.now()
  const parts = [t(lang, saver ? 'status_on' : 'status_off') + (ultra ? t(lang, 'status_ultra') : '') + (asks.never ? t(lang, 'status_snoozed') : '')]
  for (const w of usage.rateLimits) {
    const left = w.resetsAt ? Date.parse(w.resetsAt) - now : 0
    parts.push(windowName(lang, w.kind) + ' ' + t(lang, 'percent', { n: w.percentUsed }) + (left > 0 ? t(lang, 'status_resets', { duration: formatDuration(left, units) }) : ''))
  }
  if (usage.rateLimits.length === 0) parts.push(t(lang, 'status_no_data'))
  if (usage.context && typeof usage.context.tokens === 'number') parts.push(t(lang, 'status_context', { tokens: tokensLabel(usage.context.tokens) }))
  return parts.join(' · ')
}

// True only when the listed /saver is a plugin command that crew-chief itself added (an earlier
// registration that a reload or /clear kept). The list names the adding plugin as `name@marketplace`,
// `name@inline` (--plugin-dir) or `name`; anything else (a built-in, another plugin, the user's own
// command, or an entry that does not say) is not ours, and our command.run hook stays out of its way.
async function ownsSaver($) {
  try {
    const commands = await $.command.list()
    return commands.some((c) => c.name === 'saver' && c.source === 'plugin' && /^crew-chief(@|$)/.test(String(c.plugin ?? '')))
  } catch (err) {
    return false
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    resetState()
    await handoffOfferMarker($)
    const result = await next(e)
    try {
      await $.command.register({
        name: 'saver',
        description: t(await resolveLang($), 'cmd_description'),
        argumentHint: '[on|off|status]',
      })
      registered = true
    } catch (err) {
      // The name is taken: by a built-in or another plugin's command (leave it alone), or by this
      // plugin's own earlier registration (/clear, /resume run session.start again), see ownsSaver.
      registered = await ownsSaver($)
    }
    // CREW_CHIEF_ULTRA=on starts the session in ultra-saver (for trying it in a scripted run; nothing turns it on by itself).
    if (isEnvFlag(await $.env.get('CREW_CHIEF_ULTRA'))) {
      saver = true
      ultra = true
    }
    await configSessionStart($)
    await compactSessionStart($)
    await tidySessionStart($)
    await statsSessionStart($)
    rowSessionStart($)
    await guardSessionStart($)
    await uiSessionStart($)
    await panesSessionStart($)
    await avSessionStart($)
    handoffOfferStart($, e)
    return result
  })

  on('session.end', async ($, e, next) => {
    resetState()
    resetCompact()
    rowSessionEnd($)
    panesReset()
    avReset()
    await guardSessionEnd($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    lastPromptAt = await $.clock.now()
    compactNoteActivity()
    // Only what the person types counts: task notifications, peer sessions, schedules, and other
    // plugins also come through prompt.submit, and their text is usually English.
    const kind = e.origin ? e.origin.kind : undefined
    const verdict = kind === undefined || kind === 'composer' || kind === 'bridge' ? classifyText(e.text) : undefined
    if (verdict !== undefined) {
      addLanguageVote(verdict)
    }
    if (kind === undefined || kind === 'composer' || kind === 'bridge') {
      resetNotePrompt(lastPromptAt)
      await cacheOnPrompt($)
    }
    const notes = [await compactNudge($), guardNudge(), ...(await handoffOnPrompt($, e)), handoffOfferNote()].filter((n) => n !== undefined)
    return next(notes.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...notes] })
  })

  on('session.measure', async ($, e, next) => {
    uiTouch($)
    await compactUpdate($, e)
    await resetOnUsage($, e)
    await evaluate($)
    if (pending !== null && !(await turnInFlight($))) launchAsk($)
    return next(e)
  })

  // The measure event can arrive mid-turn or not at all; a finished main turn is the safe moment
  // to ask, and a second chance to notice the limits.
  on('turn.complete', async ($, e, next) => {
    await rowTurnComplete($, e)
    // A subagent's end: the notice and the agent view (hooks/src/agent-view.js); the main loop's end is noted.
    await avTurnComplete($, e)
    if (e.agentId === undefined) {
      lastCompleteAt = await $.clock.now()
      uiTouch($)
      const usage = await $.session.usage()
      await uiNoteContext($, usage)
      await compactTurnComplete($, usage, e.reason)
      await handoffTurnComplete($, e)
      await resetOnUsage($, usage)
      await evaluate($)
      launchAsk($)
      if (e.reason === 'answer' && !advisorChecked && pending === null && !open.saver) {
        advisorChecked = true
        offerAdvisor($)
      }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      lastStepAt = await $.clock.now()
      compactNoteActivity('step')
      uiNoteMainStep(e)
    }
    await statsStepStart($, e)
    // Debug log only (claude --debug-file): what the host hands this hook for a subagent request.
    if (e.agentId !== undefined) {
      $.ui.log('saver: step agent=' + e.agentId + ' model=' + e.model + ' effort=' + String(e.effort) + ' saver=' + saver, { to: 'debug' })
    }
    let request = e
    if (saver && e.agentId !== undefined) {
      const cap = capEffort(e.model, e.effort)
      // Under ultra an Opus subagent is one the person approved (or allowed for the session): the call already
      // carries the effort that was agreed, so the step must not lower it again.
      if (cap.capped && !(ultra && cap.tier === 'heavy')) {
        if (!capToasted && !quiet) {
          capToasted = true
          const lang = await resolveLang($)
          const model = t(lang, cap.tier === 'heavy' ? 'model_heavy' : 'model_sonnet')
          $.ui.toast(t(lang, 'toast_cap', { model, from: cap.from, to: cap.effort }), { timeoutMs: 6000 })
        }
        $.ui.log('saver: subagent ' + e.agentId + ' on ' + e.model + ' effort ' + cap.from + ' -> ' + cap.effort, { to: 'debug' })
        request = { ...e, effort: cap.effort }
      }
    }
    // The row shows what the host reported (e), not what the cap wrote into the outgoing request: the host may
    // keep the agent definition's own effort (seen: planner ran high while the cap wrote medium).
    await rowStepStart($, e)
    const result = yield* next(request)
    await statsStepEnd($, e, result)
    await rowStepEnd($, e, result)
    if (e.agentId !== undefined) avNote($, e.agentId)
    return result
  })

  // The one unmatched tool.call hook of this module. First the opt-in command guard (hooks/src/guard.js):
  // off unless turned on, untouched calls skip it without waiting, and any failure lets the call through.
  // Then, while the saver is on, an Agent call for one of the Opus agents carries effort medium (the
  // turn.step cap below stays as the second line). Any failure there leaves the call as it was.
  on('tool.call', async ($, e, next) => {
    let guard
    if (guardWants(e)) {
      try {
        guard = await guardCheck($, e)
      } catch (err) {
        guard = undefined
      }
    }
    if (guard !== undefined && guard.deny !== undefined) return { deny: guard.deny }
    let request = e
    try {
      let plan
      if (ultra && e.tool === 'Agent') plan = ultraAgentCall(e, ultraOpus, await $.session.model())
      if (plan !== undefined) {
        // Ultra-saver: the model and effort of the call are rewritten (never seen live: the host may still apply
        // the agent definition's own model; the unit tests cover the rewrite, /tasks shows what really ran).
        const approved = plan.ask ? await askOpus($, e) : false
        if (!approved) {
          $.ui.log('saver: ultra Agent call ' + String(e.subagent_type) + ' model ' + String(e.model) + ' effort ' + String(e.effort) + ' -> ' + JSON.stringify(plan.rewrite), { to: 'debug' })
          request = { ...e, ...plan.rewrite }
          if (!ultraToasted && !quiet && plan.rewrite.model !== undefined) {
            ultraToasted = true
            const lang = await resolveLang($)
            $.ui.toast(t(lang, 'toast_ultra_cap', { agent: String(e.subagent_type || 'agent'), effort: plan.rewrite.effort }), { timeoutMs: 6000 })
          }
        }
      } else {
        const effort = saver && e.tool === 'Agent' ? agentCallEffort(e) : undefined
        if (effort !== undefined) {
          $.ui.log('saver: Agent call ' + String(e.subagent_type) + ' effort ' + String(e.effort) + ' -> ' + effort, { to: 'debug' })
          request = { ...e, effort }
        }
      }
    } catch (err) {
      request = e
    }
    // Subagent progress (hooks/src/progress.js): counts the call, and returns a reminder only where the
    // shell hook cannot run.
    const reminder = await progressObserve($, e)
    const overlap = await overlapObserve($, e)
    const result = await next(request)
    if (typeof e.agentId === 'string') avNote($, e.agentId)
    const handoff = await handoffAfter($, e, result)
    if (guard === undefined && reminder === undefined && overlap === undefined && handoff === undefined) return result
    return progressAfter(progressAfter(progressAfter(guard === undefined ? result : await guardAfter($, e, guard, result), reminder), overlap), handoff)
  })

  on('command.run', { command: 'saver' }, async ($, e, next) => {
    // The module can be loaded again (/reload-plugins, an update) without a new session.start, which
    // leaves `registered` false while the host still has our command: look it up before refusing.
    if (!registered) registered = await ownsSaver($)
    if (!registered) return next(e)
    const word = String(e.args || '').trim().toLowerCase()
    const lang = await resolveLang($)
    if (word === 'on') {
      // From ultra, 'on' steps down to the normal saver (it read as "saver on" and changed nothing).
      const wasUltra = ultra
      saver = true
      ultra = false
      ultraOpus = false
      await askNever($, false)
      return { text: t(lang, wasUltra ? 'cmd_ultra_off' : 'cmd_on') }
    }
    if (word === 'off') {
      saver = false
      ultra = false
      ultraOpus = false
      await askNever($, true)
      return { text: t(lang, 'cmd_off') }
    }
    if (word === 'ultra' || word === 'ultra on') {
      const wasOn = saver
      saver = true
      ultra = true
      await askNever($, false)
      return { text: t(lang, 'cmd_ultra_on') + (wasOn ? '' : ' ' + t(lang, 'cmd_ultra_needs_saver')) }
    }
    if (word === 'ultra off') {
      ultra = false
      ultraOpus = false
      return { text: t(lang, 'cmd_ultra_off') }
    }
    if (word === 'ultra opus on' || word === 'ultra opus off') {
      ultraOpus = word === 'ultra opus on'
      return { text: t(lang, ultraOpus ? 'cmd_ultra_opus_on' : 'cmd_ultra_opus_off') }
    }
    if (word === '' || word === 'status') return { text: await statusText($) }
    return { text: t(lang, 'cmd_usage') }
  })

  registerAsk(on)
  registerConfig(on)
  registerCompact(on)
  // The saver word at the end of the Desktop status line: off -> saver -> ultra-saver -> off. A press does not
  // touch the "never ask" answer (that stays with /saver on|off and the question).
  registerUi(on, () => (ultra ? 'ultra' : saver), () => {
    if (!saver) {
      saver = true
      return 'cmd_on'
    }
    if (!ultra) {
      ultra = true
      return 'toast_ultra_on'
    }
    saver = false
    ultra = false
    ultraOpus = false
    return 'toast_saver_off'
  })
  registerPanes(on)
  registerAgentView(on)
  registerReset(on)
  registerTidy(on)
  registerStats(on)
  registerGuard(on)
}
