---
name: security
description: "Runs a security review of a change with crew-chief's read-only security-reviewer agent: finds the security-relevant files (risk map), picks the model and effort from what they touch, briefs the agent, and reports what it found. Use when the user asks for a security review (/crew-chief:security), when crew-chief's security gate holds back a commit, or before a pull request that touches authentication, crypto, secrets, payments, migrations, input reaching SQL/shell/path sinks, CI or dependencies. Main session only. Not a general code review (use the reviewer agent)."
argument-hint: "[staged | branch | <path or commit range> | map]"
---

Security review of a change. Arguments: `$ARGUMENTS` (optional). Main session only: it launches an agent and may ask the user a question, which a subagent cannot do. If you are a subagent, stop and tell the caller to run it.

1. **Scope.** From the arguments: `staged` = the staged diff; `branch` = the commits ahead of the upstream (or the default) branch plus uncommitted changes; a path or a commit range = that; `map` = only build or refresh the risk map (step 2) and report it. With no argument: the staged diff if anything is staged, otherwise uncommitted changes, otherwise the branch. List the files in scope with one git command.

2. **Risk map.** If `.crew-chief/security-map.json` does not exist in the project (or it is older than 7 days, or the argument is `map`), build it: `"${CLAUDE_PLUGIN_ROOT}/scripts/security-map.sh" scan "<project root>"`. It is cheap (regexes, no model call) and keeps entries the user added by hand. Add `.crew-chief/` to the project's `.gitignore` only if the user wants the map kept out of git; do not decide that for them.

3. **Which files matter.** Run `"${CLAUDE_PLUGIN_ROOT}/scripts/security-map.sh" match "<project root>" <files in scope>`: each line is `category<TAB>file<TAB>reason`. No line means nothing security-relevant in scope: say so in one line and stop, unless the user asked for the review anyway (then review the whole scope).

4. **Model and effort** (the routing rules; never Fable unless the user asked for Fable):
   - any of auth, crypto, secrets, payments, migrations, injection: `crew-chief:security-reviewer` with `effort: "xhigh"` (Opus);
   - only ci or deps: `model: "sonnet"`, `effort: "high"`;
   - a very small diff (under about 30 changed lines) with one risky file: the agent's default (Opus, high).
   The saver may lower this (plain saver keeps high; ultra-saver asks the user before Opus): follow what it says.

5. **Brief the agent** (it does not see this conversation): the scope and the exact git command for the diff, the risky files with their categories and reasons from step 3, the project's stack in one line, any security rule the user gave in this conversation, and "read-only: report, do not fix". One agent, not several in parallel on the same diff.

6. **Report** to the user in their language: the tally, then each Critical/High finding with `path:line`, the attack in one sentence and the fix; Medium and Low as a short list. Then offer to fix (ask before changing code if the user has not already asked for fixes). After fixes, a second round reviews only the new diff.

7. **The commit gate.** If this ran because the security gate held back a commit: once the findings are fixed or the user accepted them, retry the identical commit command; the gate lets it through.
