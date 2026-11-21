# Security review and verification gate

The read-only `security-reviewer`, the risk map, the commit gate, and the verification gate before commits.

[← README](../../README.md) · [Türkçe](../rehber/security.md)

## Security review

A separate read-only agent, **`security-reviewer`** (Opus, medium by default; used only when a change alters behaviour at a trust boundary, at the smallest fitting setting: Sonnet medium for one focused question, Opus medium usually, Opus high for broad, money, permission or data-moving migration changes, xhigh only for a large cross-cutting change before it ships or when you ask), has the bundled `security-audit` skill (Cloudflare, MIT) preloaded. It traces each input the change touches from where it enters to where it is used, verifies every finding with `path:line` citations, argues against its own High and Critical findings, and reports by severity; it never edits the project.

- **`/crew-chief:security [staged | branch | <path or range> | map]`** finds the security-relevant files in scope, picks the model and effort from what they touch, briefs the agent and reports what it found, then offers fixes.
- **Risk map: `.crew-chief/security-map.json`.** `scripts/security-map.sh scan` lists the project's security-relevant files with a category and a reason, from cheap path and content regexes (no model call; a hit is a reason to look, not a finding). Entries you add by hand (`"manual": true`, or a `"glob"`) are kept on every rescan. A new file Claude writes that matches is added to an existing map (PostToolUse on Write and Edit); a map older than 7 days is rescanned in the background at session start. Whether the map goes into git is your choice.
- **Commit gate.** `scripts/security-gate.sh` (PreToolUse on Bash) looks at Claude's `git commit` when the files going in (staged, `-a`, or a `git add` in the same command) are security-relevant. Every such commit is held once (the hold is cheap: no agent runs unless Claude decides one is needed) with a short decision guide: first whether a review is worth it at all (most commits need none: mechanical edits, tests, text, behaviour-keeping refactors), and if so the smallest fitting model and effort (xhigh never by default). The size of the change and any risky pattern in the changed lines (a removed permission check, input added to a query, money arithmetic) are named as hints; a small plain change is marked as most likely needing no review. The file and line rules know Turkish domain words too (odeme, tahsilat, fatura, bakiye, kur, doviz, altin, kasa, fiyat, tutar, yetki, sifre, oturum). The identical command retried within 4 hours passes. It only sees Claude's commits, not the ones you type in a terminal. `CREW_CHIEF_SECURITY_GATE=off` turns it off.
- **Saver.** The plain saver keeps it at high (only xhigh and max come down to high); ultra-saver asks you before it runs on Opus (no answer: Sonnet at high).

## Verification gate

Before Claude's `git commit`, crew-chief checks whether a test, build or check (or a `verifier`, `reviewer` or `ui-tester` agent) ran in this session since the last commit. Default `observe`: the commit runs and Claude is told to say in the message what verified it (`Verified: npm test (42 passed)` or `Verified: not run (docs only)`). `enforce` holds the commit back, at most twice per session; `off` turns it off. Set it with `CREW_CHIEF_VERIFY_GATE` or `"verify.gate"` in `.claude/crew-chief.json`.
