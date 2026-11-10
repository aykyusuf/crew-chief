# Claude platform docs sidebar: what matters for crew-chief

Date of docs read: 2026-11-10. Method: the fetch of the start URL returned only the page body (no sidebar markup). The full navigation was recovered from https://platform.claude.com/llms.txt (an index grouped like the sidebar; it omits API reference, Admin and Get started). Labels: FACT = seen in a fetched page; INFERENCE = my reading.

Important framing (FACT): the left sidebar is the API platform docs. It has NO Claude Code section (Claude Code docs live on code.claude.com). Claude Code builds its own API requests, so API-only parameters (task_budget, thinking.display, prefix check, tool_choice, compaction param) are not something a plugin controls. What transfers to crew-chief is: per-model effort guidance, cost evidence, prompting/skill-authoring guidance, advisor, refusals.

## 1. Sidebar map (about 270 entries in the index)

Build with Claude
- Core features (34): Features overview, Batch processing, Build an orchestration mode (mid-conversation-effort-example), Cache diagnostics, Citations, Coordinates and bounding boxes, Context editing, Context windows, Effort, Embeddings, Extended thinking (legacy), Fallback credit, Fast mode, Files API, Message threads, Mid-conversation messages, Multilingual support, PDF support, Preserved thinking, Prompt caching, Refusals and fallback, Search results, Steering and cost control (thinking-steering-and-cost), Stop reasons and fallback, Streaming Messages, Structured outputs, Task budgets (beta), Text watermark, Thinking, Tool and multi-turn workflows (thinking), Token counting, Troubleshooting (thinking), Skills in the API, Using the Messages API, Vision. All under /docs/en/build-with-claude/<slug>.
- Compaction (6): Compaction, Keep thinking blocks valid, Threshold compaction, Compact in the background, Compact on demand, Keep recent turns.
- Cloud platforms (7): Google Cloud (overview, Anthropic-managed, Google-managed), Bedrock (Opus 4.7+; 4.6 and earlier), Microsoft Foundry, Claude Platform on AWS.
- Prompt engineering (11): Overview, Prompting best practices, Prompting Claude Fable 5 / 5.1 / 5.2, Haiku 5.5, Opus 4.8 / 5 / 5.5, Sonnet 5 / 5.5. (/build-with-claude/prompt-engineering/...)

Tools (/docs/en/agents-and-tools/tool-use/..., 27): Tool use overview, Advisor tool, Bash, Browser and computer use (SDK), Browser use tool, Code execution, Computer use, Define tools, Fine-grained tool streaming, Handle tool calls, How tool use works, Manage tool context, Memory tool, Parallel tool use, Programmatic tool calling, Server tools, Strict tool use, Text editor, Tool combinations, Tool reference, Tool runner (SDK), Tool search tool, Tool use with prompt caching, Troubleshooting, Tutorial: build a tool-using agent, Web fetch, Web search.

Agents
- Managed Agents (/docs/en/managed-agents/..., 41): Overview, Quickstart, GitHub, Files, Vaults, Console, environments, sandboxes, custom tools/MCP, Define outcomes, Agent setup, Dreams, Memory stores, Multiagent orchestration, Permission policies, Session budgets, Session threads, Skills, Webhooks, Workflow runs, Scheduled deployments, security pages, etc.
- Agent Skills, MCP, tunnels (15): Skills overview, quickstart, Skill authoring best practices, Skills for enterprise, MCP connector, Remote MCP servers, MCP tunnels (9 pages).

Models (/docs/en/models/..., about 35): Models overview, Model cards, per-model overview pages (Fable 5/5.1/5.2, Mythos 5/5.1/5.2, Haiku 4.5/5.5, Opus 4.5/4.6/4.7/4.8/5/5.5, Sonnet 4.5/4.6/5/5.5), What's new in Fable 5.2 / Haiku 5.5 / Opus 5.5 / Sonnet 5.5, four migration guides (Fable 5.2, Haiku 5.5, Opus 5.5, Sonnet 5.5), Choosing a model, Upgrade between model versions, Model IDs and versioning, Optimizing for cost and intelligence, Model deprecations, Pricing, API credits for subscribers.

About Claude (8): Use case guides (commerce agent, content moderation, customer support, legal summarization, ticket routing), Additional resources, Glossary.

Release notes (24): Platform release notes, System prompts overview, then one system-prompt page per model (Fable 5/5.1/5.2, Haiku 3/3.5/4.5/5.5, Opus 3 to 5.5, Sonnet 3.5 to 5.5).

Test and evaluate (7): Define success and build evals, Increase output consistency, Mitigate jailbreaks, Reduce hallucinations, Reduce prompt leak, Reducing latency, Streaming refusals.

Claude Code, SDKs, CLI (index group, 21): CLI quickstart/using/authentication/scripting, Connect to a Managed Agents session, ant apply, Trigger a routine, Claude Code Analytics API, Claude API skill, SDK overview and 7 language SDKs, SDK middleware, OpenAI SDK compat, Apple Foundation Models, OpenTelemetry SDK spans. (This is the platform CLI "ant", not the Claude Code docs.)

All URLs follow https://platform.claude.com/docs/en/<path>.md in the index.

## 2. Pages read and verdicts

Already covered elsewhere (not re-read, per brief): prompting Fable 5.2 (read once as the start page; all content matches docs/model-prompting), Opus 5.5, Sonnet 5.5, Haiku 5.5, best practices.

### A. Optimizing for cost and intelligence
URL: https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence (read chars 0-100000 as a summary plus 100000-200000; the last 14k chars of 214k NOT read; the fetch tool summarises, so numbers are the tool's extraction)
- FACT: cost per solved task (SWE-bench Pro subset, internal): Sonnet 5.5 high 87.6% $0.11; Opus 5.5 low 87.4% $0.12; Opus 5.5 medium 92.8% $0.22; Opus 5.5 xhigh 96.7% (one run) $0.74; Fable 5.1 high 92.3% $1.19.
- FACT: run at low, re-run failures at high: about 40% cheaper than all-high, same pass rate.
- FACT: orchestrator with next-model-down subagents is about one third cheaper on work larger than one context window; on routine work "measure first". Defect search: Opus 5.5 + Sonnet 5.5 subagents F1 0.831 at $139; Opus 5.5 alone 0.827 medium ($200), 0.850 high ($236). Fable 5.2 + Sonnet 5.5 subagents 0.833 at $165, 54% below Fable 5.2 alone at low ($357) but 3.2 points lower. Up to 25 subagents at a time.
- FACT: elapsed-time hint. Sentence "Time matters here: do not spend time that can be avoided, and the earlier a correct result is obtained, the better." appended to the first user message and to each helper's brief, plus an "[elapsed 252s]" clock. Single agent: 47% less time, 60% lower cost, score 4.1 points lower. Team: 17% less time, 20% lower cost, 1.6 points lower.
- FACT: prompt audit: instructions written for older models ("verify twice", "be maximally thorough") each cut cost by about a third when removed; /claude-api prompt-audit finds them. Removing retired thinking settings, contradictory rules or hand-made scratchpads restored 7 to 11 accuracy points in one test.
- FACT: cache reads about 84% of input in healthy agent loops; below about 80% something breaks the cache. Top-level effort change mid-session wrote 81,000 tokens that would otherwise be read. Effort/tool changes at a compaction boundary cost $0.75 per session vs $0.95 mid-session. Haiku 5.5 compaction trigger: $0.272 at 150k, $0.082 at 90k, $0.075 at 50k, $0.729 with none.
- FACT: advisor gained 1.7 points for about 2.1x cost in one coding test; helps only if the executor actually consults. Tool search: 45% saved with 500 tool definitions.
- Verdict: MOSTLY ALREADY DONE (model-and-effort.md already has low-first, lead-plus-workers, switch at natural break, measure-before-keeping, advisor). NEW IDEA fragments: (1) prompt audit of agents/*.md and SKILL.md for stale "be thorough / verify twice" lines (confidence high that it is cheap; I grepped agents, skills/*/SKILL.md and crew-setup assets for those phrases and "reasoning/scratchpad/rationale": no hits, so likely clean); (2) elapsed-time hint as an optional line for time-boxed scanner/mechanic/ui-smoke briefs, NOT a default because it cost 1.6 to 4.1 score points (medium confidence); (3) add the cost-per-solved-task table to references/model-and-effort.md as direction-only data (Opus 5.5 low is about the price of Sonnet 5.5 high). Inference: implementer-hard/planner/reviewer at Opus high sits between the table's medium ($0.22) and xhigh ($0.74) rows; no table row for high.

### B. Effort
URL: https://platform.claude.com/docs/en/build-with-claude/effort (read the model-recommendation, levels, tool-use and thinking sections in full; per-message-effort code samples skimmed)
- FACT: defaults: high on most models; medium on Opus 5.5 and Haiku 5.5. Sonnet 5.5 default high on the API. Setting default explicitly equals omitting.
- FACT: table says low = "Simpler tasks ... such as subagents". Lower effort means fewer, combined, terser tool calls, no preamble.
- FACT: Sonnet 5.5: agentic coding start medium for well-specified tasks, high for harder/longer; xhigh/max only with measured gain; thinking:{"type":"between_tools"} is the lowest thinking setting (low/medium/high only).
- FACT: Haiku 5.5: start medium including agentic coding; low for chat, short tool tasks, high-volume; "in long agent prompts the model is more likely to skip a search, stop early, or skip a check at low"; compare xhigh/max with Sonnet 5.5.
- FACT: Opus 5.5 medium default; thinking cannot be disabled.
- FACT: per-message effort (beta) keeps prompt cache; a top-level effort change resets cache.
- Verdict: ALREADY DONE for the tier table (implementer sonnet/medium matches; planner/reviewer opus/high is a deliberate step above Opus 5.5's medium default). NEW IDEA (medium confidence): scanner and mechanic run haiku/low, and the docs warn low on Haiku 5.5 skips searches/checks in long prompts. Keep their briefs short; if misses appear, the first lever is haiku/medium (the model's own default) before moving to Sonnet. Where: agents/scanner.md, agents/mechanic.md header comment plus references/model-and-effort.md "Small models and their limits".

### C. Steering thinking (cost control)
URL: https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost
- FACT: on Sonnet 5.5, Haiku 5.5 and Fable 5.2, "think less / answer directly" prompt lines do not reliably reduce thinking; lower effort instead.
- FACT: thinking tokens bill as output; prior thinking blocks bill as input.
- Verdict: ALREADY DONE in spirit (model-and-effort.md says raise/lower effort, not prompt). NEW IDEA small: add one sentence "do not put 'don't overthink' into agent prompts; lower effort" to references/model-and-effort.md. Confidence medium-high. API-side items (max_tokens, display) NOT RELEVANT.

### D. Advisor tool
URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool (first 100k of 124k chars read via summary)
- FACT: beta header advisor-tool-2026-03-01; advisor must be at least as capable as the executor; Sonnet 5.5 executor needs Opus 5.5, Opus 5, Fable/Mythos or Sonnet 5.5 as advisor (Haiku 5.5, Sonnet 5, Opus 4.8/4.7 rejected). Typical advisor output 400-700 text tokens (1,400-1,800 with thinking); cache break-even about 3 advisor calls per conversation; max_uses and per-call max_tokens (min 1024, suggested 2048).
- FACT: Haiku executors with an Opus/Fable advisor is a documented fit; a user-message nudge before turn 2 raised Haiku 4.5 pass rate about 7 points, no effect on Sonnet, slightly lower on Opus.
- Verdict: ALREADY DONE at concept level (references/model-and-effort.md "Advisor" section and SKILL.md section 4 last paragraph). NEW IDEA (low): record the pairing rules (Sonnet 5.5 executor rejects Haiku 5.5 / Sonnet 5 / Opus 4.x advisors) and "do not add advisor-nudging text to Sonnet/Opus agents". Confidence medium; this is API-level and Claude Code's /advisor may differ (INFERENCE).

### E. Skill authoring best practices
URL: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- FACT: SKILL.md body under 500 lines; name max 64 chars lowercase/hyphens, no "anthropic"/"claude"; description max 1,024 chars, non-empty, third person, say what and when; references one level deep from SKILL.md; reference files over 100 lines get a table of contents; test with Haiku, Sonnet and Opus; at least three evals; no time-sensitive info (use an "old patterns" section); validation loops; plan-validate-execute for batches.
- Checked locally: skill descriptions are 202 to 553 characters (crew-routing 553), SKILL.md 150 lines, references 83 and 95 lines, all one level deep.
- Verdict: ALREADY DONE (compliant). Two NEW IDEAS (low): (1) mechanisms.md is 95 lines, so a table of contents is not yet required; add one if it grows past 100; (2) model-and-effort.md carries dated, price-bearing facts ("Nov 2026", dollar figures); the guide says to move time-sensitive content to a dated "old patterns"/notes block. Also the name "crew-chief" contains no reserved word. Confidence high.

### F. Refusals and fallback
URL: https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback (preview plus lines 196-234 and grep; not read end to end)
- FACT: Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5 (and others) have classifiers; refusal returns HTTP 200 with stop_reason "refusal"; categories cyber, bio, frontier_llm, reasoning_extraction, general_harms; benign security/ML/life-science work can trigger them. A refusal before any output is billed for bio, frontier_llm, reasoning_extraction; not for cyber, general_harms. reasoning_extraction is triggered by prompts, skills or tool descriptions that ask the model to write its reasoning/scratchpad/trace in output; no fallback exists, change the prompt. Sonnet 5.5 server-side fallback covers cyber and frontier_llm only (to Sonnet 5); Haiku 5.5 has none (from Haiku whats-new); Fable 5.2 falls back to Opus 4.8 or Opus 5. Subagent calls need their own fallback.
- Verdict: NEW IDEA (medium-low confidence, depends on how Claude Code surfaces a refusal inside a subagent, which I did not verify): in SKILL.md section 4 add "A subagent that ends on a refusal/declined request is not 'stopped for difficulty': do not rerun the same brief at the same tier; rephrase the brief (drop any 'show your reasoning' ask) or take it into the main session." Candidate trigger: reviewer on security-sensitive code (cyber classifier). Local grep found no agent prompt asking for reasoning or scratchpads, so reasoning_extraction is not a current risk (FACT from grep).

### G. Fable 5.2 What's new
URL: https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2
- FACT: claude-fable-5-2, 1M context, 128k output, always-on adaptive thinking, $8/$40 per MTok (cache read $0.20, batch $4/$20, fast $16/$80, fast up to 2.5x speed); default effort high; start with Opus 5.5 and move to Fable only when Opus at higher effort still falls short; permitted fallbacks Opus 4.8 and Opus 5; reads Opus/Sonnet/Haiku 5.5 thinking blocks but others do not read its blocks (switching away loses reasoning).
- Verdict: ALREADY DONE mostly (alias `fable` exists in model-and-effort.md). NEW IDEA (low): add price row and the "Opus first, Fable only if Opus at high effort fails" rule to the models table; thinking-block loss on switching down reinforces the existing "switch at a natural break" note. API breaking changes NOT RELEVANT.

### H. What's new Opus 5.5 / Sonnet 5.5 / Haiku 5.5
URLs: .../models/opus-5-5/whats-new-opus-5-5, .../sonnet-5-5/whats-new-sonnet-5-5, .../haiku-5-5/whats-new-haiku-5-5
- FACT: Opus 5.5 $4/$20, cache read $0.20 (0.05x), default effort medium, thinking cannot be disabled, 512-token minimum cacheable prompt. Sonnet 5.5 same price as Sonnet 5 but cache reads $0.10 (half), default high, between_tools option, effort levels recalibrated (rerun sweeps). Haiku 5.5: 1M context, 128k output, new tokenizer counts about 30% more tokens than Haiku 4.5 for the same text, keeps all earlier thinking blocks in context (more input tokens in long chats), default medium.
- Verdict: ALREADY DONE for defaults and Haiku long-prompt surcharge. NEW IDEA (low): if crew-chief reports/cost estimates convert tokens to dollars, note the Haiku 5.5 tokenizer (+30% vs Haiku 4.5) and the cache-read multipliers (Opus/Sonnet 5.5 0.05x, Fable 0.025x) in the report command's price table. Confidence medium; I did not read the report command's code.

### I. Choosing a model
URL: https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- FACT: "Tuning effort is often a better lever than switching models." Matrix: Fable 5.2 highest capability; Opus 5.5 complex agentic coding (most workloads start here); Sonnet 5.5 everyday coding/agents; Haiku 5.5 lowest latency/price and "subagent tasks". Efficiency-first (start Haiku) or capability-first (start Opus 5.5) are the two documented starting strategies. Fast mode up to 2.5x output speed at premium price.
- Verdict: ALREADY DONE (tiers follow this matrix). Supports the existing haiku-for-mechanic/scanner choice. Confidence high.

### J. Task budgets (beta)
URL: https://platform.claude.com/docs/en/build-with-claude/task-budgets
- FACT: output_config.task_budget, header task-budgets-2026-03-13, minimum total 20,000 tokens, advisory not enforced, countdown seen only by the model; a budget too small can cause refusal-like early stops; "Task budgets are not supported on Claude Code or Cowork surfaces"; not supported on Sonnet 5; not in Managed Agents (use Session budgets).
- Verdict: NOT RELEVANT as an API feature (explicitly unsupported in Claude Code). Mental model reusable: crew-chief's turn limits (maxTurns) play this role; the page's warning that a too-small budget causes premature partial results matches the "Size the brief" and "run ended at maxTurns" rules already in SKILL.md. Confidence high.

### K. Build an orchestration mode (example)
URL: https://platform.claude.com/docs/en/build-with-claude/mid-conversation-effort-example (first 100k of 163k chars; not the main loop)
- FACT: mode switch implemented as mid-conversation system messages, never editing system; MODE_ENTER once, MODE_REFRESH every 10 turns, MODE_EXIT once; standing consent in the tool description; effort xhigh, subagents inherit it; verification wave "try to REFUTE ... default to refuted if uncertain"; subagent told "Return findings, not narration"; a module of a few hundred lines "rarely needs more than about ten subtasks"; MAX_CONCURRENT 10, MAX_SUBAGENT_TURNS 15; warns fan-out multiplies tokens.
- Verdict: NEW IDEA (low-medium): (1) refresh cadence of 10 turns is a data point for crew-mode reminder hooks (I did not inspect scripts/session-policy.sh); (2) "default to refuted if uncertain" is a good one-line addition to a verification pass in reviewer.md (I grepped reviewer.md for refut/adversar/default: no hit); (3) "findings, not narration" return style for scanner. Confidence medium-low.

### L. Release notes (first 100k of 143k chars)
URL: https://platform.claude.com/docs/en/release-notes/overview
- FACT: latest entry Nov 9, 2026 (Fable 5.2). Advisor: Fable 5.2 executor accepts only Fable/Mythos 5.2 advisor; every executor accepts Fable 5.2 as advisor. Fast mode: Opus 4.8 fast mode deprecated, removal Nov 30, 2026; Opus 5.5 fast mode out of research preview Oct 15. On-demand compaction beta since Sep 14. Sonnet 5.5 cache reads cut to $0.10 on Oct 7. Dynamic workflows (beta) Oct 9. Sonnet 4.5 retirement set Nov 30, 2026. No release-note entry about Claude Code subagents.
- Verdict: NOT RELEVANT beyond context; the dates feed the deprecations item below.

### M. Model deprecations
URL: https://platform.claude.com/docs/en/about-claude/model-deprecations
- FACT: Sonnet 4.5 deprecated, retires Nov 30, 2026 (replacement sonnet-5-5). Haiku 4.5 "not sooner than Oct 15, 2026" (that date has passed as of today, Nov 10, 2026, but it is a "not sooner than" and still listed Active). Active 5.5 models: not sooner than Sep 22 to Oct 7, 2027. At least 60 days' notice before retirement of public models.
- Verdict: NEW IDEA (low): crew-chief uses aliases, so nothing to change; but the doc says an alias on Bedrock/Vertex can point to older models (existing note). If a user pins an old ID via ANTHROPIC_DEFAULT_*_MODEL, a deprecation warning line in the model-and-effort.md pins paragraph would help. Confidence medium.

### N. Skimmed only (via the llms index or other pages, not read)
Compaction family, Context editing, Context windows, Prompt caching, Cache diagnostics, Tool search, Parallel tool use, Fast mode page itself, Pricing, Test and evaluate pages, Managed Agents multiagent orchestration, Agent Skills overview. Verdict: likely NOT RELEVANT because Claude Code owns compaction, caching and tool search (INFERENCE, unverified). Open points: Fast mode page (does Claude Code expose it per subagent?), Tool search tool, Define success and build evaluations (could inform a crew-chief eval harness), Reducing latency.

## 3. Ranked recommendations

1. Prompt-audit the plugin's own instructions (agents/*.md, SKILL.md, crew-setup claude-md-section) for stale "be thorough / verify twice / think step by step / don't overthink" lines. Evidence: removing such lines cut cost about a third each; thinking-steering page says they do not work on Sonnet/Haiku 5.5 and Fable 5.2. My grep found none, so this is mostly a documented check (record it in the model-and-effort.md "Diagnose" section) rather than an edit. Tier: main session, small.
2. Handle subagent refusals in SKILL.md section 4 (do not re-run the same brief at the same tier; rephrase or go main-session; avoid asking agents for reasoning/scratchpad text because that triggers reasoning_extraction and is billed). Confidence medium; first verify how a refusal looks in a Claude Code subagent report. Tier: implementer after a live check.
3. Haiku-tier safety margin: add to scanner/mechanic docs and model-and-effort.md that haiku/low skips searches and checks in long prompts; keep briefs short; escalate lever order = haiku/medium (the model default) then Sonnet. Tier: implementer, tiny doc edit.
4. Extend references/model-and-effort.md with the cost-per-solved-task table (Sonnet 5.5 high $0.11/87.6%, Opus 5.5 low $0.12/87.4%, medium $0.22/92.8%, xhigh $0.74/96.7%), the defect-search numbers (orchestrator pairing 1.9 points below Opus high at $139 vs $236), and the Fable rule "Opus first, Fable only if Opus at high effort fails"; label as direction-only, dated Nov 2026. Also move dated figures into a dated block per skill best practice. Tier: implementer.
5. Optional elapsed-time line for time-boxed briefs ("Time matters here: ..."): 47% less time and 60% lower cost for a single agent, but 4.1 points lower score. Offer as an opt-in in the brief checklist, never a default. Tier: main session decision.
6. Reviewer: add "try to refute; default to unconfirmed if uncertain" to the verification step and "findings, not narration" to the return format (from the orchestration example). Confidence medium-low; test on one real review. Tier: implementer-hard or main session.
7. Report command: if it converts tokens to dollars, confirm it uses the 5.5 prices ($4/$20 Opus, Sonnet 5.5 cache read $0.10, Haiku 5.5 +30% tokens vs Haiku 4.5) and cache-read multipliers. Not verified in code. Tier: implementer after reading the report script.

## 4. Gaps
- Fetch tool summarised long pages; only optimizing, effort, advisor, release notes, orchestration example were truncated at 100k-200k chars of source. Last 14k of optimizing, 24k of advisor, 63k of orchestration example, 43k of release notes unread.
- Pages not read: compaction family, context editing, context windows, prompt caching, cache diagnostics, tool search, parallel tool use, fast mode, pricing, evaluation pages, Managed Agents. Judged low relevance by inference only.
- Claude Code behavior (how refusals, effort on resume, advisor in subagents surface) not verified here; needs a live test.
