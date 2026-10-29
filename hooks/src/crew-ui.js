// crew-chief crew-ui: a band above the prompt with what a long session needs at a glance. Part of the mod in
// hooks/register.js (Claude Code 2.1.287+). On by default and quiet (it draws nothing while there is nothing to say);
// /crew-ui off turns it off. It never writes to settings.json (the person's own status line is left alone).
//
// In the terminal, with a status line of the person's own set, the quiet band leaves out the context and the
// limits (that line has them); on the Desktop app, or with `/crew-ui full`, they are shown.
// Quiet mode (the default) shows only what is worth a look; `/crew-ui full` shows everything all the time:
//   ctx 52% 520k/1M   5h 4% ~4h20m   7d 96% ~5d13h   guard on · 1 held   saver on   [ 1 compact ]
//   deep-reader        sonnet-5.5 ●●○○○ medium ▓▓░░░░ 40%  12k  reading auth
//
// The band is raised on the terminal and the Desktop app only (not VS Code, which keeps the status line of
// hooks/src/agent-row.js). One hook draws the band, so another plugin's band and this one compete; a survey
// always wins (hasSurvey). The layout is pure (hooks/ui-logic.mjs); this file reads the data and draws.
//   - data: $.session.usage (context, windows), the subagents of agent-row.js and progress.js, the guard and
//     the saver, and the compaction threshold of compact-flow.js;
//   - redraw: uiTouch() asks for one after a turn, a measurement or an agent change ($.ui.invalidate folds
//     bursts, ten a second at most);
//   - the compact key shows only when compaction is advised (past the "ask" size). Its hotkey is a digit, the
//     one key a band answers from an empty composer without being focused; so it must not exist all the time,
//     or the first digit someone types would press it. Pressing it asks the usual question (/crew-compact).
// The extras (on by default with the band, `/crew-ui extras off`): plain text added to the engine's own lines,
// which take no colour: the model and effort after the spinner word and before the turn line, a note in the
// footer's mode labels, a limit note after the prompt hint. Nothing is replaced, only added.
// CREW_CHIEF_UI=on|off beats the saved choice. Any failure draws nothing (the engine's own band).
import { rowBandRows, rowSurfaces } from './agent-row.mjs'
import { resolveLang } from './lang.mjs'
import { t } from './saver-i18n.mjs'
import { compactAskAt, compactBandPress } from './compact-flow.mjs'
import { guardSummary } from './guard.mjs'
import { bandLines, ctxChip, demoContent, modeLabels, modelChip, quietFacts, spinnerWord, statusSegments, tailText, windowChip } from './ui-logic.mjs'

const UI_STORE_KEY = 'crew_ui'
const UI_MODE_KEY = 'crew_ui_mode' // 'quiet' (default) or 'full'
const UI_STYLE_KEY = 'crew_ui_style' // boxed (default), plain (theme colours), color (hex), pills
const UI_STYLES = ['plain', 'color', 'pills', 'boxed']
const UI_WORDS_KEY = 'crew_ui_words' // 'on' or 'off' (default): calm spinner words by model
const UI_NOTICE_KEY = 'crew_ui_notice' // set once the first-run notice was shown
const UI_EXTRAS_KEY = 'crew_ui_extras' // 'on' (default) or 'off': the small touches outside the band
const UI_MAX_LINES = 4
const UI_SURFACES = ['terminal', 'desktop']

// Tones are meanings; these are the theme keys the surfaces know (any other colour string is the surface's
// own business, so only theme keys are used).
const UI_TONES = {
  ok: { color: 'success' },
  warn: { color: 'warning' },
  hot: { color: 'claude' },
  crit: { color: 'error' },
  info: { color: 'suggestion' },
  dim: { dimColor: true },
  opus: { color: 'planMode' },
  sonnet: { color: 'permission' },
  haiku: { color: 'success' },
  fable: { color: 'merged' },
  max: { color: 'planMode' },
  rb0: { color: 'error' },
  rb1: { color: 'claude' },
  rb2: { color: 'warning' },
  rb3: { color: 'success' },
  rb4: { color: 'suggestion' },
  other: {},
}

let uiOn = false
let uiFull = false
let uiExtras = true
let uiStyle = 'boxed'
let uiStatusLine = { at: -Infinity, has: false } // is the person's own status line set (read at most once a minute)
let uiDemo = false // sample content, not saved
let uiWords = false
let uiCtxHistory = [] // the context percent after each main turn, for the graph
let uiQuestion // { text, answers, resolve }: the one question the band is asking
const UI_ASK_MAX = 4 // answers that fit digit hotkeys
let uiMain = { model: undefined, effort: undefined } // the main loop's last request

// Whether the band replaces the status line of agent-row.js: only where the band is drawn.
export function uiCovers(surfaces) {
  return uiOn && Array.isArray(surfaces) && surfaces.length > 0 && surfaces.every((s) => UI_SURFACES.includes(s))
}

async function safeStoreGet($, key) {
  try {
    return await $.store.get(key)
  } catch (err) {
    return undefined
  }
}

async function uiReadChoice($) {
  const env = String((await $.env.get('CREW_CHIEF_UI')) ?? '').trim().toLowerCase()
  if (env === 'on' || env === 'off') return { on: env === 'on', source: 'CREW_CHIEF_UI' }
  let saved
  try {
    saved = await $.store.get(UI_STORE_KEY)
  } catch (err) {
    saved = undefined
  }
  // On unless the person turned it off: the quiet band draws nothing while there is nothing to say.
  return { on: saved !== 'off', source: saved === undefined ? 'default' : 'saved choice' }
}

// Called after each finished main turn with the usage: one more point for the context graph.
export function uiNoteContext(usage) {
  const c = usage?.context
  if (!c || typeof c.tokens !== 'number' || typeof c.window !== 'number' || c.window <= 0) return
  uiCtxHistory = [...uiCtxHistory, Math.round((c.tokens / c.window) * 100)].slice(-24)
}

// Called from the mod's turn.step hook with the main loop's request: the model and effort the turn runs on.
export function uiNoteMainStep(e) {
  if (typeof e.model === 'string' && e.model !== '') uiMain = { model: e.model, effort: e.effort }
}

async function uiMainChip($) {
  let model = uiMain.model
  if (!model) {
    try {
      model = await $.session.model()
    } catch (err) {
      model = undefined
    }
  }
  return modelChip(model, uiMain.effort)
}

// Rewrites one prop of the engine's own drawing; the engine keeps drawing everything else.
function uiRewrite(next, e, props) {
  return next({ ...e, props: { ...e.props, ...props } })
}

// The plugin's questions go to the band, as buttons, when it can show them: no dialog opens and nothing holds
// the turn (the deadline of ask.js still applies). `undefined` -> the caller opens the usual dialog. Only the
// plugin's own questions come here; Claude's AskUserQuestion is never touched.
export function uiAskStart($, text, answers) {
  try {
    if (!uiCovers(rowSurfaces()) || uiQuestion !== undefined) return undefined
    if (!Array.isArray(answers) || answers.length < 1 || answers.length > UI_ASK_MAX) return undefined
    let resolve
    const promise = new Promise((r) => {
      resolve = r
    })
    const question = { text: String(text), answers: [...answers], resolve }
    uiQuestion = question
    try {
      $.ui.invalidate('ui.render')
    } catch (err) {
      // The band draws on the next event.
    }
    resolveLang($)
      .then((lang) => $.ui.toast(t(lang, 'band_ask_toast', { keys: answers.map((a, i) => i + 1).join(', ') }), { timeoutMs: 15000 }))
      .catch(() => {})
    return {
      promise,
      close() {
        if (uiQuestion === question) {
          uiQuestion = undefined
          uiTouchNow($)
        }
      },
    }
  } catch (err) {
    return undefined
  }
}

function uiTouchNow($) {
  try {
    $.ui.invalidate('ui.render')
  } catch (err) {
    // Nothing to redraw.
  }
}

// A redraw soon; $.ui.invalidate folds bursts. Free while the band is off.
export function uiTouch($) {
  if (!uiOn) return
  try {
    $.ui.invalidate('ui.render')
  } catch (err) {
    // The band is cosmetic.
  }
}

// The band is on by default, which changes what an updated install shows: say so once, in a toast (never a
// question), and only where the band can be drawn.
async function uiFirstNotice($, choice) {
  try {
    if (!choice.on || choice.source !== 'default') return
    if ((await safeStoreGet($, UI_NOTICE_KEY)) !== undefined) return
    const surfaces = await $.session.surfaces()
    if (!Array.isArray(surfaces) || surfaces.length === 0 || !surfaces.every((s) => UI_SURFACES.includes(s))) return
    await $.store.set(UI_NOTICE_KEY, 'shown')
    const lang = await resolveLang($)
    $.ui.toast(t(lang, 'ui_default_toast'), { timeoutMs: 20000 })
  } catch (err) {
    // The notice is a courtesy.
  }
}

export async function uiSessionStart($) {
  try {
    const choice = await uiReadChoice($)
    uiOn = choice.on
    uiFull = (await safeStoreGet($, UI_MODE_KEY)) === 'full'
    uiExtras = (await safeStoreGet($, UI_EXTRAS_KEY)) !== 'off'
    uiWords = (await safeStoreGet($, UI_WORDS_KEY)) === 'on'
    uiCtxHistory = []
    const savedStyle = await safeStoreGet($, UI_STYLE_KEY)
    uiStyle = UI_STYLES.includes(savedStyle) ? savedStyle : 'boxed'
    uiStatusLine = { at: -Infinity, has: false }
    await uiFirstNotice($, choice)
    await $.command.register({ name: 'crew-ui', description: 'Show or hide the crew-chief band above the prompt', immediate: true, argumentHint: '[on|off|quiet|full|style <name>|demo on|demo off|words on|words off|extras on|extras off|status]' })
  } catch (err) {
    // The name is taken, or an older Claude Code: the band can still be switched with CREW_CHIEF_UI.
  }
}

// Hex colours for the styles other than `plain` (which keeps to theme keys, the one thing every surface knows).
const UI_HEX = {
  ok: '#4ade80',
  warn: '#facc15',
  hot: '#fb923c',
  crit: '#f87171',
  info: '#7dd3fc',
  dim: '#6b7280',
  opus: '#c084fc',
  sonnet: '#60a5fa',
  haiku: '#34d399',
  fable: '#f472b6',
  max: '#e879f9',
  rb0: '#f87171',
  rb1: '#fb923c',
  rb2: '#facc15',
  rb3: '#4ade80',
  rb4: '#e879f9',
  other: '#d1d5db',
}
const UI_PILL_TEXT = '#0b1020'
const UI_LILAC = '#e08ef0' // a question the band is asking: a band of this colour, and, in the boxed style, its frame
const UI_FAMILIES = ['sonnet', 'opus', 'haiku', 'fable', 'other']

// A status line is chips separated by a gap segment of three spaces; pills turns each chip into one coloured
// block (the tone of its value on a background), the other styles keep the segments as they are.
function uiChips(line) {
  const chips = []
  let cur = []
  for (const s of line) {
    if (s.t === '   ' && s.tone === 'dim') {
      if (cur.length > 0) chips.push(cur)
      cur = []
    } else cur.push(s)
  }
  if (cur.length > 0) chips.push(cur)
  return chips
}

function uiTree($, e, lines, onCompact, style, question) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const hex = style !== 'plain'
  const look = (tone) => (hex ? { color: UI_HEX[tone] ?? UI_HEX.other } : UI_TONES[tone] ?? {})
  const text = (s) => {
    const props = { ...look(s.tone), wrap: 'truncate-end', children: [s.t] }
    if (s.bold) props.weight = 'bold'
    return Text(props)
  }
  const button = () => Button({ label: '1 compact', hotkey: '1', variant: 'primary', onPress: onCompact })
  const piece = (s) => (s.key === 'compact' ? button() : text(s))
  const pill = (chip) => {
    if (chip.some((s) => s.key === 'compact')) return button()
    const value = chip.find((s) => s.tone !== 'dim') ?? chip[0]
    const bg = UI_HEX[value.tone] ?? UI_HEX.other
    return Text({ backgroundColor: bg, color: UI_PILL_TEXT, weight: 'bold', wrap: 'truncate-end', children: [' ' + chip.map((s) => s.t).join('') + ' '] })
  }
  const row = (line, i) => {
    // The first line is the status line, unless it is an agent line (a model family tone gives that away).
    const isStatus = i === 0 && !line.some((s) => UI_FAMILIES.includes(s.tone))
    if (style === 'pills' && isStatus) return Box({ flexDirection: 'row', gap: 1, children: uiChips(line).map(pill) })
    return Box({ flexDirection: 'row', children: line.map(piece) })
  }
  const askBlock = () => {
    const q = question
    const buttons = q.answers.map((answer, i) =>
      Button({
        key: 'ask-' + (i + 1),
        label: `${i + 1} ${answer}`,
        hotkey: String(i + 1),
        variant: i === 0 ? 'primary' : 'secondary',
        onPress: () => {
          if (uiQuestion === q) {
            uiQuestion = undefined
            q.resolve(answer)
            uiTouchNow($)
          }
        },
      }),
    )
    return Box({
      flexDirection: 'column',
      children: [Text({ backgroundColor: UI_LILAC, color: UI_PILL_TEXT, weight: 'bold', wrap: 'wrap', children: [' crew-chief asks: ' + q.text + ' '] }), Box({ flexDirection: 'row', gap: 2, children: buttons })],
    })
  }
  const body = Box({ flexDirection: 'column', children: [...(question ? [askBlock()] : []), ...lines.map(row)] })
  if (style !== 'boxed') return body
  return Box({ borderStyle: 'round', borderColor: question ? UI_LILAC : UI_HEX.dim, paddingX: 1, flexDirection: 'column', children: [body] })
}

export function uiLilac() {
  return UI_LILAC
}

// Lines of segments (hooks/ui-logic.mjs) as one column of rows, in the band's colours; for the panes.
export function uiLinesTree($, e, lines) {
  const { Box, Text } = $.ui.resolve(e)
  const hex = uiStyle !== 'plain'
  const look = (tone) => (hex ? { color: UI_HEX[tone] ?? UI_HEX.other } : UI_TONES[tone] ?? {})
  const text = (s) => {
    const props = { ...look(s.tone), wrap: 'truncate-end', children: [s.t] }
    if (s.bold) props.weight = 'bold'
    return Text(props)
  }
  return Box({ flexDirection: 'column', children: lines.map((line) => Box({ flexDirection: 'row', children: line.map(text) })) })
}

// Whether the person has a status line of their own (settings.json `statusLine`). It most likely shows the
// context and the limits already, so the band leaves those out of it in the terminal (the Desktop app has no
// such line, and `/crew-ui full` shows everything).
async function uiHasStatusLine($) {
  const now = await $.clock.now()
  if (now - uiStatusLine.at < 60_000) return uiStatusLine.has
  let has = false
  try {
    const value = await $.settings.read({ key: 'statusLine' })
    has = value !== undefined && value !== null && typeof value === 'object' && typeof value.command === 'string' && value.command !== ''
  } catch (err) {
    has = false
  }
  uiStatusLine = { at: now, has }
  return has
}

async function uiFacts($, saverOn) {
  const now = await $.clock.now()
  const usage = await $.session.usage()
  const askAt = await compactAskAt($, usage)
  const guard = guardSummary()
  return {
    ctx: ctxChip(usage?.context, askAt, uiCtxHistory),
    five: windowChip(usage?.rateLimits, 'five_hour', now),
    week: windowChip(usage?.rateLimits, 'seven_day', now),
    guard: guard.loaded ? { on: guard.on, held: guard.held } : undefined,
    saver: saverOn,
  }
}

export function registerUi(on, saverOn) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (!uiOn || e.props?.hasSurvey === true) return next(e)
      const question = uiQuestion
      const demo = uiDemo ? demoContent(await $.clock.now()) : undefined
      const facts = demo ? demo.facts : await uiFacts($, saverOn())
      if (!demo) facts.compactKey = facts.ctx?.past === true && question === undefined
      const columns = typeof e.props?.bodyColumns === 'number' ? e.props.bodyColumns : 100
      const rows = typeof e.props?.maxRows === 'number' ? e.props.maxRows : UI_MAX_LINES
      const maxLines = Math.max(1, Math.min(UI_MAX_LINES, rows - (question ? 4 : 0)))
      if (!demo && !uiFull && e.surface === 'terminal' && (await uiHasStatusLine($))) {
        // The compact key was decided above from the context; only the figures the status line has are left out.
        facts.ctx = undefined
        facts.five = undefined
        facts.week = undefined
      }
      const lines = bandLines({ status: statusSegments(uiFull || demo ? facts : quietFacts(facts)), agents: demo ? demo.agents : await rowBandRows($), maxLines, width: columns })
      if (lines.length === 0 && question === undefined) return next(e)
      return uiTree($, e, lines, () => compactBandPress($), uiStyle, question)
    } catch (err) {
      return next(e)
    }
  })

  // The small touches: plain text added to the engine's own drawing (no colour there). Each leaves the
  // drawing alone when it has nothing to add, and any failure draws the engine's own.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    try {
      if (!uiOn || !uiExtras || typeof e.props?.suffix !== 'string') return next(e)
      const chip = await uiMainChip($)
      const word = uiWords && e.props.message === null ? spinnerWord(uiMain.model) : undefined
      if (chip === '' && word === undefined) return next(e)
      return uiRewrite(next, e, { ...(word !== undefined ? { word } : {}), suffix: chip === '' ? e.props.suffix : e.props.suffix + ' ' + chip })
    } catch (err) {
      return next(e)
    }
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    try {
      if (!uiOn || !uiExtras || e.props?.isExpanded === true || typeof e.props?.word !== 'string') return next(e)
      const chip = await uiMainChip($)
      return chip === '' ? next(e) : uiRewrite(next, e, { word: chip + ' · ' + e.props.word })
    } catch (err) {
      return next(e)
    }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    try {
      if (!uiOn || !uiExtras || !Array.isArray(e.props?.modes)) return next(e)
      const labels = modeLabels(await uiFacts($, saverOn()))
      return labels.length === 0 ? next(e) : uiRewrite(next, e, { modes: [...e.props.modes, ...labels] })
    } catch (err) {
      return next(e)
    }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    try {
      if (!uiOn || !uiExtras || e.props?.isDraft === true) return next(e)
      const tail = tailText(await uiFacts($, saverOn()))
      return tail === '' ? next(e) : uiRewrite(next, e, { tail })
    } catch (err) {
      return next(e)
    }
  })

  on('command.run', { command: 'crew-ui' }, async ($, e) => {
    const word = String(e.args || '').trim().toLowerCase()
    const choice = await uiReadChoice($)
    if (word === 'on' || word === 'off') {
      try {
        await $.store.set(UI_STORE_KEY, word)
      } catch (err) {
        // Kept for this session only.
      }
      const envWins = choice.source === 'CREW_CHIEF_UI'
      uiOn = envWins ? choice.on : word === 'on'
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      if (envWins && choice.on !== (word === 'on')) {
        return { text: `crew-ui: CREW_CHIEF_UI=${choice.on ? 'on' : 'off'} is set in the environment and wins; your choice (${word}) is saved for when it is unset.` }
      }
      return { text: word === 'on' ? 'crew-ui: the band is on (terminal and Desktop app; VS Code keeps its status line). Turn it off with /crew-ui off. Nothing in settings.json was changed.' : 'crew-ui: the band is off.' }
    }
    if (word === 'words on' || word === 'words off') {
      uiWords = word === 'words on'
      try {
        await $.store.set(UI_WORDS_KEY, uiWords ? 'on' : 'off')
      } catch (err) {
        // Kept for this session only.
      }
      return { text: uiWords ? 'crew-ui: words on: the spinner says Pondering (Opus), Working (Sonnet), Skimming (Haiku) instead of the engine\'s random word.' : 'crew-ui: words off: the engine picks the spinner word.' }
    }
    if (word.startsWith('style')) {
      const name = word.slice(5).trim()
      if (!UI_STYLES.includes(name)) return { text: `crew-ui: style is ${uiStyle}; choose one of ${UI_STYLES.join(', ')} (plain: theme colours; color: hex colours; pills: coloured blocks for the status line; boxed: a rounded frame). Try /crew-ui demo on first.` }
      uiStyle = name
      try {
        await $.store.set(UI_STYLE_KEY, name)
      } catch (err) {
        // Kept for this session only.
      }
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      return { text: `crew-ui: style ${name}.` }
    }
    if (word === 'demo on' || word === 'demo off') {
      uiDemo = word === 'demo on'
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      return { text: uiDemo ? 'crew-ui: demo on: the band shows sample content (three agents, limits, guard, the compact key) so styles can be judged. /crew-ui demo off to stop; /crew-ui style plain|color|pills|boxed to change the look.' : 'crew-ui: demo off.' }
    }
    if (word === 'extras on' || word === 'extras off') {
      uiExtras = word === 'extras on'
      try {
        await $.store.set(UI_EXTRAS_KEY, uiExtras ? 'on' : 'off')
      } catch (err) {
        // Kept for this session only.
      }
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      return { text: uiExtras ? 'crew-ui: extras on: the model and effort next to the spinner and the turn line, crew-chief notes in the mode line, a limit note after the prompt hint.' : 'crew-ui: extras off: only the band is drawn.' }
    }
    if (word === 'full' || word === 'quiet') {
      uiFull = word === 'full'
      try {
        await $.store.set(UI_MODE_KEY, word)
      } catch (err) {
        // Kept for this session only.
      }
      try {
        $.ui.invalidate('ui.render')
      } catch (err) {
        // Nothing to redraw.
      }
      return { text: uiFull ? 'crew-ui: full mode: the context, both limit windows and the guard are always shown.' : 'crew-ui: quiet mode: the band shows only what is worth a look (a running subagent, a limit or the context from 70 %, something the guard stopped, a compaction due).' }
    }
    const surfaces = await $.session.surfaces()
    return {
      text: `crew-ui: the band is ${uiOn ? 'on' : 'off'} (${choice.source}), ${uiFull ? 'full' : 'quiet'} mode. Surfaces here: ${Array.isArray(surfaces) && surfaces.length > 0 ? surfaces.join(', ') : 'none'}; the band is drawn on ${UI_SURFACES.join(' and ')}. /crew-ui on | off | quiet | full | style <name> | demo on | words on | extras on | extras off.`,
    }
  })
}
