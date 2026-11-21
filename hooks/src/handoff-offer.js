// The handoff setup offer at a fresh session start. Part of the mod in hooks/register.js. The rules are in
// hooks/handoff-offer-logic.mjs; the shell's text line (scripts/session-policy.sh) is the fallback and stays
// quiet while this mod is loaded (the marker file below).
//
//   - every session.start where the mod is loaded writes the marker `mod-offer-active` (a unix time) into the
//     plugin's data folder, before anything else, so the shell does not also print its offer;
//   - on a fresh startup (no prompt sent yet, a person at the prompt) it asks: Set up / Later / Never (a
//     folder with no git: git init then set up / Set up without git / Later / Never). Same record file and
//     same suppression rules as the shell. The question has a deadline: unanswered counts as Later;
//   - Set up submits one prompt that runs the crew-chief:crew-handoff skill; the user already said yes.
// The question runs detached: it never holds up the session start or the person's first prompt.
import { askWithDeadline } from './ask.mjs'
import { nightQuietNow, nightSkipped } from './night.mjs'
import { resolveLang } from './lang.mjs'
import { t } from './saver-i18n.mjs'
import {
  MARKER_FILE,
  OFFERS_FILE,
  answerKind,
  answerLabels,
  appendRecord,
  hasHandoffBlock,
  isHandoffName,
  isProjectFolder,
  lastRecord,
  recordLine,
  recordSilences,
  resolveDataDir,
  setupPrompt,
  skipRoot,
  subdirsToSearch,
} from './handoff-offer-logic.mjs'

const HO_STORE_PREFIX = 'handoff-offer:'
const HO_SURFACE_POLLS = 5
const HO_SURFACE_POLL_MS = 2000
// The model is told once, with the first prompt (prompt.submit's `context`), to ignore the shell's offer text: the shell
// may have printed it before the marker existed, and this mod asks in a dialog instead.
const HO_IGNORE_SHELL_NOTE =
  'crew-chief already asked the user about handoff files in a dialog in this session: ignore any <crew-chief-handoff-offer> instruction (do not add the closing line and do not record anything).'
let hoIgnoreShell = false

// The note for the next prompt, once; undefined when the mod is not asking in this session.
export function handoffOfferNote() {
  if (!hoIgnoreShell) return undefined
  hoIgnoreShell = false
  return HO_IGNORE_SHELL_NOTE
}

const HO_KEYS = ['ho_setup', 'ho_git_setup', 'ho_nogit_setup', 'ho_later', 'ho_never']

async function hoTry(fn, fallback) {
  try {
    return await fn()
  } catch (err) {
    return fallback
  }
}

// The plugin's data folder: where the shell keeps handoff-offers.tsv. undefined when it cannot be worked out.
async function hoDataDir($) {
  const env = await hoTry(() => $.env.get('CLAUDE_PLUGIN_DATA'), undefined)
  const home = await hoTry(() => $.env.get('HOME'), undefined)
  const configDir = await hoTry(() => $.env.get('CLAUDE_CONFIG_DIR'), undefined)
  const found = resolveDataDir({ env, pluginRoot: $.plugin.root, pluginName: $.plugin.name, home, configDir })
  await hoTry(() => $.ui.log('crew-chief: handoff offer data folder ' + (found ? `${found.dir} (${found.source})` : 'unknown, the mod stays out of it'), { to: 'debug' }), undefined)
  return found === undefined ? undefined : found.dir
}

// First thing at session.start: the marker the shell reads. Never throws.
export async function handoffOfferMarker($) {
  hoIgnoreShell = false
  try {
    // Switched off: the shell offers nothing either (it reads the same variable), so there is nothing to keep quiet.
    if ((await hoTry(() => $.env.get('CREW_CHIEF_HANDOFF_OFFER'), undefined)) === 'off') return
    const dir = await hoDataDir($)
    if (dir === undefined) return
    const sec = Math.floor((await $.clock.now()) / 1000)
    await $.fs.write(`${dir}/${MARKER_FILE}`, `${sec}\n`)
  } catch (err) {
    // The shell's line then offers as before.
  }
}

// After the session is bound: the offer itself, detached.
export function handoffOfferStart($, e) {
  void handoffOfferRun($, e).catch(() => {})
}

async function hoInteractive($, e) {
  if (e && e.isInteractive === true) return true
  // A host that draws later (the Desktop app attaches after the start) is given a few seconds to show up.
  for (let i = 0; i < HO_SURFACE_POLLS; i++) {
    const surfaces = await hoTry(() => $.session.surfaces(), [])
    if (Array.isArray(surfaces) && surfaces.length > 0) return true
    await new Promise((resolve) => {
      $.clock.after(HO_SURFACE_POLL_MS, resolve)
    })
  }
  return false
}

async function hoGitRoot($, cwd) {
  const r = await hoTry(() => $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 3000 }), undefined)
  if (!r || r.exitCode !== 0) return undefined
  const top = String(r.stdout ?? '').trim()
  return top === '' ? undefined : top
}

// Handoff-like files at the root or one folder below (the shell's search).
async function hoHasHandoffFiles($, proj) {
  const entries = await hoTry(() => $.fs.list(proj), [])
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry && entry.kind !== 'dir' && isHandoffName(entry.name)) return true
  }
  for (const name of subdirsToSearch(entries)) {
    const inner = await hoTry(() => $.fs.list(`${proj}/${name}`), [])
    for (const entry of Array.isArray(inner) ? inner : []) {
      if (entry && entry.kind !== 'dir' && isHandoffName(entry.name)) return true
    }
  }
  return false
}

async function hoRecordAnswer($, dir, proj, answer) {
  const file = `${dir}/${OFFERS_FILE}`
  const sec = Math.floor((await $.clock.now()) / 1000)
  let existing = ''
  if (await hoTry(() => $.fs.exists(file), false)) {
    // A file that is there but cannot be read is left alone: writing would erase every other project's record.
    existing = await $.fs.read(file)
  }
  await $.fs.write(file, appendRecord(existing, recordLine(proj, answer, sec)))
}

async function handoffOfferRun($, e) {
  if ((await hoTry(() => $.env.get('CREW_CHIEF_HANDOFF_OFFER'), undefined)) === 'off') return
  const cwd = e && typeof e.cwd === 'string' ? e.cwd : await hoTry(() => $.session.cwd(), undefined)
  if (!cwd) return
  // Only a fresh startup: a resumed or forked session already has prompts. (session.start carries no `source`.)
  if ((await hoTry(() => $.session.turns(), 1)) !== 0) return
  const sid = await hoTry(() => $.session.id(), undefined)
  const storeKey = sid ? HO_STORE_PREFIX + sid : undefined
  // A reload of the mod runs session.start again for the same session: ask once per session.
  if (storeKey && (await hoTry(() => $.store.get(storeKey), undefined)) !== undefined) return
  const dir = await hoDataDir($)
  if (dir === undefined) return
  const home = await hoTry(() => $.env.get('HOME'), undefined)

  let proj = await hoGitRoot($, cwd)
  const hasGit = proj !== undefined
  if (!hasGit) {
    const names = (await hoTry(() => $.fs.list(cwd), [])).map((x) => x.name)
    if (!isProjectFolder(cwd, home, names)) return
    proj = cwd
  }
  if (skipRoot(proj, home)) return
  if (await hoHasHandoffFiles($, proj)) return
  const claudeMd = await hoTry(() => $.fs.read(`${proj}/CLAUDE.md`), '')
  if (hasHandoffBlock(claudeMd)) return
  const tsv = (await hoTry(() => $.fs.exists(`${dir}/${OFFERS_FILE}`), false)) ? await hoTry(() => $.fs.read(`${dir}/${OFFERS_FILE}`), '') : ''
  const nowSec = Math.floor((await $.clock.now()) / 1000)
  if (recordSilences(lastRecord(tsv, proj), nowSec)) return

  if (!(await hoInteractive($, e))) return
  // A night is open: nobody is there to answer, and "later" must not be recorded for them.
  const night = await hoTry(() => nightQuietNow($), undefined)
  if (night) return void (await hoTry(() => nightSkipped($, night, 'the handoff setup offer'), undefined))
  // The person may have typed already while the checks ran.
  if ((await hoTry(() => $.session.turns(), 1)) !== 0) return
  if (storeKey) await hoTry(() => $.store.set(storeKey, '1'), undefined)
  hoIgnoreShell = true

  const lang = await resolveLang($)
  const messages = Object.fromEntries(HO_KEYS.map((k) => [k, t(lang, k)]))
  const answers = answerLabels(messages, hasGit)
  const question = t(lang, hasGit ? 'ho_ask_git' : 'ho_ask_nogit')
  let picked
  try {
    picked = await askWithDeadline($, question, answers, messages.ho_later)
  } catch (err) {
    picked = messages.ho_later // dismissed
  }
  const kind = answerKind(messages, hasGit, picked)
  if (kind === 'later' || kind === 'never') {
    await hoTry(() => hoRecordAnswer($, dir, proj, kind), undefined)
    await hoTry(() => $.ui.toast(t(lang, kind === 'never' ? 'ho_toast_never' : 'ho_toast_later'), { timeoutMs: 8000 }), undefined)
    return
  }
  await $.prompt.submit({ text: setupPrompt(kind, cwd) })
}
