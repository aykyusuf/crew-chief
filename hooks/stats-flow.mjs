// /crew-report and the cache-cooling hint. Part of the mod in hooks/register.js (Claude Code 2.1.287+).
//
//   /crew-report   tokens (exact) and cost (approximate) by role (main or subagent) and model, plus how
//                  much of the output came from subagents and from Sonnet or Haiku: whether the routing
//                  is moving work to cheaper tiers. Claude Code reports one session total, so each
//                  request is credited with what the total grew by since the previous one ended.
//   cache hint     a toast on your next prompt when the prompt cache has probably gone cold during an
//                  idle gap and the context is big, because that message re-reads it at the full price.
//                  The cache lifetime is learned from the usage numbers (see report-logic.mjs); until an
//                  expiry has been seen nothing is warned. CREW_CHIEF_CACHE_HINT=off turns it off.
// Nothing is written outside the plugin's store (the learned gap lengths). Nothing leaves the machine.
import { resolveLang } from './lang.mjs'
import { formatDuration } from './saver-logic.mjs'
import { t, unitsFor } from './saver-i18n.mjs'
import { modelFamily } from './saver-logic.mjs'
import {
  addStep,
  classifyGap,
  fmtTokens,
  fmtUsd,
  newStats,
  nextHint,
  parseHint,
  routingShare,
  shouldWarnCold,
  statsRows,
} from './report-logic.mjs'

function fresh() {
  return { stats: newStats(), lastCost: undefined, lastMainEndAt: undefined, lastMainContext: 0, stepGap: undefined, hint: undefined, warnedFor: undefined }
}

let st = fresh()

async function safe(fn, fallback) {
  try {
    return await fn()
  } catch (err) {
    return fallback
  }
}

async function loadHint($) {
  if (st.hint !== undefined) return st.hint
  const text = await safe(() => $.store.get('cache_hint'), undefined)
  st.hint = typeof text === 'string' ? parseHint(text) : {}
  return st.hint
}

export async function statsSessionStart($) {
  st = fresh()
  try {
    await $.command.register({
      name: 'crew-report',
      description: t(await resolveLang($), 'cmd_report_description'),
      argumentHint: '',
    })
  } catch (err) {
    // The name is taken: the rest still works.
  }
}

export function statsReset() {
  st = fresh()
}

// A compaction (or any change of conversation) guarantees a cache miss on the next request: that gap
// must not be mistaken for the cache's lifetime.
export function statsNoteBoundary() {
  st.lastMainEndAt = undefined
  st.stepGap = undefined
}

// Before a request goes out: how long the main conversation sat idle since its last one.
export async function statsStepStart($, e) {
  if (e.agentId !== undefined) return
  const now = await $.clock.now()
  st.stepGap = st.lastMainEndAt === undefined ? undefined : now - st.lastMainEndAt
}

// After a request: add it to the tallies, and learn from it how long the cache lives.
export async function statsStepEnd($, e, result) {
  try {
    const main = e.agentId === undefined
    const usage = result?.usage ?? undefined
    const family = modelFamily(usage?.model ?? e.model)
    const now = await $.clock.now()
    const cost = await safe(() => $.session.usage(), undefined)
    const usd = cost?.cost?.usd
    // The total starts at 0 and falls back to 0 after /clear: a drop means a fresh total, all of it new.
    let grew
    if (typeof usd === 'number') {
      const base = st.lastCost ?? 0
      grew = usd >= base ? usd - base : usd
      st.lastCost = usd
    }
    addStep(st.stats, { role: main ? 'main' : 'subagent', family, usage, usd: grew })
    if (main && usage) {
      const input = Number(usage.input_tokens) || 0
      const cacheRead = Number(usage.cache_read_input_tokens) || 0
      const cacheWrite = Number(usage.cache_creation_input_tokens) || 0
      const verdict = classifyGap({ gapMs: st.stepGap, input, cacheRead, cacheWrite })
      if (verdict !== undefined) {
        const hint = nextHint(await loadHint($), st.stepGap, verdict)
        st.hint = hint
        await safe(() => $.store.set('cache_hint', JSON.stringify(hint)), undefined)
      }
      st.lastMainContext = input + cacheRead + cacheWrite
    }
    if (main) st.lastMainEndAt = now
  } catch (err) {
    // The tallies are a convenience; never get in the way of a request.
  }
}

// On a typed prompt: warn once per idle gap if the cache has probably gone cold.
export async function cacheOnPrompt($) {
  try {
    if ((await safe(() => $.env.get('CREW_CHIEF_CACHE_HINT'), undefined)) === 'off') return
    if (st.lastMainEndAt === undefined || st.warnedFor === st.lastMainEndAt) return
    const now = await $.clock.now()
    const gap = now - st.lastMainEndAt
    if (!shouldWarnCold(await loadHint($), gap, st.lastMainContext)) return
    st.warnedFor = st.lastMainEndAt
    const lang = await resolveLang($)
    $.ui.toast(t(lang, 'cache_cold', { idle: formatDuration(gap, unitsFor(lang)), tokens: fmtTokens(st.lastMainContext) }), { timeoutMs: 12000 })
  } catch (err) {
    // A missing hint is better than a broken prompt.
  }
}

async function buildReport($) {
  const lang = await resolveLang($)
  const rows = statsRows(st.stats)
  if (rows.length === 0) return t(lang, 'report_none')
  const out = [t(lang, 'report_title')]
  for (const r of rows) {
    out.push(
      '- ' +
        t(lang, 'report_row', {
          role: t(lang, r.role === 'main' ? 'role_main' : 'role_subagent'),
          model: r.family,
          requests: r.requests,
          input: fmtTokens(r.input),
          cacheRead: fmtTokens(r.cacheRead),
          cacheWrite: fmtTokens(r.cacheWrite),
          output: fmtTokens(r.output),
          usd: fmtUsd(r.usd),
        }),
    )
  }
  const total = await safe(() => $.session.usage(), undefined)
  if (typeof total?.cost?.usd === 'number') out.push(t(lang, 'report_total', { usd: fmtUsd(total.cost.usd) }))
  const share = routingShare(rows)
  if (share.total > 0) out.push(t(lang, 'report_share', { sub: share.subagent, cheaper: share.cheaper }))
  out.push(t(lang, 'report_note'))
  return out.join('\n')
}

export function registerStats(on) {
  on('command.run', { command: 'crew-report' }, async ($) => ({ text: await buildReport($) }))
}
