#!/usr/bin/env node
// crew-chief stale-instruction scan (ONERILER-26 item 10c). Node 22, no dependencies. Read-only: it never writes a file and
// never touches the network.
//
// Usage: node stale-scan.mjs [paths...] [--json] [--strict]
//   paths    files or folders (folders: every *.md inside, recursively). Without paths the default scope is used:
//            ./CLAUDE.md, ./CLAUDE.local.md, ~/.claude/CLAUDE.md, the project's auto-memory folder
//            ~/.claude/projects/<cwd with / and . replaced by ->/memory/*.md, ./.claude/agents/*.md, ./agents/*.md,
//            ~/.claude/agents/*.md. A path that does not exist is skipped. STATUS.md is never scanned (its Constraints are
//            the user's own words, verbatim), even when named on the command line.
//   --json   print the hits as one JSON array [{file, line, rule, severity, text, fix}]
//   --strict exit 1 when there is any hit (for tests); without it the exit code is 0
// Output: one line per hit, `file:line: rule: text -> suggested fix`, then a count line.
// Rules (English and Turkish): always-delegate, token-budget, absolute-never (severity warn). A line, or the line above it,
// containing `crew-chief:keep` is skipped. The scan only reports; fixing is the user's call.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findTokenBudget, isUnscopedAbsolute } from './brief-check.mjs'

const ALWAYS_DELEGATE = /\balways\s+(delegate|use\s+(a\s+|an\s+|the\s+)?(sub-?agents?|agents?))\b|her zaman\s+(delege|alt\s?ajan|ajan)|\bhep\s+(ajan|delege)/i

export const RULES = [
  {
    id: 'always-delegate',
    severity: 'hit',
    test: (line) => ALWAYS_DELEGATE.test(line),
    fix: 'Delegate when the work is self-contained and parallel, or would flood your context; otherwise do it yourself.',
  },
  {
    id: 'token-budget',
    severity: 'hit',
    test: (line) => findTokenBudget(line) !== null,
    fix: 'State the scope and a stop rule instead of a token number.',
  },
  {
    id: 'absolute-never',
    severity: 'warn',
    test: (line) => isUnscopedAbsolute(line),
    fix: 'Name the case and the reason, or say "ask before X".',
  },
]

export function scanText(text) {
  const lines = String(text).split('\n')
  const hits = []
  lines.forEach((line, i) => {
    if (line.includes('crew-chief:keep') || (i > 0 && lines[i - 1].includes('crew-chief:keep'))) return
    for (const rule of RULES) {
      if (rule.test(line)) hits.push({ line: i + 1, rule: rule.id, severity: rule.severity, text: line.trim().slice(0, 140), fix: rule.fix })
    }
  })
  return hits
}

// Claude Code names a project's memory folder after its path with every / and . replaced by -.
export function memorySlug(cwd) {
  return String(cwd).replace(/[/.]/g, '-')
}

function mdIn(dir, recursive) {
  let out = []
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const n of names.sort()) {
    const p = join(dir, n)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (recursive && n !== 'node_modules' && n !== '.git') out = out.concat(mdIn(p, true))
    } else if (n.endsWith('.md')) out.push(p)
  }
  return out
}

export function defaultTargets({ cwd = process.cwd(), home = homedir() } = {}) {
  return [
    join(cwd, 'CLAUDE.md'),
    join(cwd, 'CLAUDE.local.md'),
    join(home, '.claude', 'CLAUDE.md'),
    ...mdIn(join(home, '.claude', 'projects', memorySlug(cwd), 'memory'), false),
    ...mdIn(join(cwd, '.claude', 'agents'), false),
    ...mdIn(join(cwd, 'agents'), false),
    ...mdIn(join(home, '.claude', 'agents'), false),
  ]
}

export function expandTargets(paths) {
  const seen = new Set()
  const files = []
  for (const p of paths) {
    let list
    try {
      const st = statSync(p)
      list = st.isDirectory() ? mdIn(p, true) : [p]
    } catch {
      continue // a path that does not exist is skipped
    }
    for (const f of list) {
      const abs = resolve(f)
      if (basename(abs) === 'STATUS.md' || seen.has(abs) || !existsSync(abs)) continue
      seen.add(abs)
      files.push(abs)
    }
  }
  return files
}

export function scanFiles(files) {
  const hits = []
  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const h of scanText(text)) hits.push({ file, ...h })
  }
  return hits
}

function shown(file, cwd, home) {
  if (file.startsWith(cwd + '/')) return relative(cwd, file)
  if (file.startsWith(home + '/')) return '~/' + relative(home, file)
  return file
}

function main(argv) {
  const paths = []
  let json = false
  let strict = false
  for (const a of argv) {
    if (a === '--json') json = true
    else if (a === '--strict') strict = true
    else if (a.startsWith('--')) {
      console.error(`stale-scan: unknown option ${a}`)
      return 2
    } else paths.push(a)
  }
  const cwd = process.cwd()
  const home = homedir()
  const files = expandTargets(paths.length ? paths : defaultTargets({ cwd, home }))
  const hits = scanFiles(files)
  if (json) console.log(JSON.stringify(hits, null, 2))
  else {
    for (const h of hits) console.log(`${shown(h.file, cwd, home)}:${h.line}: ${h.rule}: ${h.text} -> ${h.fix}`)
    console.log(`stale-scan: ${hits.length} hit${hits.length === 1 ? '' : 's'} in ${files.length} file${files.length === 1 ? '' : 's'} (report only, nothing was changed)`)
  }
  return strict && hits.length ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2))
