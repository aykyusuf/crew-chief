---
description: When the user names a model and effort for delegated work, the Agent call carries exactly those.
max_turns: 20
allowed_tools: [Read, Glob, Grep, Agent]
tags: [override, per-call-effort]
---

Give this to a Sonnet subagent at medium effort: find every TODO comment in this repository and list them as file:line with the comment text.
