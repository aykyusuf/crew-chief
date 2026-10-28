// crew-chief command guard (on by default after the first interactive run). Part of the mod in hooks/register.js (Claude Code 2.1.287+).
//
// On when CREW_CHIEF_GUARD=on, or ~/.claude/crew-chief-guard.json exists with "enabled": true (the first run writes it)
// (CREW_CHIEF_GUARD=off always wins). The rules and the ssh parser live in hooks/guard-logic.mjs.
//   - deny: catastrophic rm -rf, the guard's own config, and personal deny rules. Never runs.
//   - confirm: the first attempt is stopped with a checklist the model answers by itself; the identical
//     command again within confirmTtlMinutes (default 360) passes silently. A changed command is new.
//   - warn: the call runs, then a notice and a line of context for the model.
//   - ssh gate (ssh.mode "gate"): first contact with a production host, and remote commands off the
//     read-only list, are handled like confirm (same map, same checklist). Read-only agents get a plain deny.
//   - crew_guard_suggest: a tool Claude calls to flag something the config does not cover. It returns at
//     once, keeps the note in memory (at most 50) and never asks anything; /crew-guard shows them.
//   - first run: in an interactive session with no config file and no SETUP_KEY in the plugin store, the
//     default config is written once (CREW_CHIEF_GUARD_AUTOSETUP=off or CREW_CHIEF_GUARD=off prevent it);
//     the marker keeps a deleted file from coming back. /crew-guard on|off is the only other write.
// The config is read once per session. Gate state lives in memory and ends with the session.
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
  defaultConfigText,
  DEFAULTS_NOTE,
  isDefaultConfig,
  offConfigText,
  SETUP_KEY,
  toggleConfigText,
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
    defaults: false, // the loaded file is the first-run default
    toolRegistered: false,
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

async function setMarker($, value) {
  try {
    await $.store.set(SETUP_KEY, value)
  } catch (err) {
    // No store: the file check still keeps an existing file untouched.
  }
}

// First run: writes the default config once and returns its text, else undefined. Every step that cannot be
// answered (no surface, no store, fs.exists failing) does nothing, so a -p, SDK or cloud run never writes.
// `fileText`: what was read at `path` (a string when the file is there).
async function guardAutoSetup($, path, fileText) {
  if (String((await $.env.get('CREW_CHIEF_GUARD_AUTOSETUP')) ?? '').trim().toLowerCase() === 'off') return undefined
  let surfaces
  try {
    surfaces = await $.session.surfaces()
  } catch (err) {
    return undefined
  }
  if (!Array.isArray(surfaces) || surfaces.length === 0) return undefined
  let marker
  try {
    marker = await $.store.get(SETUP_KEY)
  } catch (err) {
    return undefined
  }
  if (marker !== undefined && marker !== null) return undefined
  if (typeof fileText === 'string') {
    await setMarker($, 'done') // the owner's own file: never touched
    return undefined
  }
  let exists
  try {
    exists = await $.fs.exists(path)
  } catch (err) {
    return undefined
  }
  if (exists) {
    await setMarker($, 'done')
    return undefined
  }
  const text = defaultConfigText()
  try {
    await $.fs.write(path, text) // creates ~/.claude when missing; the API has no rename, so a plain write
  } catch (err) {
    try {
      $.ui.log('crew-chief guard: could not write the default config to ' + path + ': ' + String(err && err.message ? err.message : err).slice(0, 200), { to: 'debug' })
    } catch (e2) {
      // nothing else to do
    }
    await setMarker($, 'failed')
    return undefined
  }
  await setMarker($, 'done')
  try {
    $.ui.log('crew-chief guard: first run, wrote the default config to ' + path, { to: 'debug' })
  } catch (err) {
    // the toast below still says it
  }
  await guardToast($, 'guard_toast_autosetup', {})
  return text
}

async function guardLoad($) {
  const st = guardState
  st.on = false
  st.config = undefined
  st.defaults = false
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
      text = undefined // no file: the guard stays off unless CREW_CHIEF_GUARD=on (or the first run writes it)
    }
    let written
    try {
      written = await guardAutoSetup($, path, text)
    } catch (err) {
      written = undefined // never into the session
    }
    if (typeof written === 'string') text = written // live in this session, not only the next
    if (typeof text === 'string') {
      loaded = compileConfig(text)
      st.defaults = isDefaultConfig(text)
    }
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
  await guardRegisterTool($)
  try {
    await $.command.register({ name: 'crew-guard', description: t(await resolveLang($), 'cmd_guard_description'), argumentHint: '[status|suggestions|on|off]' })
  } catch (err) {
    // The name is taken (another plugin, or this one at an earlier start): the guard works without it.
  }
}

async function guardRegisterTool($) {
  try {
    if (guardState.on && !guardState.toolRegistered) {
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
      guardState.toolRegistered = true
    }
  } catch (err) {
    // An older Claude Code, or the name is taken (registered at an earlier start): nothing else depends on it.
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
  return guardState.defaults ? GUARD_NOTE + ' ' + DEFAULTS_NOTE : GUARD_NOTE
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

// /crew-guard on|off: the only write to the config after the first run. Sets `enabled`, keeps every other
// key, and applies the result to this session at once. Returns the reply (English).
async function guardToggle($, enabled) {
  const st = guardState
  const path = configPath(await guardHome($))
  if (path === undefined) return 'crew-chief guard: no HOME (or USERPROFILE), so the config file cannot be found; nothing was changed.'
  let exists
  try {
    exists = await $.fs.exists(path)
  } catch (err) {
    return 'crew-chief guard: could not check ' + path + '; nothing was changed.'
  }
  let text
  let did
  if (exists) {
    let current
    try {
      current = await $.fs.read(path)
    } catch (err) {
      return 'crew-chief guard: could not read ' + path + '; nothing was changed.'
    }
    const next = toggleConfigText(String(current), enabled)
    if (!next.ok) return 'crew-chief guard: ' + path + ' is ' + next.error + ', so it was not changed. Fix the file by hand, then run /crew-guard ' + (enabled ? 'on' : 'off') + ' again.'
    text = next.text
    did = 'set "enabled": ' + enabled + ' in ' + path + ' (other settings kept)'
  } else {
    text = enabled ? defaultConfigText() : offConfigText()
    did = 'created ' + path + (enabled ? ' with the default rules' : ' with "enabled": false')
  }
  try {
    await $.fs.write(path, text)
  } catch (err) {
    return 'crew-chief guard: could not write ' + path + ' (' + String(err && err.message ? err.message : err).slice(0, 120) + '); nothing was changed.'
  }
  const loaded = compileConfig(text)
  const env = await $.env.get('CREW_CHIEF_GUARD')
  const envWord = String(env ?? '').trim().toLowerCase()
  st.config = loaded.ok ? loaded.config : st.config
  st.defaults = isDefaultConfig(text)
  st.on = envWord === 'off' ? false : guardOn(env, loaded)
  st.loaded = true
  if (envWord === 'off') st.why = 'CREW_CHIEF_GUARD=off'
  else if (envWord === 'on') st.why = 'CREW_CHIEF_GUARD=on'
  else st.why = enabled ? 'the config file says enabled: true' : 'the config file says enabled: false'
  await guardRegisterTool($)
  const lines = ['crew-chief guard: ' + did + '. The guard is now ' + (st.on ? 'on' : 'off') + ' in this session.']
  if (envWord === 'off' && enabled) lines.push('CREW_CHIEF_GUARD=off is set, so the guard stays off until you unset it.')
  if (envWord === 'on' && !enabled) lines.push('CREW_CHIEF_GUARD=on is set, so the guard stays on until you unset it.')
  return lines.join('\n')
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
    if (word === 'on' || word === 'off') {
      // Only the person's own gesture (Enter at the prompt, or the Remote Control bridge) changes the config:
      // a run started by the model, a plugin, the SDK or another session is refused, like an agent's Write.
      const kind = e.origin && typeof e.origin === 'object' ? e.origin.kind : undefined
      if (kind !== 'composer' && kind !== 'bridge') {
        return { text: 'crew-chief guard: /crew-guard ' + word + ' changes the config, so only you can run it by typing it at the prompt (this run came from ' + String(kind ?? 'an unknown source') + '). Nothing was changed.' }
      }
      return { text: await guardToggle($, word === 'on') }
    }
    return {
      text: guardStatusText({ on: guardState.on, why: guardState.why, config: guardState.config, contacted: guardState.gate.contacted.size, suggestions: guardState.suggestions.length }),
    }
  })
}
