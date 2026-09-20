# ctx

**Every turn of a Claude Code session re-sends the entire conversation. That is where your usage goes — and nobody shows you the bill.**

`ctx` reads the transcripts Claude Code already writes to disk and tells you what your tokens actually did. Then it stops the worst of it, at zero context cost.

```
$ /ctx

  ctx audit — 528 sessions, 86,549 turns

    modelled spend             $16,914
    all-uncached baseline     $100,253     83% saved by caching
    cache hit rate                  97%

    prefix rebuilds                 718     156.9M tokens re-billed at full price
      -> cost of those             $784     the avoidable part
    avg static prefix            42,686     system + tools, before your first word
    tool result weight      47,726,978     tokens of tool output
    thinking tokens         17,380,885     billed at the output rate

    most expensive sessions
        $770.97  2582 turns  hit  95%  peak  934k  rebuilds  51
        $381.70   446 turns  hit  98%  peak  559k  rebuilds   3
        $355.07  1524 turns  hit  96%  peak  733k  rebuilds  28
```

That is one machine. Six months of real sessions, read in four seconds, without touching the network.

## Install

```
/plugin marketplace add BelgacemElbar/ctx
/plugin install ctx@ctx
```

Restart Claude Code. That's it — no API key, no daemon, no config file. Works on every plan, **including Pro and Max**.

Total added context cost: **~79 tokens**.

## What you get

### `/ctx` — the audit

Reads `~/.claude/projects/**/*.jsonl`, models every turn at public API rates, and reports the leaks. Per-turn token usage, cache reads, cache writes split by 1h vs 5m, output and thinking tokens — all of it is already on disk, so this needs no credentials and makes no network calls.

### It trims before the tokens are spent

Reporting a number doesn't reduce it. These four hooks rewrite the tool call
*before it runs*, so the bytes never enter context.

**`PreToolUse` on Read** — any file over 150 lines gets a 120-line limit injected.

```json
{"updatedInput":{"file_path":"package-lock.json","limit":120}}
```

That file is 5,571 lines, ~433k tokens. You get 120 lines.

**`PreToolUse` on Grep** — injects `head_limit: 30` on any search that doesn't set one.

**`PreToolUse` on Bash** — rewrites bare `cat f` to `head -120 f`, and `git log` to `git log -n 30`.

**`PostToolUse`** — tells the model what it did *not* see, so a trimmed file is never
mistaken for a short one:

```
ctx: this file is 5,571 lines; you were shown 120. The rest was withheld to
protect the context budget. Use offset/limit or Grep if you need more.
```

…and truncates command output over 30k chars, keeping head and tail because errors
live at the end. Measured: **60,000 chars → 6,195, 89.7% removed.**

**`PreCompact`** — compaction decides how much of a session survives, and the default
is generous. This makes it aggressive: discard tool results entirely, collapse dead
ends, keep only goal, decisions, changed files and open questions, target under
8,000 tokens. Every token kept after compaction is re-sent on every later turn.

**All four cost zero context tokens.** Claude Code treats hooks as harness-only —
they run outside the context they're protecting.

Tunable with `CTX_READ_LINES`, `CTX_READ_KEEP`, `CTX_GREP_LIMIT`, `CTX_BASH_CHARS`
(set `0` to disable output truncation), `CTX_TRIM_BASH=0` to leave shell commands alone.

### A session brief

On startup, one line:

```
ctx: last session was 313 turns, $60.12, peak 416k context, 1 prefix rebuild.
Run /ctx for the full audit.
```

### A `context-budget` skill

Auto-fires when a session gets long or before reading something large. Four rules: never read a whole file to find one thing, pipe command output instead of dumping it, don't change the cache prefix mid-session, clear instead of continuing.

## The three leaks

**Prefix rebuilds.** A cached token costs 0.1x. A full-price one costs 1x. If anything in the prefix changes — CLAUDE.md, memory files, connected plugins, MCP servers, model — the whole thing is re-billed at full price until it's cached again. 718 of those added up to 156.9M tokens on one machine. This is the single biggest number in almost every audit, and nothing else surfaces it.

**Tool bloat.** A static prefix of 42,686 tokens before you type anything. Every tool schema from every plugin and MCP server sits in every request, and it's the floor that every rebuild re-pays.

**Context growth.** Context isn't a one-off cost, it's a cost you pay again on every later turn. One session ran 2,582 turns and peaked at 934k. Past ~400k, `/clear` beats continuing.

## Why a plugin and not a proxy

A proxy is the obvious design, so we built one first and tested it against a Pro/Max subscription on 2026-09-20. It does not work: with `ANTHROPIC_BASE_URL` set, Claude Code refuses to send its credentials (`Not logged in · Please run /login`) and the upstream returns `401 invalid x-api-key`. Subscription auth is bound to Anthropic's endpoint on purpose.

So the measurement layer reads local transcripts instead, and the intervention layer uses hooks. Both work on every plan.

The proxy still ships for API-key users who want live interception, including tool-schema pruning and tool-result offloading. See [`docs/PROXY.md`](docs/PROXY.md).

## Limits

- **Read and Grep are trimmed on the way in; Bash only partly.** Rewriting arbitrary
  shell is unsafe, so only bare `cat` and `git log` are rewritten before running —
  everything else is truncated *after* the fact, which still keeps the tokens out of
  context but doesn't save the generation.
- **Trimming trades completeness for budget.** If you genuinely need a whole 5,571-line
  file, ask for it in slices. The point is that this is now a choice you make, not a
  default that costs you 433k tokens.
- **Figures are modelled at public API rates.** On a subscription they are what your usage is *worth*, not what you're invoiced.
- **Claude Desktop is out of reach.** No base-URL override, and intercepting it means a MITM CA plus DNS override. Desktop also isn't where the spend is — no MCP servers, no multi-hour loops.
- Prefix rebuilds are detected heuristically: a `cache_read` that drops below 80% of the previous turn means the prefix was rebuilt.

## License

MIT. Read-only against your own files; the audit never leaves your machine.
