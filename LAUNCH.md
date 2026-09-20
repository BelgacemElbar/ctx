# Launch copy

Paste-ready. Every number below came from a real audit of 528 Claude Code
sessions on one machine. Do not soften them.

---

## X — thread (primary)

**1/**

I audited six months of my own Claude Code sessions.

528 sessions. 86,549 turns. $16,914 of usage at API rates.

The biggest line item wasn't output tokens. It was 718 cache-prefix rebuilds —
156.9M tokens re-billed at full price instead of 0.1x.

Nothing tells you this is happening.

**2/**

A cached token costs 0.1x. A full-price one costs 1x.

If anything in the prefix changes — CLAUDE.md, memory, connected plugins, MCP
servers, model — the whole thing is re-billed at full price until it caches again.

I was editing CLAUDE.md mid-session. 156.9M tokens. ~$784.

**3/**

So I built ctx. It reads the transcripts Claude Code already writes to disk and
shows you where the tokens went. Then it blocks the reads that blow the budget —
as a PreToolUse hook, so the guard costs zero context tokens.

```
/plugin marketplace add BelgacemElbar/ctx
/plugin install ctx@ctx
```

github.com/BelgacemElbar/ctx

---

## X — single post (if you only post once)

I read six months of my Claude Code transcripts: 528 sessions, 86,549 turns,
$16,914 of usage.

718 cache-prefix rebuilds. 156.9M tokens re-billed at full price instead of 0.1x.
Cause: editing CLAUDE.md mid-session.

Built a plugin that shows it and blocks the worst reads. Free, zero context cost.
github.com/BelgacemElbar/ctx

---

## Reddit — r/ClaudeAI and r/ClaudeCode

**Title:** I read my own Claude Code transcripts: 718 cache-prefix rebuilds,
156.9M tokens re-billed at full price

**Body:**

Claude Code writes every turn's token usage to `~/.claude/projects/**/*.jsonl` —
cache reads, cache writes split by 1h vs 5m, output, thinking tokens. Nobody
reads it, so I wrote something that does.

Six months of my sessions: 528 sessions, 86,549 turns, $16,914 modelled at API
rates, 97% cache hit rate.

The number I did not expect: **718 prefix rebuilds, 156.9M tokens.**

A cached token costs 0.1x. A full-price one costs 1x. If the prefix changes —
editing CLAUDE.md or memory mid-session, toggling plugins or MCP servers,
switching model, session compaction — the whole thing re-bills at full price. My
static prefix is 42,686 tokens before I type anything, so every rebuild is
expensive.

I detect it like this: when `cache_read` on turn N drops below 80% of turn N-1,
the prefix was rebuilt.

What I built, as a plugin rather than a proxy, because a proxy doesn't work here:
setting `ANTHROPIC_BASE_URL` on a Pro/Max subscription makes Claude Code refuse
to send credentials (401 invalid x-api-key). Subscription auth is bound to
Anthropic's endpoint. Hooks work on every plan, and Claude Code counts them as
harness-only, so the read guard costs **zero** context tokens.

- `/ctx` — audits your sessions
- a PreToolUse hook that refuses whole-file reads over 800 lines and tells the
  model to slice or grep instead
- a one-line startup brief: what the last session cost
- MIT, read-only against your own files, no network calls

```
/plugin marketplace add BelgacemElbar/ctx
/plugin install ctx@ctx
```

Happy to be told the modelling is wrong. The script is 200 lines and it only
reads your own files.

---

## Hacker News

**Title:** Show HN: ctx – see where your Claude Code tokens go

**First comment:**

Claude Code writes per-turn token usage to local JSONL transcripts. I parse them
and model spend at public API rates.

The finding I did not expect: 718 cache-prefix rebuilds across 528 sessions —
156.9M tokens re-billed at full price instead of the 0.1x cache rate. A prefix
rebuild happens when the system prompt, tool list or model changes mid-session;
mine came from editing CLAUDE.md while working.

Detection heuristic is simple: a `cache_read` that drops below 80% of the
previous turn means the prefix was rebuilt.

It also ships a PreToolUse hook that refuses whole-file reads over 800 lines.
Claude Code counts hooks as harness-only, so the guard costs zero context tokens
in the currency it's saving.

Works on Pro/Max. A proxy does not — Claude Code won't send subscription
credentials to a custom base URL.

---

## Product Hunt

**Tagline:** See where your Claude Code tokens go — and stop the worst of it

**Description:**

Every turn of a Claude Code session re-sends the entire conversation. ctx reads
the transcripts Claude Code already writes to your disk and shows you what your
tokens actually did: cache-prefix rebuilds, tool bloat, context growth, thinking
tokens.

Then it stops the worst of it. A PreToolUse hook refuses whole-file reads over
800 lines before they enter context — and because Claude Code treats hooks as
harness-only, the guard costs zero context tokens.

No API key. No daemon. Works on every plan, including Pro and Max. ~79 tokens
added to your session. MIT licensed, read-only against your own files.

---

## Timing

Post between 13:00 and 15:00 UTC on a Tuesday or Wednesday. Reddit first, then X
an hour later, then HN the next morning if Reddit lands. Do not post all three
at once — you can't tell which one worked.
