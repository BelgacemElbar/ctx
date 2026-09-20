#!/usr/bin/env node
// Reads Claude Code's own local transcripts. No proxy, no interception.
// Works on a Pro/Max subscription, which ANTHROPIC_BASE_URL cannot reach.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { priceFor, fmtUsd } from '../src/pricing.js';
import { renderAudit } from '../src/audit-report.js';

// ctx audit [limit]        -> most recent N sessions
// ctx audit [dir] [limit]  -> sessions under a directory
const a2 = process.argv[2];
const ROOT = a2 && !/^\d+$/.test(a2) ? a2 : path.join(os.homedir(), '.claude', 'projects');
const LIMIT = Number((a2 && /^\d+$/.test(a2) ? a2 : process.argv[3]) || 0); // 0 = all

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function costOf(price, u) {
  const M = 1_000_000;
  const cc = u.cache_creation || {};
  const w1 = cc.ephemeral_1h_input_tokens || 0;
  const w5 = cc.ephemeral_5m_input_tokens || (u.cache_creation_input_tokens || 0) - w1;
  const read = u.cache_read_input_tokens || 0;
  const plain = u.input_tokens || 0;
  const out = u.output_tokens || 0;
  const parts = {
    input: (plain * price.in) / M,
    cacheWrite: (w1 * price.w1 + Math.max(0, w5) * price.w5) / M,
    cacheRead: (read * price.read) / M,
    output: (out * price.out) / M,
  };
  parts.total = parts.input + parts.cacheWrite + parts.cacheRead + parts.output;
  parts.baseline = ((plain + w1 + Math.max(0, w5) + read) * price.in + out * price.out) / M;
  return parts;
}

function analyse(file) {
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const turns = lines.filter((l) => l.type === 'assistant' && l.message?.usage).map((l) => ({
    usage: l.message.usage,
    model: l.message.model || 'unknown',
    text: JSON.stringify(l.message.content || ''),
  }));
  if (!turns.length) return null;

  let cost = 0,
    baseline = 0,
    cacheRead = 0,
    cacheWrite = 0,
    plainInput = 0,
    output = 0,
    thinking = 0,
    invalidations = 0,
    invalidationTokens = 0,
    peak = 0;

  const models = {};
  let prevRead = null;

  for (const t of turns) {
    const u = t.usage;
    const price = priceFor(t.model);
    const c = costOf(price, u);
    cost += c.total;
    baseline += c.baseline;
    const read = u.cache_read_input_tokens || 0;
    cacheRead += read;
    cacheWrite += u.cache_creation_input_tokens || 0;
    plainInput += u.input_tokens || 0;
    output += u.output_tokens || 0;
    thinking += u.output_tokens_details?.thinking_tokens || 0;
    const ctx = read + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
    peak = Math.max(peak, ctx);

    // A cache read that SHRINKS means the prefix was rebuilt: everything that
    // used to be cheap is now re-billed at full input price.
    if (prevRead !== null && read < prevRead * 0.8) {
      invalidations++;
      invalidationTokens += prevRead - read;
    }
    prevRead = read;
    models[t.model] = (models[t.model] || 0) + 1;
  }

  const toolChars = lines
    .filter((l) => l.type === 'user')
    .flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : []))
    .filter((b) => b && b.type === 'tool_result')
    .reduce((s, b) => s + (typeof b.content === 'string' ? b.content.length : JSON.stringify(b.content).length), 0);

  const staticPrefix = turns[0].usage.cache_creation_input_tokens || 0;

  return {
    file,
    name: path.basename(file, '.jsonl').slice(0, 8),
    project: path.basename(path.dirname(file)),
    turns: turns.length,
    model: Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown',
    cost,
    baseline,
    saved: baseline - cost,
    savedPct: baseline ? (baseline - cost) / baseline : 0,
    cacheRead,
    cacheWrite,
    plainInput,
    output,
    thinking,
    hitRate: cacheRead + cacheWrite + plainInput ? cacheRead / (cacheRead + cacheWrite + plainInput) : 0,
    invalidations,
    invalidationTokens,
    peak,
    staticPrefix,
    toolChars,
    toolTokens: Math.round(toolChars / 4),
    mtime: fs.statSync(file).mtimeMs,
  };
}

const files = walk(ROOT)
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  .slice(0, LIMIT || Infinity);

const sessions = files.map(analyse).filter(Boolean).sort((a, b) => b.cost - a.cost);

const sum = (k) => sessions.reduce((s, x) => s + x[k], 0);
const total = {
  sessions: sessions.length,
  turns: sum('turns'),
  cost: sum('cost'),
  baseline: sum('baseline'),
  cacheRead: sum('cacheRead'),
  cacheWrite: sum('cacheWrite'),
  plainInput: sum('plainInput'),
  output: sum('output'),
  thinking: sum('thinking'),
  invalidations: sum('invalidations'),
  invalidationTokens: sum('invalidationTokens'),
  toolTokens: sum('toolTokens'),
};
total.saved = total.baseline - total.cost;
total.savedPct = total.baseline ? total.saved / total.baseline : 0;
total.hitRate = total.cacheRead / (total.cacheRead + total.cacheWrite + total.plainInput || 1);
// Rebuilds are billed at full input price. Opus 5 is the common case here.
total.rebuildCost = (total.invalidationTokens * priceFor('claude-opus-5').in) / 1_000_000;
total.avgPrefix = Math.round(sessions.reduce((s, x) => s + x.staticPrefix, 0) / (sessions.length || 1));

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log(`\nctx audit — ${total.sessions} Claude Code sessions, ${total.turns.toLocaleString()} turns`);
console.log(`source: ${ROOT}\n`);
console.log(`  ${pad('modelled spend', 24)}${num(fmtUsd(total.cost), 12)}`);
console.log(`  ${pad('all-uncached baseline', 24)}${num(fmtUsd(total.baseline), 12)}`);
console.log(`  ${pad('cache saved', 24)}${num(fmtUsd(total.saved), 12)}   ${(total.savedPct * 100).toFixed(0)}%`);
console.log(`  ${pad('cache hit rate', 24)}${num((total.hitRate * 100).toFixed(0) + '%', 12)}`);
console.log('');
console.log(`  ${pad('prefix rebuilds', 24)}${num(total.invalidations.toLocaleString(), 12)}   ${(total.invalidationTokens / 1e6).toFixed(1)}M tokens re-billed at full price`);
console.log(`  ${pad('  -> cost of those', 24)}${num(fmtUsd(total.rebuildCost), 12)}   the avoidable part`);
console.log(`  ${pad('avg static prefix', 24)}${num(total.avgPrefix.toLocaleString(), 12)}   system + tool tokens before your first word`);
console.log(`  ${pad('tool result weight', 24)}${num(total.toolTokens.toLocaleString(), 12)}   tokens of tool output across all sessions`);
console.log(`  ${pad('thinking tokens', 24)}${num(total.thinking.toLocaleString(), 12)}   billed at the output rate`);
console.log('');
console.log('  most expensive sessions');
for (const s of sessions.slice(0, 8)) {
  console.log(
    `    ${fmtUsd(s.cost).padStart(9)}  ${String(s.turns).padStart(4)} turns  hit ${String(
      (s.hitRate * 100).toFixed(0) + '%'
    ).padStart(4)}  peak ${(s.peak / 1000).toFixed(0).padStart(4)}k  rebuilds ${String(s.invalidations).padStart(3)}  ${s.project.slice(0, 42)}`
  );
}
console.log('');

const html = renderAudit(total, sessions, ROOT);
const out = process.env.CTX_AUDIT_OUT || path.join(os.homedir(), '.ctx', 'audit.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`  html report: ${out}\n`);
