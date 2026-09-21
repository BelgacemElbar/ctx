#!/usr/bin/env node
// Loop breaker. Detects when Claude Code is stuck in a loop:
//   - reading the same file 5+ times in a session
//   - running the same command 3+ times
//   - hitting the same error pattern 3+ times
//
// When a loop is detected, it injects additionalContext telling the model
// to stop, think, and change approach. This prevents the classic
// "read file → fail → read same file → fail" death spiral that burns
// tens of thousands of tokens for nothing.
//
// State is a simple JSON file under ~/.ctx/loop-state.json, keyed by
// session ID. It auto-prunes entries older than 6 hours.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STATE = path.join(os.homedir(), '.ctx', 'loop-state.json');
const MAX_AGE = 6 * 3600 * 1000; // 6 hours
const FILE_READ_THRESHOLD = 5;
const CMD_REPEAT_THRESHOLD = 3;
const ERROR_REPEAT_THRESHOLD = 3;

function loadState() {
  try {
    const raw = fs.readFileSync(STATE, 'utf8');
    const obj = JSON.parse(raw);
    // Prune old sessions
    const now = Date.now();
    for (const k of Object.keys(obj)) {
      if (obj[k] && obj[k]._ts && now - obj[k]._ts > MAX_AGE) {
        delete obj[k];
      }
    }
    return obj;
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    state._ts = Date.now();
    fs.writeFileSync(STATE, JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

function getSlot(state, sid, name) {
  if (!state[sid]) state[sid] = { _ts: Date.now() };
  if (!state[sid][name]) state[sid][name] = [];
  return state[sid][name];
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
  const ev = p.hook_event_name || '';
  const sid = p.session_id || 'unknown';
  const state = loadState();

  // PreToolUse: track file reads and command repeats
  if (ev === 'PreToolUse') {
    const tool = p.tool_name || '';
    const input = p.tool_input || {};

    if (tool === 'Read') {
      const fp = input.file_path;
      if (!fp) return;
      const reads = getSlot(state, sid, 'reads');
      reads.push(fp);
      const count = reads.filter((f) => f === fp).length;

      if (count >= FILE_READ_THRESHOLD) {
        saveState(state);
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              additionalContext: `You have read ${fp} ${count} times this session. This is likely a loop — the file has not changed between reads. Stop re-reading it. Instead: (1) recall what you already know from previous reads, (2) if the content is wrong, fix the file instead of re-reading it, (3) if you need a specific line, use Grep instead. Do not read this file again unless you have modified it.`,
            },
          })
        );
        return;
      }
    }

    if (tool === 'Bash') {
      const cmd = (input.command || '').trim();
      if (!cmd) return;
      const cmds = getSlot(state, sid, 'cmds');
      cmds.push(cmd);
      const count = cmds.filter((c) => c === cmd).length;

      if (count >= CMD_REPEAT_THRESHOLD) {
        saveState(state);
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              additionalContext: `You have run the exact same command ${count} times: "${cmd.slice(0, 120)}". Re-running an identical command will produce the same result. Change your approach: (1) modify the command (add flags, change paths), (2) try a different tool, (3) explain what you expected vs what you got and reason about why.`,
            },
          })
        );
        return;
      }
    }

    saveState(state);
    return;
  }

  // PostToolUse: track repeated errors
  if (ev === 'PostToolUse') {
    const result = p.tool_result || p.tool_response || '';
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result || '');
    if (!/\b(error|Error|ERROR|failed|FAILED|Traceback|panic|ENOENT|EACCES|TypeError|ReferenceError)\b/.test(resultStr)) {
      saveState(state);
      return;
    }

    const errs = getSlot(state, sid, 'errors');
    // Normalize: take first 200 chars of the error message
    const normalized = resultStr.replace(/\s+/g, ' ').slice(0, 200);
    errs.push(normalized);
    const count = errs.filter((e) => e === normalized).length;

    if (count >= ERROR_REPEAT_THRESHOLD) {
      saveState(state);
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: `The same error has occurred ${count} times: "${normalized.slice(0, 150)}". You are in a failure loop. Stop retrying the same approach. (1) Read the error carefully and identify the root cause. (2) If it is a file-not-found, verify the path exists first. (3) If it is a type/syntax error, read the exact line mentioned. (4) If you cannot fix it, tell the user what is blocking you rather than retrying.`,
          },
        })
      );
      return;
    }

    saveState(state);
    return;
  }
});
