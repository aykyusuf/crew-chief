---
description: When one unit of a split job fails, only that unit goes back, with its evidence and a scope line; the passed units are left alone.
max_turns: 4
allowed_tools: []
tags: [routing, escalation, lesson]
---

Four slices of a port were done by four subagents. Slices 1, 2 and 4 pass their tests. Slice 3 fails: test_auth_redirect expected 302, got 200, at handlers/auth.py:88. Write the exact message you send back, and say what happens to slices 1, 2 and 4.
