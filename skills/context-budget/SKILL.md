---
name: context-budget
description: Keeps Claude Code sessions cheap — when to clear, how to read files without flooding context, and what invalidates the cache prefix. Use when a session is getting long, when token or usage cost comes up, or before reading large files.
---

Every turn re-sends the whole conversation. Context is not a one-off cost, it is a
cost you pay again on every subsequent turn. Act accordingly.

## The four rules

**1. Never read a whole file to find one thing.**
`Grep` with `output_mode: "content"` and a narrow pattern, then `Read` with `offset`
and `limit` around the hit. A 2,000-line file is ~20k tokens that then sit in
context for the rest of the session.

**2. Pipe command output instead of dumping it.**
`npm test 2>&1 | tail -30`, not the full log. Same for build output, `git log`, and
`ls -R`. If you only need to know whether it passed, grep for the summary line.

**3. Do not change the cache prefix mid-session.**
The system prompt, tool list and model must stay byte-identical or the whole prefix
is re-billed at full input price instead of 0.1x. That means: do not edit CLAUDE.md
or memory files while working, do not toggle plugins or MCP servers, do not switch
model. Batch those changes at session boundaries.

**4. Clear instead of continuing.**
Once a session passes ~400k tokens, the cheap move is `/clear` and a fresh start
with a one-paragraph handoff. Continuing costs more per turn and gets slower.

## When to invoke

- A session has run past ~50 turns.
- The user asks why something is slow or expensive.
- About to read a file over ~800 lines.
- Deciding whether to keep going or start over.

## Do not

- Do not read files "for context" speculatively. Read what the task needs.
- Do not re-run an audit mid-task. Once per session, at the start or the end.
