// Two agents that write the same files at the same time collide. The brief of an Agent call is free text,
// so the files it names are found by shape: a path with a slash, or a name with a file extension. Pure
// functions, no Claude Code API, so tests/overlap-logic.test.mjs can run them with plain Node.

const PATH = /(?:^|[\s`'"(\[])((?:\.{0,2}\/)?(?:[\w.-]+\/)+(?:[\w.-]*[\w-])?|[\w-]+\.[A-Za-z][A-Za-z0-9]{0,4})(?=$|[\s`'",):;\].]|\.\s)/g
const NOT_FILES = /^(e\.g|i\.e|vs|etc|\d+(\.\d+)+)\.?$/i

// The file and folder names a brief mentions, normalised (no leading ./, no trailing slash, lower case).
export function briefPaths(text) {
  const out = new Set()
  for (const m of String(text ?? '').matchAll(PATH)) {
    let p = m[1].replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()
    if (p.length < 3 || /^[a-z][a-z0-9+.-]*:\/\//.test(p) || NOT_FILES.test(p)) continue
    if (/^https?:/.test(p) || p.startsWith('//')) continue
    out.add(p)
  }
  return [...out]
}

// Whether two names collide: the same file, or one is a folder holding the other.
function collides(a, b) {
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/')
}

// The names in `paths` that collide with a name in `other`.
export function overlapping(paths, other) {
  const hit = []
  for (const p of paths) if (other.some((q) => collides(p, q))) hit.push(p)
  return hit
}

// Only agents that write are worth watching (crew-chief's writers, by name).
export function isWriterType(type) {
  return /(^|:)(implementer|implementer-hard|mechanic)$/.test(String(type ?? ''))
}
