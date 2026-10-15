// Pure helpers for /crew-report (token and cost by model and role) and the cache-cooling hint
// (hooks/stats-flow.mjs). No Claude Code API in here, so tests/report-logic.test.mjs can run them.

// ---- tokens and cost by model ---------------------------------------------------------------

export function newStats() {
  return new Map()
}

// One finished request: who made it ('main' or 'subagent'), the model family, its usage numbers, and
// the cost that grew since the previous request ended (approximate when subagents run side by side).
export function addStep(stats, { role, family, usage, usd }) {
  const key = role + '|' + family
  const row = stats.get(key) ?? { role, family, requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, usd: 0 }
  row.requests += 1
  row.input += Number(usage?.input_tokens) || 0
  row.cacheRead += Number(usage?.cache_read_input_tokens) || 0
  row.cacheWrite += Number(usage?.cache_creation_input_tokens) || 0
  row.output += Number(usage?.output_tokens) || 0
  row.usd += typeof usd === 'number' && usd > 0 ? usd : 0
  stats.set(key, row)
}

export function statsRows(stats) {
  return [...stats.values()].sort((a, b) => b.usd - a.usd || b.output - a.output)
}

// Of all output tokens, the share written by subagents, and the share written below the heavy tier
// (Haiku or Sonnet): what routing is meant to move work onto.
export function routingShare(rows) {
  const total = rows.reduce((n, r) => n + r.output, 0)
  if (total === 0) return { total: 0, subagent: 0, cheaper: 0 }
  const sum = (pred) => rows.filter(pred).reduce((n, r) => n + r.output, 0)
  return {
    total,
    subagent: Math.round((sum((r) => r.role === 'subagent') / total) * 100),
    cheaper: Math.round((sum((r) => r.family === 'haiku' || r.family === 'sonnet') / total) * 100),
  }
}

export function fmtTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'k'
  return String(Math.round(n))
}

export function fmtUsd(n) {
  return typeof n === 'number' && Number.isFinite(n) ? '$' + n.toFixed(n < 10 ? 2 : 1) : '?'
}

// ---- the prompt cache going cold ------------------------------------------------------------
// Claude Code gives a mod no way to read the main conversation's cache lifetime (5 minutes or 1 hour
// depends on the account and settings), so it is learned from what the API reports: a request after an
// idle gap that read almost nothing from the cache and wrote most of the context means the cache had
// expired within that gap; one that read most of it means the cache was still alive. Until a gap has
// shown an expiry, nothing is warned.

export const CACHE_MIN_GAP_MS = 4 * 60 * 1000
export const CACHE_WARN_MIN_TOKENS = 100_000

// 'expired', 'alive', or undefined (too short a gap, or the numbers say nothing).
export function classifyGap({ gapMs, input, cacheRead, cacheWrite }) {
  const total = (Number(input) || 0) + (Number(cacheRead) || 0) + (Number(cacheWrite) || 0)
  if (!(gapMs >= CACHE_MIN_GAP_MS) || total < 20_000) return undefined
  if (cacheRead / total < 0.2 && cacheWrite / total >= 0.5) return 'expired'
  if (cacheRead / total >= 0.7) return 'alive'
  return undefined
}

// hint = { expiredMs?, aliveMs? }: the shortest gap seen to expire the cache, the longest seen to keep it.
export function nextHint(hint, gapMs, verdict) {
  const h = { ...hint }
  if (verdict === 'expired') h.expiredMs = h.expiredMs === undefined ? gapMs : Math.min(h.expiredMs, gapMs)
  if (verdict === 'alive') h.aliveMs = h.aliveMs === undefined ? gapMs : Math.max(h.aliveMs, gapMs)
  return h
}

// Warn only when an expiry has been seen at a gap no longer than this one, the cache has not been seen
// alive across a gap this long, and the context is big enough for the re-read to cost something.
export function shouldWarnCold(hint, gapMs, contextTokens) {
  if (!hint || hint.expiredMs === undefined) return false
  if (typeof contextTokens !== 'number' || contextTokens < CACHE_WARN_MIN_TOKENS) return false
  if (hint.aliveMs !== undefined && hint.aliveMs >= gapMs) return false
  return gapMs >= hint.expiredMs
}

export function parseHint(text) {
  try {
    const h = JSON.parse(text)
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
    return { expiredMs: ok(h?.expiredMs) ? h.expiredMs : undefined, aliveMs: ok(h?.aliveMs) ? h.aliveMs : undefined }
  } catch (err) {
    return {}
  }
}
