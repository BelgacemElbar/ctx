---
description: Show where your Claude Code tokens went and what to fix.
allowed-tools: Bash(node:*)
---

Run the audit over the most recent sessions:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/audit.js" 20
```

Then report back in this shape, and nothing longer:

1. **One line**: total modelled spend, cache hit rate, and how much the cache saved.
2. **The leaks**, as a short list — prefix rebuilds and their cost, tool-result weight,
   peak context, thinking tokens. Only mention figures that are actually large.
3. **One action.** Pick the single change that would save the most and say it in one
   sentence. Do not list five.

Rules:

- Lead with the number, not with an explanation of what the number means.
- If prefix rebuilds are high, the cause is almost always editing CLAUDE.md or memory
  mid-session, toggling plugins or MCP servers, switching model, or session compaction.
- If peak context is above ~400k, say to `/clear` and start a fresh session instead of
  continuing.
- Do not restate the figures as a table. Do not add encouragement.
