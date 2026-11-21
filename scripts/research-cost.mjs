#!/usr/bin/env node
// crew-chief research cost estimate (ONERILER-26 item 10b). Node 22, no dependencies. Prints numbers only: no network, writes nothing.
//
// Usage: node research-cost.mjs --mode economic|full --groups G [--claims N] [--calibrate <trial group tokens>] [--json] [--config <file>]
//   --mode      economic (alias ekonomik): G researchers (1-3) + 1 verifier. full (alias tam): G researchers + ceil(N/8)
//               verifiers + min(ceil(G/2), 4) counter-evidence agents + 1 reporter.
//   --groups    number of research groups (one researcher each)
//   --claims    expected number of claims (default: groups x claimsPerGroup from the config)
//   --calibrate the real token count of one measured researcher group (read it in /workflows); it replaces the researcher
//               range with 0.8x to 1.25x of that figure. Other roles keep their guesses.
//   --config    another constants file (default: data/research-cost.json next to this script)
// Re-checks: a claim where the tool and the verifier disagree is re-run once on Opus medium by the skill. The estimate counts
// "up to R re-checks" (R = min(ceil(claims x recheckShare), recheckCap)); they are in the high figure and not in the low one.
// Output (text), then warnings:
//   research-cost: full mode, 6 groups, 40 claims
//   formula: 6 researchers + 5 verifiers (8 claims each) + 3 counters + 1 reporter = 15 agents, plus up to 4 re-checks
//   15 agents (up to 4 re-checks more), about 730k to 3.3M tokens (rough, +-2x; the constants are guesses, a trial group replaces them)
// With --json one object: { mode, groups, claims, agents: {researcher, verifier, counter, reporter, total, rechecksUpTo, maxTotal},
// tokens: {low, high}, formula, warnings: [], trialFirst, calibrated }. Warnings fire when agents (with re-checks) exceed warnAgents
// or the high token figure exceeds warnTokens (these mirror Claude Code's own "Large workflow" thresholds, which only advise after
// launch), or the group count is out of range; in full mode trialFirst is always true (run group 1 first). Exit 0, or 2 on bad arguments.
// The numbers are for the user-facing question only; never write them into a brief.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DEFAULTS = {
  roles: {
    researcher: { low: 60000, high: 250000 },
    verifier: { low: 40000, high: 150000 },
    counter: { low: 50000, high: 200000 },
    reporter: { low: 20000, high: 60000 },
    recheck: { low: 30000, high: 100000 },
  },
  batchSize: 8,
  counterCap: 4,
  claimsPerGroup: 6,
  recheckShare: 0.1,
  recheckCap: 6,
  economicMaxGroups: 3,
  fullMaxGroups: 8,
  warnAgents: 25,
  warnTokens: 1500000,
}

const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
const nonneg = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0

// A missing, malformed or nonsensical value falls back to the built-in default, key by key.
export function mergeConfig(raw) {
  const out = JSON.parse(JSON.stringify(DEFAULTS))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const role of Object.keys(DEFAULTS.roles)) {
    const r = raw.roles && raw.roles[role]
    if (r && pos(r.low) && pos(r.high) && r.high >= r.low) out.roles[role] = { low: r.low, high: r.high }
  }
  for (const k of ['batchSize', 'counterCap', 'claimsPerGroup', 'recheckCap', 'economicMaxGroups', 'fullMaxGroups', 'warnAgents', 'warnTokens']) {
    if (pos(raw[k])) out[k] = Math.floor(raw[k])
  }
  if (nonneg(raw.recheckShare) && raw.recheckShare <= 1) out.recheckShare = raw.recheckShare
  return out
}

export function loadConfig(file) {
  try {
    return mergeConfig(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return mergeConfig(null)
  }
}

export function estimate({ mode, groups, claims, calibrate }, cfg = mergeConfig(null)) {
  const full = mode === 'full'
  const g = groups
  const n = claims === undefined ? g * cfg.claimsPerGroup : claims
  const roles = JSON.parse(JSON.stringify(cfg.roles))
  if (pos(calibrate)) roles.researcher = { low: Math.round(calibrate * 0.8), high: Math.round(calibrate * 1.25) }
  const verifier = full ? Math.ceil(n / cfg.batchSize) : 1
  const counter = full ? Math.min(Math.ceil(g / 2), cfg.counterCap) : 0
  const reporter = full ? 1 : 0
  const total = g + verifier + counter + reporter
  const rechecksUpTo = Math.min(Math.ceil(n * cfg.recheckShare), cfg.recheckCap)
  const low = g * roles.researcher.low + verifier * roles.verifier.low + counter * roles.counter.low + reporter * roles.reporter.low
  const high = g * roles.researcher.high + verifier * roles.verifier.high + counter * roles.counter.high + reporter * roles.reporter.high + rechecksUpTo * roles.recheck.high
  const parts = [`${g} researcher${g === 1 ? '' : 's'}`, `${verifier} verifier${verifier === 1 ? '' : 's'}${full ? ` (${cfg.batchSize} claims each)` : ''}`]
  if (full) parts.push(`${counter} counter${counter === 1 ? '' : 's'}`, `${reporter} reporter`)
  const formula = `${parts.join(' + ')} = ${total} agents, plus up to ${rechecksUpTo} re-check${rechecksUpTo === 1 ? '' : 's'}`
  const warnings = []
  const maxGroups = full ? cfg.fullMaxGroups : cfg.economicMaxGroups
  if (g > maxGroups) warnings.push(`${g} groups is more than ${full ? 'full' : 'economic'} mode takes (${maxGroups}): cut scope or merge groups`)
  if (total + rechecksUpTo > cfg.warnAgents) warnings.push(`${total + rechecksUpTo} agents at most is more than ${cfg.warnAgents}: run one group first as a trial, or cut scope`)
  if (high > cfg.warnTokens) warnings.push(`the high estimate (${fmt(high)} tokens) is above ${fmt(cfg.warnTokens)}: run one group first as a trial, or cut scope`)
  if (full) warnings.push('full mode: run group 1 alone first as a trial, then ask before running the rest (the trial replaces these guesses: --calibrate <its tokens>)')
  return {
    mode,
    groups: g,
    claims: n,
    agents: { researcher: g, verifier, counter, reporter, total, rechecksUpTo, maxTotal: total + rechecksUpTo },
    tokens: { low, high },
    formula,
    warnings,
    trialFirst: full,
    calibrated: pos(calibrate),
  }
}

export function fmt(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

export function formatEstimate(e) {
  const a = e.agents
  return [
    `research-cost: ${e.mode} mode, ${e.groups} group${e.groups === 1 ? '' : 's'}, ${e.claims} claim${e.claims === 1 ? '' : 's'}`,
    `formula: ${e.formula}`,
    `${a.total} agents (up to ${a.rechecksUpTo} re-check${a.rechecksUpTo === 1 ? '' : 's'} more), about ${fmt(e.tokens.low)} to ${fmt(e.tokens.high)} tokens (rough, +-2x; the constants are guesses${e.calibrated ? ', researcher calibrated from a trial group' : ', a trial group replaces them'})`,
    ...e.warnings.map((w) => `warn: ${w}`),
  ].join('\n')
}

function intArg(name, v, min) {
  if (!/^\d+$/.test(String(v ?? '')) || Number(v) < min) throw new Error(`${name} needs a whole number of at least ${min}`)
  return Number(v)
}

function main(argv) {
  const opt = {}
  let json = false
  let config = fileURLToPath(new URL('../data/research-cost.json', import.meta.url))
  try {
    for (let i = 0; i < argv.length; i++) {
      let a = argv[i]
      let v
      const eq = a.indexOf('=')
      if (a.startsWith('--') && eq > 0) {
        v = a.slice(eq + 1)
        a = a.slice(0, eq)
      }
      const val = () => (v !== undefined ? v : argv[++i])
      if (a === '--json') json = true
      else if (a === '--mode') opt.mode = val()
      else if (a === '--groups') opt.groups = intArg('--groups', val(), 1)
      else if (a === '--claims') opt.claims = intArg('--claims', val(), 0)
      else if (a === '--calibrate') opt.calibrate = intArg('--calibrate', val(), 1)
      else if (a === '--config') config = val()
      else throw new Error(`unknown argument ${a}`)
    }
    const alias = { economic: 'economic', ekonomik: 'economic', full: 'full', tam: 'full' }
    opt.mode = alias[String(opt.mode).toLowerCase()]
    if (!opt.mode) throw new Error('--mode must be economic or full')
    if (opt.groups === undefined) throw new Error('--groups is required')
  } catch (e) {
    console.error(`research-cost: ${e.message}`)
    console.error('usage: node research-cost.mjs --mode economic|full --groups G [--claims N] [--calibrate <tokens>] [--json]')
    return 2
  }
  const e = estimate(opt, loadConfig(config))
  console.log(json ? JSON.stringify(e, null, 2) : formatEstimate(e))
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2))
