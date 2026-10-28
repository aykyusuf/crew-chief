// crew-chief subagent progress, kept by the mod (Claude Code 2.1.287+). Part of the mod in hooks/register.js.
//
// The shell hook (scripts/progress-hook.sh) needs jq and writes the files the shell panel row reads. Where it
// cannot run (Windows, no jq) nothing would count the subagent's calls, so the mod does it in memory:
//   - every subagent tool.call is counted; a `: 'crew-progress NN | step | delay'` Bash call is a report;
//   - the percentage of a fresh report goes into the status line (hooks/src/agent-row.js);
//   - after 10 calls without a report the call's result carries the same reminder the shell hook would send,
//     but only when jq is missing, so an agent never gets it twice.
// Any failure leaves the call alone.
import { rowShellHookDead } from './agent-row.mjs'
import { freshPct, nudgeText, observe } from './progress-logic.mjs'

let progressAgents = new Map()

export function progressReset() {
  progressAgents = new Map()
}

// Called from the mod's tool.call hook with the call as it goes out. Returns the reminder text, or undefined.
export async function progressObserve($, e) {
  try {
    if (typeof e.agentId !== 'string' || e.agentId === '') return undefined
    const now = await $.clock.now()
    const due = observe(progressAgents, e.agentId, e.tool, e.command, now)
    if (due === 0) return undefined
    return (await rowShellHookDead($)) ? nudgeText(due) : undefined
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

// After the call ran: the reminder rides with the result, next to what the guard may have added.
export function progressAfter(r, text) {
  try {
    if (!r || r.deny !== undefined || text === undefined) return r
    return { ...r, context: [...(r.context ?? []), text] }
  } catch (err) {
    return r
  }
}
