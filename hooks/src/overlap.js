// A note, never a block, when an Agent call for a writing agent (implementer, implementer-hard, mechanic) names
// files that another running writer's brief also named: parallel edits to one file collide, and the routing
// skill says to give parallel implementers disjoint file sets. The model sees the note with the call's result
// and decides; nothing is stopped. Briefs are free text, so the files are found by shape (hooks/overlap-logic.mjs).
import { briefPaths, isWriterType, overlapping } from './overlap-logic.mjs'

let writers = [] // { paths, who } of the writing agents started in this stretch of the session

export function overlapReset() {
  writers = []
}

export async function overlapObserve($, e) {
  try {
    if (e.tool !== 'Agent' || !isWriterType(e.subagent_type)) return undefined
    const list = await $.agent.list()
    const running = Array.isArray(list) ? list.filter((a) => a.status === 'pending' || a.status === 'running').length : 0
    if (running === 0) writers = [] // nothing else is running, so nothing can collide
    const paths = briefPaths(e.prompt)
    const who = String(e.subagent_type).replace(/^.*:/, '')
    let note
    for (const w of writers) {
      const hit = overlapping(paths, w.paths)
      if (hit.length > 0) {
        note = `crew-chief: this brief names the same file(s) as a ${w.who} you started earlier and that may still be running: ${hit.slice(0, 4).join(', ')}. Two agents editing one file at once collide. Wait for it to finish, or give each agent its own files.`
        break
      }
    }
    if (paths.length > 0) writers.push({ paths, who })
    return note
  } catch (err) {
    return undefined
  }
}
