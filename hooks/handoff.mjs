// Finds the project's handoff files (see skills/crew-handoff) for the compact flow and /crew-tidy.
// The lookup order matches scripts/compact-restore.sh: STATUS.md (or durum.md) next to the working
// directory, then at the repository root, then one level down. A mod's analyser follows `$` only into
// function declarations, so this is one, shared by the files that need it.

async function safe(fn, fallback) {
  try {
    return await fn()
  } catch (err) {
    return fallback
  }
}

export async function findHandoff($) {
  const cwd = await safe(() => $.session.cwd(), undefined)
  if (!cwd) return undefined
  const root = (await safe(() => $.session.root(), cwd)) || cwd
  const dirs = [...new Set([cwd, root])]
  const names = ['STATUS.md', 'durum.md']
  let dir
  let status
  for (const d of dirs) {
    for (const n of names) {
      if (!status && (await safe(() => $.fs.exists(`${d}/${n}`), false))) {
        dir = d
        status = `${d}/${n}`
      }
    }
  }
  if (!status) {
    const entries = await safe(() => $.fs.list(root), [])
    for (const entry of entries) {
      if (status || entry.kind !== 'dir' || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      for (const n of names) {
        if (!status && (await safe(() => $.fs.exists(`${root}/${entry.name}/${n}`), false))) {
          dir = `${root}/${entry.name}`
          status = `${dir}/${n}`
        }
      }
    }
  }
  let tasks
  for (const d of [dir, cwd, root]) {
    if (!tasks && d && (await safe(() => $.fs.exists(`${d}/tasks.json`), false))) tasks = `${d}/tasks.json`
  }
  let progress
  if (dir) {
    for (const n of ['PROGRESS.md', 'ilerleme.md']) {
      if (!progress && (await safe(() => $.fs.exists(`${dir}/${n}`), false))) progress = `${dir}/${n}`
    }
  }
  if (!status && !tasks) return undefined
  return { dir, status, tasks, progress }
}
