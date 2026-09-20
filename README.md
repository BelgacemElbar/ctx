# ctx

A local proxy that owns your LLM context. You point `ANTHROPIC_BASE_URL` at it and
every request goes through one chokepoint, where the expensive things get fixed
before they reach the API.

Every cost problem in an agentic session is the same problem: **context that
grows unbounded and stops being cacheable.** One mechanism, applied at the
network boundary, covers all of them.

## Install as a Claude Code plugin

Works on every plan, including Pro/Max. No API key, no daemon, no network.

```
/plugin marketplace add BelgacemElbar/ctx
/plugin install ctx@ctx
```

Restart Claude Code so the hooks register. You get:

- **`/ctx`** — audits your recent sessions and reports where the tokens went.
- **A read guard** — refuses whole-file reads over 800 lines and tells the model to
  slice or grep instead. Runs as a `PreToolUse` hook, so it costs **zero context
  tokens**; Claude Code counts hooks as harness-only.
- **A session brief** — one line on startup: what the last session cost, its peak
  context, and how many prefix rebuilds it had.
- **A `context-budget` skill** — auto-fires when a session gets long or before
  reading something large.

Measured install cost: ~79 tokens always-on.

The guard refuses the same file at most twice per session, then gets out of the
way. Override with `CTX_MAX_LINES` / `CTX_MAX_BYTES`.

### Local development loop

```bash
claude plugin marketplace add /Users/ssss/dev/ctx   # local path works
claude plugin install ctx@ctx
# after a change:
git commit -am "..." && claude plugin marketplace update ctx && claude plugin install ctx@ctx
claude plugin details ctx    # shows component inventory and token cost
```

## Install as a proxy (API key only)

```bash
cd ~/dev/ctx
node src/proxy.js            # or: npm link && ctx
export ANTHROPIC_BASE_URL=http://localhost:8787
```

Then use Claude Code normally. Dashboard at `http://localhost:8787/`, terminal
summary with `node bin/report.js`.

### On a subscription — use the audit instead

```bash
node bin/audit.js            # reads ~/.claude/projects/**/*.jsonl
open ~/.ctx/audit.html
```

⚠️ **The proxy only works on the API path.** Tested 2026-09-20 with Claude Code
2.1.223 and a Pro/Max subscription: setting `ANTHROPIC_BASE_URL` makes the CLI
refuse to send its credentials — it prints `Not logged in · Please run /login`
and the upstream returns `invalid x-api-key`. Subscription auth is bound to
Anthropic's endpoint on purpose. So for subscription users `ctx` is a
**measurement** tool, not an interception tool.

That is fine, because Claude Code already writes the ground truth to disk:
`~/.claude/projects/**/*.jsonl` contains per-turn `usage` with cache reads,
cache writes (broken out 1h vs 5m), output and thinking tokens. `audit.js`
reads those, needs no network and no credentials, and works for anyone.

## What it does

| Problem | Mechanism | Where |
| --- | --- | --- |
| Prefix keeps changing, cache misses | Hash `system` + `tools` + `model` each turn, flag every change and bill it visibly | `optimize.js: checkPrefix` |
| 60 MCP tool schemas resent every turn | Score tools against the session's first message, keep top N, **freeze** the set so the prefix stays stable | `optimize.js: pruneTools` |
| Fat tool results (file reads, logs) live in context forever | Swap body for head + tail + an absolute path on disk; the agent re-reads or greps only what it needs | `optimize.js: offloadToolResults` |
| Mechanical work billed at Opus rates | Regex rules on the latest user message rewrite `model` | `optimize.js: routeModel` |
| No idea where the money goes | Per-turn accounting: tokens by class, cache hit rate, spend vs all-uncached baseline, per-session and per-model split | `dashboard.js`, `bin/report.js` |

Why offloading works without client changes: the truncated text contains a real
absolute path, and the agent's own Read/Grep tools can open it. No new tool
definition, no plugin, no MCP server.

## Config

Written to `~/.ctx/config.json` on first run.

```json
{
  "port": 8787,
  "upstream": "https://api.anthropic.com",
  "offload": { "enabled": true, "minChars": 4000, "keepChars": 1200, "keepTailChars": 400 },
  "tools":   { "enabled": true, "pruneAbove": 10, "keepTop": 8 },
  "routing": { "enabled": false, "rules": [{ "match": "format this json", "model": "claude-haiku-4-5" }] }
}
```

`pruneAbove` is the important one: below that tool count, pruning is skipped
entirely, because breaking a cache for 6 tools costs more than it saves.

### Claude Desktop

No path in. Desktop has no base-URL override, and intercepting it means a MITM
proxy with a locally trusted CA plus a DNS override — fragile, breaks on every
app update, and not something to ship. Desktop is also not where the spend is:
it has no MCP servers configured here, so its tool overhead is near zero, and
its chats do not run multi-hour agentic loops. The levers that apply to Desktop
are config-level: fewer connected MCP servers, smaller Project knowledge, and
shorter chats.

## Honest limits

- Interception requires an API key. Subscription traffic cannot be proxied.
- Audit figures are modelled at public API rates. On a subscription they are
  what the usage is *worth*, not what is invoiced.

- Anthropic `/v1/messages` only. OpenAI-shaped `tools[].function` is not handled yet.
- Offloading is content-blind — it cannot tell a build log you need from one you
  don't. The head + tail + path heuristic is a first cut.
- Sessions are identified by the `x-ctx-session` header; without it everything
  lands in `default`. A client wrapper that injects a real session id is the fix.
- Tool pruning is keyword-scored, not embedded. Good enough, not smart.
- `~/.ctx/store/` grows unbounded. Needs a TTL sweep.

## Kill criterion

Ship it, post it, and measure. Kill it if, two weeks after the launch post:

- fewer than **20 GitHub stars**, or
- fewer than **3 people who are not me** have run it against their own traffic, or
- it cannot show **≥30% below the all-uncached baseline** on my own sessions.

Any one of those failing means stop. Not "iterate" — stop.
