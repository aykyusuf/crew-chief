---
description: A brief to a subagent names its scope (the files) and the exact check to run, not only the goal.
max_turns: 15
allowed_tools: [Read, Glob, Grep, Agent]
tags: [routing, brief]
---

Hand this to a subagent: in src/, rename the function calc_total to compute_total in every file, and make sure python3 -m compileall src still passes. Do not touch tests/. Reply with the list of files changed.
