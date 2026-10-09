---
description: When the implementer tier reports stopped, escalate one step to implementer-hard instead of re-running the same tier.
max_turns: 8
allowed_tools: [Read, Skill]
tags: [routing, escalation]
---

Context: I gave a multi-module change to the crew-chief implementer subagent. It came back with "Status: stopped. The same check failed twice after two different fixes; the root cause is not in the files I was given." What do you do next? Answer in two sentences with the exact agent you would use. Don't start anything.
