<!-- crew-chief:handoff:start (added by crew-handoff; edit freely, it is not rewritten) -->
## Session start (every time, in this order)
1. `git log --oneline -15` to see recent changes.
2. Read the working project's `STATUS.md`.
3. Pick the first high-priority `"status": "todo"` task in `tasks.json`, unless the user asked for something else.
4. Start the environment if needed and run the basic check before changing anything.

## Session end (when work is done or before the context fills up)
1. In `tasks.json`, update only `status` and `evidence` (see its `_rule`; `done` needs every part of `done_when`, sign-offs included).
2. Update `STATUS.md` (Now, Next, Open questions, Failed attempts).
3. Add one dated paragraph to the top of `PROGRESS.md`.
4. Commit only if the user asks.
<!-- crew-chief:handoff:end -->
