// Which language the mod's messages are in, shared by hooks/register.js and hooks/compact-flow.mjs.
// The state lives here (one set per Claude Code session, put back by resetLang) so both files speak
// the same language. A mod's analyser follows `$` only into function declarations, so these are
// declarations, not injected callbacks.
import { pickLanguage } from './saver-i18n.mjs'

const VOTES_KEPT = 5
const votes = []
let settingPromise
let storedPromise
let storedLang

export function resetLang() {
  settingPromise = undefined
  storedPromise = undefined
  storedLang = undefined
  votes.length = 0
}

// The language of one typed prompt ('tr', 'en'); the last few decide the session's language.
export function addLanguageVote(verdict) {
  votes.push(verdict)
  if (votes.length > VOTES_KEPT) votes.shift()
}

async function loadLanguageSetting($) {
  try {
    const settings = await $.settings.read()
    return typeof settings.language === 'string' ? settings.language : undefined
  } catch (err) {
    // No settings to read: the other signals still decide.
    return undefined
  }
}

async function loadStoredLanguage($) {
  try {
    const value = await $.store.get('lang')
    return value === 'tr' || value === 'en' ? value : undefined
  } catch (err) {
    // No store: the language is simply not remembered.
    return undefined
  }
}

// The language of the messages. Cheap to call: the settings and the stored language are read once
// per session (the promises are kept, so two overlapping calls share one read), and a language
// read off the prompts is remembered (that one word, "tr" or "en") so the next session can ask its
// first question in it, before any prompt has been typed.
export async function resolveLang($) {
  const override = await $.env.get('CREW_CHIEF_LANG')
  const locale = await $.env.get('LANG')
  if (settingPromise === undefined) settingPromise = loadLanguageSetting($)
  if (storedPromise === undefined) storedPromise = loadStoredLanguage($)
  const setting = await settingPromise
  if (storedLang === undefined) storedLang = await storedPromise
  const pick = pickLanguage({ override, setting, votes, stored: storedLang, locale })
  if (pick.source === 'prompts' && pick.lang !== storedLang) {
    storedLang = pick.lang
    try {
      await $.store.set('lang', pick.lang)
    } catch (err) {
      // Not remembered; it is detected again next time.
    }
  }
  return pick.lang
}
