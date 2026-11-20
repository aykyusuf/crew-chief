// The handoff setup offer the mod asks at a fresh session start (hooks/src/handoff-offer.js). Pure functions,
// no Claude Code API, so tests/handoff-offer-logic.test.mjs can run them with plain Node.
//
// The same rules and the same record file as scripts/session-policy.sh (handoff_offer): handoff-offers.tsv
// holds one line per answer, `root TAB installed`, `root TAB never` or `root TAB later TAB unix-time`, and
// the last line for a root wins. A marker file (mod-offer-active, a unix time) tells the shell that the mod
// is asking, so the shell's text line stays quiet for 14 days.

export const OFFERS_FILE = 'handoff-offers.tsv'
export const MARKER_FILE = 'mod-offer-active'
export const LATER_SECONDS = 7 * 24 * 3600
export const MARKER_SECONDS = 14 * 24 * 3600

// The names the shell looks for at the root and one level below (any of them means handoff exists).
export const HANDOFF_FILE_NAMES = ['tasks.json', 'STATUS.md', 'PROGRESS.md', 'HANDOFF.md', 'claude-progress.txt', 'feature_list.json', 'durum.md', 'ilerleme.md']

// Folders in the home directory that are not projects (only used when there is no git repository to say so).
const NOT_PROJECT_HOME_DIRS = ['Desktop', 'Documents', 'Downloads', 'Library', 'Movies', 'Music', 'Pictures', 'Public']

const TMP_ROOTS = ['/tmp', '/private/tmp', '/private/var/folders', '/var/folders']

function trimSlashes(path) {
  const clean = String(path ?? '').replace(/\/+$/, '')
  return clean === '' && String(path ?? '').startsWith('/') ? '/' : clean
}

// True when no offer belongs here: no usable folder, the home directory, the file system root, a temp
// folder, or a path with a quote in it (the commands the skill prints would break).
export function skipRoot(root, home) {
  if (typeof root !== 'string' || root === '' || root.includes("'")) return true
  const r = trimSlashes(root)
  if (r === '/' || (typeof home === 'string' && home !== '' && r === trimSlashes(home))) return true
  return TMP_ROOTS.some((tmp) => r === tmp || r.startsWith(tmp + '/'))
}

// A folder without git that is still a place to work in: not skipped as a root, not one of the home
// directory's own plain folders (Desktop, Documents, ...), and not empty. `names` are its entries.
export function isProjectFolder(cwd, home, names) {
  if (skipRoot(cwd, home)) return false
  if (typeof home === 'string' && home !== '') {
    const h = trimSlashes(home)
    const c = trimSlashes(cwd)
    if (NOT_PROJECT_HOME_DIRS.some((d) => c === `${h}/${d}`)) return false
  }
  return Array.isArray(names) && names.some((n) => n !== '.DS_Store' && n !== 'Thumbs.db')
}

// Does one name (a file at the root, or in a folder one level down) count as a handoff file?
export function isHandoffName(name) {
  return HANDOFF_FILE_NAMES.includes(name)
}

// Folders one level below the root that the shell's `"$root"/*/name` glob reaches (no hidden ones).
export function subdirsToSearch(entries, cap = 200) {
  return (Array.isArray(entries) ? entries : [])
    .filter((e) => e && e.kind === 'dir' && typeof e.name === 'string' && !e.name.startsWith('.'))
    .map((e) => e.name)
    .slice(0, cap)
}

export function hasHandoffBlock(claudeMd) {
  return typeof claudeMd === 'string' && claudeMd.includes('crew-chief:handoff')
}

// The last record for a root: { answer, when } (when in unix seconds, undefined when it has none), or undefined.
export function lastRecord(tsv, root) {
  if (typeof tsv !== 'string' || typeof root !== 'string') return undefined
  let found
  for (const raw of tsv.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const fields = line.split('\t')
    if (fields[0] !== root) continue
    const when = /^\d+$/.test(fields[2] ?? '') ? Number(fields[2]) : undefined
    found = { answer: fields[1] ?? '', when }
  }
  return found
}

// Whether the record silences the offer: installed, never, or a later younger than 7 days.
export function recordSilences(record, nowSec) {
  if (record === undefined) return false
  if (record.answer === 'installed' || record.answer === 'never') return true
  if (record.answer === 'later' && record.when !== undefined && Number.isFinite(nowSec)) return nowSec - record.when < LATER_SECONDS
  return false
}

// The line the shell writes for an answer ('later' carries the time).
export function recordLine(root, answer, nowSec) {
  return answer === 'later' ? `${root}\tlater\t${nowSec}\n` : `${root}\t${answer}\n`
}

// The tsv text after one more line (a file that does not end in a newline gets one first).
export function appendRecord(existing, line) {
  const text = typeof existing === 'string' ? existing : ''
  return text === '' || text.endsWith('\n') ? text + line : text + '\n' + line
}

export function markerFresh(text, nowSec) {
  const v = String(text ?? '').trim()
  return /^\d+$/.test(v) && Number.isFinite(nowSec) && nowSec - Number(v) < MARKER_SECONDS
}

// ---- the plugin's data folder ------------------------------------------------------------------------

// The folder Claude Code gives the shell as CLAUDE_PLUGIN_DATA: ~/.claude/plugins/data/<name>-<marketplace>
// (a plugin loaded with --plugin-dir or CLAUDE_CODE_PLUGIN_DIRS has the marketplace 'inline').
// Order: the environment variable if the mod's process has it; the folder derived from the plugin's cache
// path; the folder for an inline plugin. undefined when none of them can be worked out (then the mod offers
// nothing and writes nothing, and the shell's line stays the only offer).
export function resolveDataDir({ env, pluginRoot, pluginName, home, configDir }) {
  if (typeof env === 'string' && env !== '') return { dir: env, source: 'env' }
  const clean = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '-')
  const root = String(pluginRoot ?? '')
  const marker = '/plugins/cache/'
  const at = root.indexOf(marker)
  if (at >= 0) {
    const [marketplace, name] = root.slice(at + marker.length).split('/')
    if (marketplace && name) return { dir: `${root.slice(0, at)}/plugins/data/${clean(name)}-${clean(marketplace)}`, source: 'derived' }
  }
  const base = typeof configDir === 'string' && configDir !== '' ? trimSlashes(configDir) : typeof home === 'string' && home !== '' ? `${trimSlashes(home)}/.claude` : undefined
  if (base !== undefined && typeof pluginName === 'string' && pluginName !== '') return { dir: `${base}/plugins/data/${clean(pluginName)}-inline`, source: 'inline' }
  return undefined
}

// ---- the question and what an answer does -------------------------------------------------------------

// The answers, in the order shown (the yes first; Later is the safe default; Never is last).
export function answerLabels(messages, hasGit) {
  return hasGit
    ? [messages.ho_setup, messages.ho_later, messages.ho_never]
    : [messages.ho_git_setup, messages.ho_nogit_setup, messages.ho_later, messages.ho_never]
}

// What a picked label means: 'setup' | 'git-setup' | 'nogit-setup' | 'later' | 'never'. Anything else
// (a dismissed or unknown answer) is 'later'.
export function answerKind(messages, hasGit, picked) {
  if (hasGit && picked === messages.ho_setup) return 'setup'
  if (!hasGit && picked === messages.ho_git_setup) return 'git-setup'
  if (!hasGit && picked === messages.ho_nogit_setup) return 'nogit-setup'
  if (picked === messages.ho_never) return 'never'
  return 'later'
}

// The prompt that runs the skill. The user already said yes in the question, so the skill writes in the
// same turn; the git choice rides in the text (the skill's step 0 follows it).
export function setupPrompt(kind, dir) {
  const head =
    "Run the crew-chief:crew-handoff skill now (the Skill tool). The user already said yes to setting up handoff files, in crew-chief's question at session start: show the plan and preview and write the files in this same turn; wait for confirmation only if the skill's step 1 finds equivalent files."
  if (kind === 'git-setup') {
    return `${head} The user chose "git init, then set up": run \`git init\` in ${dir} first, then use the new repository root as the target directory.`
  }
  if (kind === 'nogit-setup') {
    return `${head} There is no git repository and the user chose to set up without git: pass ${dir} as the directory argument and do not run git init.`
  }
  return head
}
