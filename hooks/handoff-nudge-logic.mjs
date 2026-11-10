// Keeps the project's handoff files (STATUS.md, tasks.json, PROGRESS.md) from going stale. Pure functions, no
// Claude Code API, so tests/handoff-nudge-logic.test.mjs can run them with plain Node. The part that touches `$` is
// hooks/src/handoff-nudge.js.
//
// A session can end without warning (a limit stop, a closed terminal, a crash), and the next session starts from
// those files. Nothing here writes them: only Claude knows what changed. The mod counts what happened since they
// were last written and reminds Claude, at moments it is likely to listen:
//   - after enough edited files or enough time (the reminder rides with the result of an Edit/Write call, so it
//     also reaches a long unattended run, and with the next prompt);
//   - when the user may have stated a lasting rule, answered a question (a decision), or a commit was made;
//   - when a usage limit is nearly used;
//   - mode `turn` only: if reminders went unanswered, one extra turn at the end of an answer asks for the update.

export const MODES = ['off', 'nudge', 'turn']

export const DEFAULTS = { mode: 'nudge', files: 6, minutes: 45, max: 6 }

const HANDOFF_NAMES = new Set(['status.md', 'durum.md', 'tasks.json', 'progress.md', 'ilerleme.md'])
const IGNORED_DIRS = /\/(node_modules|\.git|dist|build|out|\.next|\.nuxt|coverage|\.dart_tool|Pods|__pycache__|\.gradle|\.idea|\.test-tmp|target|vendor)\//
const IGNORED_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|pubspec\.lock|Podfile\.lock|Cargo\.lock|composer\.lock|poetry\.lock|Gemfile\.lock)$|\.(min\.(js|css)|map|log|pyc|lock)$|\.(g|freezed|generated)\.[a-z]+$/i

export const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export function baseName(path) {
  return String(path ?? '').split('/').pop().toLowerCase()
}

export function isHandoffPath(path) {
  return HANDOFF_NAMES.has(baseName(path))
}

// A file the project owns that is worth counting: under the project root, not generated, not a handoff file.
export function isCountedPath(path, root) {
  const p = String(path ?? '')
  if (p === '' || isHandoffPath(p)) return false
  if (typeof root === 'string' && root !== '' && !p.startsWith(root.replace(/\/+$/, '') + '/')) return false
  if (IGNORED_DIRS.test(p) || IGNORED_FILES.test(p)) return false
  return true
}

// The path a write call names (Edit, Write and MultiEdit use file_path, NotebookEdit notebook_path).
export function writtenPath(call) {
  return call && typeof call === 'object' ? call.file_path ?? call.notebook_path : undefined
}

export function isCommit(command) {
  return typeof command === 'string' && /\bgit\s+(?:(?:-c|-C)\s+\S+\s+|--\S+\s+)*commit\b/.test(command) && !/--dry-run/.test(command)
}

// Whether the person's message may state a lasting rule (English or Turkish). A hint to Claude, not a verdict:
// false positives cost one line of context, so the list leans wide but skips very short messages.
const RULE_WORDS = [
  /\b(never|always|do not|don'?t|must not|must always|from now on|going forward|no more|stop (using|doing)|make sure (you|to)|only (ever )?use|not allowed|rule[: ]|constraint)\b/i,
  /\b(asla|hiçbir zaman|her zaman|yapma|yapmayacaksın|yapmayın|sakın|bundan sonra|artık|kural|dokunma|değiştirme|açma|sormadan|izin vermeden|mutlaka|şart)\b/i,
]

export function looksLikeRule(text) {
  const t = String(text ?? '').trim()
  if (t.length < 12 || t.startsWith('/')) return false
  return RULE_WORDS.some((re) => re.test(t))
}

export function newState() {
  return {
    files: new Set(), // distinct counted files edited since the handoff files were last written
    edits: 0,
    since: undefined, // when the first of those edits happened
    baseline: undefined, // newest mtime of the handoff files when counting started
    nudges: 0, // ordinary reminders sent this session
    events: 0, // event reminders (rule, decision, commit, limit) sent this session
    lastAt: undefined, // when the last ordinary reminder went out
    lastFiles: 0, // the file count at that moment
    unanswered: 0, // ordinary reminders since the handoff files were last written
    limitDone: false,
    enforced: false, // the extra turn (mode turn) was used for the current stretch
  }
}

// The handoff files were written (by anyone): the stretch starts over.
export function wrote(state, mtime) {
  state.files = new Set()
  state.edits = 0
  state.since = undefined
  state.unanswered = 0
  state.lastAt = undefined
  state.lastFiles = 0
  state.enforced = false
  if (typeof mtime === 'number') state.baseline = mtime
}

// One finished tool call of this session (main or subagent). Returns 'wrote' when it wrote a handoff file,
// 'counted' when it was a project edit that counts, otherwise undefined.
export function noteCall(state, call, root, now) {
  if (!call || !WRITE_TOOLS.has(call.tool)) return undefined
  const path = writtenPath(call)
  if (isHandoffPath(path)) {
    wrote(state)
    return 'wrote'
  }
  if (!isCountedPath(path, root)) return undefined
  state.files.add(path)
  state.edits += 1
  if (state.since === undefined) state.since = now
  return 'counted'
}

const MIN_GAP_MS = 10 * 60_000
const MIN_NEW_FILES = 3

// An ordinary reminder is due when enough has piled up: `files` distinct files or a quarter as many with
// `minutes` having passed. Spaced out: not within ten minutes of the last one, and not before three more files.
export function ordinaryDue(state, cfg, now) {
  if (cfg.mode === 'off' || state.nudges >= cfg.max || state.unanswered >= 3) return false
  const n = state.files.size
  if (n === 0 || state.since === undefined) return false
  const minutes = (now - state.since) / 60_000
  const enough = n >= cfg.files || (n >= Math.max(2, Math.ceil(cfg.files / 3)) && minutes >= cfg.minutes)
  if (!enough) return false
  if (state.lastAt !== undefined && (now - state.lastAt < MIN_GAP_MS || n - state.lastFiles < MIN_NEW_FILES)) return false
  return true
}

export function sentOrdinary(state, now) {
  state.nudges += 1
  state.unanswered += 1
  state.lastAt = now
  state.lastFiles = state.files.size
}

// Mode `turn`: reminders went unanswered and the pile is twice what triggers a reminder, once per stretch.
export function enforceDue(state, cfg, now) {
  if (cfg.mode !== 'turn' || state.enforced || state.unanswered < 1) return false
  const n = state.files.size
  const minutes = state.since === undefined ? 0 : (now - state.since) / 60_000
  return n >= cfg.files * 2 || (n >= cfg.files && minutes >= cfg.minutes * 2)
}

export const EVENT_CAP = 12

const ROUTINE =
  'tasks.json: only status and evidence change (never reword a task); STATUS.md: Now, Next, Open questions, Failed attempts; PROGRESS.md: one dated paragraph at the top; copy any rule the user gave word for word under Constraints.'

export function ordinaryText(state, now) {
  const minutes = state.since === undefined ? 0 : Math.max(1, Math.round((now - state.since) / 60_000))
  const head = `[crew-chief] Handoff check: ${state.files.size} files edited in ${minutes} min since STATUS.md / tasks.json / PROGRESS.md were last written.`
  if (state.unanswered === 0) {
    return `${head} If the state changed (a task started or finished, a decision, a failed attempt, a rule from the user), update them now as part of your next step, briefly. ${ROUTINE} If nothing changed, ignore this.`
  }
  return `${head} This is reminder ${state.unanswered + 1}. A session can end without warning (a usage limit, a closed terminal) and the next one starts from these files, so update them now, briefly, before the next large step. ${ROUTINE}`
}

export function eventText(kind) {
  switch (kind) {
    case 'rule':
      return '[crew-chief] The user\'s last message may state a lasting rule (do not touch X, no commits, ask before Y, a language or style). If it does, copy it word for word under Constraints in STATUS.md right now, before you continue. If it only applies to this one task, ignore this.'
    case 'decision':
      return '[crew-chief] The user just answered a question, which is a decision. If it affects later work, record it and the reason under Decisions in STATUS.md now; if it reverses an earlier attempt, add that under Failed attempts. If it changes nothing later, ignore this.'
    case 'commit':
      return '[crew-chief] A commit was made. If it finishes or advances a task, update that task\'s status and evidence in tasks.json and the Now line in STATUS.md (only status and evidence change; never reword a task). Otherwise ignore this.'
    case 'limit':
      return '[crew-chief] A usage limit is nearly used, and a limit stop ends the session without warning. Update STATUS.md, tasks.json and PROGRESS.md now so the next session can pick up where this one stops.'
    default:
      return undefined
  }
}

export function enforceText(state, now) {
  const minutes = state.since === undefined ? 0 : Math.round((now - state.since) / 60_000)
  return `crew-chief: ${state.files.size} files have been edited over ${minutes} minutes and the handoff files were not updated after earlier reminders. Update STATUS.md (Now, Next, Open questions, Failed attempts), tasks.json (status and evidence only) and PROGRESS.md (one dated paragraph) to match the real state, then continue what you were doing. Do not commit. ${ROUTINE}`
}

// Which usage windows count as "nearly used".
export function limitNear(rateLimits) {
  if (!Array.isArray(rateLimits)) return false
  return rateLimits.some((w) => (w.kind === 'five_hour' && w.percentUsed >= 90) || (w.kind === 'seven_day' && w.percentUsed >= 95))
}
