// Keeps the handoff files (STATUS.md, tasks.json, PROGRESS.md) from going stale. Part of the mod in hooks/register.js.
// The rules are in hooks/handoff-nudge-logic.mjs. This part watches the session:
//   - every Edit/Write call counts the project file it touched (main session and subagents);
//   - a reminder rides with the result of a main-session Edit/Write call once enough has piled up, so a long
//     unattended run is reached too; the next prompt carries one as well when the pile is big but no call did;
//   - a prompt that may state a rule, a question the person answered, a commit and a nearly used limit each get
//     a one-time reminder;
//   - mode `turn`: after unanswered reminders, one extra turn at the end of an answer asks for the update.
// It never writes the files, never asks a question and never stops a call. Any failure says nothing.
import { findHandoff } from './handoff.mjs'
import { cfgGet } from './config.mjs'
import { compactActivity, compactBusy } from './compact-flow.mjs'
import {
  EVENT_CAP,
  enforceDue,
  enforceText,
  eventText,
  isCommit,
  limitNear,
  looksLikeRule,
  newState,
  noteCall,
  ordinaryDue,
  ordinaryText,
  sentOrdinary,
  wrote,
  WRITE_TOOLS,
} from './handoff-nudge-logic.mjs'

let hs = newState()
let known // { at, paths: string[] } or { at, paths: [] } when the project has no handoff files

export function handoffReset() {
  hs = newState()
  known = undefined
}

async function config($) {
  return {
    mode: await cfgGet($, 'handoff.mode'),
    files: await cfgGet($, 'handoff.files'),
    minutes: await cfgGet($, 'handoff.minutes'),
    max: await cfgGet($, 'handoff.max'),
  }
}

// The handoff files this project has, looked up at most every two minutes (crew-handoff may create them mid-session).
async function handoffPaths($) {
  const now = await $.clock.now()
  if (known !== undefined && now - known.at < 120_000) return known.paths
  const h = await findHandoff($)
  known = { at: now, paths: h ? [h.status, h.tasks, h.progress].filter(Boolean) : [] }
  return known.paths
}

async function newestMtime($, paths) {
  let best
  for (const p of paths) {
    try {
      const st = await $.fs.stat(p)
      if (st && typeof st.mtimeMs === 'number' && (best === undefined || st.mtimeMs > best)) best = st.mtimeMs
    } catch (err) {
      // A file that cannot be read has no time.
    }
  }
  return best
}

// Whether the files were written since counting began (a Bash edit, another tool, the person): then the stretch restarts.
async function writtenMeanwhile($, paths) {
  const mt = await newestMtime($, paths)
  if (mt === undefined) return false
  if (hs.baseline === undefined) {
    hs.baseline = mt
    return false
  }
  if (mt > hs.baseline) {
    wrote(hs, mt)
    return true
  }
  return false
}

async function root($) {
  try {
    return (await $.session.root()) || (await $.session.cwd())
  } catch (err) {
    return undefined
  }
}

// Called from the mod's tool.call hook after the call ran. `result` is what the call returned. Returns the note to
// add to that result, or undefined.
export async function handoffAfter($, e, result) {
  try {
    if (result && result.deny !== undefined) return undefined
    const watched = WRITE_TOOLS.has(e.tool) || e.tool === 'AskUserQuestion' || (e.tool === 'Bash' && isCommit(e.command))
    if (!watched) return undefined
    const cfg = await config($)
    if (cfg.mode === 'off') return undefined
    const paths = await handoffPaths($)
    if (paths.length === 0) return undefined
    const main = typeof e.agentId !== 'string' || e.agentId === ''
    const now = await $.clock.now()
    if (WRITE_TOOLS.has(e.tool)) {
      const kind = noteCall(hs, e, await root($), now)
      if (kind === 'wrote') {
        hs.baseline = await newestMtime($, paths)
        return undefined
      }
      if (kind === 'counted' && hs.baseline === undefined) hs.baseline = await newestMtime($, paths) // counting begins: remember how the files stand
      if (kind !== 'counted' || !main || compactBusy() || !ordinaryDue(hs, cfg, now)) return undefined
      if (await writtenMeanwhile($, paths)) return undefined
      if (!ordinaryDue(hs, cfg, now)) return undefined
      const text = ordinaryText(hs, now)
      sentOrdinary(hs, now)
      return text
    }
    if (!main || hs.events >= EVENT_CAP || compactBusy()) return undefined
    if (e.tool === 'Bash') {
      hs.events += 1
      return eventText('commit')
    }
    // AskUserQuestion: Claude asked, the person answered.
    if (result && result.result !== undefined) {
      hs.events += 1
      return eventText('decision')
    }
    return undefined
  } catch (err) {
    return undefined
  }
}

// Called from the prompt.submit hook with what the person typed. Returns notes to add to the prompt's context.
export async function handoffOnPrompt($, e) {
  const notes = []
  try {
    const kind = e.origin ? e.origin.kind : undefined
    const typed = kind === undefined || kind === 'composer' || kind === 'bridge'
    const cfg = await config($)
    if (cfg.mode === 'off') return notes
    const paths = await handoffPaths($)
    if (paths.length === 0) return notes
    const now = await $.clock.now()
    if (!compactBusy()) {
      if (typed && hs.events < EVENT_CAP && looksLikeRule(e.text)) {
        hs.events += 1
        notes.push(eventText('rule'))
      }
      if (!hs.limitDone) {
        const usage = await $.session.usage().catch(() => undefined)
        if (limitNear(usage?.rateLimits)) {
          hs.limitDone = true
          if (hs.events < EVENT_CAP) {
            hs.events += 1
            notes.push(eventText('limit'))
          }
        }
      }
      if (typed && ordinaryDue(hs, cfg, now) && !(await writtenMeanwhile($, paths)) && ordinaryDue(hs, cfg, now)) {
        notes.push(ordinaryText(hs, now))
        sentOrdinary(hs, now)
      }
    }
  } catch (err) {
    // A missing reminder is better than a broken prompt.
  }
  return notes
}

// Called after each finished main turn. Mode `turn`: if reminders went unanswered and the pile is large, ask for the
// update in a turn of its own, once per stretch, after the session has stayed quiet for a few seconds.
export async function handoffTurnComplete($, e) {
  try {
    if (e.agentId !== undefined || (e.reason !== undefined && e.reason !== 'answer')) return
    const cfg = await config($)
    if (cfg.mode !== 'turn' || compactBusy()) return
    const paths = await handoffPaths($)
    if (paths.length === 0) return
    const now = await $.clock.now()
    if (!enforceDue(hs, cfg, now)) return
    const seen = compactActivity()
    $.clock.after(8000, async () => {
      try {
        if (compactActivity() !== seen || compactBusy()) return // a new turn started, or a compaction did
        const agents = await $.agent.list().catch(() => [])
        if (Array.isArray(agents) && agents.some((a) => a.status === 'pending' || a.status === 'running')) return
        if (await writtenMeanwhile($, paths)) return
        const at = await $.clock.now()
        if (!enforceDue(hs, cfg, at)) return
        hs.enforced = true
        $.ui.log('handoff: asking for an update after unanswered reminders', { to: 'debug' })
        await $.prompt.submit({ text: enforceText(hs, at) })
      } catch (err) {
        // Nothing is lost: the reminders and the compact flow still exist.
      }
    })
  } catch (err) {
    // Silent.
  }
}
