<!-- crew-chief:handoff:start (added by crew-handoff; edit freely, it is not rewritten) -->
## Session start (every time, in this order)
1. `git log --oneline -15` to see recent changes.
2. Read the working project's `STATUS.md`. Its Constraints are the user's rules: follow them.
3. Pick the first high-priority `"status": "todo"` task in `tasks.json`, unless the user asked for something else.
4. Start the environment if needed and run the basic check before changing anything.

## During the session
When the user gives a rule meant to last (do not touch X, no commits, ask before Y), copy it word for word under Constraints in `STATUS.md` right away, with its reason and scope when the user gave them (so an exception can be written into the rule instead of piling up beside it).
When a failure's cause is confirmed (not guessed), turn it into one short rule under Decisions in `STATUS.md` and put it in the briefs of later work, so the same break is not met twice.

## Session end (when work is done or before the context fills up)
1. In `tasks.json`, update only `status` and `evidence` (see its `_rule`; `done` needs every part of `done_when`, sign-offs included).
2. Update `STATUS.md` (Now, Next, Open questions, Failed attempts).
3. Add one dated paragraph to the top of `PROGRESS.md`.
4. Re-read Constraints. If a rule looks stale, was contradicted by a later message, or has an exception the user gave, do not delete it: name it in your last line and let the user decide. Old "never" rules pile up and newer models obey them literally.
5. Commit only if the user asks.
<!-- crew-chief:handoff:end -->
