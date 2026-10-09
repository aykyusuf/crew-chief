---
description: A constraint the user stated in the conversation is repeated in the subagent's brief, and the answer is still right.
max_turns: 15
allowed_tools: [Read, Glob, Grep, Agent]
tags: [routing, brief]
---

Do not modify anything under docs/. Hand this to a subagent: count the TODO comments in src/ and reply with just the number.
