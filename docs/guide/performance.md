# Performance mode

Stills the moving pictures of the band (and a theme mod's animation) to save drawing cost.

[← README](../../README.md) · [Türkçe](../rehber/performance.md)

Moving pictures cost a little to draw. On the Desktop app the ⚡ at the end of the band's status line (or `/crew-perf`) stills them:

- **Agents** stops the agent pictures in the band; **theme** stops a desktop theme's animation; **all** does both. `/crew-perf all|agents|theme|off` sets it directly, `/crew-config set panel.perf <value>` does the same, and `CREW_CHIEF_PANEL_PERF` wins when set.
- **The theme part needs a theme mod that listens.** crew-chief does not draw a theme itself; it writes `~/.claude/perf-mode.json` and a theme mod reads it. With no such mod installed, the ⚡ just switches the agents on and off without asking, `/crew-perf theme|all` changes nothing, and a saved `theme` or `all` works as `agents`.
- **The file:** `{"on": true, "agents": true, "theme": true, "at": "<iso time>"}`, written whenever the setting changes. `on` mirrors the theme part, so a mod that only knows `on` stills the theme as asked.
- **For theme mod authors.** At session start, write `~/.claude/perf-mode.readers/<your mod>.json` = `{"name": "<your mod>", "theme": true, "at": "<now, iso>"}`; crew-chief offers the theme choice while one such file is less than 14 days old. Read `~/.claude/perf-mode.json` at session start or attach and on each turn (or poll it), and stand still while `theme` is true.
