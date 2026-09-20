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

### The read guard

The one intervention that works on subscription traffic:

```
ctx: package-lock.json is 5,571 lines (~432,804 tokens). Reading it whole
adds that to this turn and to every turn after it. Use offset/limit to read
a slice, or Grep for what you actually need. Run /ctx to see your token spend.
```

A `PreToolUse` hook fires before `Read`, counts lines in 256KB chunks, and refuses files over 800 lines or 60KB. The file never enters context at all.

**This costs zero tokens.** Claude Code treats hooks as harness-only — they run outside the context they're protecting, so the guard is free in the currency it saves.

It also refuses the same file at most twice per session, then gets out of the way. Override with `CTX_MAX_LINES` / `CTX_MAX_BYTES`.

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

- **Read is guarded; Bash is not.** You can't know a command's output size before it runs. Grep with a narrow pattern instead of dumping logs.
- **Figures are modelled at public API rates.** On a subscription they are what your usage is *worth*, not what you're invoiced.
- **Claude Desktop is out of reach.** No base-URL override, and intercepting it means a MITM CA plus DNS override. Desktop also isn't where the spend is — no MCP servers, no multi-hour loops.
- Prefix rebuilds are detected heuristically: a `cache_read` that drops below 80% of the previous turn means the prefix was rebuilt.

## License

MIT. Read-only against your own files; the audit never leaves your machine.
