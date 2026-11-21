# Updating

How to update the plugin, and what the update notices tell you.

[← README](../../README.md) · [Türkçe](../rehber/updating.md)

Third-party marketplaces do **not** auto-update by default, so turn it on once: `/plugin` → **Marketplaces** → `crew-chief` → **Enable auto-update**. Claude Code then refreshes the plugin shortly after your first message in a session. Or update by hand: `claude plugin update crew-chief@crew-chief`.

An update does not change the session that is already running:
- After an auto-update Claude Code prints `Plugin updated: crew-chief · Run /reload-plugins to apply`. Run `/reload-plugins` to switch the hooks in that session (a new session loads the new version by itself).
- After `claude plugin update` in a shell, other open sessions get no message from Claude Code. Crew Chief fills that gap: on your next prompt it says once per session that this session still runs the old copy and to run `/reload-plugins`. After an auto-update you may see both messages, since the old copy is marked in that case too.
- Your first prompt after an update shows a short "what's new": the first three items of that version's [CHANGELOG](../../CHANGELOG.md) section. A fresh install shows nothing, except the old-Claude-Code warning below (an upgrade from before 0.3.0 is announced too, if you had answered the handoff offer). Switch it off with `CREW_CHIEF_WHATS_NEW=off`.

Both notices are printed by a UserPromptSubmit hook (`systemMessage`) under your prompt, not written by the model. A SessionStart hook's `systemMessage` is not shown by Claude Code 2.1.295, which is why the notice waits for your first prompt.
