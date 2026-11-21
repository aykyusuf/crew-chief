# Briefs: `/crew-chief:crew-brief`

You act as the manager: Claude interviews you and writes one approved brief for a project or a feature.

[← README](../../README.md) · [Türkçe](../rehber/brief.md)

`/crew-chief:crew-brief` makes you the manager. You act as the manager. Claude interviews you (few grouped questions, recommended options first) and writes one brief: goal and why, non-goals, build order, your constraints word for word, checkable success criteria, quality bar, and decision rights (what agents decide alone, what they park, what they never do without you). Project brief: `BRIEF.md`; feature brief: `docs/briefs/<slug>.md`. After one approval your constraints go to `STATUS.md`, each success criterion becomes a `tasks.json` task, and every subagent brief carries the decision rights. Main session only; independent of other brainstorming skills (use one or the other). A prompt about a new project or feature gets one closing line offering it, once per project, never where a brief exists.
