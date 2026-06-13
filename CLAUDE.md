# CLAUDE.md — 8-Rule Architecture
These rules apply to every task in this project unless explicitly overridden.
Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.
## Rule 1 — Think Before Coding
State assumptions explicitly. If uncertain, ask rather than guess.
Push back when a simpler approach exists. Stop when confused.
## Rule 2 — Simplicity First
Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.
## Rule 3 — Surgical Changes
Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting. Match existing style.
## Rule 4 — Goal-Driven Execution
Define success criteria. Loop until verified.
Don't follow steps. Define success and iterate independently.
## Rule 5 — Token budgets are not advisory
Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh. Surface the breach.
## Rule 6 — Read before you write
Before adding code, read exports, immediate callers, shared utilities.
If unsure why code is structured a certain way, ask.
## Rule 7 — Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back. Stop and restate.
## Rule 8 — Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.