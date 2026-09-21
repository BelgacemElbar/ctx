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

So I built ctx. Seven hooks, zero context tokens:

- Trims file reads before they enter context
- Blocks junk files (lockfiles, minified, binaries)
- Breaks tool loops (same file 5x, same error 3x)
- Saves your session before compaction and hands it back after
- Forces aggressive compaction (target <8k tokens)
- Audits your spend from local transcripts

```
/plugin marketplace add BelgacemElbar/ctx
/plugin install ctx@ctx
```

github.com/BelgacemElbar/ctx

---

## X — single post (if you only post once)

I read six months of my Claude Code transcripts: 528 sessions, 86,549 turns,
$16,914 of usage.

Built a plugin with seven zero-context hooks that stop the waste: trims reads,
blocks junk files, breaks loops, survives compaction. Free, ~79 tokens.

github.com/BelgacemElbar/ctx

---

## Reddit — r/ClaudeAI and r/ClaudeCode

**Title:** I built 7 hooks that cut Claude Code token waste — trims, junk-file shield, loop breaker, compaction survival

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
harness-only, so every intervention costs **zero** context tokens.

Seven hooks:

1. **Trimmer** — caps file reads to 120 lines, grep to 30 results, rewrites `cat` → `head`, truncates command output at 30k chars
2. **Junk-file shield** — 30+ patterns + binary detector: lockfiles, minified bundles, node_modules/, archives, fonts, databases. Caps to 50 lines with an explanation so the model doesn't retry
3. **Loop breaker** — same file read 5×, same command 3×, same error 3× → injects a stop-and-think message. Kills the read-fail-read death spiral
4. **Compaction survival** — saves goal + changed files + last errors + where it left off before compaction, re-injects after. Fixes the #1 complaint: "Claude forgets everything after compaction"
5. **Aggressive compaction** — discard tool results, collapse dead ends, target <8k tokens. Every token kept after compaction is re-sent on every later turn
6. **Session brief** — one line on startup: what the last session cost
7. **`/ctx` audit** — reads local transcripts, models spend at API rates, reports the leaks

```
/plugin marketplace add BelgacemElbar/ctx
/plugin install ctx@ctx
```

MIT, read-only against your own files, no network calls. ~79 tokens added.

Happy to be told the modelling is wrong. The script is 200 lines and it only
reads your own files.

---

## Hacker News

**Title:** Show HN: ctx — 7 zero-context hooks that cut Claude Code token waste

**First comment:**

Claude Code writes per-turn token usage to local JSONL transcripts. I parse them
and model spend at public API rates.

The finding I did not expect: 718 cache-prefix rebuilds across 528 sessions —
156.9M tokens re-billed at full price instead of the 0.1x cache rate. A prefix
rebuild happens when the system prompt, tool list or model changes mid-session;
mine came from editing CLAUDE.md while working.

Detection heuristic is simple: a `cache_read` that drops below 80% of the
previous turn means the prefix was rebuilt.

But the real intervention is the seven hooks, not the audit. They run
harness-only — zero context tokens:

- Trims file reads, grep results, and command output before they enter context
- Blocks junk files (lockfiles, minified, binaries, node_modules/) — 30+ patterns
- Breaks loops: same file read 5×, same command 3×, same error 3× → stop-and-think
- Survives compaction: saves goal + changed files + errors before, re-injects after
- Forces aggressive compaction: target <8k tokens, discard tool results

Works on Pro/Max. A proxy does not — Claude Code won't send subscription
credentials to a custom base URL.

github.com/BelgacemElbar/ctx

---

## Product Hunt

**Tagline:** 7 zero-context hooks that cut your Claude Code token waste

**Description:**

Every turn of a Claude Code session re-sends the entire conversation. ctx stops
the waste with seven hooks that run harness-only — zero context tokens:

1. Trims file reads to 120 lines, grep to 30 results, command output to 30k chars
2. Junk-file shield: blocks lockfiles, minified bundles, binaries, archives, 30+ patterns
3. Loop breaker: stops read-fail-read death spirals automatically
4. Compaction survival: saves your session before compaction, hands it back after
5. Aggressive compaction: target <8k tokens, discard tool results
6. Session brief: one line on startup showing last session's cost
7. `/ctx` audit: reads local transcripts, models spend at API rates

No API key. No daemon. Works on every plan, including Pro and Max. ~79 tokens
added to your session. MIT licensed, read-only against your own files.

---

## Timing

Post between 13:00 and 15:00 UTC on a Tuesday or Wednesday. Reddit first, then X
an hour later, then HN the next morning if Reddit lands. Do not post all three
at once — you can't tell which one worked.
