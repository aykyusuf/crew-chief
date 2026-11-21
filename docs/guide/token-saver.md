# Token saver

A mod that watches your plan limits and, with your yes, caps subagent effort (and ultra-saver, language, toasts).

[← README](../../README.md) · [Türkçe](../rehber/token-saver.md)

Plan limits are eaten mostly by long sessions and big contexts, then by subagents on Opus. The saver is a small [mod](https://code.claude.com/docs/en/plugins/mods/overview) (`hooks/register.js`) that watches your limits from inside Claude Code and asks before it changes anything.

- **When it asks:** the first time your 5-hour limit passes 70, 80, or 90 %, or your weekly limit passes 50, 75, 85, or 90 %, once per threshold and limit window. If a session starts already past a threshold, it asks right away. If two thresholds are crossed at once, it asks once.
- **Answers:** *Turn on saver*, *Not now* (asks again at the next threshold), *Don't ask again this session*.
- **What the saver does, only for subagents:** Opus (and Fable) run at **medium** effort at most; Sonnet runs at **high** at most (no `xhigh` or `max`); Haiku and your main session are never touched. It changes the effort of each subagent request, not the model.
- **It never sticks:** every new session, `/clear`, and `/resume` starts with the saver off. No saver state is saved; what is remembered between sessions is the language and the advisor-offer answer (see below).
- **`/saver on|off|status`** switches it by hand and shows your limits, their reset times, and the context size.
- **Ultra-saver** (`/saver ultra`, `/saver ultra off`). A stricter mode of the saver for when the limit is the problem. Subagents never run on Opus or Fable: `implementer-hard`, `planner` and `reviewer` run on Sonnet at high; any agent that would inherit an Opus main model runs on Sonnet; Sonnet agents are capped at high effort; the rest keeps its own default (mostly medium). It rewrites `model` and `effort` on the Agent call. **Opus only with your yes:** a review asked at `xhigh`/`max` (the routing policy's mark of risky work) or a call that names Opus asks you first (*Yes, Opus for this call* / *No, Sonnet at high*; no answer counts as no). `/saver ultra opus on` lifts the model limit for the session (effort is still capped at medium), `/saver ultra opus off` puts it back. It is offered as an extra answer of the limit question and never opens by itself; `CREW_CHIEF_ULTRA=on` starts a session in it (for scripts). **The main model is never changed:** Sonnet 5.5 at high is a good fit for the session (`/model`, `/effort`; switch at a natural break, because the prompt cache belongs to the model). Seen live on `claude -p`: the same `implementer-hard` call ran on `claude-opus-5-5` without ultra and on `claude-sonnet-5-5` with it; the Opus question dialog and the effort on the subagent were only tested with mocks, so check `/tasks` once.
- **One toast per session** when the session is 8 hours old. (The old toast at 150k tokens is gone: the [compact flow](compact.md) replaces it with a real proposal at a better moment.)

**Language.** Questions, toasts, `/saver`, and the update notices speak English or Turkish, whichever you write in. Order of precedence: `CREW_CHIEF_LANG=tr|en`, then Claude Code's `language` setting (`turkish` or `english`), then your recent prompts (Turkish letters and common Turkish words; the majority of the last five prompts, so one stray English sentence changes nothing; slash commands and code count for nothing), then the language last detected (so the first question of a new session already speaks it), then the `LANG` locale, then English. Kept between sessions in the plugin's store: that one word, `tr` or `en`, and the answer to the [advisor offer](advisor.md). Other languages fall back to English; adding one means adding an object to `hooks/saver-i18n.mjs` (a test checks that its keys match English). Update notes come from `CHANGELOG.tr.md` when it has the version, otherwise from `CHANGELOG.md`.

| Environment variable | Effect |
|---|---|
| `CREW_CHIEF_SAVER=off` | No saver questions and no toasts (`/saver` still works; the one-time [advisor offer](advisor.md) has its own switch below) |
| `CREW_CHIEF_SAVER_FIVE_HOUR=60,85` | Your own 5-hour thresholds |
| `CREW_CHIEF_SAVER_SEVEN_DAY=50,90` | Your own weekly thresholds |
| `CREW_CHIEF_ULTRA=on` | Start the session in ultra-saver |
| `CREW_CHIEF_LANG=tr` or `en` | Force the language of every message |
| `CREW_CHIEF_ADVISOR_OFFER=off` | Never offer the advisor |
| `CREW_CHIEF_ROW_MOD=auto`, `on` or `off` | The [agent row status line](panel.md#agent-row-status-line): `auto` (default) shows it on the Desktop app, VS Code and terminals where the shell panel row cannot draw; `on` always; `off` never |
| `CREW_CHIEF_GUARD=auto`, `on` or `off` | The [command guard](guard.md): `auto` (default) follows `~/.claude/crew-chief-guard.json` (`"enabled": true`), which the first interactive session writes with default rules; `on` turns on the built-in rules even without the file; `off` never (and prevents the first write) |
| `CREW_CHIEF_GUARD_AUTOSETUP=off` | Do not write the default guard config on the first interactive session (the guard then stays off until you create the file or run `/crew-guard on`) |
| `CREW_CHIEF_ASK_TIMEOUT_MIN=10` | Minutes before an unanswered question takes its safe answer (default 20, at most 30; `off` or `0`: questions wait for you) |

**Questions never wait forever.** Every question the mod asks (saver, advisor offer, compaction, the compaction gate, limit reset, `/crew-tidy archive`) counts as answered with its safe choice when nobody answers for 20 minutes: *Not now* for the saver and the compaction, *No* for the limit reset, *Remind me in a week* for the advisor offer, *Cancel* for the compaction gate and the archive. Never the yes, and never *Don't ask again*. A toast says so (`No answer for 20 min: treated as "Not now".`). The mod moves on in every case; where it can, it also closes the dialog (it answers its own `AskUserQuestion` call), but a question raised between turns may stay on screen, and a late click on it then changes nothing. An `AskUserQuestion` that Claude itself raises is never touched.

**Needs:** Claude Code 2.1.287 or later (older versions never load the mod; the first prompt after install tells you), and a Pro or Max plan for the limit data (with an API key the mod stays quiet; the context and age toasts still work). The questions need an interactive session; `claude -p` never asks.

Measured on Claude Code 2.1.295: the limits are available right when a session starts, and match `/usage` and the status line. For a hard cap that needs no questions, set `"maxEffortLevel": "medium"` in your settings.
