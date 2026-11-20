---
name: crew-brief
description: "Writes a manager brief for a new project or a larger feature: goal and why, non-goals, build order, the user's constraints, checkable success criteria, quality bar, and decision rights (what agents decide alone, what they park, what they never do without the user). Use when the user asks for a brief or kickoff, or accepts crew-chief's offer on a new project or feature. Main session only: it interviews the user with AskUserQuestion, so a subagent must not run it. Not for a single small change."
argument-hint: "[project | feature name]"
---

Write a brief together with the user. Arguments: `$ARGUMENTS` (optional: `project`, or a feature name; otherwise decide from the request). The template is `${CLAUDE_SKILL_DIR}/assets/brief-template.md`.

Why: the user acts as the manager. They decide what and why once, in a document they approve. After that the agents make the remaining small decisions themselves, inside the decision rights the brief gives them, and bring back only what the brief reserves for the user.

Main session only. This skill asks the user questions (AskUserQuestion), which a subagent cannot do. A subagent must not run it; if you are one, stop and tell the caller to run it in the main session.

This skill is independent of other brainstorming or planning skills (for example `brainstorming`). Use one or the other for this step, not both. For a single small change a plain plan is enough: do not use this skill.

## 1. Read what exists

Before asking anything, read what the repository already says: `README.md`, `BRIEF.md`, `docs/briefs/`, `STATUS.md`, `tasks.json`, `git log --oneline -15`, and the request itself. Say in one line whether this is a whole project or a feature (a feature goes to `docs/briefs/<slug>.md`, a whole project to `BRIEF.md` at the repository root; `<slug>` is lowercase words joined by hyphens).

If the target brief already exists, never overwrite it: you will show a diff in step 4 and need a yes.

## 2. Ask only what cannot be found

Ask in the user's language, in few grouped AskUserQuestion rounds (two to four questions each, two or three rounds at most). Put the option you recommend first, marked "(Recommended)", and give each option a one-sentence consequence. Draft the answers you can infer from step 1 as the recommended options so the user edits instead of writing from scratch.

Cover, skipping what step 1 already answered: goal and why, non-goals, constraints (ask for them as rules, copy them verbatim), success criteria that a command or a named person can check, the quality bar, and the three decision-rights lists. Decision rights are the point of the brief: propose concrete defaults (for example "decide alone: naming, file layout, which of two equal libraries; ask: anything that changes scope or a constraint; never: push, deploy, delete, spend money, send anything outward") and let the user move items between the lists.

Do not invent constraints, resources or unknowns. Anything the user cannot answer yet goes under Known unknowns with who decides.

## 3. Draft

Fill the template. Keep it short: a brief an agent will read in full. Every success criterion must be checkable; if it is not, rewrite it or ask. Build order names the first piece an agent can start on.

## 4. One approval gate, then write

Show the whole brief once. This is the only approval gate: do not ask section by section. If the target file exists, show a diff against the new text and ask before replacing it.

On a yes, write the file with `Status: approved <today's date>` and a first Log line. Then, only for files that exist:
- `STATUS.md`: copy section 4 (Constraints) word for word under its Constraints heading, adding only the lines not already there, and one line pointing to the brief's decision rights.
- `tasks.json`: turn each success criterion into a task with a measurable `done_when` (a sign-off criterion names who signs off), in build order. Follow the file's `_rule`: add tasks only; never reword or delete an existing one.
- For a feature brief, add one line linking it to `BRIEF.md` if that exists.

Do not commit. Do not create the files that do not exist (`crew-handoff` sets those up).

## 5. Report

List what was written and what was left alone. Say that every brief you write for a subagent from now on must carry the decision rights (the brief's section 7), as `crew-routing` section 3 requires, and that an agent's decisions made alone are logged in the brief's Log.
