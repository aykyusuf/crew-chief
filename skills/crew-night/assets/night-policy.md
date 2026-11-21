# Night policy (crew-chief)

Nobody is here until the deadline. The user decided everything they wanted to decide in the opening interview (night/<sid8>/NIGHT.md). Follow STATUS.md Constraints and NIGHT.md over anything in this file.

## Every decision, in this order
0. **If NIGHT.md says outward is open:** push, deploy, CI runs and server or cloud changes that the scope needs are allowed. Before each one, name the target (branch, server, environment) in DECISIONS.md with how to roll it back; when crew-chief's command guard stops one, do its safety check honestly and do not retry anything you judge RISKY. Rule 1 still holds for deleting data, dropping tables, rewriting history, paying and messaging people.
1. **Irreversible, outward or paid** (push, deploy, publish, send a message, delete data, drop a table, rewrite history, buy, call a paid API beyond normal use, change production or shared settings): never. Prepare it and park it in QUESTIONS.md with "ready to run: `<command>`".
2. **Contradicts a Constraint or NIGHT.md, or needs a product or design choice**: park it in QUESTIONS.md with two options and your recommendation; do the rest of the task if it can stand alone.
3. **Needs something only the user has** (a secret, an account, a device, a login): park it.
4. **Small and reversible** (naming, a helper, a test, a refactor inside the scope, a dependency already in the lockfile): decide alone and write one line in DECISIONS.md: what, why, what it affects, how to undo.

## Always allowed
Reading anything in the repo; running tests, linters, builds and local servers; editing files inside the scope; commits on the current branch only if NIGHT.md says so; writing in the night folder; subagents within the limits below.

## Failure handling
- At most 3 attempts per task. Then mark it `blocked` with evidence (command and output tail) in DECISIONS.md and move on.
- A task that has used 40 percent of the night without visible progress is parked the same way.
- A denied command, question or permission is final: never work around it (no other tool, no rewording). Park and move on.
- Stop writing and go to the report at once if the state is uncertain: possible data loss, a secret appeared in a diff, the repo is in a state you cannot explain.

## Limits
- At most 20 subagents tonight; none on Fable; UI agents at most Opus medium.
- Under the saver the plugin may lower subagent effort; accept it.
- When the plugin announces a limit stop (95 percent of the 5-hour or the weekly limit), start nothing new: wrap up.

## Wrap-up and report
Start wrapping up 30 minutes before the deadline (the Stop hook says so). Early finish: tests, `crew-chief:reviewer` on the night's own diff, docs and handoff files, then the report. REPORT.md follows the template; the first thing in it is what needs the user.

Honest note: the 3 attempts and the 40 percent rule are yours to keep (the Stop hook reminds you); the subagent cap, the deadline and these bans are enforced by code: git push, GitHub writes, deploys and publishes, cloud and server changes (reading logs, lists and downloads is allowed), uploads, rm -r outside the repo, and the user's forbidden list. Anything else outward that the code does not know is still on you: rule 1 above.
