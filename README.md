# ctx

**Every turn of a Claude Code session re-sends the entire conversation. That is where your usage goes — and nobody stops it.**

`ctx` intercepts tool calls *before* they burn tokens: trims file reads, blocks junk files, breaks tool loops, survives compaction, and forces aggressive compaction. All at zero context cost. Then it shows you the bill.

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

Seven hooks. All harness-only — zero context tokens.

### 1. Trims before the tokens are spent

**`PreToolUse` on Read** — any file over 150 lines gets a 120-line limit injected.

```json
{"updatedInput":{"file_path":"package-lock.json","limit":120}}
```

That file is 5,571 lines, ~433k tokens. You get 120 lines.

**`PreToolUse` on Grep** — injects `head_limit: 30` on any search that doesn't set one.

**`PreToolUse` on Bash** — rewrites bare `cat f` to `head -120 f`, and `git log` to `git log -n 30`.

**`PostToolUse`** — tells the model what it did *not* see, so a trimmed file is never mistaken for a short one:

```
ctx: this file is 5,571 lines; you were shown 120. The rest was withheld to
protect the context budget. Use offset/limit or Grep if you need more.
```

…and truncates command output over 30k chars, keeping head and tail because errors live at the end. Measured: **60,000 chars → 6,195, 89.7% removed.**

### 2. Junk-file shield

**`PreToolUse` on Read** — detects lockfiles, minified bundles, binaries, archives, fonts, databases, `node_modules/`, build output, and other files that should never enter context. Caps them to 50 lines with an explanation.

```
ctx: Blocked full read of package-lock.json: npm lockfile — 50k+ lines of
dependency hashes. Showing first 50 lines only — do not attempt to read more.
```

30+ pattern matchers plus a binary-content detector (null bytes and non-printable ratio in the first 512 bytes). The model gets told *why* the file is useless, so it doesn't retry with a different approach.

### 3. Compaction survival

**`PreCompact`** — before compaction throws your session away, this reads the last 512KB of transcript and extracts: the goal (last 2 user messages), every file changed (from `Write`/`Edit` tool calls), the last 2 errors, and where the model left off. Writes it to `~/.ctx/handoff.md`.

**`PostCompact`** — immediately re-injects the handoff as `additionalContext`, so the model comes out of compaction knowing what it was doing.

**`SessionStart`** — also injects the handoff (if <36h old), giving you continuity across `/clear` and across days.

Compaction is the single most complained-about Claude Code problem. This is the fix.

### 4. Loop breaker

**`PreToolUse` + `PostToolUse`** — tracks per-session tool patterns and intervenes when the model is stuck:

- **Same file read 5×** → *"You have read this file 5 times. The file has not changed. Stop re-reading it."*
- **Same command 3×** → *"Re-running an identical command will produce the same result. Change your approach."*
- **Same error 3×** → *"You are in a failure loop. Stop retrying the same approach."*

State is a simple JSON file under `~/.ctx/loop-state.json`, auto-pruned every 6 hours. No external dependencies.

### 5. Aggressive compaction

**`PreCompact`** — compaction decides how much of a session survives, and the default is generous. This makes it aggressive: discard tool results entirely, collapse dead ends, keep only goal, decisions, changed files and open questions, target under 8,000 tokens. Every token kept after compaction is re-sent on every later turn.

### 6. Session brief

On startup, one line:

```
ctx: last session was 313 turns, $60.12, peak 416k context, 1 prefix rebuild.
Run /ctx for the full audit.
```

### 7. `/ctx` — the audit

Reads `~/.claude/projects/**/*.jsonl`, models every turn at public API rates, and reports the leaks. Per-turn token usage, cache reads, cache writes split by 1h vs 5m, output and thinking tokens — all of it is already on disk, so this needs no credentials and makes no network calls.

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

## Configuration

All hooks are tunable via environment variables:

| Variable | Default | Effect |
|---|---|---|
| `CTX_READ_LINES` | 150 | Files above this many lines get trimmed |
| `CTX_READ_KEEP` | 120 | How many lines to keep when trimming |
| `CTX_GREP_LIMIT` | 30 | Max grep results without an explicit limit |
| `CTX_BASH_CHARS` | 30000 | Command output truncation threshold |
| `CTX_BASH_HEAD` | 4000 | Head chars to keep when truncating output |
| `CTX_BASH_TAIL` | 2000 | Tail chars to keep when truncating output |
| `CTX_TRIM_BASH` | 1 | Set to `0` to leave shell commands alone |

## Limits

- **Read and Grep are trimmed on the way in; Bash only partly.** Rewriting arbitrary shell is unsafe, so only bare `cat` and `git log` are rewritten before running — everything else is truncated *after* the fact, which still keeps the tokens out of context but doesn't save the generation.
- **Trimming trades completeness for budget.** If you genuinely need a whole 5,571-line file, ask for it in slices. The point is that this is now a choice you make, not a default that costs you 433k tokens.
- **Figures are modelled at public API rates.** On a subscription they are what your usage is *worth*, not what you're invoiced.
- **Claude Desktop is out of reach.** No base-URL override, and intercepting it means a MITM CA plus DNS override. Desktop also isn't where the spend is — no MCP servers, no multi-hour loops.
- Prefix rebuilds are detected heuristically: a `cache_read` that drops below 80% of the previous turn means the prefix was rebuilt.

## License

MIT. Read-only against your own files; the audit never leaves your machine.
