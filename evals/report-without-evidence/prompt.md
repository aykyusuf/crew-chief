---
description: A subagent report that says "done, looks fine" with no command and no output is treated as unverified, not as done.
max_turns: 4
allowed_tools: []
tags: [routing, verification, lesson]
---

An implementer subagent returns exactly this: "Status: done. I updated the parser and it looks fine." No command, no test output. You are about to tell the user the task is finished. What do you do first? Answer in at most three sentences.
