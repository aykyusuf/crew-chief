import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'

const dir = new URL('../agents/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
const front = (name) => {
  const text = readFileSync(new URL(name, dir), 'utf8')
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  assert.ok(m, name + ': frontmatter')
  return Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))
}

test('every agent has name = file name, description, model, effort and a turn limit', () => {
  assert.ok(files.length >= 10)
  for (const f of files) {
    const fm = front(f)
    assert.equal(fm.name, f.replace(/\.md$/, ''), f)
    assert.ok(fm.description.length > 60, f + ': description')
    assert.ok(['haiku', 'sonnet', 'opus'].includes(fm.model), f + ': model')
    assert.ok(['low', 'medium', 'high'].includes(fm.effort), f + ': effort')
    assert.ok(Number(fm.maxTurns) > 0, f + ': maxTurns')
  }
})

test('mechanic is a cheap writer and planner a read-only Opus, both named in the policy and the routing skill', () => {
  const mech = front('mechanic.md')
  assert.equal(mech.model, 'haiku')
  assert.ok(mech.tools.includes('Edit') && !mech.tools.includes('Write'))
  const plan = front('planner.md')
  assert.equal(plan.model, 'opus')
  assert.ok(!plan.tools.includes('Edit'))
  const policy = readFileSync(new URL('../scripts/session-policy.sh', import.meta.url), 'utf8')
  const skill = readFileSync(new URL('../skills/crew-routing/SKILL.md', import.meta.url), 'utf8')
  const guard = readFileSync(new URL('../scripts/readonly-guard.sh', import.meta.url), 'utf8')
  for (const n of ['mechanic', 'planner']) {
    assert.ok(policy.includes('crew-chief:' + n), n + ' in policy')
    assert.ok(skill.includes('crew-chief:' + n), n + ' in routing skill')
  }
  assert.ok(guard.includes('crew-chief:planner'))
  assert.ok(!guard.includes('crew-chief:mechanic'))
})

test('every read-only agent that can write reports is covered by the read-only guard', () => {
  const guard = readFileSync(new URL('../scripts/readonly-guard.sh', import.meta.url), 'utf8')
  for (const f of files) {
    const fm = front(f)
    if (!fm.tools.includes('Edit')) assert.ok(guard.includes('crew-chief:' + fm.name) || fm.name.startsWith('ui-tester'), fm.name)
  }
})

test('writing agents ask the caller about a missing dependency instead of installing; the routing skill says what the caller does', () => {
  for (const n of ['implementer', 'implementer-hard', 'mechanic']) {
    const text = readFileSync(new URL(n + '.md', dir), 'utf8')
    assert.ok(text.includes('install packages'), n)
    assert.ok(text.includes('declared dependency is missing'), n + ': dependency protocol')
    assert.ok(text.includes('the caller owns'), n + ': reason given')
  }
  const skill = readFileSync(new URL('../skills/crew-routing/SKILL.md', import.meta.url), 'utf8')
  assert.ok(skill.includes('dependency is missing') && skill.includes('ask the user first'))
  assert.ok(skill.includes('If your own model is Fable'))
  const policy = readFileSync(new URL('../scripts/session-policy.sh', import.meta.url), 'utf8')
  assert.ok(policy.includes('If your own model is Fable'))
})

test('every agent says why it is read-only or limited, batches independent calls, and the web agents check the date', () => {
  for (const n of ['scanner', 'deep-reader', 'planner', 'reviewer']) {
    assert.ok(/owns? (every|the) change/.test(readFileSync(new URL(n + '.md', dir), 'utf8')), n + ': reason for being read-only')
  }
  for (const n of ['scanner', 'deep-reader', 'planner', 'reviewer', 'implementer', 'implementer-hard', 'mechanic']) {
    assert.ok(/[Bb]atch independent/.test(readFileSync(new URL(n + '.md', dir), 'utf8')), n + ': batching')
  }
  for (const n of ['deep-reader', 'planner']) assert.ok(readFileSync(new URL(n + '.md', dir), 'utf8').includes('date +%F'), n + ': date')
  for (const n of ['implementer', 'implementer-hard']) assert.ok(readFileSync(new URL(n + '.md', dir), 'utf8').includes('special-cases the test inputs'), n + ': no hardcoding')
})

test('the handoff routine reviews stale constraints without deleting them', () => {
  const routine = readFileSync(new URL('../skills/crew-handoff/assets/claude-md-routine.md', import.meta.url), 'utf8')
  assert.ok(routine.includes('do not delete it') && routine.includes('reason and scope'))
})

test('ui-implementer: Sonnet/medium writer with the design skills preloaded; every preloaded skill is a skill folder of this plugin', () => {
  const text = readFileSync(new URL('ui-implementer.md', dir), 'utf8')
  const fm = front('ui-implementer.md')
  assert.equal(fm.model, 'sonnet')
  assert.equal(fm.effort, 'medium')
  for (const t of ['Read', 'Edit', 'Write', 'Bash', 'Skill']) assert.ok(fm.tools.includes(t), 'tool ' + t)
  const block = /\nskills:\n((?:  - .+\n)+)/.exec(text)
  assert.ok(block, 'skills: list in the frontmatter')
  const skills = block[1].trim().split('\n').map((l) => l.replace(/^\s*-\s+/, '').trim())
  assert.deepEqual(skills, ['crew-chief:frontend-design', 'crew-chief:ui-ux-pro-max', 'crew-chief:thesvg', 'crew-chief:animation-performance'])
  for (const s of skills) {
    assert.ok(s.startsWith('crew-chief:'), s)
    assert.ok(existsSync(new URL('../skills/' + s.slice('crew-chief:'.length) + '/SKILL.md', import.meta.url)), s + ' exists as a skill folder')
  }
  assert.ok(!/disable-model-invocation:\s*true/.test(skills.map((s) => readFileSync(new URL('../skills/' + s.slice(11) + '/SKILL.md', import.meta.url), 'utf8')).join('\n')), 'a preloaded skill cannot be model-invocation-disabled')
})

test('ui-implementer: its prompt lists skills first, reads the profile, loads extras, follows the ban list and checklist, uses references, verifies', () => {
  const text = readFileSync(new URL('ui-implementer.md', dir), 'utf8')
  for (const part of ['lists the skills you have', '.crew-chief/ui-profile.json', 'Skill tool', 'crew-chief:design-taste-frontend', 'crew-chief:web-3d-perf', 'polish checklist', 'Never ship Claude\'s default look', 'reference image', 'theSVG', 'not verified', 'install packages', 'Batch independent']) {
    assert.ok(text.includes(part), part)
  }
})

test('every skill an agent or the UI policy names exists as a skill folder', () => {
  const policy = JSON.parse(readFileSync(new URL('../data/ui-policy.json', import.meta.url), 'utf8'))
  const names = new Set([...policy.base, ...policy.landing.skills])
  for (const p of Object.values(policy.profiles)) for (const s of p.skills) names.add(s)
  assert.ok(names.size >= 7)
  for (const n of names) {
    assert.ok(n.startsWith('crew-chief:'), n)
    assert.ok(existsSync(new URL('../skills/' + n.slice(11) + '/SKILL.md', import.meta.url)), n + ' missing')
  }
})

test('ui policy: three profiles, motion 0-10, a perf budget, the named ban list, the polish checklist with credit, the reference step', () => {
  const policy = JSON.parse(readFileSync(new URL('../data/ui-policy.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(policy.profiles).sort(), ['calm', 'immersive', 'lively'])
  for (const p of Object.values(policy.profiles)) {
    assert.ok(Number.isInteger(p.motion) && p.motion >= 0 && p.motion <= 10)
    assert.ok(typeof p.perfBudget === 'string' && p.perfBudget.length > 10)
  }
  assert.deepEqual(policy.aliases, { 'static-minimal': 'calm', 'clean-practical': 'lively', 'performance-3d': 'immersive' })
  for (const [old, id] of Object.entries(policy.aliases)) assert.ok(policy.profiles[id] && !policy.profiles[old], old)
  for (const p of Object.values(policy.profiles)) assert.ok(typeof p.label.en === 'string' && p.label.en.length > 10 && typeof p.label.tr === 'string' && p.label.tr.length > 10)
  assert.equal(policy.profiles.calm.label.tr, 'Sakin: neredeyse hareketsiz, hızlı ve net')
  assert.equal(policy.profiles.lively.label.en, 'Lively: measured animation, smooth transitions')
  assert.equal(policy.profiles.immersive.label.en, 'Immersive 3D: a real WebGL scene within a performance budget')
  assert.deepEqual(policy.base, ['crew-chief:frontend-design', 'crew-chief:ui-ux-pro-max'])
  assert.deepEqual(policy.landing.skills, ['crew-chief:design-taste-frontend'])
  assert.deepEqual(policy.profiles['immersive'].skills, ['crew-chief:animate', 'crew-chief:choreograph', 'crew-chief:web-3d-perf'])
  assert.deepEqual(policy.profiles['lively'].skills, ['crew-chief:animate'])
  assert.deepEqual(policy.profiles['calm'].skills, ['crew-chief:remove-animations'])
  const bans = policy.bannedDefaults.join(' | ').toLowerCase()
  for (const w of ['inter', 'arial', 'system font', 'purple', 'cream', 'terracotta', 'serif', 'three equal', 'centred hero']) assert.ok(bans.includes(w), w)
  assert.ok(policy.logos.includes('theSVG') && policy.logos.includes('never hand-drawn'))
  assert.ok(policy.polishChecklist.credit.includes('jakub.kr') && policy.polishChecklist.credit.includes('MIT'))
  const list = policy.polishChecklist.items.join('\n')
  for (const w of ['text-wrap: balance', 'text-wrap: pretty', 'inner radius', 'antialiased', 'tabular-nums', 'layered', 'outline', 'transition: all', '0.96', '44px', 'stroke', 'prefers-reduced-motion']) assert.ok(list.includes(w), w)
  assert.equal(policy.reference.choices.length, 3)
  assert.deepEqual(policy.reference.choices.map((c) => [c.id, c.label.en, c.label.tr]), [['send', "I'll send one", 'Ben göndereyim'], ['find', 'Find some (ui-scout)', 'Sen bul (ui-scout)'], ['none', 'None', 'Yok']])
  assert.deepEqual([policy.reference.scout.agent, policy.reference.scout.model, policy.reference.scout.effort], ['crew-chief:ui-scout', 'sonnet', 'medium'])
  assert.ok(policy.reference.scout.pick.includes('multiSelect') && policy.reference.scout.pick.includes('#1') && policy.reference.scout.pick.includes('does not answer'))
  assert.ok(policy.reference.scout.pick.includes('project-relative'))
  assert.ok(policy.reference.scout.never.includes('ui-tester') && policy.reference.note.includes('never copied 1:1'))
  assert.equal(policy.reference.dir, '.crew-chief/refs')
  assert.ok(policy.reference.reanimate.includes('immersive') && policy.reference.reanimate.includes("user's yes"))
})

test('web-3d-perf skill: own words, the checkable rules are all there, a reasonable size', () => {
  const text = readFileSync(new URL('../skills/web-3d-perf/SKILL.md', import.meta.url), 'utf8')
  assert.ok(/^---\nname: web-3d-perf\n/.test(text))
  assert.ok(text.length > 4000 && text.length < 12000, String(text.length))
  for (const w of ['dpr', 'setPixelRatio', 'IntersectionObserver', 'visibilityState', 'InstancedMesh', 'dispose()', 'renderer.info', 'React.lazy', 'prefers-reduced-motion', 'frameloop', 'Performance panel', 'webglcontextlost']) assert.ok(text.includes(w), w)
})

test('ui-implementer is named in the policy, the routing skill, the setup list and the ultra-saver; the gate is wired', () => {
  const policy = readFileSync(new URL('../scripts/session-policy.sh', import.meta.url), 'utf8')
  const skill = readFileSync(new URL('../skills/crew-routing/SKILL.md', import.meta.url), 'utf8')
  const saver = readFileSync(new URL('../hooks/saver-logic.mjs', import.meta.url), 'utf8')
  const setup = readFileSync(new URL('../skills/crew-setup/SKILL.md', import.meta.url), 'utf8')
  assert.ok(policy.includes('crew-chief:ui-implementer (sonnet/medium)'))
  assert.ok(skill.includes('`crew-chief:ui-implementer` | sonnet / medium'))
  assert.ok(/SONNET_NAMED = .*ui-implementer/.test(saver))
  assert.ok(setup.includes('`ui-implementer.md`'))
  const hooks = JSON.parse(readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'))
  const agentHooks = hooks.hooks.PreToolUse.filter((g) => g.matcher === 'Agent').flatMap((g) => g.hooks.map((h) => h.command))
  assert.ok(agentHooks.some((c) => c.includes('ui-brief-check.sh')))
  assert.ok(agentHooks.some((c) => c.includes('mode-guard.sh')))
  const assets = new URL('../skills/crew-setup/assets/agents/ui-implementer.md', import.meta.url)
  assert.equal(readFileSync(assets, 'utf8'), readFileSync(new URL('ui-implementer.md', dir), 'utf8'))
})

test('ui-designer: read-only Opus/high designer, three design skills preloaded (all exist), writes only the spec, covered by the guard and the saver', () => {
  const text = readFileSync(new URL('ui-designer.md', dir), 'utf8')
  const fm = front('ui-designer.md')
  assert.equal(fm.model, 'opus')
  assert.equal(fm.effort, 'high')
  assert.ok(!fm.tools.includes('Edit') && !fm.tools.includes('MultiEdit'), 'no Edit')
  for (const t of ['Read', 'Write', 'Grep', 'Glob', 'Bash', 'Skill']) assert.ok(fm.tools.includes(t), 'tool ' + t)
  const block = /\nskills:\n((?:  - .+\n)+)/.exec(text)
  assert.ok(block, 'skills: list in the frontmatter')
  const skills = block[1].trim().split('\n').map((l) => l.replace(/^\s*-\s+/, '').trim())
  assert.deepEqual(skills, ['crew-chief:frontend-design', 'crew-chief:ui-ux-pro-max', 'crew-chief:design-taste-frontend'])
  for (const s of skills) assert.ok(existsSync(new URL('../skills/' + s.slice('crew-chief:'.length) + '/SKILL.md', import.meta.url)), s + ' exists as a skill folder')
  for (const part of ['read-only', '.crew-chief/design/<slug>.md', 'no code', 'owns every change', 'lists the skills you have', '.crew-chief/ui-profile.json', 'Never ship Claude\'s default look', 'Batch independent', 'Direction', 'Palette', 'Type', 'Layout', 'Components', 'Motion', 'Per-screen notes', 'Acceptance checks', 'hex']) {
    assert.ok(text.includes(part), part)
  }
  const policy = readFileSync(new URL('../scripts/session-policy.sh', import.meta.url), 'utf8')
  const skill = readFileSync(new URL('../skills/crew-routing/SKILL.md', import.meta.url), 'utf8')
  const guard = readFileSync(new URL('../scripts/readonly-guard.sh', import.meta.url), 'utf8')
  const setup = readFileSync(new URL('../skills/crew-setup/SKILL.md', import.meta.url), 'utf8')
  const saver = readFileSync(new URL('../hooks/saver-logic.mjs', import.meta.url), 'utf8')
  assert.ok(policy.includes('crew-chief:ui-designer (opus/high)'))
  assert.ok(skill.includes('`crew-chief:ui-designer` | opus / high'))
  assert.ok(guard.includes('crew-chief:ui-designer') && guard.includes('.crew-chief/design'))
  assert.ok(setup.includes('`ui-designer.md`'))
  assert.ok(/HEAVY_AGENT = .*ui-designer/.test(saver) && /HIGH_FIRST = .*ui-designer/.test(saver))
  const assets = new URL('../skills/crew-setup/assets/agents/ui-designer.md', import.meta.url)
  assert.equal(readFileSync(assets, 'utf8'), text)
})

test('the ui policy has the model rules: every rule a model and an effort, none above high, never Sonnet xhigh, Fable never, a designer split', () => {
  const policy = JSON.parse(readFileSync(new URL('../data/ui-policy.json', import.meta.url), 'utf8'))
  const m = policy.models
  assert.deepEqual(Object.keys(m.rules), ['small-fix', 'with-direction', 'clear-work', 'new-no-direction', 'new-3d-scene', 'repair', 'repair-twice'])
  const want = { 'small-fix': ['sonnet', 'medium'], 'with-direction': ['sonnet', 'high'], 'clear-work': ['opus', 'medium'], 'new-no-direction': ['opus', 'high'], 'new-3d-scene': ['opus', 'high'], repair: ['sonnet', 'medium'], 'repair-twice': ['opus', 'high'] }
  for (const [id, rule] of Object.entries(m.rules)) {
    assert.deepEqual([rule.model, rule.effort], want[id], id)
    assert.ok(['sonnet', 'opus'].includes(rule.model) && ['low', 'medium', 'high'].includes(rule.effort), id + ': never fable, never above high')
    assert.ok(rule.when.length > 10, id)
  }
  const never = m.never.join(' | ')
  assert.ok(never.includes('sonnet at xhigh') && never.includes('effort above high') && never.includes('Fable'))
  assert.deepEqual([m.designer.agent, m.designer.model, m.designer.effort, m.designer.specDir], ['crew-chief:ui-designer', 'opus', 'high', '.crew-chief/design'])
  assert.deepEqual([m.designer.builder.agent, m.designer.builder.model, m.designer.builder.effort], ['crew-chief:ui-implementer', 'sonnet', 'high'])
  // ui-implementer keeps its own frontmatter default; the per-call parameters override it
  const impl = front('ui-implementer.md')
  assert.deepEqual([impl.model, impl.effort], ['sonnet', 'medium'])
  const skill = readFileSync(new URL('../skills/crew-routing/SKILL.md', import.meta.url), 'utf8')
  for (const part of ['pass `model` and `effort` on every UI Agent call', 'opus / medium', 'opus / high', 'sonnet / high', 'Never sonnet at xhigh', 'never a Fable model unless the user asked for Fable', 'crew-chief:ui-designer', '.crew-chief/design/<slug>.md']) assert.ok(skill.includes(part), part)
})

test('the Fable gate and the UI gate are both wired on the Agent matcher, and the Fable gate script exists and is executable', () => {
  const hooks = JSON.parse(readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'))
  const agentHooks = hooks.hooks.PreToolUse.filter((g) => g.matcher === 'Agent').flatMap((g) => g.hooks.map((h) => h.command))
  assert.ok(agentHooks.some((c) => c.includes('fable-gate.sh')))
  assert.ok(statSync(new URL('../scripts/fable-gate.sh', import.meta.url)).mode & 0o111, 'executable')
})

test('profile pages override, the real-3D rule, no commentary on the pick and the 360px checklist item are in the policy, the agents and the skills', () => {
  const policy = JSON.parse(readFileSync(new URL('../data/ui-policy.json', import.meta.url), 'utf8'))
  assert.ok(policy.profileDocs.pages.includes('file paths or route globs') && policy.profileDocs.pages.includes('profile, motion, perfBudget and notes'))
  assert.ok(policy.profileDocs.rule.includes('no profile question') || policy.profileDocs.rule.includes('gets no profile question'))
  assert.ok(policy.profileDocs.noCommentary.includes('no recommended option') && policy.profileDocs.noCommentary.includes('too heavy'))
  const rule = policy.profiles['immersive'].rule
  assert.ok(rule.includes('Three.js/WebGL') && rule.includes('react-three-fiber') && rule.includes('CSS or SVG imitation is not acceptable') && rule.includes('say so explicitly'))
  assert.ok(!policy.profiles['lively'].rule && !policy.profiles['calm'].rule)
  assert.ok(policy.polishChecklist.items.some((i) => i.includes('no horizontal overflow at 360px') && i.includes('header')))
  for (const n of ['ui-implementer', 'ui-designer']) {
    const text = readFileSync(new URL(n + '.md', dir), 'utf8')
    assert.ok(text.includes('`pages` object') && text.includes('uses the default, without a question'), n + ': pages')
    assert.ok(text.includes('real 3D scene') && text.includes('CSS or SVG imitation') && text.includes('say so explicitly'), n + ': real 3D')
  }
  const perf = readFileSync(new URL('../skills/web-3d-perf/SKILL.md', import.meta.url), 'utf8')
  assert.ok(perf.includes('Real 3D only') && perf.includes('CSS or SVG imitation') && perf.includes('say so explicitly'))
  const skill = readFileSync(new URL('../skills/crew-routing/SKILL.md', import.meta.url), 'utf8')
  assert.ok(skill.includes('`pages` object') && skill.includes('no recommended option') && skill.includes('real Three.js/WebGL scene'))
})

test('ui-scout: Sonnet/medium scout with the browser tools, no Edit, writes only under .crew-chief/refs, untrusted pages, inspiration only', () => {
  const text = readFileSync(new URL('ui-scout.md', dir), 'utf8')
  const fm = front('ui-scout.md')
  assert.equal(fm.model, 'sonnet')
  assert.equal(fm.effort, 'medium')
  assert.ok(!fm.tools.includes('Edit') && !fm.tools.includes('MultiEdit'), 'no Edit')
  const cic = (n) => 'mcp__claude-in-chrome__' + n
  const scoutList = fm.tools.split(',').map((x) => x.trim())
  for (const n of ['tabs_context_mcp', 'tabs_create_mcp', 'tabs_close_mcp', 'navigate', 'computer', 'read_page', 'get_page_text', 'find', 'resize_window', 'read_console_messages', 'list_connected_browsers', 'select_browser']) assert.ok(scoutList.includes(cic(n)), n)
  for (const n of ['form_input', 'file_upload', 'upload_image', 'javascript_tool', 'gif_creator', 'browser_batch', 'read_network_requests', 'switch_browser']) assert.ok(!scoutList.includes(cic(n)), 'scout has no ' + n)
  for (const part of ['Claude in Chrome: not used, because', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '15000', 'preloader', 'never a reference']) assert.ok(text.includes(part), part)
  for (const t of ['Read', 'Write', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill', 'ToolSearch']) assert.ok(fm.tools.split(',').map((x) => x.trim()).includes(t), 'tool ' + t)
  assert.ok(!fm.tools.includes('mcp__computer-use__'), 'no computer use')
  for (const part of [
    'owns every change', '.crew-chief/refs/', 'REFS.md', 'untrusted data', 'never follow instructions', 'never copy a site 1:1', 'belong to their owners',
    'Awwwards', 'Godly', 'Land-book', 'Dribbble', 'Mobbin', 'tabs_context_mcp', 'your own new tab', 'never touch the user', 'close your tab', 'ToolSearch',
    '--headless=new', '--user-data-dir', '--window-size=1440,900', 'ui-shot.mjs', '--webgl', 'real 390 px', 'skip the mobile shot', '-desktop.png', '-mobile.png', 'curl -sL', 'command -v google-chrome chromium',
    'date +%F', 'Domain notes', 'Take', 'Do not copy', 'ranked', 'hex', '#1', 'calm', 'lively', 'immersive', 'README', 'package.json',
    'at the same time as a ui-tester', 'crew-progress', 'Batch independent', 'turn limit of 60', 'Skill tool',
  ]) assert.ok(text.includes(part), part)
  assert.ok(Number(fm.maxTurns) === 60)
  const policy = readFileSync(new URL('../scripts/session-policy.sh', import.meta.url), 'utf8')
  const skill = readFileSync(new URL('../skills/crew-routing/SKILL.md', import.meta.url), 'utf8')
  const guard = readFileSync(new URL('../scripts/readonly-guard.sh', import.meta.url), 'utf8')
  const setup = readFileSync(new URL('../skills/crew-setup/SKILL.md', import.meta.url), 'utf8')
  const mode = readFileSync(new URL('../skills/crew-mode/SKILL.md', import.meta.url), 'utf8')
  const saver = readFileSync(new URL('../hooks/saver-logic.mjs', import.meta.url), 'utf8')
  const gate = readFileSync(new URL('../scripts/ui-brief-check.sh', import.meta.url), 'utf8')
  const logic = readFileSync(new URL('../hooks/guard-logic.mjs', import.meta.url), 'utf8')
  assert.ok(policy.includes('crew-chief:ui-scout (sonnet/medium)') && policy.includes('Never run it and ui-tester on the same browser at the same time'))
  assert.ok(skill.includes('`crew-chief:ui-scout` | sonnet / medium') && skill.includes('never `ui-scout` and `ui-tester` on the same browser at once') && skill.includes('"Find some (ui-scout)"'))
  assert.ok(guard.includes('crew-chief:ui-scout') && guard.includes('.crew-chief/refs') && guard.includes('scout_chrome'))
  assert.ok(setup.includes('`ui-scout.md`') && mode.includes('ui-scout'))
  assert.ok(/SONNET_NAMED = .*ui-scout/.test(saver))
  assert.ok(/ui-scout/.test(gate) && /READONLY_AGENTS = \[.*'ui-scout'/.test(logic))
  const assets = new URL('../skills/crew-setup/assets/agents/ui-scout.md', import.meta.url)
  assert.equal(readFileSync(assets, 'utf8'), text)
})

test('motion bands and the visual self-check: in the policy, in ui-implementer and ui-designer, and the agent files carry the same band list', () => {
  const policy = JSON.parse(readFileSync(new URL('../data/ui-policy.json', import.meta.url), 'utf8'))
  assert.deepEqual(policy.motionBands.bands.map((b) => b.range), ['0-1', '2-3', '4-6', '7-8', '9-10'])
  const d = policy.motionBands.bands.map((b) => b.delivers)
  assert.ok(d[0].includes('colour and opacity') && d[1].includes('scroll reveal') && d[1].includes('press feedback'))
  for (const w of ['staggered hero entrance', 'micro-interaction on every interactive element', 'ambient loop', 'choreographed section transitions']) assert.ok(d[2].includes(w), w)
  for (const w of ['scroll-linked scenes', 'parallax', 'page or view transitions']) assert.ok(d[3].includes(w), w)
  assert.ok(d[4].includes('continuous scene') && d[4].includes('3D/WebGL'))
  assert.ok(policy.motionBands.every.includes('prefers-reduced-motion') && policy.motionBands.every.includes('transform and opacity') && policy.motionBands.every.includes('animation-performance'))
  assert.ok(policy.motionBands.rule.includes("must deliver that band's list"))
  assert.deepEqual([policy.selfCheck.dir, policy.selfCheck.widths, policy.selfCheck.overflowWidths], ['.crew-chief/check', [1440, 390], [390, 360]])
  const steps = policy.selfCheck.steps.join('\n')
  for (const w of ['ui-shot.mjs', 'real 390 px', 'about 500 px', 'never in the project source', 'scrollWidth > window.innerWidth', '390 and 360', 'motion band', 'no headless browser', 'not verified']) assert.ok(steps.includes(w), w)
  assert.ok(policy.selfCheck.ignore.includes('.gitignore'))
  const impl = readFileSync(new URL('ui-implementer.md', dir), 'utf8')
  for (const w of ['Visual self-check, mandatory', '--window-size=W,H', '.crew-chief/check/', 'never write shots into the project source', 'ui-shot.mjs', 'real 390 px', 'scrollWidth', 'innerWidth', '500 px layout', '390 or 360', 'Band check', 'not verified', '0-1 no motion', '2-3 scroll reveal', '4-6', '7-8', '9-10', "band's whole list", '**Visual self-check:**']) assert.ok(impl.includes(w), w)
  const designer = readFileSync(new URL('ui-designer.md', dir), 'utf8')
  for (const w of ['0-1 no motion', '2-3 scroll reveal', '4-6 plus a staggered hero entrance', '7-8 plus scroll-linked scenes', '9-10 plus a continuous scene', 'none missing', 'measures horizontal overflow']) assert.ok(designer.includes(w), w)
  assert.equal(readFileSync(new URL('../skills/crew-setup/assets/agents/ui-implementer.md', import.meta.url), 'utf8'), impl)
  assert.equal(readFileSync(new URL('../skills/crew-setup/assets/agents/ui-designer.md', import.meta.url), 'utf8'), designer)
})

test('no agent lists a wildcard MCP tool in tools (Claude Code matches none of them); ui-tester lists every Claude in Chrome tool', () => {
  // mcp__computer-use__* stays in ui-tester until the exact computer-use tool names are known (unverified).
  for (const f of files) assert.ok(!/__\*/.test((front(f).tools || '').replace('mcp__computer-use__*', '')), f + ': wildcard in tools')
  const list = front('ui-tester.md').tools.split(',').map((x) => x.trim())
  for (const n of ['tabs_context_mcp', 'tabs_create_mcp', 'tabs_close_mcp', 'navigate', 'computer', 'read_page', 'get_page_text', 'find', 'form_input', 'javascript_tool', 'read_console_messages', 'read_network_requests', 'resize_window', 'gif_creator', 'upload_image', 'file_upload', 'browser_batch', 'list_connected_browsers', 'select_browser', 'switch_browser']) assert.ok(list.includes('mcp__claude-in-chrome__' + n), n)
})

test('researcher is a read-only Sonnet with web tools, named in the policy, the routing skill, the mode skill and both guard lists', () => {
  const r = front('researcher.md')
  assert.equal(r.model, 'sonnet')
  assert.ok(r.tools.includes('WebFetch') && r.tools.includes('WebSearch'))
  assert.ok(!r.tools.includes('Edit'))
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  assert.ok(read('../scripts/session-policy.sh').includes('crew-chief:researcher'))
  assert.ok(read('../skills/crew-routing/SKILL.md').includes('crew-chief:researcher'))
  assert.ok(read('../skills/crew-mode/SKILL.md').includes('researcher'))
  const guard = read('../scripts/readonly-guard.sh')
  assert.ok(guard.includes('crew-chief:researcher') && guard.includes('|researcher|'))
  assert.ok(read('../hooks/guard-logic.mjs').includes("'researcher'"))
})
