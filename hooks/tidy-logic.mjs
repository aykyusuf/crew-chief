// Pure helpers for /crew-tidy (hooks/tidy-flow.mjs): what in the context is oversized, repeated, or
// points at something that is gone. No Claude Code API in here, so tests/tidy-logic.test.mjs runs them.
// Everything here only measures; deciding what to cut stays with the person.

// Anthropic's guidance (checked 2026-10): a CLAUDE.md under about 200 lines; auto memory loads the
// first 200 lines or 25 KB of MEMORY.md and drops the rest without a word.
export const INSTRUCTION_LINES = 200
export const MEMORY_LINES = 200
export const MEMORY_BYTES = 25 * 1024
// STATUS.md is read at every session start, so it pays for itself every time.
export const STATUS_BYTES = 6 * 1024
export const MCP_NOTABLE_TOKENS = 2000
export const DUPLICATE_MIN_CHARS = 30

export function measure(text) {
  const s = String(text)
  const lines = s === '' ? 0 : s.replace(/\n$/, '').split('\n').length
  return { lines, bytes: new TextEncoder().encode(s).length }
}

// auto memory's index is a list of "- [Title](file.md) — hook" lines; the files they name.
export function memoryIndexLinks(text) {
  const out = []
  for (const m of String(text).matchAll(/\]\(([^)\s#]+\.md)(?:#[^)\s]*)?\)/g)) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(m[1]) && !m[1].startsWith('/')) out.push(m[1])
  }
  return [...new Set(out)]
}

const FILE_EXT = /\.(md|json|ya?ml|toml|lock|txt|sh|py|rb|go|rs|java|kt|swift|dart|js|jsx|mjs|cjs|ts|tsx|css|scss|html|sql|env|cfg|ini|gradle|plist)$/i

// Paths written in `backticks` outside fenced blocks: the ones a reader could check against the
// project folder. URLs, globs, placeholders, version-like words and home-relative paths are skipped,
// so a finding is a real reference that leads nowhere, not a guess.
export function extractPathRefs(text) {
  const out = []
  let fenced = false
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    for (const m of line.matchAll(/`([^`\s]{3,200})`/g)) {
      const raw = m[1].replace(/[.,;:]+$/, '')
      if (/[*?<>{}$|\\=()[\]"'!@#%^&+~]/.test(raw)) continue
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue
      const looksLikePath = raw.includes('/') ? /^[\w.-]+(\/[\w.-]+)*\/$|^[\w.-]+(\/[\w.-]+)+$|^\.{0,2}\/[\w./-]+$/.test(raw) : FILE_EXT.test(raw)
      if (!looksLikePath) continue
      if (/^\d+(\.\d+)*$/.test(raw)) continue
      out.push(raw)
    }
  }
  return [...new Set(out)]
}

// Lines (long enough to mean something) that appear more than once in the files given together,
// keyed by their trimmed text. Headings, tables, fences and list-only markers are not repeats.
export function findDuplicateLines(files) {
  const seen = new Map()
  for (const file of files) {
    for (const raw of String(file.text).split(/\r?\n/)) {
      const line = raw.trim().replace(/^[-*]\s+/, '')
      if (line.length < DUPLICATE_MIN_CHARS) continue
      if (/^(#|\||```|~~~|<!--|---)/.test(line)) continue
      const entry = seen.get(line) ?? { line, where: [] }
      entry.where.push(file.path)
      seen.set(line, entry)
    }
  }
  return [...seen.values()].filter((e) => e.where.length > 1)
}

// MCP tools grouped by server: how many tools, how many tokens, how many are loaded now.
export function summarizeMcp(tools) {
  const by = new Map()
  for (const tool of tools ?? []) {
    const row = by.get(tool.serverName) ?? { server: tool.serverName, count: 0, tokens: 0, loaded: 0 }
    row.count += 1
    row.tokens += Number(tool.tokens) || 0
    if (tool.isLoaded) row.loaded += 1
    by.set(tool.serverName, row)
  }
  return [...by.values()].sort((a, b) => b.tokens - a.tokens)
}

// Whether a path is one of the person's global files (outside any project): reported, never changed.
export function isGlobalPath(path, home) {
  return typeof home === 'string' && home !== '' && String(path).startsWith(home + '/.claude/') && !String(path).includes('/.claude/projects/')
}

export function kb(bytes) {
  return (bytes / 1024).toFixed(1)
}
