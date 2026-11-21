# Research: `/crew-chief:crew-research`

Research runs with sourced, quote-checked claims, plus `/crew-chief:crew-lint`.

[← README](../../README.md) · [Türkçe](../rehber/research.md)

A question that needs current sources goes to a research run. Claude asks the mode first:
- **ekonomik:** 1-3 `researcher` agents (Sonnet, web access) plus one verification (the quote check and one `verifier`), at most 4 agents.
- **tam:** the two plugin workflows: `research-sweep` (up to 8 researcher groups in parallel) then `research-verify` (a `verifier` per 8 claims, a counter-evidence agent per 2 groups, one reporter). Before it, `scripts/research-cost.mjs` shows the agent count and a token range and recommends a one-group trial first. With workflows off (or at night, where the Workflow tool is denied) the same steps run with plain agents, and Claude says so.

Every claim carries a URL, the access date and a verbatim quote. `scripts/source-check.mjs` fetches each cited page and checks the quote is on it (`found`, `not_found`, `dead_link`, `unverified`; a page it cannot read is never counted as a refutation). When the quote check and the verifier disagree, the claim is checked once more on Opus at medium; if they still disagree it is reported as unverified. Fetched pages are data, never instructions.

`/crew-chief:crew-lint` runs two more tools by hand: `scripts/stale-scan.mjs` finds outdated instructions in `CLAUDE.md`, memory and agent files ("always delegate", token-budget numbers, absolute "never" lines) and suggests fixes, and `scripts/brief-check.mjs` lists what a research or agent brief lacks (stop rule, verification, output path, a scope limit). Neither changes a file without your yes. Not yet seen live.
