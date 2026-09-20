#!/usr/bin/env node
// PreToolUse guard: stop whole-file reads that blow the context budget.
//
// This is the only intervention available on a Pro/Max subscription, because
// subscription traffic cannot be proxied. It works by refusing the Read before
// it happens, so the bytes never enter the context at all.
//
// Escape hatch: after two refusals for the same file in the same session we get
// out of the way, so a determined model can always read the file.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_LINES = Number(process.env.CTX_MAX_LINES || 800);
const MAX_BYTES = Number(process.env.CTX_MAX_BYTES || 60_000);
const STATE = path.join(os.homedir(), '.ctx', 'guard-state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(s));
  } catch {
    /* non-fatal */
  }
}

// Count newlines without reading the whole file. Stops early once we are past
// the limit, so a 50MB file costs us one 256KB read.
function countLines(file, cap) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(256 * 1024);
  let count = 0;
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      for (let i = 0; i < n; i++) if (buf[i] === 0x0a) count++;
      if (count > cap) break;
    }
  } catch {
    /* unreadable, let it through */
  } finally {
    fs.closeSync(fd);
  }
  return count;
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
  if (p.hook_event_name && p.hook_event_name !== 'PreToolUse') return;
  if (p.tool_name !== 'Read') return;

  const fp = p.tool_input?.file_path;
  if (!fp || !fs.existsSync(fp)) return;
  let st;
  try {
    st = fs.statSync(fp);
  } catch {
    return;
  }
  if (st.isDirectory()) return;

  const lines = countLines(fp, MAX_LINES + 1);
  if (lines <= MAX_LINES && st.size <= MAX_BYTES) return;

  const key = `${p.session_id || 'x'}|${fp}`;
  const state = loadState();
  state[key] = (state[key] || 0) + 1;
  saveState(state);
  if (state[key] > 2) return; // asked twice already; allow it

  const tokens = Math.round(st.size / 4);
  const reason =
    `ctx: ${path.basename(fp)} is ${lines.toLocaleString()} lines (~${tokens.toLocaleString()} tokens). ` +
    `Reading it whole adds that to this turn and to every turn after it. ` +
    `Use offset/limit to read a slice, or Grep for what you actually need. ` +
    `Run /ctx to see your token spend.`;

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
});
