// Messages and language detection for the saver mod (hooks/register.js). Pure functions, no Claude
// Code API, so tests/saver-i18n.test.mjs can run them with plain Node. Languages: English (the
// fallback) and Turkish. Add a language by adding an object to MESSAGES with the same keys; the
// parity test fails until every key and every {placeholder} matches English.

export const MESSAGES = {
  en: {
    win_five_hour: '5-hour',
    win_seven_day: 'weekly',
    unit_d: 'd',
    unit_h: 'h',
    unit_m: 'm',
    unit_lt: '<1m',
    reset_in: ' It resets in {duration}.',
    ask:
      'Your {window} limit is {percent}% used.{reset} Turn on the token saver for this session? (Opus subagents run at medium effort, Sonnet at high at most.)',
    answer_on: 'Turn on saver',
    answer_not_now: 'Not now',
    answer_never: "Don't ask again this session",
    toast_saver_on: 'Saver is on for this session. /saver off switches it off.',
    toast_context: 'Context is {tokens} tokens and every request resends it. /compact mid-task, /clear between tasks.',
    toast_age: 'This session was opened {duration} ago. A fresh one starts lean.',
    toast_cap: 'Saver: {model} subagent effort {from} -> {to}',
    model_heavy: 'Opus',
    model_sonnet: 'Sonnet',
    cmd_description: 'crew-chief token saver: on, off, or status (Opus subagents at medium effort)',
    cmd_on: 'saver on for this session: Opus subagents at medium effort, Sonnet at high at most.',
    cmd_off: 'saver off for this session; it will not ask again until /clear or a new session.',
    cmd_usage: 'usage: /saver [on|off|status]',
    status_on: 'saver ON',
    status_off: 'saver off',
    status_snoozed: ' (questions snoozed for this session)',
    status_resets: ' (resets in {duration})',
    status_no_data: 'no plan limit data (needs a Pro or Max subscription)',
    status_context: 'context {tokens}',
    percent: '{n}%',
    model_opus: 'Opus',
    model_fable: 'Fable',
    model_haiku: 'Haiku',
    advisor_ask_standard:
      "The advisor is off. Turned on, {main} asks {advisor} for advice at hard moments (before choosing an approach, when stuck, before finishing). In Anthropic's own benchmarks Sonnet with an Opus advisor finished tasks about 12% cheaper and slightly better than Sonnet alone, and Haiku gained even more. It is experimental, and each consultation is billed at {advisor} rates. Turn it on? (/advisor off switches it off again.)",
    advisor_ask_second:
      "The advisor is off. Turned on, a second {advisor} reviews {main}'s plan at hard moments: an independent check, most useful for high-stakes work. It costs extra, since each consultation reads the whole conversation again at {advisor} rates, and it is experimental. Turn it on? (/advisor off switches it off again.)",
    advisor_answer_on: 'Turn it on',
    advisor_answer_later: 'Remind me in a week',
    advisor_answer_never: "Don't ask again",
    advisor_toast_on: 'Advisor set to {advisor}. /advisor off switches it off.',
    advisor_toast_failed: 'Could not turn the advisor on from here. Run /advisor yourself to see why or to pick another model.',
  },
  tr: {
    win_five_hour: '5 saatlik',
    win_seven_day: 'haftalık',
    unit_d: 'g',
    unit_h: 'sa',
    unit_m: 'dk',
    unit_lt: '<1dk',
    reset_in: ' {duration} sonra sıfırlanır.',
    ask:
      '{window} limitin %{percent} dolu.{reset} Bu session için token tasarruf modu açılsın mı? (Opus alt ajanları medium, Sonnet en fazla high effort ile çalışır.)',
    answer_on: 'Tasarruf modunu aç',
    answer_not_now: 'Şimdi değil',
    answer_never: "Bu session'da bir daha sorma",
    toast_saver_on: 'Tasarruf modu bu session için açık. Kapatmak için /saver off.',
    toast_context: 'Bağlam {tokens} token oldu ve her istekte baştan gönderiliyor. Görev ortasında /compact, görevler arasında /clear iyi gelir.',
    toast_age: 'Bu session {duration} önce açıldı. Yeni bir session daha hafif başlar.',
    toast_cap: 'Tasarruf: {model} alt ajanı effort {from} -> {to}',
    model_heavy: 'Opus',
    model_sonnet: 'Sonnet',
    cmd_description: 'crew-chief token tasarrufu: on, off veya status (Opus alt ajanları medium effort)',
    cmd_on: 'tasarruf modu bu session için açık: Opus alt ajanları medium, Sonnet en fazla high effort ile çalışır.',
    cmd_off: "tasarruf modu bu session için kapalı; /clear ya da yeni session'a kadar bir daha sormaz.",
    cmd_usage: 'kullanım: /saver [on|off|status]',
    status_on: 'tasarruf modu AÇIK',
    status_off: 'tasarruf modu kapalı',
    status_snoozed: ' (bu session için sorular kapalı)',
    status_resets: ' ({duration} sonra sıfırlanır)',
    status_no_data: 'plan limiti verisi yok (Pro veya Max abonelik gerekir)',
    status_context: 'bağlam {tokens}',
    percent: '%{n}',
    model_opus: 'Opus',
    model_fable: 'Fable',
    model_haiku: 'Haiku',
    advisor_ask_standard:
      "Advisor kapalı. Açıkken {main}, zor anlarda (yaklaşım seçmeden önce, takılınca, bitirmeden önce) {advisor} modeline danışır. Anthropic'in kendi ölçümlerinde Opus advisor'lı Sonnet görevleri tek başına Sonnet'ten yaklaşık %12 daha ucuza ve biraz daha iyi bitirdi, Haiku ise daha da çok kazandı. Deneysel; her danışma {advisor} fiyatından faturalanır. Açılsın mı? (Tekrar kapatmak için /advisor off.)",
    advisor_ask_second:
      'Advisor kapalı. Açıkken ikinci bir {advisor}, zor anlarda {main} modelinin planını gözden geçirir: bağımsız bir kontrol, en çok yüksek riskli işlerde işe yarar. Ek maliyeti var, çünkü her danışmada bütün konuşma {advisor} fiyatından yeniden okunur; ayrıca deneysel. Açılsın mı? (Tekrar kapatmak için /advisor off.)',
    advisor_answer_on: 'Aç',
    advisor_answer_later: 'Bir hafta sonra hatırlat',
    advisor_answer_never: 'Bir daha sorma',
    advisor_toast_on: 'Advisor {advisor} olarak ayarlandı. Kapatmak için /advisor off.',
    advisor_toast_failed: 'Advisor buradan açılamadı. Nedenini görmek ya da başka bir model seçmek için /advisor komutunu kendin çalıştır.',
  },
}

export const LANGUAGES = Object.keys(MESSAGES)

// t('tr', 'toast_context', { tokens: '160k' }). An unknown language or key falls back to English;
// a placeholder with no value is left as written.
export function t(lang, key, vars = {}) {
  const table = MESSAGES[lang] ?? MESSAGES.en
  const template = table[key] ?? MESSAGES.en[key] ?? key
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
}

// 'five_hour' -> "5-hour" / "5 saatlik"; a window kind this plugin does not know is shown as is.
export function windowName(lang, kind) {
  if (kind === 'five_hour') return t(lang, 'win_five_hour')
  if (kind === 'seven_day') return t(lang, 'win_seven_day')
  return String(kind)
}

export function unitsFor(lang) {
  return { d: t(lang, 'unit_d'), h: t(lang, 'unit_h'), m: t(lang, 'unit_m'), lt: t(lang, 'unit_lt') }
}

// ---- language detection -------------------------------------------------------------------

// Letters only Turkish uses (dotless i, g with breve, s with cedilla). o/u with umlaut and c with
// cedilla are shared with German, French and others, so they are not evidence.
const TURKISH_LETTERS = /[ığşİĞŞ]/g

// Only words that are Turkish and nothing else. Short words that other languages also use (mi, ne,
// ve, var, ile, ben, ama, sen ...) are left out on purpose: French, Italian, Spanish and Dutch
// writers must never be read as Turkish. scripts/plugin-notices.sh keeps the same two lists in awk;
// tests/saver-i18n.test.mjs fails when they drift apart.
export const TURKISH_WORDS = new Set([
  'bir', 'bu', 'için', 'evet', 'hayır', 'tamam', 'bana', 'gibi', 'daha', 'çok', 'yap', 'yaz',
  'bakalım', 'nasıl', 'neden', 'şu', 'bunu', 'şunu', 'olsun', 'olur', 'değil', 'lütfen', 'merhaba',
  'selam', 'peki', 'hepsini', 'sonra', 'önce', 'kadar', 'göster', 'ekle', 'sil', 'düzelt', 'devam',
  'başla', 'şimdi', 'zaten', 'çünkü', 'hangi', 'burada', 'yeni', 'eski', 'iyi', 'günler',
  'günaydın', 'teşekkürler', 'sağol',
])

export const ENGLISH_WORDS = new Set([
  'the', 'and', 'is', 'are', 'to', 'of', 'for', 'with', 'that', 'this', 'you', 'can', 'it', 'in',
  'be', 'do', 'not', 'what', 'how', 'please', 'yes', 'fix', 'add', 'run', 'why', 'when', 'where',
  'will', 'would', 'should', 'have', 'has', 'was', 'from', 'my', 'your', 'we', 'me', 'if', 'then',
  'so', 'but', 'or', 'as', 'at', 'by', 'all', 'now', 'just', 'also', 'make', 'use', 'need', 'want',
])

// Drops what is code or log output, not prose: fenced blocks, indented lines, lines with braces,
// semicolons, arrows, "()" or "::", shell prompts, "SomethingError:" lines and stack frames.
// Keywords such as for/in/if/is/not would otherwise count as English.
export function stripCode(text) {
  const out = []
  let fenced = false
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (/^(\s{4,}|\t)/.test(line)) continue
    if (/[{};]|=>|\(\)|::|^\s*\$ |^\s*\w+Error:|\bat\s+\S+\s*\(/.test(line)) continue
    out.push(line)
  }
  return out.join('\n')
}

// 'tr', 'en', or undefined when the text is too short, too mixed, or mostly code to tell. Turkish
// needs a real Turkish word, or three distinctive letters in text with no English word at all (one
// or two letters, or letters among English words, are a name like Ayşe, Barış or Çağrı) and at least as much evidence as English; with two or more Turkish words a tie goes to
// Turkish (a Turkish sentence around a pasted English error message). English needs two common
// English words and more of them than Turkish evidence.
export function classifyText(text) {
  if (typeof text !== 'string' || text.trim() === '' || text.trimStart().startsWith('/')) return undefined
  const sample = stripCode(text.slice(0, 2000))
  const letters = Math.min((sample.match(TURKISH_LETTERS) || []).length, 6)
  let wordsTr = 0
  let wordsEn = 0
  // toLowerCase turns the dotted capital İ into i plus a combining dot; drop the dot.
  for (const word of sample.toLowerCase().replace(/̇/g, '').split(/[^\p{L}]+/u)) {
    if (word === '') continue
    if (TURKISH_WORDS.has(word)) wordsTr += 1
    if (ENGLISH_WORDS.has(word)) wordsEn += 1
  }
  const turkish = wordsTr * 2 + letters
  const turkishLeads = turkish > wordsEn || (wordsTr >= 2 && turkish >= wordsEn)
  if ((wordsTr >= 1 || (letters >= 3 && wordsEn === 0)) && turkish >= 2 && turkishLeads) return 'tr'
  if (wordsEn >= 2 && wordsEn > turkish) return 'en'
  return undefined
}

// The majority of the recent per-prompt verdicts; a tie or an empty list decides nothing.
export function majority(votes) {
  const tr = votes.filter((v) => v === 'tr').length
  const en = votes.filter((v) => v === 'en').length
  if (tr > en) return 'tr'
  if (en > tr) return 'en'
  return undefined
}

// "turkish", "Türkçe", "tr" -> 'tr'; "english", "en" -> 'en'; anything else (a language this plugin
// has no messages for, "turkmen", or garbage) -> undefined, so detection moves on to the next signal.
export function languageFromName(name) {
  if (typeof name !== 'string') return undefined
  const n = name.trim().toLowerCase().replace(/\u0307/g, '')
  if (['tr', 'turkish', 'turkce', 'türkçe'].includes(n)) return 'tr'
  if (['en', 'english', 'ingilizce'].includes(n)) return 'en'
  return undefined
}

// Which language to speak, and which signal decided. Order: CREW_CHIEF_LANG, Claude Code's
// `language` setting, what the person has been writing, what was detected in an earlier session,
// the system locale, English.
export function pickLanguage({ override, setting, votes = [], stored, locale } = {}) {
  const fromOverride = languageFromName(override)
  if (fromOverride) return { lang: fromOverride, source: 'override' }
  const fromSetting = languageFromName(setting)
  if (fromSetting) return { lang: fromSetting, source: 'setting' }
  const fromVotes = majority(votes)
  if (fromVotes) return { lang: fromVotes, source: 'prompts' }
  if (stored === 'tr' || stored === 'en') return { lang: stored, source: 'stored' }
  if (typeof locale === 'string' && /^tr([_.@-]|$)/i.test(locale.trim())) return { lang: 'tr', source: 'locale' }
  return { lang: 'en', source: 'default' }
}
