// Command guard for the crew-chief mod (hooks/src/guard.js). Pure functions, no Claude Code API, so
// tests/guard-logic.test.mjs can run them with plain Node. Opt-in: nothing here runs unless the guard is on.
//
//   classify(tool, input, rules)  built-in rules plus the person's own rules -> { level, rule, text } | null
//   compileConfig(text)           ~/.claude/crew-chief-guard.json -> a checked config (bad rules dropped)
//   guardOn(envValue, loaded)     CREW_CHIEF_GUARD=on|off|auto
//   parseRemoteCalls(command)     ssh / scp / sftp / rsync calls in a Bash command (quote-aware, small)
//   remoteVerdict(remote, safe)   is a remote command on the read-only list?
//   sshAssess / gateDecide / gateRecord   the "first contact" gate for production hosts
//
// This is a speed bump, not a security boundary: a regex and a small tokenizer cannot see through
// scripts, variables, ssh config aliases or other tools. The README says so and lists the server-side
// controls that do protect a server.

export const READONLY_AGENTS = ['scanner', 'deep-reader', 'reviewer', 'ui-smoke']
export const MAX_RULES = 100
export const MAX_PATTERN = 300
export const MAX_STATE = 500
// How long an approved first attempt stays approved (confirm rules and the ssh gate), in minutes.
export const DEFAULT_TTL_MIN = 360
export const CLIP = 80
export const LEVELS = ['deny', 'confirm', 'warn']
export const CONFIG_NAME = 'crew-chief-guard.json'

export const BUILTIN_RULES = [
  'guard-config',
  'rm-rf',
  'sql-destructive',
  'git-force-push',
  'git-reset-hard',
  'key-write',
  'key-read',
  'key-access',
  'env-write',
  'env-read',
  'env-stage',
  'env-access',
  'ssh-db',
  'sql-no-where',
  'prod-deploy',
  'service-control',
]

const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
const SAFE_RM_TARGET = /^(\.\/)?[A-Za-z0-9_][\w.\-/]*$/
const BUILD_DIRS = /^(\.\/)?(node_modules|build|dist|\.dart_tool|\.next|__pycache__|coverage|\.cache)(\/.*)?$/
// Generic private key names only; a .pub next to it is a public key and stays allowed.
const KEY_FILE = /(\.pem|\.p12|\.pfx|id_rsa(?!\.pub)|id_ed25519(?!\.pub))/i
const ENV_FILE = /(^|\/)\.env(\.|$)/

export function clipText(text, n = CLIP) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function rmVerdict(cmd) {
  const m = /\brm\s+((?:-\S+\s+)+)([^;&|\n]*)/.exec(cmd)
  if (!m) return null
  const flags = m[1]
  if (!/-[a-zA-Z]*r|--recursive/.test(flags) || !/-[a-zA-Z]*f|--force/.test(flags)) return null
  const targets = m[2].trim().split(/\s+/).filter(Boolean)
  if (targets.length > 0 && targets.every((t) => BUILD_DIRS.test(t) || /^\/(tmp|private\/tmp)\//.test(t))) return null
  // Only wiping the whole disk or home is a hard block; a risky target asks once; the rest is a warning.
  const catastrophic = targets.filter((t) => /^["']?(\/|\/\*|~|~\/|~\/\*|\$HOME|\$HOME\/|\$HOME\/\*|\*)["']?$/.test(t))
  if (catastrophic.length > 0) return { level: 'deny', rule: 'rm-rf', text: `rm -rf on ${catastrophic.join(' ')} (root, home or bare wildcard)` }
  const risky = targets.filter((t) => !/^\/(tmp|private\/tmp)\//.test(t) && (!SAFE_RM_TARGET.test(t) || t.includes('..')) && !BUILD_DIRS.test(t))
  if (risky.length > 0) return { level: 'confirm', rule: 'rm-rf', text: `rm -rf on ${risky.join(' ')} (absolute, home, parent, hidden or wildcard path)` }
  return { level: 'warn', rule: 'rm-rf', text: 'rm -rf inside the project' }
}

function fileOf(input) {
  if (typeof input.file_path === 'string') return input.file_path
  if (typeof input.notebook_path === 'string') return input.notebook_path
  return ''
}

// Every built-in match, in a fixed order (the first deny, else the first warning, is reported).
function builtinMatches(tool, input) {
  const out = []
  const cmd = typeof input.command === 'string' ? input.command : ''
  const file = fileOf(input)
  if (FILE_TOOLS.includes(tool)) {
    if (isConfigPath(file)) out.push({ level: 'deny', rule: 'guard-config', text: CONFIG_TEXT })
    if (KEY_FILE.test(file)) out.push({ level: 'confirm', rule: 'key-write', text: `write to a private key file (${file})` })
    if (ENV_FILE.test(file)) out.push({ level: 'warn', rule: 'env-write', text: `edit of ${file}` })
    return out
  }
  if (tool === 'Read') {
    if (KEY_FILE.test(file)) out.push({ level: 'confirm', rule: 'key-read', text: `read of a private key file (${file})` })
    if (ENV_FILE.test(file)) out.push({ level: 'warn', rule: 'env-read', text: `read of ${file}` })
    return out
  }
  if (tool !== 'Bash' || !cmd) return out
  if (writesConfig(cmd)) out.push({ level: 'deny', rule: 'guard-config', text: CONFIG_TEXT })
  const rm = rmVerdict(cmd)
  if (rm?.level === 'deny') out.push(rm)
  if (/\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW)\b|\bTRUNCATE\b/i.test(cmd)) out.push({ level: 'confirm', rule: 'sql-destructive', text: 'DROP or TRUNCATE statement' })
  if (/\bgit\s+push\b[^;&|\n]*(--force\b|--force-with-lease\b|\s-f\b)/.test(cmd)) out.push({ level: 'confirm', rule: 'git-force-push', text: 'git push --force' })
  if (/\bgit\s+reset\s+--hard\b/.test(cmd)) out.push({ level: 'confirm', rule: 'git-reset-hard', text: 'git reset --hard' })
  if (KEY_FILE.test(cmd) && /\b(cat|less|more|head|tail|cp|mv|scp|rsync|base64|xxd|curl|git\s+add|git\s+commit\s+-a)\b/.test(cmd)) {
    out.push({ level: 'confirm', rule: 'key-access', text: 'command reads, copies or stages a private key file' })
  }
  if (/\bgit\s+add\b[^;&|\n]*(\.env\b|\s-A\b|\s\.\s*$)/.test(cmd) && /\.env/.test(cmd)) out.push({ level: 'warn', rule: 'env-stage', text: 'git add of a .env file: it holds secrets, check it is not going into the repo' })
  if (rm !== null && rm.level !== 'deny') out.push(rm)
  if (/\bssh\b/.test(cmd) && /\b(mysql|mariadb|psql|sqlcmd|sqlite3|mongosh|redis-cli)\b|\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO|ALTER\s+TABLE)\b/i.test(cmd)) {
    out.push({ level: 'confirm', rule: 'ssh-db', text: 'database command over ssh: confirm the target server, and that a backup exists' })
  }
  if (/\b(DELETE\s+FROM\s+\S+|UPDATE\s+\S+\s+SET\b)(?![^;]*\bWHERE\b)/i.test(cmd)) out.push({ level: 'confirm', rule: 'sql-no-where', text: 'DELETE/UPDATE without WHERE' })
  if (/\b(netlify\s+deploy\b[^;&|\n]*--prod|vercel\b[^;&|\n]*--prod|firebase\s+deploy|fly(ctl)?\s+deploy|wrangler\s+(deploy|publish)|npm\s+run\s+\S*deploy\S*)\b|(^|[\s;&|/])\.?\/?[\w./-]*deploy[\w.-]*\.(sh|py|js|ps1|bat)\b/.test(cmd)) {
    out.push({ level: 'confirm', rule: 'prod-deploy', text: 'deploy command: confirm the target environment' })
  }
  if (/\b(pm2\s+(restart|stop|delete|reload)|docker\s+compose\s+(down|rm|stop)|docker\s+(rm|stop|kill)\b|systemctl\s+(stop|restart|disable))\b/.test(cmd)) {
    out.push({ level: 'confirm', rule: 'service-control', text: 'stops, restarts or disables a service' })
  }
  if (/\b(cat|less|head|tail|grep|cp|scp)\b[^;&|\n]*(^|[\s/])\.env\b/.test(cmd)) out.push({ level: 'warn', rule: 'env-access', text: 'access to a .env file' })
  return out
}

function userMatches(tool, input, rules) {
  const out = []
  for (const r of rules) {
    if (!r.tools.includes('*') && !r.tools.includes(tool)) continue
    const value = r.target === 'file_path' ? fileOf(input) : typeof input.command === 'string' ? input.command : ''
    if (!value || !r.re.test(value)) continue
    if (r.unless && r.unless.test(value)) continue
    out.push({ level: r.level, rule: r.id, text: r.text, user: true })
  }
  return out
}

export const NO_RULES = { rules: [], disabled: new Set() }

// The verdict for one tool call: deny beats confirm beats warn; at the same level the person's rules come
// first. The guard's own config protection cannot be disabled.
export function classify(tool, input, cfg = NO_RULES) {
  if (!input || typeof input !== 'object') return null
  const disabled = cfg.disabled ?? new Set()
  const user = userMatches(tool, input, cfg.rules ?? [])
  const builtin = builtinMatches(tool, input).filter((v) => v.rule === 'guard-config' || !disabled.has(v.rule))
  const all = [...user, ...builtin]
  const v = all.find((x) => x.level === 'deny') ?? all.find((x) => x.level === 'confirm') ?? all.find((x) => x.level === 'warn')
  return v ? { level: v.level, rule: v.rule, text: v.text } : null
}

// ---- the guard's own config -------------------------------------------------------------------------

export const CONFIG_TEXT = "the guard configuration can only be changed by the user; propose the change with crew_guard_suggest"

export function isConfigPath(p) {
  return typeof p === 'string' && /(^|[\\/])crew-chief-guard\.json$/i.test(p.trim())
}

const mentionsConfig = (s) => typeof s === 'string' && /crew-chief-guard\.json/i.test(s)
const CONFIG_EDITORS = ['rm', 'unlink', 'shred', 'truncate', 'tee', 'chmod', 'chown', 'touch', 'ed', 'ex', 'vi', 'vim', 'nano', 'emacs']
const CONFIG_COPIERS = ['cp', 'install', 'rsync', 'ln', 'scp', 'ditto']
const INTERPRETERS = ['python', 'python3', 'node', 'perl', 'ruby', 'deno', 'bun', 'php']

// True when a Bash command changes the guard's config file. Reading it (cat, jq, grep, cp FROM it) passes.
export function writesConfig(command, depth = 0) {
  if (!mentionsConfig(command) || depth > 3) return false
  const { tokens } = tokenize(command)
  for (const seg of segments(tokens)) {
    if (seg.redirs.some((r) => /^(>|>>|>\||&>|&>>)$/.test(r.op) && r.target && (mentionsConfig(r.target.v) || r.target.dyn))) {
      if (seg.redirs.some((r) => r.target && mentionsConfig(r.target.v)) || mentionsConfig(seg.words.map((w) => w.v).join(' '))) return true
    }
    const words = stripWrappers(seg.words)
    if (words.length === 0) continue
    const name = base(words[0])
    const args = words.slice(1).map((w) => w.v)
    const any = args.some(mentionsConfig)
    if (SHELLS.includes(name) && args.length > 1 && /^-[a-z]*c/.test(args[0]) && writesConfig(args[1], depth + 1)) return true
    if (!any) continue
    if (CONFIG_EDITORS.includes(name) || name === 'mv') return true
    if (CONFIG_COPIERS.includes(name) && mentionsConfig(args[args.length - 1])) return true
    if (name === 'sed' && args.some((a) => /^(-[a-zA-Z]*i|--in-place)/.test(a))) return true
    if (name === 'perl' && args.some((a) => /^-[a-zA-Z]*i/.test(a))) return true
    if (name === 'dd' && args.some((a) => /^of=/.test(a) && mentionsConfig(a))) return true
    if (INTERPRETERS.includes(name.replace(/[\d.]+$/, '')) || INTERPRETERS.includes(name)) {
      if (args.some((a) => /^-[a-zA-Z]*[ec]$/.test(a) || a === '--eval')) return true
    }
    if (name === 'git' && /^(checkout|restore|apply|stash)$/.test(args.find((a) => !a.startsWith('-')) ?? '')) return true
  }
  return false
}

// ---- config -------------------------------------------------------------------------------------

function safeRegex(source, flags, problems, where) {
  if (typeof source !== 'string' || source.length === 0) {
    problems.push(`${where}: pattern missing`)
    return undefined
  }
  if (source.length > MAX_PATTERN) {
    problems.push(`${where}: pattern longer than ${MAX_PATTERN} characters`)
    return undefined
  }
  const f = typeof flags === 'string' ? [...new Set(flags.replace(/[gy]/g, ''))].join('') : ''
  if (!/^[imsu]*$/.test(f)) {
    problems.push(`${where}: flags may only use i, m, s, u`)
    return undefined
  }
  try {
    return new RegExp(source, f)
  } catch (err) {
    problems.push(`${where}: invalid regex`)
    return undefined
  }
}

function compileRule(raw, i, problems) {
  const where = `rules[${i}]`
  if (!raw || typeof raw !== 'object') return problems.push(`${where}: not an object`), undefined
  const id = typeof raw.id === 'string' && /^[\w.:-]{1,60}$/.test(raw.id) ? raw.id : undefined
  if (!id) return problems.push(`${where}: id missing or not [A-Za-z0-9_.:-]{1,60}`), undefined
  if (!LEVELS.includes(raw.level)) return problems.push(`${where} (${id}): level must be deny, confirm or warn`), undefined
  const tools = Array.isArray(raw.tools) ? raw.tools.filter((t) => typeof t === 'string' && t.length > 0) : []
  if (tools.length === 0) return problems.push(`${where} (${id}): tools must list at least one tool`), undefined
  const target = raw.target === undefined ? 'command' : raw.target
  if (target !== 'command' && target !== 'file_path') return problems.push(`${where} (${id}): target must be command or file_path`), undefined
  const re = safeRegex(raw.pattern, raw.flags, problems, `${where} (${id})`)
  if (!re) return undefined
  let unless
  if (raw.unless !== undefined) {
    unless = safeRegex(raw.unless, raw.flags, problems, `${where} (${id}) unless`)
    if (!unless) return undefined
  }
  const text = typeof raw.text === 'string' && raw.text.trim() ? raw.text.trim().slice(0, 300) : `matched your rule ${id}`
  return { id, level: raw.level, tools, target, re, unless, text }
}

function globToRegex(glob) {
  const body = glob
    .toLowerCase()
    .split('*')
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp('^' + body + '$')
}

function compileSsh(raw, problems, ttlMs = DEFAULT_TTL_MIN * 60_000) {
  const ssh = { mode: 'off', prodHosts: [], safeRemote: [], ttlMs }
  if (raw === undefined) return ssh
  if (!raw || typeof raw !== 'object') return problems.push('ssh: not an object'), ssh
  if (raw.mode !== undefined) {
    if (['off', 'warn', 'gate'].includes(raw.mode)) ssh.mode = raw.mode
    else problems.push('ssh.mode: must be off, warn or gate')
  }
  for (const h of Array.isArray(raw.prodHosts) ? raw.prodHosts.slice(0, MAX_RULES) : []) {
    if (typeof h !== 'string' || !h.trim() || h.length > MAX_PATTERN || /\s/.test(h.trim())) {
      problems.push('ssh.prodHosts: skipped an entry that is not a host name')
      continue
    }
    const host = h.trim()
    ssh.prodHosts.push({ hasUser: host.includes('@'), re: globToRegex(host) })
  }
  const safe = Array.isArray(raw.safeRemote) ? raw.safeRemote.slice(0, MAX_RULES) : []
  safe.forEach((p, i) => {
    const re = typeof p === 'string' ? safeRegex(`^(?:${p})$`, '', problems, `ssh.safeRemote[${i}]`) : undefined
    if (typeof p === 'string' && p.length > MAX_PATTERN) return
    if (re) ssh.safeRemote.push(re)
    else if (typeof p !== 'string') problems.push(`ssh.safeRemote[${i}]: not a string`)
  })
  if (raw.ttlMinutes !== undefined) {
    const n = Number(raw.ttlMinutes)
    if (Number.isFinite(n) && n >= 1 && n <= 1440) ssh.ttlMs = Math.round(n) * 60_000
    else problems.push('ssh.ttlMinutes: must be a number from 1 to 1440')
  }
  return ssh
}

// The config file's text -> { ok: true, config } with a list of what was dropped, or { ok: false, error }
// when it is not a JSON object at all (then the guard stays off and the person is told once).
export function compileConfig(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: 'not valid JSON' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not a JSON object' }
  const problems = []
  const list = Array.isArray(raw.rules) ? raw.rules : []
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) problems.push('rules: not a list')
  if (list.length > MAX_RULES) problems.push(`rules: only the first ${MAX_RULES} are used`)
  const rules = []
  const ids = new Set()
  list.slice(0, MAX_RULES).forEach((r, i) => {
    const rule = compileRule(r, i, problems)
    if (!rule) return
    if (ids.has(rule.id)) problems.push(`rules[${i}] (${rule.id}): id used twice (both kept)`)
    ids.add(rule.id)
    rules.push(rule)
  })
  const disabled = new Set()
  for (const id of Array.isArray(raw.disable) ? raw.disable : []) {
    if (BUILTIN_RULES.includes(id)) disabled.add(id)
    else problems.push(`disable: ${String(id).slice(0, 40)} is not a built-in rule`)
  }
  let confirmTtlMs = DEFAULT_TTL_MIN * 60_000
  if (raw.confirmTtlMinutes !== undefined) {
    const n = Number(raw.confirmTtlMinutes)
    if (Number.isFinite(n) && n >= 1 && n <= 1440) confirmTtlMs = Math.round(n) * 60_000
    else problems.push('confirmTtlMinutes: must be a number from 1 to 1440')
  }
  const ssh = compileSsh(raw.ssh, problems, confirmTtlMs)
  return { ok: true, config: { enabled: raw.enabled === true, rules, disabled, confirmTtlMs, ssh }, problems }
}

// CREW_CHIEF_GUARD: off beats everything; on turns the guard on even without a config file (built-in
// rules only, ssh gate off); auto (the default, also any other value) = on when the file says enabled: true.
export function guardOn(envValue, loaded) {
  const v = String(envValue ?? '').trim().toLowerCase()
  if (v === 'off') return false
  if (loaded && loaded.ok === false) return false
  if (v === 'on') return true
  return Boolean(loaded && loaded.ok && loaded.config.enabled)
}

export function configPath(home) {
  if (typeof home !== 'string' || !home) return undefined
  const sep = /^[A-Za-z]:\\/.test(home) || (home.includes('\\') && !home.includes('/')) ? '\\' : '/'
  return home.replace(/[\\/]+$/, '') + sep + '.claude' + sep + 'crew-chief-guard.json'
}

// ---- a small shell tokenizer ----------------------------------------------------------------------

// Words keep their unquoted value and say whether the LOCAL shell would expand something in them
// (`dyn`: $VAR, $(...), backticks outside single quotes). Operators split segments; redirections are
// kept with their target. Heredocs, process substitution and unbalanced quotes are flagged.
export function tokenize(s) {
  const tokens = []
  const flags = { heredoc: false, subst: false, unbalanced: false }
  let cur = null
  const word = () => (cur ??= { t: 'word', v: '', dyn: false, quoted: false })
  const push = () => {
    if (cur) tokens.push(cur)
    cur = null
  }
  let i = 0
  const n = s.length
  while (i < n) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\r') {
      push()
      i++
    } else if (c === '\n' || c === ';') {
      push()
      tokens.push({ t: 'op', v: ';' })
      i += c === ';' && s[i + 1] === ';' ? 2 : 1
    } else if (c === '#' && cur === null) {
      while (i < n && s[i] !== '\n') i++
    } else if (c === '&' && s[i + 1] === '>') {
      push()
      const app = s[i + 2] === '>'
      tokens.push({ t: 'redir', v: app ? '&>>' : '&>' })
      i += app ? 3 : 2
    } else if (c === '&' || c === '|') {
      push()
      const two = s[i + 1] === c || (c === '|' && s[i + 1] === '&')
      tokens.push({ t: 'op', v: two ? c + s[i + 1] : c })
      i += two ? 2 : 1
    } else if (c === '(' || c === ')') {
      push()
      tokens.push({ t: 'op', v: c })
      i++
    } else if (c === '<' || c === '>') {
      // A bare number right before it is the file descriptor (2>), not a word.
      if (cur && !cur.quoted && /^\d+$/.test(cur.v)) cur = null
      else push()
      let op = c
      i++
      if (s[i] === '(') {
        flags.subst = true
        op += '('
        i++
      } else if (c === '<' && s[i] === '<') {
        op += '<'
        i++
        if (s[i] === '<') {
          op += '<'
          i++
        } else flags.heredoc = true
        if (s[i] === '-') i++
      } else if (s[i] === '>' || s[i] === '&' || s[i] === '|') {
        op += s[i]
        i++
      }
      tokens.push({ t: 'redir', v: op })
    } else if (c === "'") {
      const end = s.indexOf("'", i + 1)
      const w = word()
      w.quoted = true
      if (end < 0) {
        flags.unbalanced = true
        w.v += s.slice(i + 1)
        i = n
      } else {
        w.v += s.slice(i + 1, end)
        i = end + 1
      }
    } else if (c === '"') {
      const w = word()
      w.quoted = true
      i++
      let closed = false
      while (i < n) {
        const d = s[i]
        if (d === '\\' && i + 1 < n && '"\\$`\n'.includes(s[i + 1])) {
          if (s[i + 1] !== '\n') w.v += s[i + 1]
          i += 2
        } else if (d === '"') {
          closed = true
          i++
          break
        } else {
          if (d === '$' || d === '`') {
            w.dyn = true
            if (d === '`' || s[i + 1] === '(') flags.subst = true
          }
          w.v += d
          i++
        }
      }
      if (!closed) flags.unbalanced = true
    } else if (c === '\\') {
      if (i + 1 < n && s[i + 1] !== '\n') word().v += s[i + 1]
      i += 2
    } else {
      const w = word()
      if (c === '$' || c === '`') {
        w.dyn = true
        if (c === '`' || s[i + 1] === '(') flags.subst = true
      }
      w.v += c
      i++
    }
  }
  push()
  return { tokens, flags }
}

// Splits the tokens on ; && || | & ( ) into segments of { words, redirs }.
export function segments(tokens) {
  const out = []
  let seg = { words: [], redirs: [] }
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]
    if (tk.t === 'op') {
      if (seg.words.length || seg.redirs.length) out.push(seg)
      seg = { words: [], redirs: [] }
    } else if (tk.t === 'redir') {
      const target = tokens[i + 1] && tokens[i + 1].t === 'word' ? tokens[++i] : undefined
      seg.redirs.push({ op: tk.v, target })
    } else seg.words.push(tk)
  }
  if (seg.words.length || seg.redirs.length) out.push(seg)
  return out
}

const base = (w) => (w ? w.v.replace(/^.*\//, '') : '')
const SUDO_ARG = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '--user', '--group', '--host', '--prompt', '--chdir'])

// Drops env assignments and wrappers (sudo, rtk, env, time, nohup, timeout N, command, exec, sshpass,
// the `do`/`then` of a loop) so the real program is first.
export function stripWrappers(words) {
  let w = words.slice()
  for (let guard = 0; guard < 20 && w.length > 0; guard++) {
    const first = w[0]
    const name = base(first)
    if (!first.quoted && /^[A-Za-z_]\w*=/.test(first.v)) {
      w = w.slice(1)
    } else if (['rtk', 'nohup', 'command', 'exec', 'builtin', 'do', 'then', 'else', '{', '!', 'nice', 'stdbuf'].includes(first.v) || name === 'nohup') {
      w = w.slice(1)
      if (first.v === 'nice' || first.v === 'stdbuf') while (w.length && w[0].v.startsWith('-')) w = w.slice(w[0].v === '-n' ? 2 : 1)
    } else if (name === 'time') {
      w = w.slice(1)
      while (w.length && /^-[pv]$/.test(w[0].v)) w = w.slice(1)
    } else if (name === 'sudo' || name === 'doas') {
      w = w.slice(1)
      while (w.length && w[0].v.startsWith('-')) {
        const opt = w[0].v
        w = w.slice(opt === '--' ? 1 : SUDO_ARG.has(opt) ? 2 : 1)
        if (opt === '--') break
      }
    } else if (name === 'env') {
      w = w.slice(1)
      while (w.length && (w[0].v.startsWith('-') || /^[A-Za-z_]\w*=/.test(w[0].v))) w = w.slice(w[0].v === '-u' || w[0].v === '-C' ? 2 : 1)
    } else if (name === 'timeout') {
      w = w.slice(1)
      while (w.length && w[0].v.startsWith('-')) w = w.slice(w[0].v === '-s' || w[0].v === '-k' ? 2 : 1)
      w = w.slice(1) // the duration
    } else if (name === 'sshpass') {
      w = w.slice(1)
      while (w.length && w[0].v.startsWith('-')) w = w.slice(/^-[pfdP]$/.test(w[0].v) ? 2 : 1)
    } else break
  }
  return w
}

const SSH_TOOLS = ['ssh', 'autossh', 'scp', 'sftp', 'rsync']
const SSH_ARG = new Set('BbcDEeFIiJLlmOopQRSWw'.split(''))
const SCP_ARG = new Set('cDFiJlOoPSX'.split(''))
const SFTP_ARG = new Set('BbcDFiJlOoPRSs'.split(''))
const RSYNC_LONG_ARG = new Set([
  '--rsh', '--rsync-path', '--filter', '--exclude', '--include', '--files-from', '--exclude-from', '--include-from', '--log-file',
  '--password-file', '--temp-dir', '--partial-dir', '--backup-dir', '--suffix', '--chmod', '--chown', '--compare-dest', '--link-dest',
  '--copy-dest', '--bwlimit', '--timeout', '--contimeout', '--port', '--max-size', '--min-size', '--info', '--debug', '--out-format', '--usermap', '--groupmap',
])
const DANGEROUS_SSH_OPTION = /^(proxycommand|localcommand|remotecommand|permitlocalcommand|knownhostscommand|match)$/i

function splitHost(spec) {
  // ssh://user@host:port, user@host, host:port is not ssh syntax (only in the URL form)
  let s = spec
  let url = false
  if (/^ssh:\/\//i.test(s)) {
    s = s.slice(6).replace(/\/.*$/, '')
    url = true
  }
  let user
  const at = s.lastIndexOf('@')
  if (at >= 0) {
    user = s.slice(0, at)
    s = s.slice(at + 1)
  }
  if (url) s = s.replace(/:\d+$/, '')
  s = s.replace(/^\[(.*)\]$/, '$1')
  return { user, host: s.toLowerCase() }
}

function jumpHosts(value) {
  return String(value)
    .split(',')
    .filter((j) => j && j.toLowerCase() !== 'none')
    .map((j) => splitHost(j.replace(/:\d+$/, '')).host)
}

function parseSsh(words, tool) {
  const call = { tool: 'ssh', user: undefined, host: undefined, jumps: [], hostnames: [], remote: undefined, unknown: undefined }
  let i = 1
  const option = (ch, arg) => {
    if (arg === undefined) return
    if (arg.dyn) call.unknown ??= 'a variable or command substitution in an ssh option'
    const v = arg.v
    if (ch === 'l') call.user = v
    else if (ch === 'J') call.jumps.push(...jumpHosts(v))
    else if (ch === 'F') call.unknown ??= 'a custom ssh config file (-F)'
    else if (ch === 'o') {
      const m = /^\s*(\w+)\s*[= ]\s*(.*)$/.exec(v)
      if (!m) return
      const key = m[1]
      if (DANGEROUS_SSH_OPTION.test(key)) call.unknown ??= `the ssh option ${key} runs or hides commands`
      else if (/^user$/i.test(key)) call.user = m[2]
      else if (/^hostname$/i.test(key)) call.hostnames.push(m[2].toLowerCase())
      else if (/^proxyjump$/i.test(key)) call.jumps.push(...jumpHosts(m[2]))
    }
  }
  const argSet = tool === 'autossh' ? new Set([...SSH_ARG, 'M']) : SSH_ARG
  for (; i < words.length; i++) {
    const w = words[i]
    if (w.v === '--') {
      i++
      break
    }
    if (!w.v.startsWith('-') || w.v.length < 2) break
    for (let j = 1; j < w.v.length; j++) {
      const ch = w.v[j]
      if (argSet.has(ch)) {
        const rest = w.v.slice(j + 1)
        option(ch, rest ? { v: rest, dyn: w.dyn } : words[++i])
        break
      }
    }
  }
  const hostWord = words[i]
  if (!hostWord) return undefined // `ssh -V` and friends: no connection
  if (hostWord.dyn) {
    call.unknown = 'the host is a variable'
    return call
  }
  const h = splitHost(hostWord.v)
  call.host = h.host
  call.user = h.user ?? call.user
  const rest = words.slice(i + 1)
  if (rest.some((w) => w.dyn)) call.unknown ??= 'a local variable or command substitution in the remote command'
  call.remote = rest.length ? rest.map((w) => w.v).join(' ') : null
  return call
}

const REMOTE_OPERAND = /^(?:([^@/:\s]+)@)?(\[[^\]]+\]|[^/:@\s]+):(?!:)/

function parseCopy(words, tool) {
  const argSet = tool === 'sftp' ? SFTP_ARG : SCP_ARG
  const operands = []
  const calls = []
  let unknown
  let jumps = []
  let user
  for (let i = 1; i < words.length; i++) {
    const w = words[i]
    if (w.v.startsWith('-') && w.v.length > 1) {
      for (let j = 1; j < w.v.length; j++) {
        if (argSet.has(w.v[j])) {
          const rest = w.v.slice(j + 1)
          const arg = rest ? { v: rest, dyn: w.dyn } : words[++i]
          if (arg && arg.dyn) unknown ??= 'a variable in an option'
          if (arg && w.v[j] === 'J') jumps = jumpHosts(arg.v)
          if (arg && w.v[j] === 'S') unknown ??= 'a custom transport program (-S)'
          if (arg && w.v[j] === 'F') unknown ??= 'a custom ssh config file (-F)'
          if (arg && w.v[j] === 'l' && tool === 'sftp') user = arg.v
          if (arg && w.v[j] === 'o' && DANGEROUS_SSH_OPTION.test((/^\s*(\w+)/.exec(arg.v) || [])[1] || '')) unknown ??= 'an ssh option that runs or hides commands'
          break
        }
      }
      continue
    }
    operands.push(w)
  }
  operands.forEach((w, idx) => {
    if (w.dyn) {
      calls.push({ tool, unknown: 'a variable in a file operand', host: undefined, jumps, hostnames: [] })
      return
    }
    let spec = w.v
    if (/^(scp|sftp):\/\//i.test(spec)) spec = spec.replace(/^(scp|sftp):\/\//i, '').replace(/(:\d+)?(\/.*)?$/, '') + ':'
    if (tool === 'sftp' && idx === 0 && !REMOTE_OPERAND.test(spec)) spec += ':'
    const m = REMOTE_OPERAND.exec(spec)
    if (!m) return
    calls.push({ tool, user: m[1] ?? user, host: m[2].replace(/^\[(.*)\]$/, '$1').toLowerCase(), jumps, hostnames: [], unknown, upload: idx === operands.length - 1 && tool === 'scp' })
  })
  return calls
}

function parseRsync(words) {
  const operands = []
  let unknown
  let sshUser
  for (let i = 1; i < words.length; i++) {
    const w = words[i]
    if (w.v === '--') {
      operands.push(...words.slice(i + 1))
      break
    }
    if (w.v.startsWith('--')) {
      const eq = w.v.indexOf('=')
      const name = eq >= 0 ? w.v.slice(0, eq) : w.v
      let value
      if (eq >= 0) value = { v: w.v.slice(eq + 1), dyn: w.dyn }
      else if (RSYNC_LONG_ARG.has(name)) value = words[++i]
      if (name === '--rsh' && value) {
        if (value.dyn || /proxycommand|localcommand/i.test(value.v)) unknown ??= 'a remote shell (-e) that cannot be checked'
        const lu = /\s-l\s+(\S+)/.exec(' ' + value.v)
        if (lu) sshUser = lu[1]
      }
      if (name === '--rsync-path') unknown ??= 'a custom remote rsync command (--rsync-path)'
      continue
    }
    if (w.v.startsWith('-') && w.v.length > 1) {
      const e = w.v.indexOf('e', 1)
      if (e > 0) {
        const rest = w.v.slice(e + 1)
        const value = rest ? { v: rest, dyn: w.dyn } : words[++i]
        if (value && (value.dyn || /proxycommand|localcommand/i.test(value.v))) unknown ??= 'a remote shell (-e) that cannot be checked'
        const lu = value && /\s-l\s+(\S+)/.exec(' ' + value.v)
        if (lu) sshUser = lu[1]
      }
      continue
    }
    operands.push(w)
  }
  const calls = []
  operands.forEach((w, idx) => {
    if (w.dyn) {
      calls.push({ tool: 'rsync', unknown: 'a variable in a file operand', host: undefined, jumps: [], hostnames: [] })
      return
    }
    if (/^rsync:\/\//i.test(w.v)) return // the rsync daemon, not ssh
    const m = REMOTE_OPERAND.exec(w.v)
    if (!m) return
    calls.push({ tool: 'rsync', user: m[1] ?? sshUser, host: m[2].replace(/^\[(.*)\]$/, '$1').toLowerCase(), jumps: [], hostnames: [], unknown, upload: idx === operands.length - 1 })
  })
  return calls
}

const SHELLS = ['bash', 'sh', 'zsh', 'dash', 'ksh']
const RUNNERS = ['xargs', 'parallel', 'watch', 'eval', 'source', '.']

// Every ssh-family call in a Bash command. A call that cannot be read reliably carries `unknown`.
export function parseRemoteCalls(command, depth = 0) {
  const calls = []
  if (typeof command !== 'string' || !command || depth > 3) return calls
  const { tokens, flags } = tokenize(command)
  for (const seg of segments(tokens)) {
    const words = stripWrappers(seg.words)
    if (words.length === 0) continue
    const name = base(words[0])
    if (SHELLS.includes(name)) {
      const c = words.findIndex((w, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(w.v))
      if (c > 0 && words[c + 1]) {
        const inner = parseRemoteCalls(words[c + 1].v, depth + 1)
        if (words[c + 1].dyn && inner.length) inner.forEach((x) => (x.unknown ??= 'a variable in a shell -c string'))
        calls.push(...inner)
      }
      continue
    }
    if (RUNNERS.includes(name) && words.slice(1).some((w) => SSH_TOOLS.includes(base(w)))) {
      calls.push({ tool: 'ssh', unknown: `ssh run through ${name}`, host: undefined, jumps: [], hostnames: [] })
      continue
    }
    if (!SSH_TOOLS.includes(name)) continue
    let found
    if (name === 'ssh' || name === 'autossh') {
      const c = parseSsh(words, name)
      found = c ? [c] : []
      // ssh reads its stdin as the remote script when the command comes from a redirect or heredoc.
      if (c && seg.redirs.some((r) => r.op === '<' || r.op === '<<' || r.op === '<<<')) c.unknown ??= 'the remote script comes from stdin (redirect or heredoc)'
    } else if (name === 'rsync') found = parseRsync(words)
    else found = parseCopy(words, name)
    for (const c of found) {
      if (flags.heredoc) c.unknown ??= 'a heredoc'
      if (flags.subst) c.unknown ??= 'command or process substitution'
      if (flags.unbalanced) c.unknown ??= 'unbalanced quotes'
      calls.push(c)
    }
  }
  return calls
}

// ---- remote commands -----------------------------------------------------------------------------

const SECRET_ARG = /(^|\/)\.env(\.|$)|\.(pem|p12|pfx|key)$|(^|\/)id_(rsa|ed25519|ecdsa|dsa)$|\/etc\/(g?shadow|sudoers)|credentials|(^|\/)secrets?(\.|\/|$)|\.pgpass|\.my\.cnf/i
const PLAIN_READ = ['ls', 'cat', 'tail', 'head', 'grep', 'egrep', 'fgrep', 'zgrep', 'df', 'du', 'free', 'uptime', 'ps', 'whoami', 'stat', 'wc']
const FIND_BAD = /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/
const JOURNAL_BAD = /^--(vacuum|rotate|flush|sync|relinquish-var|smart-relinquish-var|setup-keys|update-catalog)/
const SYSTEMCTL_READ = ['status', 'is-active', 'is-enabled', 'is-failed', 'list-units', 'list-timers', 'show']
const HOSTNAME_FLAGS = /^(-[fsiIdAa]+|--(fqdn|long|short|ip-address|all-ip-addresses|domain|all-fqdns))$/

function firstArg(args) {
  return args.find((a) => !a.startsWith('-'))
}

function readOnlyProgram(words) {
  const name = base(words[0])
  const args = words.slice(1).map((w) => w.v)
  if (args.some((a) => SECRET_ARG.test(a))) return false
  if (PLAIN_READ.includes(name)) return true
  if (name === 'find') return !args.some((a) => FIND_BAD.test(a))
  if (name === 'journalctl') return !args.some((a) => JOURNAL_BAD.test(a))
  if (name === 'systemctl') return SYSTEMCTL_READ.includes(firstArg(args))
  if (name === 'docker') {
    const sub = firstArg(args)
    if (sub === 'compose') return ['ps', 'logs'].includes(firstArg(args.slice(args.indexOf('compose') + 1)))
    return sub === 'ps' || sub === 'logs'
  }
  if (name === 'git') {
    let k = 0
    while (k < args.length && args[k].startsWith('-')) k += args[k] === '-C' ? 2 : 1
    return ['status', 'log', 'diff'].includes(args[k])
  }
  if (name === 'hostname') return args.every((a) => HOSTNAME_FLAGS.test(a))
  if (name === 'date') {
    for (let k = 0; k < args.length; k++) {
      const a = args[k]
      if (a.startsWith('+')) continue
      if (a === '-d' || a === '--date' || a === '-r' || a === '--reference') {
        k++
        continue
      }
      if (/^-(u|R|I\w*)$|^--(utc|universal|rfc-\w+|iso-8601(=\w+)?|date=.*|reference=.*)$/.test(a)) continue
      return false
    }
    return true
  }
  return false
}

const QUIET_REDIR = (r) => ((r.op === '>' || r.op === '>>' || r.op === '&>' || r.op === '&>>') && r.target && r.target.v === '/dev/null') || (r.op === '>&' && r.target && /^\d$/.test(r.target.v)) || r.op === '<'

// 'read' when every part of the remote command is on the read-only list (or matches a safeRemote
// pattern), 'unknown' when it cannot be read reliably, 'risky' otherwise. `why` says which part.
export function remoteVerdict(remote, safeRemote = []) {
  if (remote === null || remote === undefined || !String(remote).trim()) return { kind: 'risky', why: 'an interactive session (no remote command)' }
  const { tokens, flags } = tokenize(String(remote))
  if (flags.heredoc) return { kind: 'unknown', why: 'a heredoc in the remote command' }
  if (flags.subst) return { kind: 'unknown', why: 'command substitution in the remote command' }
  if (flags.unbalanced) return { kind: 'unknown', why: 'unbalanced quotes in the remote command' }
  for (const seg of segments(tokens)) {
    if (seg.words.some((w) => w.dyn)) return { kind: 'unknown', why: 'a variable in the remote command' }
    const text = seg.words.map((w) => w.v).join(' ')
    if (safeRemote.some((re) => re.test(text))) continue
    const bad = seg.redirs.find((r) => !QUIET_REDIR(r))
    if (bad) return { kind: 'risky', why: `an output redirection (${bad.op})` }
    const words = stripWrappers(seg.words)
    if (words.length === 0) continue
    if (safeRemote.some((re) => re.test(words.map((w) => w.v).join(' ')))) continue
    if (!readOnlyProgram(words)) return { kind: 'risky', why: `${clipText(base(words[0]), 30)} is not on the read-only list` }
  }
  return { kind: 'read', why: '' }
}

// ---- the gate ------------------------------------------------------------------------------------

export function hostMatches(prodHosts, user, host) {
  if (!host) return false
  const h = String(host).toLowerCase()
  const full = (user ? String(user).toLowerCase() : '') + '@' + h
  return prodHosts.some((p) => p.re.test(p.hasUser ? full : h))
}

// What a Bash command does to production hosts: one entry per touch, with the remote verdict.
export function sshAssess(command, ssh) {
  if (!ssh || ssh.mode === 'off' || !ssh.prodHosts.length || typeof command !== 'string') return []
  const touches = []
  for (const c of parseRemoteCalls(command)) {
    if (c.host === undefined) {
      touches.push({ host: undefined, tool: c.tool, verdict: { kind: 'unknown', why: c.unknown || 'the host cannot be read' } })
      continue
    }
    const names = [c.host, ...c.hostnames, ...c.jumps]
    if (!names.some((n) => hostMatches(ssh.prodHosts, c.user, n))) continue
    let verdict
    if (c.unknown) verdict = { kind: 'unknown', why: c.unknown }
    else if (c.tool === 'ssh') verdict = remoteVerdict(c.remote, ssh.safeRemote)
    else verdict = { kind: 'risky', why: `a ${c.tool} file transfer${c.upload ? ' to the server' : ''}` }
    touches.push({ host: c.host, tool: c.tool, verdict })
  }
  // A production host named somewhere the parser did not reach (bash -c '...', nested ssh, a loop).
  if (!touches.some((t) => t.host !== undefined) && /(^|[\s'"`;&|(/])(ssh|scp|sftp|rsync|autossh)(?=[\s'"`;&|)]|$)/.test(command)) {
    for (const raw of command.split(/[^\w.@*\-[\]:]+/)) {
      const spec = splitHost(raw.replace(/:.*$/, ''))
      if (spec.host && hostMatches(ssh.prodHosts, spec.user, spec.host)) {
        touches.push({ host: spec.host, tool: 'ssh', verdict: { kind: 'unknown', why: 'the ssh call could not be read (nested or wrapped)' } })
        break
      }
    }
  }
  return touches
}

export function newGateState() {
  return { contacted: new Map(), commands: new Map() }
}

export function normaliseCommand(command) {
  return String(command ?? '').replace(/\s+/g, ' ').trim()
}

const loopKey = (loop) => (loop === undefined || loop === null || loop === '' ? 'main' : String(loop))

// The gate's answer for one call; nothing is recorded here (gateRecord does it once the deny or the
// warning is really returned). action: 'pass' | 'deny' | 'warn'; kind: 'first' | 'risky' | 'readonly'.
export function gateDecide(state, touches, { mode, loop, readOnly, now, ttlMs, command }) {
  if (mode === 'off' || !touches || touches.length === 0) return { action: 'pass' }
  const lk = loopKey(loop)
  const hosts = [...new Set(touches.map((t) => t.host ?? '(unknown host)'))]
  const risky = touches.filter((t) => t.verdict.kind !== 'read')
  const why = risky.length ? risky[0].verdict.why : ''
  const unknown = risky.some((t) => t.verdict.kind === 'unknown')
  if (readOnly) {
    return risky.length ? { action: mode === 'warn' ? 'warn' : 'deny', kind: 'readonly', hosts, why, unknown } : { action: 'pass' }
  }
  const fresh = touches.filter((t) => t.host !== undefined && !state.contacted.has(lk + '\u0000' + t.host)).map((t) => t.host)
  const key = lk + '\u0000' + normaliseCommand(command)
  const at = state.commands.get(key)
  const retry = at !== undefined && now - at <= ttlMs
  const base = { hosts, why, unknown, loop: lk, key, firstHosts: [...new Set(fresh)] }
  if (mode === 'warn') {
    if (fresh.length) return { ...base, action: 'warn', kind: 'first' }
    if (risky.length) return { ...base, action: 'warn', kind: 'risky' }
    return { action: 'pass' }
  }
  if (fresh.length) return { ...base, action: 'deny', kind: 'first' }
  if (risky.length && !retry) return { ...base, action: 'deny', kind: 'risky' }
  return { action: 'pass' }
}

function capMap(map) {
  while (map.size > MAX_STATE) map.delete(map.keys().next().value)
}

export function gateRecord(state, decision, now) {
  if (!decision || decision.action === 'pass' || decision.kind === 'readonly') return
  for (const h of decision.firstHosts ?? []) state.contacted.set(decision.loop + '\u0000' + h, now)
  if (decision.action === 'deny') {
    state.commands.delete(decision.key)
    state.commands.set(decision.key, now)
  }
  capMap(state.contacted)
  capMap(state.commands)
}

// ---- messages for the model (English) -------------------------------------------------------------

export function ruleDenyMessage(v) {
  return `crew-chief guard [${v.rule}] BLOCKED: ${v.text}. Do not retry or work around it. Tell the user what you wanted to do and let them run it themselves or turn the rule off.`
}

export function ruleWarnContext(v) {
  return `crew-chief guard [${v.rule}] WARNING: ${v.text}. Double-check the target before continuing and mention this to the user.`
}

// The checklist a first attempt gets (confirm rules and the ssh gate). The model decides by itself; the
// identical command passes on the next try.
export const CHECKLIST =
  'Do not ask the user and wait; decide yourself in your next message with 5 short lines: (1) what exactly runs and on which machine/environment/database/path, including anything inside quotes, scripts, pipes, redirections; (2) what can be lost or changed (data, a service, config, secrets, customer data); (3) is there a verified backup or a way to undo it, and is a read-only way enough; (4) is the target really the one you think it is; (5) verdict SAFE or RISKY. If SAFE and (3) is satisfied, run exactly the same command again and it will pass. If RISKY or unsure, do not run it: finish with a message telling the user what you wanted to do and why.'

export function checklistMessage(reasons, { loop, unknown } = {}) {
  const why = reasons.filter(Boolean).join('; ')
  const sub = loop && loop !== 'main' ? ' If you cannot decide, stop and report to the caller; do not retry.' : ''
  const limits = unknown ? ' The command could not be fully read, so treat it as risky unless you are sure.' : ''
  return `crew-chief guard: stopped before it ran (first attempt): ${why}. ${CHECKLIST}${sub}${limits} A changed command is a new command.`
}

export function gateReason(d) {
  const hosts = d.hosts.join(', ')
  return d.kind === 'first'
    ? `first contact with the production host ${hosts} in this session`
    : `this command on the production host ${hosts} is not on the read-only list (${d.why})`
}

export function sshDenyMessage(d) {
  const hosts = d.hosts.join(', ')
  if (d.kind === 'readonly') {
    return `crew-chief ssh check BLOCKED: this agent is read-only, and this command on the production host ${hosts} is not on the read-only list (${d.why}). It cannot be retried. Do not work around it (scripts, other syntax, other tools); report to the caller what you needed and why.`
  }
  return checklistMessage([gateReason(d)], d)
}

export function readOnlyDenyMessage(v) {
  return `crew-chief guard [${v.rule}] BLOCKED: this agent is read-only and ${v.text}. It cannot be retried. Report to the caller what you needed and why.`
}

// The key of a call in the shared first-attempt map: the agent loop plus the normalised command (Bash) or
// the tool and path (file tools).
export function callKey(loop, tool, input) {
  const what = tool === 'Bash' ? normaliseCommand(input.command) : `${tool} ${fileOf(input)}`
  return loopKey(loop) + '\u0000' + what
}

export function isFresh(state, key, now, ttlMs) {
  const at = state.commands.get(key)
  return at !== undefined && now - at <= ttlMs
}

export function markCommand(state, key, now) {
  state.commands.delete(key)
  state.commands.set(key, now)
  capMap(state.commands)
}

// ---- suggestions from the agent (crew_guard_suggest) ------------------------------------------------

export const SUGGEST_KINDS = ['host', 'path', 'command', 'secret', 'other']
export const MAX_SUGGESTIONS = 50
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{24,}/g

function hideTokens(s) {
  return s.replace(LONG_TOKEN, '(hidden)')
}

// Adds one suggestion to `list` (mutated). Returns 'added' | 'duplicate' | 'full' | 'invalid'. A secret
// keeps only its label (the part before = or :), never a value.
export function addSuggestion(list, raw) {
  if (!raw || typeof raw !== 'object' || !SUGGEST_KINDS.includes(raw.kind)) return 'invalid'
  let value = typeof raw.value === 'string' ? raw.value.replace(/\s+/g, ' ').trim() : ''
  if (!value) return 'invalid'
  if (raw.kind === 'secret') value = hideTokens(value.split(/[=:]/)[0].trim()).slice(0, 60) || '(secret)'
  else value = hideTokens(value).slice(0, 200)
  const reason = typeof raw.reason === 'string' ? hideTokens(raw.reason.replace(/\s+/g, ' ').trim()).slice(0, 200) : ''
  const id = raw.kind + '\u0000' + value.toLowerCase()
  if (list.some((s) => s.id === id)) return 'duplicate'
  if (list.length >= MAX_SUGGESTIONS) return 'full'
  list.push({ id, kind: raw.kind, value, reason })
  return 'added'
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A ready-to-paste JSON piece for one suggestion, or undefined when there is nothing to paste.
export function suggestionSnippet(s, n) {
  const id = `suggested-${n}`
  if (s.kind === 'host') return JSON.stringify({ ssh: { prodHosts: [s.value] } })
  if (s.kind === 'path' || (s.kind === 'secret' && /[/\\.]/.test(s.value))) {
    return JSON.stringify({ id, level: 'confirm', tools: ['Read', 'Write', 'Edit', 'MultiEdit'], target: 'file_path', pattern: escapeRe(s.value), text: s.reason || `touches ${s.value}` }) +
      ',\n' + JSON.stringify({ id: id + '-cmd', level: 'confirm', tools: ['Bash'], target: 'command', pattern: escapeRe(s.value), text: s.reason || `command touching ${s.value}` })
  }
  if (s.kind === 'command') return JSON.stringify({ id, level: 'confirm', tools: ['Bash'], target: 'command', pattern: escapeRe(s.value), text: s.reason || `runs ${s.value}` })
  return undefined
}

export function suggestionsText(list) {
  if (list.length === 0) return 'crew-chief guard: no suggestions from Claude in this session.'
  const lines = [`crew-chief guard: ${list.length} suggestion(s) from Claude in this session. Nothing was written; paste what you agree with into ~/.claude/${CONFIG_NAME} (hosts into ssh.prodHosts, rules into rules).`]
  list.forEach((s, i) => {
    lines.push('', `${i + 1}. ${s.kind}: ${s.value}${s.reason ? ' (' + s.reason + ')' : ''}`)
    const snip = suggestionSnippet(s, i + 1)
    lines.push(snip === undefined ? '   (no snippet; add a rule by hand if you agree)' : snip)
  })
  return lines.join('\n')
}

// /crew-guard status: info = { on, why, config, contacted, suggestions }
export function guardStatusText(info) {
  const c = info.config
  const lines = [`crew-chief guard: ${info.on ? 'on' : 'off'} (${info.why})`]
  if (c) {
    const count = (lv) => c.rules.filter((r) => r.level === lv).length
    lines.push(`personal rules: ${c.rules.length} (deny ${count('deny')}, confirm ${count('confirm')}, warn ${count('warn')}); built-in rules switched off: ${c.disabled.size}`)
    lines.push(`ssh gate: ${c.ssh.mode}, production host patterns: ${c.ssh.prodHosts.length}, first contacts made this session: ${info.contacted}`)
    lines.push(`approval window for a first attempt: ${Math.round(c.confirmTtlMs / 60_000)} min (ssh: ${Math.round(c.ssh.ttlMs / 60_000)} min)`)
  }
  lines.push(`suggestions from Claude: ${info.suggestions} (/crew-guard suggestions)`)
  return lines.join('\n')
}

export const GUARD_NOTE =
  "The command guard is on. If while working you meet a production host, a critical path, a secret, or a command that looks dangerous and is not covered by the guard, call crew_guard_suggest with a one-line reason (it returns at once; never stop to ask). Never edit the guard's config yourself."

export function sshWarnContext(d) {
  const hosts = d.hosts.join(', ')
  const what = d.kind === 'first' ? `first contact with the production host ${hosts} in this session` : `a command on the production host ${hosts} that is not on the read-only list (${d.why})`
  return `crew-chief ssh check WARNING: ${what}. Before the next remote command, check what it really does on the server: can it lose data, stop or restart a service, change config or expose secrets? Mention this to the user.`
}
