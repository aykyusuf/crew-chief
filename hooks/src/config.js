// /crew-config: one place to see and change the numbers the mod uses (when the compact flow speaks up, how
// the saver asks, how long a question waits). A value is kept in the plugin's store, so it survives the
// session; the environment variable of the same name, when set, still wins (kept for scripts).
// Nothing is written to settings.json. A project can carry its own values in .claude/crew-chief.json (read below the
// environment); the only thing the mod writes there is the compaction question's "don't ask again" (compact.never).
import { perfFileWrite, perfReaderKnown, perfReaderRefresh } from './crew-ui.mjs'
import { SETTINGS, SETTING_KEYS, checkSettings, envName, formatSetting, parseSetting, resolveSetting, storeText } from './config-logic.mjs'

const storeKey = (key) => 'cfg_' + key.replace('.', '_')

// A mod must spell environment variable names as literals in $.env.get, so each one is written out.
async function envRaw($, key) {
  try {
    switch (key) {
      case 'compact.enabled':
        return await $.env.get('CREW_CHIEF_COMPACT')
      case 'compact.arm':
        return await $.env.get('CREW_CHIEF_COMPACT_ARM')
      case 'compact.ask':
        return await $.env.get('CREW_CHIEF_COMPACT_ASK')
      case 'saver.ask':
        return await $.env.get('CREW_CHIEF_SAVER')
      case 'saver.five':
        return await $.env.get('CREW_CHIEF_SAVER_FIVE_HOUR')
      case 'saver.seven':
        return await $.env.get('CREW_CHIEF_SAVER_SEVEN_DAY')
      case 'ask.timeout':
        return await $.env.get('CREW_CHIEF_ASK_TIMEOUT_MIN')
      case 'night.ask':
        return await $.env.get('CREW_CHIEF_NIGHT_ASK_MIN')
      case 'handoff.mode':
        return await $.env.get('CREW_CHIEF_HANDOFF')
      case 'notify.agent':
        return await $.env.get('CREW_CHIEF_NOTIFY_AGENT')
      case 'notify.native':
        return await $.env.get('CREW_CHIEF_NOTIFY_NATIVE')
      case 'notify.min':
        return await $.env.get('CREW_CHIEF_NOTIFY_MIN')
      case 'panel.style':
        return await $.env.get('CREW_CHIEF_PANEL_STYLE')
      case 'panel.click':
        return await $.env.get('CREW_CHIEF_PANEL_CLICK')
      case 'panel.perf':
        return await $.env.get('CREW_CHIEF_PANEL_PERF')
      case 'ui.statusline':
        return await $.env.get('CREW_CHIEF_UI_STATUSLINE')
      default:
        return undefined
    }
  } catch (err) {
    return undefined
  }
}

async function storedRaw($, key) {
  try {
    return await $.store.get(storeKey(key))
  } catch (err) {
    return undefined
  }
}

// ---- the project file: <project root>/.claude/crew-chief.json -----------------------------------------------------
// Per-project values (flat keys: { "compact.ask": "300k", "compact.never": true }). Read for every setting below the
// environment and above /crew-config's saved value; written only for the compaction "don't ask again" answer.
const PROJECT_TTL_MS = 5000
let projectCache = { at: -Infinity, root: undefined, data: undefined }

async function projectPath($) {
  try {
    const root = await $.session.root()
    return typeof root === 'string' && root !== '' ? `${root.replace(/\/+$/, '')}/.claude/crew-chief.json` : undefined
  } catch (err) {
    return undefined
  }
}

export async function projectConfig($) {
  const now = await $.clock.now()
  const path = await projectPath($)
  if (projectCache.root === path && now - projectCache.at < PROJECT_TTL_MS) return projectCache.data
  let data = {}
  if (path) {
    try {
      if (await $.fs.exists(path)) {
        const parsed = JSON.parse(await $.fs.read(path))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed
      }
    } catch (err) {
      data = {}
    }
  }
  projectCache = { at: now, root: path, data }
  return data
}

// Sets (or, with undefined, removes) one key in the project file, keeping the rest. true when written.
export async function projectConfigSet($, key, value) {
  const path = await projectPath($)
  if (!path) return false
  try {
    projectCache.at = -Infinity
    const data = { ...(await projectConfig($)) }
    if (value === undefined) delete data[key]
    else data[key] = value
    await $.fs.write(path, JSON.stringify(data, null, 2) + '\n')
    projectCache = { at: -Infinity, root: undefined, data: undefined }
    return true
  } catch (err) {
    return false
  }
}

// The value in force and where it came from: { value, source: 'env' | 'project' | 'saved' | 'default' }.
export async function cfgState($, key) {
  const project = await projectConfig($)
  return resolveSetting(key, await envRaw($, key), await storedRaw($, key), project ? project[key] : undefined)
}

export async function cfgGet($, key) {
  return (await cfgState($, key)).value
}

// Saves one value as /crew-config set does (for the short forms other commands offer, such as /crew-ui panel).
// { ok: true, value, source } with the value in force afterwards, or { ok: false, error: 'invalid' | 'store' }.
export async function cfgSet($, key, text) {
  const parsed = parseSetting(key, text)
  if (!parsed.ok) return { ok: false, error: 'invalid' }
  try {
    await $.store.set(storeKey(key), storeText(key, parsed.value))
  } catch (err) {
    return { ok: false, error: 'store' }
  }
  const st = await cfgState($, key)
  return { ok: true, value: st.value, source: st.source }
}

async function allValues($) {
  const out = {}
  for (const key of SETTING_KEYS) out[key] = (await cfgState($, key)).value
  return out
}

// panel.perf theme|all with no theme mod reading ~/.claude/perf-mode.json (perfReaderKnown): it works as agents.
function perfNote(key, value) {
  if (key !== 'panel.perf' || perfReaderKnown() || (value !== 'theme' && value !== 'all')) return ''
  return ' (works as agents: no theme mod reads ~/.claude/perf-mode.json, see docs/guide/performance.md)'
}

async function listText($) {
  await perfReaderRefresh($).catch(() => false)
  const lines = ['crew-config: the numbers crew-chief uses. Change one with /crew-config set <name> <value>, put one back with /crew-config reset <name> (or all).', '']
  let group = ''
  for (const key of SETTING_KEYS) {
    const def = SETTINGS[key]
    if (def.group !== group) {
      group = def.group
      lines.push(group + ':')
    }
    const st = await cfgState($, key)
    const mark = st.source === 'default' ? '' : st.source === 'env' ? ` [${envName(key)} in the environment wins]` : st.source === 'project' ? ' [this project: .claude/crew-chief.json]' : ' [saved]'
    lines.push(`  ${key} = ${formatSetting(key, st.value)}${mark}${perfNote(key, st.value)}  ${def.what}`)
  }
  const problems = checkSettings(await allValues($))
  if (problems.length > 0) lines.push('', 'Note: ' + problems.join('; ') + '.')
  return lines.join('\n')
}

export async function configSessionStart($) {
  try {
    await $.command.register({ name: 'crew-config', description: 'Show or change crew-chief\'s thresholds (compact, saver, question deadline)', immediate: true, argumentHint: '[set <name> <value> | reset <name>|all]' })
  } catch (err) {
    // The name is taken, or an older Claude Code: the environment variables still work.
  }
}

export function registerConfig(on) {
  on('command.run', { command: 'crew-config' }, async ($, e) => {
    const words = String(e.args || '').trim().split(/\s+/).filter(Boolean)
    const verb = (words[0] || '').toLowerCase()
    if (verb === '' || verb === 'status' || verb === 'list' || verb === 'show') return { text: await listText($) }
    if (verb === 'reset') {
      const target = (words[1] || '').toLowerCase()
      const keys = target === 'all' ? SETTING_KEYS : SETTING_KEYS.includes(target) ? [target] : []
      if (keys.length === 0) return { text: 'crew-config: reset <name> or reset all. Names: ' + SETTING_KEYS.join(', ') + '.' }
      for (const key of keys) {
        try {
          await $.store.set(storeKey(key), '')
        } catch (err) {
          return { text: 'crew-config: the plugin store is not available here, so nothing can be saved or reset (the environment variables still work).' }
        }
      }
      if (keys.includes('panel.perf')) await perfFileWrite($)
      return { text: `crew-config: ${target === 'all' ? 'every value is' : target + ' is'} back to the default${target === 'all' ? '' : ' (' + formatSetting(target, SETTINGS[target].def) + ')'}.` }
    }
    const rest = verb === 'set' ? words.slice(1) : words
    const key = (rest[0] || '').toLowerCase()
    if (!SETTING_KEYS.includes(key)) return { text: `crew-config: "${rest[0] ?? ''}" is not a setting. Names: ${SETTING_KEYS.join(', ')}. /crew-config shows them with what they do.` }
    const raw = rest.slice(1).join(' ')
    const parsed = parseSetting(key, raw)
    if (!parsed.ok) return { text: `crew-config: "${raw}" is not valid for ${key}: ${SETTINGS[key].what}.` }
    try {
      await $.store.set(storeKey(key), storeText(key, parsed.value))
    } catch (err) {
      return { text: 'crew-config: the plugin store is not available here, so the value cannot be saved (use the environment variable instead).' }
    }
    if (key === 'panel.perf') {
      await perfFileWrite($)
      await perfReaderRefresh($).catch(() => false)
    }
    const st = await cfgState($, key)
    const envNote = (st.source === 'env' ? ` ${envName(key)} is set in the environment and still wins (${formatSetting(key, st.value)}).` : '') + perfNote(key, st.value).replace(/^ \((.*)\)$/, ' It $1.')
    const problems = checkSettings(await allValues($))
    return { text: `crew-config: ${key} = ${formatSetting(key, parsed.value)}, saved.${envNote}${problems.length > 0 ? ' Note: ' + problems.join('; ') + '.' : ''}` }
  })
}
