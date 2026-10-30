// crew-chief subagent progress, kept by the mod (Claude Code 2.1.287+). Part of the mod in hooks/register.js.
//
// The shell hook (scripts/progress-hook.sh) needs jq and writes the files the shell panel row reads. Where it
// cannot run (Windows, no jq) nothing would count the subagent's calls, so the mod does it in memory:
//   - every subagent tool.call is counted; a `: 'crew-progress NN | step | delay'` Bash call is a report;
//   - the percentage of a fresh report goes into the status line (hooks/src/agent-row.js);
//   - after 10 calls without a report the call's result carries the same reminder the shell hook would send,
//     but only when jq is missing, so an agent never gets it twice.
// Any failure leaves the call alone.
import { INTRO_AT_CALL, freshPct, introText, nudgeText, observe, parseReport } from './progress-logic.mjs'

let progressAgents = new Map()
let progressMissed = new Map() // agentId -> reminders sent since its last report

export function progressReset() {
  progressAgents = new Map()
  progressMissed = new Map()
}

// Called from the mod's tool.call hook with the call as it goes out. Returns the note to add to the call's result,
// or undefined: the rule at the agent's second call when it has not reported, then a reminder every 10 calls
// without a report, louder each time one goes unanswered. It never stops a call.
export async function progressObserve($, e) {
  try {
    if (typeof e.agentId !== 'string' || e.agentId === '') return undefined
    const now = await $.clock.now()
    const report = e.tool === 'Bash' && parseReport(e.command) !== null
    const due = observe(progressAgents, e.agentId, e.tool, e.command, now)
    if (report) {
      progressMissed.delete(e.agentId)
      return undefined
    }
    const entry = progressAgents.get(e.agentId)
    if (due > 0) {
      const missed = progressMissed.get(e.agentId) ?? 0
      progressMissed.set(e.agentId, missed + 1)
      return nudgeText(due, missed)
    }
    if (entry && entry.tools === INTRO_AT_CALL && entry.reported !== true) return introText()
    return undefined
  } catch (err) {
    return undefined
  }
}

// The percentage to show for an agent, or undefined.
export async function progressPct($, agentId) {
  try {
    const entry = progressAgents.get(agentId)
    if (!entry) return undefined
    return freshPct(entry, await $.clock.now())
  } catch (err) {
    return undefined
  }
}

// How many tool calls an agent has made (counted by this module), or undefined.
export function progressStats(agentId) {
  const entry = progressAgents.get(agentId)
  return entry ? { calls: entry.tools } : undefined
}

// The fresh report of an agent as { pct, step }, or undefined (same freshness as progressPct).
export async function progressInfo($, agentId) {
  try {
    const entry = progressAgents.get(agentId)
    if (!entry) return undefined
    const pct = freshPct(entry, await $.clock.now())
    if (pct === undefined) return undefined
    return { pct, step: typeof entry.step === 'string' && entry.step !== '' ? entry.step : undefined }
  } catch (err) {
    return undefined
  }
}

// After the call ran: the reminder rides with the result, next to what the guard may have added.
export function progressAfter(r, text) {
  try {
    if (!r || r.deny !== undefined || text === undefined) return r
    return { ...r, context: [...(r.context ?? []), text] }
  } catch (err) {
    return r
  }
}
