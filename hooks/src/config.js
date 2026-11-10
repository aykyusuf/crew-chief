// /crew-config: one place to see and change the numbers the mod uses (when the compact flow speaks up, how
// the saver asks, how long a question waits). A value is kept in the plugin's store, so it survives the
// session; the environment variable of the same name, when set, still wins (kept for scripts).
// Nothing is written to settings.json or any project file.
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
      case 'handoff.mode':
        return await $.env.get('CREW_CHIEF_HANDOFF')
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

// The value in force and where it came from: { value, source: 'env' | 'saved' | 'default' }.
export async function cfgState($, key) {
  return resolveSetting(key, await envRaw($, key), await storedRaw($, key))
}

export async function cfgGet($, key) {
  return (await cfgState($, key)).value
}

async function allValues($) {
  const out = {}
  for (const key of SETTING_KEYS) out[key] = (await cfgState($, key)).value
  return out
}

async function listText($) {
  const lines = ['crew-config: the numbers crew-chief uses. Change one with /crew-config set <name> <value>, put one back with /crew-config reset <name> (or all).', '']
  let group = ''
  for (const key of SETTING_KEYS) {
    const def = SETTINGS[key]
    if (def.group !== group) {
      group = def.group
      lines.push(group + ':')
    }
    const st = await cfgState($, key)
    const mark = st.source === 'default' ? '' : st.source === 'env' ? ` [${envName(key)} in the environment wins]` : ' [saved]'
    lines.push(`  ${key} = ${formatSetting(key, st.value)}${mark}  ${def.what}`)
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
    const st = await cfgState($, key)
    const envNote = st.source === 'env' ? ` ${envName(key)} is set in the environment and still wins (${formatSetting(key, st.value)}).` : ''
    const problems = checkSettings(await allValues($))
    return { text: `crew-config: ${key} = ${formatSetting(key, parsed.value)}, saved.${envNote}${problems.length > 0 ? ' Note: ' + problems.join('; ') + '.' : ''}` }
  })
}
