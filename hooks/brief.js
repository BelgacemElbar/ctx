#!/usr/bin/env node
// SessionStart brief: one paragraph on what the last session cost.
// stdout from a SessionStart hook is added to context, so keep it short —
// a long warning would itself be part of the problem.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { priceFor, fmtUsd } from '../src/pricing.js';

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let p = {};
  try {
    p = JSON.parse(raw);
  } catch {
    /* SessionStart payload is optional */
  }

  const root = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(root)) return;

  let files = [];
  for (const proj of fs.readdirSync(root)) {
    const dir = path.join(root, proj);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.jsonl')) files.push(path.join(dir, f));
    }
  }
  files = files
    .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.m - a.m)
    .map((x) => x.f)
    .filter((f) => !p.session_id || !f.includes(p.session_id));

  const last = files[0];
  if (!last) return;

  const turns = fs
    .readFileSync(last, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((l) => l && l.type === 'assistant' && l.message?.usage)
    .map((l) => l.message);

  if (turns.length < 3) return;

  let cost = 0,
    rebuilds = 0,
    peak = 0,
    prevRead = null;
  for (const m of turns) {
    const u = m.usage;
    const pr = priceFor(m.model);
    const cc = u.cache_creation || {};
    const w1 = cc.ephemeral_1h_input_tokens || 0;
    const w5 = Math.max(0, (u.cache_creation_input_tokens || 0) - w1);
    cost +=
      ((u.input_tokens || 0) * pr.in +
        w1 * pr.w1 +
        w5 * pr.w5 +
        (u.cache_read_input_tokens || 0) * pr.read +
        (u.output_tokens || 0) * pr.out) /
      1e6;
    const read = u.cache_read_input_tokens || 0;
    if (prevRead !== null && read < prevRead * 0.8) rebuilds++;
    prevRead = read;
    peak = Math.max(peak, read + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0));
  }

  const bits = [`${turns.length} turns`, fmtUsd(cost), `peak ${(peak / 1000).toFixed(0)}k context`];
  if (rebuilds) bits.push(`${rebuilds} prefix rebuild${rebuilds === 1 ? '' : 's'}`);
  console.log(
    `ctx: last session was ${bits.join(', ')}.` +
      (rebuilds > 2
        ? ' Rebuilds mean the cache prefix changed mid-session — avoid editing CLAUDE.md or toggling plugins while working.'
        : '') +
      ' Run /ctx for the full audit.'
  );
});
