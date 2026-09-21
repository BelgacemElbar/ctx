#!/usr/bin/env node
// Compaction survival. Claude Code throws away your session when the context
// fills up, and the model comes out of it not knowing what it was doing. This
// writes a structured handoff before compaction and hands it straight back
// after, so the goal, the changed files and the last error all survive.
//
// Also re-injects the handoff on session start, which gives you continuity
// across /clear and across days.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const FILE = path.join(os.homedir(), '.ctx', 'handoff.md');
const TAIL_BYTES = 512 * 1024;

function readTail(file, bytes) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  const text = buf.toString('utf8');
  const nl = text.indexOf('\n');
  return (start > 0 ? text.slice(nl + 1) : text).split('\n').filter(Boolean);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && b.type === 'text' ? b.text : '')).join('\n');
}

function build(transcriptPath) {
  const lines = readTail(transcriptPath, TAIL_BYTES)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const goals = [];
  const files = new Set();
  const errors = [];
  let lastPlan = '';

  for (const l of lines) {
    const m = l.message;
    if (!m) continue;
    if (l.type === 'user') {
      const t = textOf(m.content).trim();
      if (t && !t.startsWith('[') && !t.includes('<system-reminder>')) goals.push(t);
    }
    if (l.type === 'assistant') {
      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) {
        if (!b || !b.name) continue;
        if (b.name === 'Write' || b.name === 'Edit' || b.name === 'NotebookEdit') {
          if (b.input?.file_path) files.add(b.input.file_path);
        }
      }
      const t = textOf(m.content).trim();
      if (t) lastPlan = t;
    }
    if (l.type === 'user') {
      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) {
        if (b?.type !== 'tool_result') continue;
        const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
        if (/\b(error|Error|ERROR|failed|FAILED|Traceback|panic)\b/.test(t)) {
          errors.push(t.replace(/\s+/g, ' ').slice(0, 220));
        }
      }
    }
  }

  const goal = goals.slice(-2).join(' | ').slice(0, 400) || '(none captured)';
  const fileList = [...files].slice(-18);
  const err = errors.slice(-2);

  let out = `# Session handoff\n\n## Goal\n${goal}\n`;
  if (fileList.length) out += `\n## Files changed\n${fileList.map((f) => `- ${f}`).join('\n')}\n`;
  if (err.length) out += `\n## Last errors\n${err.map((e) => `- ${e}`).join('\n')}\n`;
  if (lastPlan) {
    out += `\n## Where it left off\n${lastPlan.replace(/\s+/g, ' ').slice(-500)}\n`;
  }
  out += `\nResume from the goal above. Do not re-explore the codebase; the files are listed.`;
  return out;
}

function inject(ev) {
  if (!fs.existsSync(FILE)) return;
  const age = Date.now() - fs.statSync(FILE).mtimeMs;
  if (age > 36 * 3600 * 1000) return; // stale
  const body = fs.readFileSync(FILE, 'utf8').slice(0, 1800);
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: ev || 'PostCompact', additionalContext: body },
    })
  );
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let p = {};
  try {
    p = JSON.parse(raw);
  } catch {}
  const ev = p.hook_event_name || '';

  if (ev === 'PreCompact') {
    const tp = p.transcript_path;
    if (!tp || !fs.existsSync(tp)) return;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, build(tp));
    } catch {
      /* never block compaction */
    }
    return;
  }

  if (ev === 'PostCompact' || ev === 'SessionStart') {
    try {
      inject(ev);
    } catch {
      /* non-fatal */
    }
  }
});
