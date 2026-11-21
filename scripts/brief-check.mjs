#!/usr/bin/env node
// crew-chief brief checker (ONERILER-26 item 10d). Node 22, no dependencies, never touches the network or any file but the one it reads.
//
// Usage: node brief-check.mjs <file | -> [--kind research|agent] [--json]
//
// Checks a brief for an agent (or a research agent) for the parts every brief needs:
//   stop-rule     a sentence that says when to stop ("stop as soon as the question is answered")
//   verification  how the result is checked or refuted
//   output-path   where the result is written (a path or "the reports folder")
//   cost-limit    a SCOPE limit: an agent count, a call or search count, or a bounded scope; never a token number
// With --kind research it also warns (does not fail) when these are missing: objective, output-format,
// assumption-to-verify, sources-guidance.
// Errors: a token-budget number in the brief ("50k tokens"). The model adjusts its spend to a shown number, so a brief states a
// scope and a stop rule instead. Warning: an absolute "never" line that names no case, reason or "ask first".
//
// Output (text): `brief-check: ok` or `brief-check: FAIL`, then `missing: a, b`, then one `  part: suggested sentence` line per
// missing part, then `error: ...` and `warn: ...` lines. With --json one object:
// { ok, kind, missing: [{part, suggestion}], errors: [{rule, line, text, suggestion}], warnings: [{rule, line?, text?, suggestion}] }.
// Exit 1 when a required part is missing or an error is found, 0 otherwise (warnings never fail), 2 on a usage or read error.
// Limits: keyword checks in English and Turkish; they see words, not meaning. A path named only as an input still satisfies
// output-path if no other wording does, so read the suggestion lines, not just the exit code.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const NUM = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)'
const COUNT_NOUN = '(agents?|sub-?agents?|searches|search|fetch(?:es)?|calls?|tool calls?|pages?|files?|directories|folders?|sources?|queries|turns|rounds|ajan(?:lar)?|arama(?:lar)?|çağrı(?:lar)?|sayfa|dosya|dizin|klasör|kaynak|sorgu|tur)'

// Token budget: a number next to "tokens", "token budget of N", or "budget N" with a k or m suffix (a bare "budget of 20" is not
// taken for tokens: it is usually a count).
const TOKEN_BUDGET_RES = [
  /\b\d[\d.,]*\s*[kKmM]?\s*[- ]?tokens?\b/i,
  /\btokens?\s*(budget|limit|cap)?\s*(of|is|:|=|at)?\s*~?\d[\d.,]*\s*[kKmM]?\b/i,
  /\b(budget|bütçe\w*)\s*(of|is|:|=|at)?\s*~?\$?\d[\d.,]*\s*[kKmM]\b/i,
  /\bbütçe\w*[^.\n]{0,24}\d[\d.,]*\s*[kKmM]?\s*token/i,
]
export function findTokenBudget(line) {
  for (const re of TOKEN_BUDGET_RES) {
    const m = re.exec(line)
    if (m) return m[0].trim()
  }
  return null
}

const ABSOLUTE_RE = /\b(never|asla)\b|hiçbir zaman|kesinlikle/i
const SCOPE_RE = /\b(unless|except|before|without asking|ask|because|so that|if)\b|onay|izin|ancak|dışında|çünkü|önce/i
export function isUnscopedAbsolute(line) {
  return ABSOLUTE_RE.test(line) && !SCOPE_RE.test(line)
}

const STOP = new RegExp(
  '\\bstop(s|ping)?\\s+(when|once|after|as soon as|if|at|by|here)\\b|\\bstop rule\\b|\\bstopping rule\\b|\\bstop\\b[^.\\n]{0,40}\\b(answered|enough|done|reached|limit)\\b|' +
    '\\b(enough|sufficient)\\b[^.\\n]{0,40}\\bstop\\b|yeterli\\w*[^.\\n]{0,30}\\bdur\\b|\\bdur\\b[^.\\n]{0,20}\\b(yeterli|cevap|bulun)|durma kuralı|\\bdurun\\b|\\bdurdur\\b|cevaplan\\w*[^.\\n]{0,20}\\bdur\\b',
  'i',
)
const VERIFY = /verif|refut|falsif|independent|cross-?check|double-?check|counter-?evidence|doğrula|çürüt|bağımsız|çapraz kontrol/i
const OUTPUT_KEYWORD = /reports folder|crew-chief-reports|output path|output file|write (it |the \w+ |your \w+ |results? |report |result |file |json )?(to|into|in|under)\b|save (it |the \w+ )?(to|in|into|as)\b|çıktı yolu|çıktı dosyası|rapor klasör|\byaz(ın|ınız|ıp)?\b[^.\n]{0,60}(klasör|dosya|yol)/i
const PATH_TOKEN = /[\w}>\-.]+\/[\w${}<>.\-/]*\.[A-Za-z0-9]{1,5}\b/
const SCOPE_AT_MOST = new RegExp(
  '\\b(at most|up to|no more than|not more than|maximum|max|limit(?:ed)? to|capped at|cap of|en fazla|en çok|azami|şundan fazla değil)\\b[^.\\n]{0,24}?\\b' + NUM + '\\b\\s*(\\w+\\s+){0,2}' + COUNT_NOUN,
  'i',
)
const SCOPE_COUNT_FIRST = new RegExp('\\b' + NUM + '\\s+(\\w+\\s+){0,1}' + COUNT_NOUN + '\\s*(at most|max|or fewer|or less|tops|limit|ile sınırlı|ile sınır|en fazla)', 'i')
const SCOPE_BOUNDED = /\b(only|just|yalnızca|sadece)\s+(in|under|inside|within|the|bu|şu)?\s*(directory|folder|file|module|dizin|klasör|dosya|modül)\b|\b(one|single|a single|tek)\s+(directory|folder|file|module|page|dizin|klasör|dosya|modül|sayfa)\b|\b(scope|kapsam) (limit|is|sınır)/i
export function hasScopeLimit(text) {
  return SCOPE_AT_MOST.test(text) || SCOPE_COUNT_FIRST.test(text) || SCOPE_BOUNDED.test(text)
}

const OBJECTIVE = /\b(objective|goal|question|purpose|find out|determine|investigate|establish)\b|amaç|hedef|soru\b|araştır/i
const OUTPUT_FORMAT = /\b(json|schema|output contract|output format|format|table|markdown|bullet|fields?|columns?)\b|çıktı biçim|biçim\b/i
const ASSUMPTION = /\b(assumption|hypothesis|to verify|to refute|to disprove|to test)\b|varsayım|hipotez|doğrulanacak|çürütülecek/i
const SOURCES = /\b(official|primary sources?|primary pages?|vendor|authoritative|reputable|first-?party|avoid (blogs?|seo)|prefer\b[^.\n]{0,40}(docs|documentation|sources?|pages?))\b|resmi|birincil|güvenilir kaynak/i

const SUGGEST = {
  'stop-rule': 'Add a sentence such as: "Stop as soon as the question is answered; more sources for an answered question are waste."',
  verification: 'Add how the result is checked, such as: "Every claim carries a URL and a verbatim quote so it can be verified independently; say what would refute it."',
  'output-path': 'Add where the result goes, such as: "Write the result to <path> in the crew-chief reports folder and return only the path and a short summary."',
  'cost-limit': 'Add a scope limit, never a token number, such as: "Use at most 12 searches and fetches" or "at most 3 agents" or "read only the src directory".',
  objective: 'Open with the one question or goal in one sentence.',
  'output-format': 'Name the output format, such as: "Return JSON with claims, each with claim, url, accessed, quote, stance."',
  'assumption-to-verify': 'State the assumption to verify or refute, and say the researcher does not have to confirm it.',
  'sources-guidance': 'Say which sources to prefer, such as: "Prefer official and primary pages over blogs and SEO pages."',
}
const TOKEN_SUGGEST = 'Remove the number and state the scope and a stop rule instead (for example "at most 12 searches; stop when answered").'
const NEVER_SUGGEST = 'Name the case and the reason, or say "ask before X".'

export function checkBrief(text, { kind = 'agent' } = {}) {
  const t = String(text)
  const lines = t.split('\n')
  const ok = {
    'stop-rule': STOP.test(t),
    verification: VERIFY.test(t),
    'output-path': OUTPUT_KEYWORD.test(t) || PATH_TOKEN.test(t),
    'cost-limit': hasScopeLimit(t),
  }
  const missing = Object.entries(ok)
    .filter(([, v]) => !v)
    .map(([part]) => ({ part, suggestion: SUGGEST[part] }))
  const errors = []
  const warnings = []
  lines.forEach((line, i) => {
    const hit = findTokenBudget(line)
    if (hit) errors.push({ rule: 'token-budget', line: i + 1, text: hit, suggestion: TOKEN_SUGGEST })
    if (isUnscopedAbsolute(line)) warnings.push({ rule: 'absolute-never', line: i + 1, text: line.trim().slice(0, 120), suggestion: NEVER_SUGGEST })
  })
  if (kind === 'research') {
    const checks = { objective: OBJECTIVE, 'output-format': OUTPUT_FORMAT, 'assumption-to-verify': ASSUMPTION, 'sources-guidance': SOURCES }
    for (const [rule, re] of Object.entries(checks)) if (!re.test(t)) warnings.push({ rule, suggestion: SUGGEST[rule] })
  }
  return { ok: missing.length === 0 && errors.length === 0, kind, missing, errors, warnings }
}

export function formatResult(r) {
  const out = [`brief-check: ${r.ok ? 'ok' : 'FAIL'}`]
  if (r.missing.length) {
    out.push('missing: ' + r.missing.map((m) => m.part).join(', '))
    for (const m of r.missing) out.push(`  ${m.part}: ${m.suggestion}`)
  }
  for (const e of r.errors) out.push(`error: ${e.rule}: line ${e.line}: "${e.text}" -> ${e.suggestion}`)
  for (const w of r.warnings) out.push(`warn: ${w.rule}:${w.line ? ' line ' + w.line + ':' : ''}${w.text ? ' "' + w.text + '"' : ''} -> ${w.suggestion}`)
  return out.join('\n')
}

function main(argv) {
  let file
  let kind = 'agent'
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--kind') kind = argv[++i]
    else if (a.startsWith('--kind=')) kind = a.slice(7)
    else if (a.startsWith('--') && a !== '-') {
      console.error(`brief-check: unknown option ${a}`)
      return 2
    } else if (file === undefined) file = a
    else {
      console.error('brief-check: one file only')
      return 2
    }
  }
  if (file === undefined || !['research', 'agent'].includes(kind)) {
    console.error('usage: node brief-check.mjs <file | -> [--kind research|agent] [--json]')
    return 2
  }
  let text
  try {
    text = readFileSync(file === '-' ? 0 : file, 'utf8')
  } catch (e) {
    console.error(`brief-check: cannot read ${file}: ${e.code || e.message}`)
    return 2
  }
  const r = checkBrief(text, { kind })
  console.log(json ? JSON.stringify(r, null, 2) : formatResult(r))
  return r.ok ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2))
