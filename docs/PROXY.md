# ctx as a proxy (API key only)

The plugin is the main path and works on every plan. This is the power-user path:
live interception for people on `ANTHROPIC_API_KEY`.

⚠️ Verified 2026-09-20 with Claude Code 2.1.223: **this does not work with a
Pro/Max subscription.** Setting `ANTHROPIC_BASE_URL` makes the CLI refuse to send
its credentials — it prints `Not logged in · Please run /login` and the upstream
returns `401 invalid x-api-key`. Subscription auth is bound to Anthropic's
endpoint deliberately. If you are on a subscription, use the plugin instead.

## Run it

```bash
node src/proxy.js            # or: npm link && ctx
export ANTHROPIC_BASE_URL=http://localhost:8787
```

Dashboard at `http://localhost:8787/`, terminal summary with `node bin/report.js`.

## What it does

| Problem | Mechanism | Where |
| --- | --- | --- |
| Prefix keeps changing, cache misses | Hash `system` + `tools` + `model` each turn, flag every change and bill it visibly | `src/optimize.js: checkPrefix` |
| Dozens of MCP tool schemas resent every turn | Score tools against the session's first message, keep top N, then **freeze** the set so the prefix stays stable | `src/optimize.js: pruneTools` |
| Fat tool results live in context forever | Swap body for head + tail + an absolute path on disk; the agent re-reads or greps only what it needs | `src/optimize.js: offloadToolResults` |
| Mechanical work billed at Opus rates | Regex rules on the latest user message rewrite `model` | `src/optimize.js: routeModel` |
| No idea where the money goes | Per-turn accounting: tokens by class, cache hit rate, spend vs all-uncached baseline | `src/dashboard.js` |

Offloading works without client changes because the truncated text contains a real
absolute path the agent's own Read/Grep tools can open. No new tool definition, no
plugin, no MCP server.

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

`pruneAbove` matters: below that tool count, pruning is skipped entirely, because
breaking a cache for six tools costs more than it saves.

## Limits

- Anthropic `/v1/messages` only. OpenAI-shaped `tools[].function` is not handled.
- Offloading is content-blind — head + tail + path is a first-cut heuristic.
- Sessions come from an `x-ctx-session` header; without it everything lands in `default`.
- Tool pruning is keyword-scored, not embedded.
- `~/.ctx/store/` grows unbounded. Needs a TTL sweep.
