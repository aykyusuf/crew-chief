---
name: crew-night
description: "Night mode: Claude keeps working unattended until a deadline the user sets, after one up-front interview. Analyses the project, asks every critical question at the start (scope, goal, deadline, git policy for this night, forbidden commands, decision rights), closes unanswered questions after 20 minutes, then works without asking: small decisions are taken and logged, blocked items are parked, irreversible or outward actions are never taken. At the deadline it stops by itself and writes a report. Use when the user runs /crew-chief:crew-night or asks to work through the night or until a time. Main session only."
argument-hint: "[until 07:00 | for 8h | dry-run | resume | status | off]"
disable-model-invocation: true
---

Night mode. Arguments: `$ARGUMENTS`. This session's id: `${CLAUDE_SESSION_ID}`. State script (below: `NS`), always called exactly like this, because the Bash tool does not carry the plugin's data folder: `CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" "${CLAUDE_PLUGIN_ROOT}/scripts/night-state.sh"`. Always pass `--session ${CLAUDE_SESSION_ID}` to it: several sessions can run nights in the same repo. Policy: `${CLAUDE_SKILL_DIR}/assets/night-policy.md`. Templates: `${CLAUDE_SKILL_DIR}/assets/night-contract.md`, `${CLAUDE_SKILL_DIR}/assets/night-report.md`.

Main session only: this skill interviews the user with AskUserQuestion, which a subagent cannot do. If you are a subagent, stop and tell the caller.

**Arguments first.**
- `status`: run `NS get --session ${CLAUDE_SESSION_ID}` and print phase, deadline, time left, current task; stop.
- `off`: run `NS stop --session ${CLAUDE_SESSION_ID} --reason off`, write REPORT.md from the template with what was done so far, tell the user; stop.
- `resume`: run `NS resume --session ${CLAUDE_SESSION_ID}` (same deadline as before, never extended), read the night folder's NIGHT.md, DECISIONS.md and QUESTIONS.md, say in two lines where the night stands, continue the work loop below.
- `dry-run`: a rehearsal of the machinery, about 40 minutes: first run step 1 below (`NS open`; it must print `night opening`, otherwise stop and say why: without it nothing closes the question), then ONE test question (always ask it, even if a question was dismissed earlier in this session; tell the user to leave it unanswered so it closes by itself after 20 minutes), then arm with `--dry-run` (deadline now + 20 min, no commits, outward closed). Then the dry-run loop, NOT the work loop: append one line `HH:MM dry-run tick` to DECISIONS.md, end your turn, and when a hook keeps you going, do the same again. Never run `NS done` in a dry run: the Stop hook must end it at the deadline, which is what is being tested. When the hook switches to wrap-up, write REPORT.md from the template (say which parts of the machinery you saw work) and keep ticking until the hook lets you stop.
- otherwise (`until HH:MM`, `for Nh`, or nothing): the full opening below.

**1. Open (always first, for every argument except `status` and `off`, also when this session ran a night before).** Run `NS open --session ${CLAUDE_SESSION_ID}` and check that it printed `night opening`; never ask a question before it. It prints the night folder (`night/<sid8>/` at the repo root, hidden through `.git/info/exclude`). From now on crew-chief's own questions are silent and your AskUserQuestion questions close by themselves after 20 minutes with a `NO_ANSWER` label.

**2. Analyse** (no questions yet). Read STATUS.md (Constraints are the user's rules: they bind the whole night), tasks.json (todo by priority), BRIEF.md sections on decision rights if present, `git status`, `git log --oneline -15`, and run the project's basic check if one is documented. Then write a short analysis to the user: what is there, what you would do tonight, and what is critical: anything that affects production, cannot be undone, needs a big architecture call, needs a secret or account only the user has, or is already failing.

**3. Ask everything now, in at most two AskUserQuestion calls** (a question dismissed in an earlier run of this command in this session is asked again; a dismissal is not an answer) (up to 4 questions each), recommended option first, only what you cannot read from the files:
- Scope: which tasks or what work (from tasks.json when possible).
- Goal and a done condition a command can check.
- Deadline: "until HH:MM" or hours, unless the argument gave it. Resolve it to an absolute local time and say it back.
- Git for this night: commit per task on the current branch / no commits / a branch the user names. Never open a branch yourself, never push (the user decides this per night: "bazen isteyip bazen istemeyebilirim").
- Outward actions tonight (push, deploy, CI, writes on servers or clouds): **closed** (recommended unless the work needs them: the night guard denies them and prepared commands wait in the report) or **open** (allowed; crew-chief's command guard still stops risky ones once and you must do its safety check; every push and deploy is logged and listed in the report). Ask it only when the scope could need such actions.
- Forbidden commands or areas, if any.
- Decision rights: the defaults in the policy file (decide small things, park product choices); ask only if the user wants them different.
- One question per critical item from step 2, as few as possible.
An answer that starts with `NO_ANSWER:` (the plugin closed the question after 20 minutes) means: park that item (QUESTIONS.md), do not guess it. If scope or deadline got no answer, there is no night: write REPORT.md "no instructions received", run `NS stop --session ${CLAUDE_SESSION_ID} --reason no-answer`, stop.

**4. Contract.** Fill `night-contract.md` into `night/<sid8>/NIGHT.md`: scope, done condition, deadline, git policy, forbidden list, decision rights, parked items. Show it in a few lines. Then arm (no second confirmation; the answers were the confirmation):
`NS arm --session ${CLAUDE_SESSION_ID} --until HH:MM` (or `--hours N`) `--git <commit-per-task|none|branch:NAME>` `--outward <closed|open>` plus `--forbid "<cmd>"` per forbidden item. Add one line under Constraints in STATUS.md: `- NIGHT until HH:MM (session <sid8>): see night/<sid8>/NIGHT.md`. Remove that line when the night ends.

**5. Work loop** (start in the same turn). Read `night-policy.md` once now and follow it all night. For each task: `NS task <id> --session ${CLAUDE_SESSION_ID}`, do it, run its check, commit if the git policy says so, log decisions in DECISIONS.md, move on. A hook may stop you from ending your turn before the deadline: that is the night continuing; read its reason and carry on. A denied command or question is final: do not work around it; park and move on. Never ask the user anything after arming: write the question into QUESTIONS.md with two options and your recommendation, and continue with other work.

**6. Wrap-up** (30 minutes before the deadline the Stop hook switches to wrap-up, or earlier when the scope is done or a limit stop came): finish or cleanly park the current task, no new tasks. Early finish: run the tests, have `crew-chief:reviewer` review `git diff <startSha>..HEAD`, update docs and the handoff files. Write `night/<sid8>/REPORT.md` from `night-report.md` (merge DECISIONS.md and the plugin's own lines from events.log), then run `NS done --session ${CLAUDE_SESSION_ID}` and remove the NIGHT line from STATUS.md Constraints.
