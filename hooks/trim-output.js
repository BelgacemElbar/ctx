#!/usr/bin/env node
// PostToolUse. Two jobs:
//
//   1. Read  -> tell the model what it did NOT see, so a trimmed file is never
//               mistaken for a short one. Costs ~30 tokens, prevents a wrong
//               conclusion that would cost far more.
//   2. Bash  -> truncate enormous command output before it lands in context.
//               Head and tail are kept because errors live at the end.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_CHARS = Number(process.env.CTX_BASH_CHARS || 30_000);
const KEEP_HEAD = Number(process.env.CTX_BASH_HEAD || 4_000);
const KEEP_TAIL = Number(process.env.CTX_BASH_TAIL || 2_000);
const STATE = path.join(os.homedir(), '.ctx', 'trim-state.json');

function asText(r) {
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object') return r.stdout ?? r.output ?? JSON.stringify(r);
  return '';
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return;
  }
  if (p.hook_event_name && p.hook_event_name !== 'PostToolUse') return;

  if (p.tool_name === 'Read') {
    let s = {};
    try {
      s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    } catch {
      return;
    }
    const fp = p.tool_input?.file_path;
    const key = `${p.session_id || 'x'}|${fp}`;
    const lines = s[key];
    if (!lines) return;
    delete s[key];
    try {
      fs.writeFileSync(STATE, JSON.stringify(s));
    } catch {}
    const shown = p.tool_input?.limit || 120;
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext:
            `ctx: this file is ${lines.toLocaleString()} lines; you were shown ${shown}. ` +
            `The rest was withheld to protect the context budget. Use offset/limit or Grep if you need more.`,
        },
      })
    );
    return;
  }

  if (p.tool_name === 'Bash') {
    const text = asText(p.tool_response);
    if (text.length <= MAX_CHARS) return;
    const withheld = text.length - KEEP_HEAD - KEEP_TAIL;
    const trimmed =
      text.slice(0, KEEP_HEAD) +
      `\n\n…[ctx] ${withheld.toLocaleString()} chars withheld (~${Math.round(withheld / 4).toLocaleString()} tokens) to protect the context budget. Errors are usually at the end, which is kept. Ask again with | tail or a narrower command if you need the middle.…\n\n` +
      text.slice(-KEEP_TAIL);
    console.log(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: trimmed },
      })
    );
  }
});
