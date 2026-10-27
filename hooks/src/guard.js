// crew-chief command guard (opt-in). Part of the mod in hooks/register.js (Claude Code 2.1.287+).
//
// Off unless CREW_CHIEF_GUARD=on, or ~/.claude/crew-chief-guard.json exists with "enabled": true
// (CREW_CHIEF_GUARD=off always wins). The rules and the ssh parser live in hooks/guard-logic.mjs.
//   - deny: catastrophic rm -rf, the guard's own config, and personal deny rules. Never runs.
//   - confirm: the first attempt is stopped with a checklist the model answers by itself; the identical
//     command again within confirmTtlMinutes (default 360) passes silently. A changed command is new.
//   - warn: the call runs, then a notice and a line of context for the model.
//   - ssh gate (ssh.mode "gate"): first contact with a production host, and remote commands off the
//     read-only list, are handled like confirm (same map, same checklist). Read-only agents get a plain deny.
//   - crew_guard_suggest: a tool Claude calls to flag something the config does not cover. It returns at
//     once, keeps the note in memory (at most 50) and never asks anything; /crew-guard shows them.
// The config is read once per session. State lives in memory and ends with the session; nothing is written.
// A speed bump, not a security boundary. Any failure lets the call through (fail open).
import { resolveLang } from './lang.mjs'
import { t } from './saver-i18n.mjs'
import {
  DEFAULT_TTL_MIN,
  GUARD_NOTE,
  READONLY_AGENTS,
  addSuggestion,
  callKey,
  checklistMessage,
  classify,
  clipText,
  compileConfig,
  configPath,
  gateDecide,
  gateReason,
  gateRecord,
  guardOn,
  isFresh,
  markCommand,
  newGateState,
  readOnlyDenyMessage,
  ruleDenyMessage,
  ruleWarnContext,
  sshAssess,
  sshDenyMessage,
  sshWarnContext,
  guardStatusText,
  suggestionsText,
} from './guard-logic.mjs'

const GUARD_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']
const GUARD_TTL = DEFAULT_TTL_MIN * 60_000
const GUARD_NO_FILE = { enabled: false, rules: [], disabled: new Set(), confirmTtlMs: GUARD_TTL, ssh: { mode: 'off', prodHosts: [], safeRemote: [], ttlMs: GUARD_TTL } }
export const GUARD_TOOL_NAME = 'crew_guard_suggest'
const GUARD_TOOL_MATCH = /^mcp__.+__crew_guard_suggest$/
const GUARD_TOOL_DESCRIPTION =
  "Flag something the command guard should know about: a production host, a critical path, a secret (its name only, never its value), or a dangerous command it does not cover. Returns at once; never stop or wait for an answer. The user reviews these with /crew-guard. Never edit the guard's config yourself."

function guardFresh() {
  return {
    loaded: false,
    loading: undefined,
    on: false,
    why: 'not loaded yet',
    config: undefined,
    gate: newGateState(),
    agentTypes: new Map(), // agentId -> read-only (true/false), once the agent list named it
    suggestions: [],
    suggestToasted: false,
    noted: false,
  }
}

let guardState = guardFresh()

async function guardHome($) {
  const home = await $.env.get('HOME')
  if (typeof home === 'string' && home) return home
  const profile = await $.env.get('USERPROFILE')
  return typeof profile === 'string' && profile ? profile : undefined
}

async function guardToast($, key, vars) {
  try {
    $.ui.toast(t(await resolveLang($), key, vars), { timeoutMs: 10000 })
  } catch (err) {
    // The deny or the warning stands without the toast.
  }
}

async function guardLoad($) {
  const st = guardState
  st.on = false
  st.config = undefined
  const env = await $.env.get('CREW_CHIEF_GUARD')
  if (String(env ?? '').trim().toLowerCase() === 'off') {
    st.why = 'CREW_CHIEF_GUARD=off'
    return
  }
  const path = configPath(await guardHome($))
  let loaded
  if (path !== undefined) {
    let text
    try {
      text = await $.fs.read(path)
    } catch (err) {
      text = undefined // no file: the guard stays off unless CREW_CHIEF_GUARD=on
    }
    if (typeof text === 'string') loaded = compileConfig(text)
  }
  if (loaded !== undefined && !loaded.ok) {
    st.why = 'the config file is ' + loaded.error
    $.ui.log('crew-chief guard: ' + path + ' is ' + loaded.error + '; the guard is off this session', { to: 'debug' })
    await guardToast($, 'guard_toast_invalid', { path: clipText(path, 60) })
    return
  }
  if (loaded !== undefined) loaded.problems.slice(0, 20).forEach((p) => $.ui.log('crew-chief guard: config: ' + p, { to: 'debug' }))
  st.on = guardOn(env, loaded)
  st.config = loaded !== undefined ? loaded.config : GUARD_NO_FILE
  if (String(env ?? '').trim().toLowerCase() === 'on') st.why = 'CREW_CHIEF_GUARD=on' + (loaded ? '' : ', no config file: built-in rules only')
  else if (loaded === undefined) st.why = 'no config file at ' + (path ?? '~/.claude/crew-chief-guard.json')
  else st.why = loaded.config.enabled ? 'the config file says enabled: true' : 'the config file says enabled: false'
  if (st.on) $.ui.log('crew-chief guard: on, ' + st.config.rules.length + ' personal rules, ssh ' + st.config.ssh.mode, { to: 'debug' })
}

async function guardEnsure($) {
  if (guardState.loaded) return
  const st = guardState
  st.loading ??= guardLoad($).finally(() => {
    st.loaded = true
  })
  await st.loading
}

export async function guardSessionStart($) {
  guardState = guardFresh()
  try {
    await guardEnsure($)
  } catch (err) {
    guardState.on = false // fail open
  }
  try {
    if (guardState.on) {
      await $.tool.register({
        name: GUARD_TOOL_NAME,
        description: GUARD_TOOL_DESCRIPTION,
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['host', 'path', 'command', 'secret', 'other'], description: 'What is flagged.' },
            value: { type: 'string', description: 'The host, path or command; for a secret only its name or location, never the value.' },
            reason: { type: 'string', description: 'One line: why it is critical.' },
          },
          required: ['kind', 'value', 'reason'],
        },
        isDeferred: false,
      })
    }
  } catch (err) {
    // An older Claude Code, or the name is taken (registered at an earlier start): nothing else depends on it.
  }
  try {
    await $.command.register({ name: 'crew-guard', description: t(await resolveLang($), 'cmd_guard_description'), argumentHint: '[status|suggestions]' })
  } catch (err) {
    // The name is taken (another plugin, or this one at an earlier start): the guard works without it.
  }
}

export function guardSessionEnd() {
  guardState = guardFresh()
}

// Synchronous, so a call the guard never looks at (and every call while it is off) passes untouched.
export function guardWants(e) {
  return GUARD_TOOLS.includes(e.tool) && (!guardState.loaded || guardState.on)
}

// Once per session while the guard is on: the note for the next prompt (prompt.submit), else undefined.
export function guardNudge() {
  if (!guardState.on || guardState.noted) return undefined
  guardState.noted = true
  return GUARD_NOTE
}

async function guardReadOnlyAgent($, agentId) {
  const known = guardState.agentTypes.get(agentId)
  if (known !== undefined) return known
  try {
    const list = await $.agent.list()
    const agent = list.find((a) => a.id === agentId)
    if (agent === undefined) return false
    const type = String(agent.type || '').replace(/^crew-chief:/, '')
    const readOnly = READONLY_AGENTS.includes(type)
    guardState.agentTypes.set(agentId, readOnly)
    return readOnly
  } catch (err) {
    return false // unknown: treated as an ordinary agent
  }
}

// undefined = let the call run untouched; { deny } = refuse it; { contexts, notes } = run it, then warn.
export async function guardCheck($, e) {
  await guardEnsure($)
  const st = guardState
  if (!st.on || st.config === undefined) return undefined
  const v = classify(e.tool, e, st.config)
  if (v !== null && v.level === 'deny') {
    $.ui.log('crew-chief guard: denied by rule ' + v.rule, { to: 'debug' })
    await guardToast($, 'guard_toast_deny', { text: clipText(v.text) })
    return { deny: ruleDenyMessage(v) }
  }
  const ssh = st.config.ssh
  const touches = e.tool === 'Bash' && ssh.mode !== 'off' && typeof e.command === 'string' ? sshAssess(e.command, ssh) : []
  const confirm = v !== null && v.level === 'confirm'
  if (!confirm && touches.length === 0) {
    return v !== null ? { contexts: [ruleWarnContext(v)], notes: [v.text] } : undefined
  }
  const readOnly = e.agentId !== undefined ? await guardReadOnlyAgent($, e.agentId) : false
  if (confirm && readOnly) {
    await guardToast($, 'guard_toast_deny', { text: clipText(v.text) })
    return { deny: readOnlyDenyMessage(v) }
  }
  const now = await $.clock.now()
  const key = callKey(e.agentId, e.tool, e)
  const d = touches.length > 0 ? gateDecide(st.gate, touches, { mode: ssh.mode, loop: e.agentId, readOnly, now, ttlMs: ssh.ttlMs, command: e.command }) : { action: 'pass' }
  if (d.action === 'deny' && d.kind === 'readonly') {
    await guardToast($, 'guard_toast_readonly', { host: clipText(d.hosts.join(', '), 40), cmd: clipText(e.command) })
    return { deny: sshDenyMessage(d) }
  }
  const confirmDue = confirm && !isFresh(st.gate, key, now, st.config.confirmTtlMs)
  if (confirmDue || d.action === 'deny') {
    const reasons = []
    if (confirmDue) reasons.push(`${v.text} [${v.rule}]`)
    if (d.action === 'deny') {
      reasons.push(gateReason(d))
      gateRecord(st.gate, d, now)
    }
    markCommand(st.gate, key, now)
    $.ui.log('crew-chief guard: first attempt held' + (confirmDue ? ' (' + v.rule + ')' : '') + (d.action === 'deny' ? ' (ssh ' + d.kind + ')' : ''), { to: 'debug' })
    const what = d.action === 'deny' ? 'ssh ' + d.hosts.join(', ') : v.text
    await guardToast($, 'guard_toast_confirm', { text: clipText(what, 50), cmd: clipText(e.command ?? e.file_path ?? '') })
    return { deny: checklistMessage(reasons, { loop: e.agentId, unknown: d.unknown }) }
  }
  // An approved retry passes silently.
  if (confirm) return undefined
  if (d.action === 'warn') {
    gateRecord(st.gate, d, now)
    return { contexts: [sshWarnContext(d)], notes: ['ssh ' + d.hosts.join(', ') + (d.kind === 'first' ? ': first contact' : ': ' + d.why)] }
  }
  return v !== null ? { contexts: [ruleWarnContext(v)], notes: [v.text] } : undefined
}

// After the call ran: a notice for the person and context for the model. Any failure returns the result as is.
export async function guardAfter($, e, g, r) {
  try {
    if (!r || r.deny !== undefined) return r
    try {
      const lang = await resolveLang($)
      $.ui.notice(e.tool_use_id, t(lang, 'guard_notice', { text: clipText(g.notes.join(' · ')) }))
    } catch (err) {
      // The context below still reaches the model.
    }
    const context = [...(r.context ?? []), ...g.contexts]
    if (r.isError) return { isError: true, result: r.result, text: r.text, context }
    return { result: r.result, context }
  } catch (err) {
    return r
  }
}

export function registerGuard(on) {
  // Returns at once and never asks: the person reads the notes with /crew-guard suggestions.
  on('tool.call', { tool: GUARD_TOOL_MATCH }, async ($, e) => {
    let outcome
    try {
      outcome = guardState.on ? addSuggestion(guardState.suggestions, e) : 'off'
    } catch (err) {
      outcome = 'invalid'
    }
    if (outcome === 'added' && !guardState.suggestToasted) {
      guardState.suggestToasted = true
      await guardToast($, 'guard_toast_suggest', {})
    }
    if (outcome === 'off') return { result: 'The command guard is off; nothing was noted. Carry on.' }
    if (outcome === 'invalid') return { result: 'Not noted: kind must be host, path, command, secret or other, with a value. Carry on; do not stop to wait.' }
    return { result: 'Noted; the user will see it with /crew-guard. Do not stop to wait; carry on with your work.' }
  })

  on('command.run', { command: 'crew-guard' }, async ($, e) => {
    try {
      await guardEnsure($)
    } catch (err) {
      // Status shows what is known.
    }
    const word = String(e.args || '').trim().toLowerCase()
    if (word === 'suggestions') return { text: suggestionsText(guardState.suggestions) }
    return {
      text: guardStatusText({ on: guardState.on, why: guardState.why, config: guardState.config, contacted: guardState.gate.contacted.size, suggestions: guardState.suggestions.length }),
    }
  })
}
