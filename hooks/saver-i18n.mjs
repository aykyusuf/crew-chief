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
    toast_age: 'This session was opened {duration} ago. A fresh one starts lean.',
    ck_ask:
      'Context is {tokens} tokens.{phase}{state} Compact now? Claude first updates STATUS.md and tasks.json (when they exist), then the conversation is compacted with a detailed brief so nothing important is lost.',
    ck_phase: ' Claude reports a phase boundary: {phase}.',
    ck_state: ' Now: {parts}.',
    ck_state_agents: 'subagents running: {n}',
    ck_state_waiting: 'waiting on background work or approval: {n}',
    ck_state_shells: 'background processes: {n} ({list})',
    ck_state_dirty: 'uncommitted files: {n}',
    ck_wait_agents: 'Subagents are still running. Ask again when they have finished.',
    ck_agents_still: 'subagents were still running after 3 minutes',
    ck_yes: 'Yes, compact',
    ck_later: 'Not now',
    ck_never: "Don't ask again this session",
    ck_gate_ask: 'STATUS.md / tasks.json have not changed since you approved. What now?',
    ck_gate_anyway: 'Compact anyway',
    ck_gate_retry: 'Ask Claude to update first',
    ck_gate_cancel: 'Cancel',
    toast_compact_done: 'Compacted. Raw summary saved: {path}',
    toast_compact_done_plain: 'Compacted.',
    toast_compact_missing: '{n} pinned note(s) or open task(s) were missing from the summary; they are put back from the project files.',
    toast_compact_failed: 'Compaction did not run: {reason}',
    toast_transcript_lost: 'The transcript lost lines in the last compaction; later compactions keep a copy first.',
    cmd_compact_description: 'crew-chief: propose a compaction now (updates the handoff files first)',
    cmd_compact_ok: 'ok, I will ask when this turn ends.',
    cmd_compact_busy: 'a compaction is already being arranged.',
    cmd_compact_off: 'the compact flow is off (CREW_CHIEF_COMPACT=off).',
    reset_toast: 'Your {window} limit has reset.',
    limit_ask: 'Your {window} limit stopped Claude. It resets in {duration}. Send "continue" to Claude automatically when it resets? (Only if you have not typed anything by then.)',
    limit_yes: 'Yes, continue at reset',
    limit_no: 'No',
    limit_never: "Don't ask again this session",
    limit_continue_toast: 'Your {window} limit reset; asked Claude to continue.',
    ask_expired_toast: 'No answer for {min} min: treated as "{answer}".',
    row_jq_hint: "crew-chief: jq is not installed, so the agent panel below the prompt cannot show each subagent's model and effort (the line above the prompt still does). To get it: {install}. Shown once.",
    guard_toast_deny: 'crew-chief guard blocked: {text}',
    guard_toast_ssh: 'crew-chief ssh check held a command for {host}, Claude is asked to check it first: {cmd}',
    guard_toast_readonly: 'crew-chief ssh check blocked a read-only agent on {host}: {cmd}',
    guard_notice: 'crew-chief guard warning: {text}',
    guard_toast_confirm: 'Guard stopped a first attempt ({text}); Claude checks it and may retry: {cmd}',
    guard_toast_suggest: 'Guard: Claude flagged something not in your config, see /crew-guard',
    cmd_guard_description: 'Command guard: status, what Claude flagged (suggestions), on or off',
    guard_toast_autosetup: 'crew-chief: command guard is on (default rules). Status: /crew-guard status. Off: /crew-guard off.',
    guard_toast_invalid: 'crew-chief guard: {path} is not valid JSON, so the guard is off this session.',
    tidy_description: 'crew-chief: audit what fills your context (oversized, stale, repeated); "archive" moves old PROGRESS.md entries',
    tidy_head: 'Context audit (nothing was changed):',
    tidy_none: 'Nothing oversized, stale or repeated found in the files Claude loaded.',
    tidy_file_long: '{path}: {lines} lines (the target is under 200). Move rarely needed parts to path-scoped rules or a skill.',
    tidy_memory_long: '{path}: {lines} lines / {kb} KB. Only the first 200 lines or 25 KB are loaded; the rest is dropped silently.',
    tidy_memory_missing: '{path}: {n} entries point to files that do not exist: {list}.',
    tidy_paths_missing: '{path}: mentions {n} path(s) that do not exist here: {list}.',
    tidy_dupes: '{n} line(s) appear in more than one loaded file, for example: "{sample}".',
    tidy_status_big: '{path}: {kb} KB, read at every session start. Move old failed attempts to an archive.',
    tidy_progress_old: '{path}: {n} entries older than {days} days. /crew-tidy archive moves them to an archive file (it asks first).',
    tidy_mcp: 'MCP server {server}: {count} tools, about {tokens} tokens ({loaded} loaded now). Disable it if you are not using it.',
    tidy_categories: 'Largest parts of the context (estimate): {list}',
    tidy_skills: 'Skill listing: {n} skills, about {tokens} tokens.',
    tidy_global: 'Your global files were only looked at, never changed: {list}',
    tidy_archive_nofile: 'No PROGRESS.md (or ilerleme.md) found next to the project\'s STATUS.md.',
    tidy_archive_none: 'No entry older than {days} days (or none with a clear date). Nothing to move.',
    tidy_archive_ask: 'Move {n} entries older than {days} days from {path} to {archive}? Nothing is deleted.',
    tidy_archive_yes: 'Move them',
    tidy_archive_no: 'Cancel',
    tidy_archive_cancelled: 'Cancelled. Nothing was changed.',
    tidy_archive_failed: 'Could not archive: {reason}. Nothing was lost.',
    tidy_archive_changed: 'The file changed while the question was open. Nothing was moved; run /crew-tidy archive again.',
    tidy_archive_done: 'Moved {n} entries to {archive}. Nothing was deleted.',
    cmd_report_description: 'crew-chief: tokens and cost by model and by main/subagent in this session',
    role_main: 'main',
    role_subagent: 'subagent',
    report_title: 'This session by role and model:',
    report_none: 'No requests recorded in this session yet.',
    report_row: '{role} · {model}: {requests} requests · in {input} · cache read {cacheRead} · cache write {cacheWrite} · out {output} · about {usd}',
    report_total: 'Session cost so far: {usd} (as /cost totals it).',
    report_share: 'Subagents wrote {sub}% of the output tokens; {cheaper}% came from Sonnet or Haiku.',
    report_note: 'Tokens are exact. Dollars are approximate: Claude Code gives one session total, so each request is credited with what the total grew by since the previous one ended.',
    cache_cold: 'The prompt cache has probably gone cold ({idle} idle). This message re-reads about {tokens} tokens at the full price.',
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
    toast_age: 'Bu session {duration} önce açıldı. Yeni bir session daha hafif başlar.',
    ck_ask:
      'Bağlam {tokens} token.{phase}{state} Şimdi compact edelim mi? Önce Claude STATUS.md ve tasks.json dosyalarını (varsa) günceller, sonra konuşma, önemli hiçbir şey kaybolmasın diye ayrıntılı bir talimatla compact edilir.',
    ck_phase: ' Claude bir faz sonu bildirdi: {phase}.',
    ck_state: ' Şu an: {parts}.',
    ck_state_agents: 'çalışan alt ajan: {n}',
    ck_state_waiting: 'arka plan işini ya da onayı bekleyen: {n}',
    ck_state_shells: 'arka plan süreci: {n} ({list})',
    ck_state_dirty: 'commit’lenmemiş dosya: {n}',
    ck_wait_agents: 'Alt ajanlar hâlâ çalışıyor. Bitince tekrar sor.',
    ck_agents_still: 'alt ajanlar 3 dakika sonra hâlâ çalışıyordu',
    ck_yes: 'Evet, compact et',
    ck_later: 'Şimdi değil',
    ck_never: "Bu session'da bir daha sorma",
    ck_gate_ask: 'Onayından beri STATUS.md / tasks.json değişmedi. Ne yapalım?',
    ck_gate_anyway: 'Yine de compact et',
    ck_gate_retry: 'Önce Claude güncellesin',
    ck_gate_cancel: 'Vazgeç',
    toast_compact_done: 'Compact tamam. Ham özet yedeği: {path}',
    toast_compact_done_plain: 'Compact tamam.',
    toast_compact_missing: 'Özette {n} sabit not/açık görev yoktu; proje dosyalarından geri yüklendi.',
    toast_compact_failed: 'Compact çalışmadı: {reason}',
    toast_transcript_lost: 'Son compact transcript satırlarını kaybettirdi; sonraki compact’lar önce kopya alacak.',
    cmd_compact_description: 'crew-chief: şimdi compact öner (önce handoff dosyalarını günceller)',
    cmd_compact_ok: 'tamam, bu turn bitince soracağım.',
    cmd_compact_busy: 'bir compact zaten hazırlanıyor.',
    cmd_compact_off: 'compact akışı kapalı (CREW_CHIEF_COMPACT=off).',
    reset_toast: '{window} limitin sıfırlandı.',
    limit_ask: '{window} limitin Claude’u durdurdu. {duration} sonra sıfırlanır. Sıfırlanınca Claude’a otomatik "devam et" gönderilsin mi? (O arada sen bir şey yazmadıysan.)',
    limit_yes: 'Evet, reset olunca devam ettir',
    limit_no: 'Hayır',
    limit_never: "Bu session'da bir daha sorma",
    limit_continue_toast: '{window} limitin sıfırlandı; Claude’dan devam etmesini istedim.',
    ask_expired_toast: 'Soru {min} dk cevapsız kaldı, "{answer}" seçilmiş sayıldı.',
    row_jq_hint: "crew-chief: jq kurulu değil, bu yüzden prompt'un altındaki ajan paneli her alt ajanın modelini ve eforunu gösteremiyor (prompt'un üstündeki satır gösteriyor). Görmek için: {install}. Bir kez gösterilir.",
    guard_toast_deny: 'crew-chief koruması engelledi: {text}',
    guard_toast_ssh: 'crew-chief ssh kontrolü {host} için bir komutu durdurdu, Claude önce komutu incelemeli: {cmd}',
    guard_toast_readonly: 'crew-chief ssh kontrolü salt-okunur bir ajanı {host} üzerinde engelledi: {cmd}',
    guard_notice: 'crew-chief koruma uyarısı: {text}',
    guard_toast_confirm: 'Koruma ilk denemeyi durdurdu ({text}); Claude kontrol edip tekrar deneyebilir: {cmd}',
    guard_toast_suggest: 'Koruma: Claude ayarında olmayan bir şeyi işaretledi, bkz. /crew-guard',
    cmd_guard_description: 'Komut koruması: durum, Claude\'un işaretledikleri (suggestions), on ya da off',
    guard_toast_autosetup: 'crew-chief: komut koruması açık (varsayılan kurallar). Durum: /crew-guard status. Kapatmak için: /crew-guard off.',
    guard_toast_invalid: 'crew-chief koruması: {path} geçerli bir JSON değil, koruma bu oturumda kapalı.',
    tidy_description: 'crew-chief: context’i dolduranları denetle (şişkin, bayat, tekrarlı); "archive" eski PROGRESS.md girdilerini taşır',
    tidy_head: 'Context denetimi (hiçbir şey değiştirilmedi):',
    tidy_none: 'Claude’un yüklediği dosyalarda şişkin, bayat ya da tekrarlı bir şey bulunmadı.',
    tidy_file_long: '{path}: {lines} satır (hedef 200’ün altı). Nadir gereken kısımları yola özel kurallara ya da bir skill’e taşı.',
    tidy_memory_long: '{path}: {lines} satır / {kb} KB. Yalnızca ilk 200 satır ya da 25 KB yüklenir, kalanı sessizce düşer.',
    tidy_memory_missing: '{path}: {n} girdi olmayan dosyalara işaret ediyor: {list}.',
    tidy_paths_missing: '{path}: burada olmayan {n} yoldan söz ediyor: {list}.',
    tidy_dupes: '{n} satır birden fazla yüklü dosyada geçiyor, örneğin: "{sample}".',
    tidy_status_big: '{path}: {kb} KB, her session başında okunuyor. Eski başarısız denemeleri bir arşive taşı.',
    tidy_progress_old: '{path}: {days} günden eski {n} girdi var. /crew-tidy archive bunları arşiv dosyasına taşır (önce sorar).',
    tidy_mcp: 'MCP sunucusu {server}: {count} araç, yaklaşık {tokens} token (şu an {loaded} tanesi yüklü). Kullanmıyorsan kapat.',
    tidy_categories: 'Context’in en büyük parçaları (tahmin): {list}',
    tidy_skills: 'Skill listesi: {n} skill, yaklaşık {tokens} token.',
    tidy_global: 'Global dosyalarına sadece bakıldı, hiçbiri değiştirilmedi: {list}',
    tidy_archive_nofile: 'Projenin STATUS.md dosyasının yanında PROGRESS.md (ya da ilerleme.md) bulunamadı.',
    tidy_archive_none: '{days} günden eski (ya da tarihi net olan) girdi yok. Taşınacak bir şey yok.',
    tidy_archive_ask: '{path} dosyasındaki {days} günden eski {n} girdi {archive} dosyasına taşınsın mı? Hiçbir şey silinmez.',
    tidy_archive_yes: 'Taşı',
    tidy_archive_no: 'Vazgeç',
    tidy_archive_cancelled: 'Vazgeçildi. Hiçbir şey değişmedi.',
    tidy_archive_failed: 'Arşivlenemedi: {reason}. Hiçbir şey kaybolmadı.',
    tidy_archive_changed: 'Soru açıkken dosya değişti. Hiçbir şey taşınmadı; /crew-tidy archive komutunu yeniden çalıştır.',
    tidy_archive_done: '{n} girdi {archive} dosyasına taşındı. Hiçbir şey silinmedi.',
    cmd_report_description: 'crew-chief: bu session’da model ve ana/alt ajan bazında token ve maliyet',
    role_main: 'ana',
    role_subagent: 'alt ajan',
    report_title: 'Bu session, rol ve model bazında:',
    report_none: 'Bu session’da henüz kayıtlı istek yok.',
    report_row: '{role} · {model}: {requests} istek · girdi {input} · cache okuma {cacheRead} · cache yazma {cacheWrite} · çıktı {output} · yaklaşık {usd}',
    report_total: 'Şu ana kadarki session maliyeti: {usd} (/cost’un topladığı gibi).',
    report_share: 'Çıktı token’larının %{sub}’i alt ajanlardan, %{cheaper}’i Sonnet ya da Haiku’dan geldi.',
    report_note: 'Token sayıları kesin. Dolar tutarları yaklaşık: Claude Code tek bir session toplamı veriyor, bu yüzden her isteğe önceki istek bittiğinden beri toplamın artışı yazılıyor.',
    cache_cold: 'Prompt cache büyük ihtimalle soğudu ({idle} boşta kaldı). Bu mesaj yaklaşık {tokens} token’ı tam fiyattan yeniden okuyacak.',
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
