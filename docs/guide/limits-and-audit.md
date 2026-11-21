# Limit resets, context audit and report

Toasts and a "continue" offer at limit resets, plus `/crew-tidy` (context audit) and `/crew-report` (tokens and cost).

[← README](../../README.md) · [Türkçe](../rehber/limits-and-audit.md)

## Limit resets

- A timer per window that was at 90 % or more and resets within 12 hours: a toast at the reset, even if the session sat idle (Claude Code only measures after a response).
- When a limit really stops Claude (the `StopFailure` event with error `rate_limit`, not the 100 % mark: with usage credits you keep working past it), you are asked whether to send "continue" at the reset. Only on a yes, only for a reset within 6 hours, and nothing is sent if you typed something in the meantime. The message says it comes from crew-chief; it is not sent as your own words. `CREW_CHIEF_RESET=off` turns both off.

## Context audit and report

`/crew-tidy` reads what Claude Code actually loaded (the same list `/context` shows) and reports, changing nothing: instruction and memory files over Anthropic's limits (CLAUDE.md under about 200 lines; MEMORY.md loads only its first 200 lines or 25 KB, the rest is dropped silently), paths a file mentions that no longer exist, `MEMORY.md` entries pointing at missing files, lines repeated across files, a `STATUS.md` over 6 KB (read at every start), `PROGRESS.md` entries older than 60 days, lines that lean on ALL-CAPS emphasis or on old orders ("think harder", "don't be lazy"), lines that read like passing facts (a deadline, "for now") in a file that loads every session, `@imports` (imported files load at session start too, so they organise a file but do not make it cheaper), MCP servers by token cost, the largest parts of the context. Files under `~/.claude` are only reported. `/crew-tidy archive` moves `PROGRESS.md` entries older than 60 days to `PROGRESS-archive.md` after asking: the archive is written and read back before the source is rewritten, an entry whose date is unclear stays, nothing is deleted.

`/crew-report` shows tokens (exact) and cost (approximate) by main or subagent and model, how much of the output came from subagents and from Sonnet or Haiku, and the three most expensive subagent runs (a few hard runs usually carry most of the spend). Claude Code reports one session total, so each request is credited with what the total grew by since the previous one ended. A toast on your next prompt also warns when the prompt cache has probably gone cold during an idle gap (the cache lifetime is learned from the usage numbers; nothing is warned until an expiry has been seen; `CREW_CHIEF_CACHE_HINT=off`).
