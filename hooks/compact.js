#!/usr/bin/env node
// PreCompact. Compaction decides how much of the old conversation survives, and
// the default is generous. This makes it aggressive, which is the only
// automatic lever on context size that Claude Code gives us.
//
// Fires on both `auto` and `manual` compaction.

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreCompact',
      additionalContext:
        'Compacting under a context budget. Be aggressive: discard tool results and ' +
        'their contents entirely, discard superseded attempts and dead ends, and collapse ' +
        'repeated debugging into a single outcome. Keep only: the current goal, decisions ' +
        'made with one-line reasoning, files created or changed with their paths, and ' +
        'unresolved questions. Never preserve transcripts, logs, or code blocks. ' +
        'Target under 8,000 tokens — every token kept here is re-sent on every later turn.',
    },
  })
);
