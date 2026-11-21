# Advisor offer

A one-time offer to turn on the experimental `/advisor`, which lets Claude ask a stronger model for advice.

[← README](../../README.md) · [Türkçe](../rehber/advisor.md)

`/advisor` (experimental, Anthropic API only) lets Claude ask a stronger model for advice at hard moments: before choosing an approach, when stuck, before finishing. Subagents inherit it, so a Sonnet `implementer` can consult Opus instead of stopping and being re-run as `implementer-hard`. In Anthropic's own benchmark a Sonnet and Opus pair finished tasks about 12% cheaper and slightly better; each consultation is billed at the advisor's rates.

When the advisor is off, the saver mod offers it **once**, after the first finished turn of a session (never at startup, never over a saver question):
- **Sonnet or Haiku main model:** "asks Opus at hard moments". **Opus or Fable main model:** the wording becomes "a second Opus (Fable) reviews the plan", an independent check that costs extra.
- **Answers:** *Turn it on* runs `/advisor opus` (`/advisor fable` for Fable) for you, which saves `advisorModel` in your user settings exactly as if you had typed it, and says so in a toast. If the setting does not appear (a policy, Fable usage credits not enabled), the toast tells you to run `/advisor` yourself to see why, and the offer is not repeated. *Remind me in a week* and *Don't ask again* are remembered in the plugin's store. Dismissing the dialog remembers nothing.
- **Never offered** when `advisorModel` is already set, on Bedrock, Vertex, Foundry or the other cloud routes, when `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` is set, when this Claude Code has no `/advisor`, when the main model is unknown, in `claude -p`, or after you said yes (turn it off later with `/advisor off`; it will not come back). It also waits for a turn that ended normally, not one you interrupted.
- `CREW_CHIEF_ADVISOR_OFFER=off` switches the offer off for good.
