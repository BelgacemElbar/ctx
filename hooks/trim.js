#!/usr/bin/env node
// PreToolUse trimmer. Rewrites tool INPUT before it runs, so the bytes never
// enter context. This is the real intervention — not a report about it.
//
//   Read  -> injects a line limit on any file over 150 lines
//   Grep  -> injects head_limit on any search without one
//   Bash  -> rewrites bare `cat` to `head`, and `git log` to a bounded form
//
// Nothing is denied. The model still gets what it needs, just not 433k tokens
// of it, and hooks cost zero context tokens.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SOFT_LINES = Number(process.env.CTX_READ_LINES || 150);
const KEEP_LINES = Number(process.env.CTX_READ_KEEP || 120);
const GREP_LIMIT = Number(process.env.CTX_GREP_LIMIT || 30);
const TRIM_BASH = process.env.CTX_TRIM_BASH !== '0';
const STATE = path.join(os.homedir(), '.ctx', 'trim-state.json');

function countLines(file, cap) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(256 * 1024);
  let n = 0;
  try {
    for (;;) {
      const r = fs.readSync(fd, buf, 0, buf.length, null);
      if (r <= 0) break;
      for (let i = 0; i < r; i++) if (buf[i] === 0x0a) n++;
      if (n > cap) break;
    }
  } catch {
    /* unreadable: leave it alone */
  } finally {
    fs.closeSync(fd);
  }
  return n;
}

function note(file, lines, session) {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    let s = {};
    try {
      s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    } catch {}
    s[`${session}|${file}`] = lines;
    fs.writeFileSync(STATE, JSON.stringify(s));
  } catch {
    /* non-fatal */
  }
}

function emit(updatedInput) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput },
    })
  );
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
  const input = { ...(p.tool_input || {}) };

  if (p.tool_name === 'Read') {
    const fp = input.file_path;
    if (!fp || input.limit) return; // already bounded
    let st;
    try {
      st = fs.statSync(fp);
    } catch {
      return;
    }
    if (st.isDirectory()) return;
    const lines = countLines(fp, SOFT_LINES + 1);
    if (lines <= SOFT_LINES) return;
    note(fp, lines, p.session_id || 'x');
    emit({ ...input, limit: KEEP_LINES });
    return;
  }

  if (p.tool_name === 'Grep') {
    if (input.head_limit) return;
    emit({ ...input, head_limit: GREP_LIMIT });
    return;
  }

  if (p.tool_name === 'Bash' && TRIM_BASH) {
    const cmd = input.command || '';
    let out = cmd;
    // bare `cat file` -> `head -120 file`
    out = out.replace(/(^|&&|\||;)\s*cat\s+(\S+)\s*$/, `$1 head -${KEEP_LINES} $2`);
    // `git log` with no bound -> bounded
    if (/\bgit\s+log\b/.test(out) && !/-n\b|--max-count|-1\b/.test(out)) {
      out = out.replace(/\bgit\s+log\b/, 'git log -n 30');
    }
    if (out !== cmd) emit({ ...input, command: out.trim() });
  }
});
