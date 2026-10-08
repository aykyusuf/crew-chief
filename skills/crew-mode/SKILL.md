---
name: crew-mode
description: "Switches crew-chief's delegation mode for the rest of the session: auto (route by difficulty), solo (main session does everything, no subagents), or delegate (hand every independent piece to a tier)."
argument-hint: "[auto | solo | delegate | status]"
disable-model-invocation: true
---

The user ran `/crew-chief:crew-mode $ARGUMENTS`.

Apply the matching rule for the rest of this session, until the user changes it again. It replaces any earlier mode, including the default from the session-start policy.

- **auto**: route each piece of work by the crew-chief routing table: main session for interactive, coupled, or quick work; the cheapest capable tier for self-contained work.
- **solo**: spawn no subagents at all. Do every step in the main session, including searches and test runs. Workflows and agent teams are off too unless the user asks for one explicitly.
- **delegate**: actively hand independent pieces to the tiers (scanner, deep-reader, implementer, implementer-hard, ui-smoke, ui-tester, reviewer), sending independent briefs in one message so they run in parallel. Keep design decisions and anything needing the user's feedback in the main session.
- **status** or empty: say which mode is active and what it means in one sentence. Change nothing.
- Anything else: list the three modes in one line each and change nothing.

Confirm in one short sentence in the user's language, for example "Mode: solo. I'll do everything myself, no subagents."
