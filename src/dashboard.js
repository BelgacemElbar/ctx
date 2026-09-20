import { readRecords, LOG_PATH } from './store.js';
import { fmtUsd } from './pricing.js';

function aggregate() {
  const recs = readRecords();
  const a = {
    turns: recs.length,
    cost: 0,
    baseline: 0,
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    invalidations: 0,
    invalidationCost: 0,
    offloaded: 0,
    offloadedChars: 0,
    routed: 0,
    sessions: {},
    models: {},
    last: null,
  };
  for (const r of recs) {
    a.cost += r.cost || 0;
    a.baseline += r.baseline || 0;
    a.input += r.input || 0;
    a.cacheWrite += r.cacheWrite || 0;
    a.cacheRead += r.cacheRead || 0;
    a.output += r.output || 0;
    a.offloaded += r.offloaded || 0;
    a.offloadedChars += r.offloadedChars || 0;
    if (r.invalidated) {
      a.invalidations++;
      a.invalidationCost += r.cost || 0;
    }
    if (r.routed) a.routed++;
    const s = (a.sessions[r.sid] ||= { turns: 0, cost: 0, baseline: 0, hit: 0, billed: 0, offloaded: 0, last: r.ts });
    s.turns++;
    s.cost += r.cost || 0;
    s.baseline += r.baseline || 0;
    s.hit += r.cacheRead || 0;
    s.billed += (r.input || 0) + (r.cacheWrite || 0) + (r.cacheRead || 0);
    s.offloaded += r.offloaded || 0;
    s.last = r.ts;
    const m = (a.models[r.model] ||= { turns: 0, cost: 0 });
    m.turns++;
    m.cost += r.cost || 0;
    a.last = r.ts;
  }
  a.billed = a.input + a.cacheWrite + a.cacheRead;
  a.hitRate = a.billed ? a.cacheRead / a.billed : 0;
  a.saved = a.baseline - a.cost;
  a.savedPct = a.baseline ? a.saved / a.baseline : 0;
  a.offloadedTokens = Math.round(a.offloadedChars / 4);
  return a;
}

const bar = (pct, color) =>
  `<div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.max(
    0,
    Math.min(100, pct * 100)
  ).toFixed(1)}%;background:${color}"></div></div>`;

function metric(label, value, sub) {
  return `<div style="background:var(--surface-2);border-radius:8px;padding:12px 14px">
    <div style="font-size:12px;color:var(--muted);margin-bottom:4px">${label}</div>
    <div style="font-size:22px;font-weight:500">${value}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:2px">${sub || ''}</div>
  </div>`;
}

export function renderDashboard() {
  const a = aggregate();
  const rows = Object.entries(a.sessions)
    .sort((x, y) => y[1].cost - x[1].cost)
    .map(
      ([sid, s]) => `<tr>
        <td style="font-family:var(--mono);font-size:12px">${sid}</td>
        <td>${s.turns}</td>
        <td>${fmtUsd(s.cost)}</td>
        <td>${fmtUsd(s.baseline)}</td>
        <td>${((s.billed ? s.hit / s.billed : 0) * 100).toFixed(0)}%</td>
        <td>${s.offloaded}</td>
        <td style="color:var(--muted);font-size:12px">${String(s.last).slice(11, 19)}</td>
      </tr>`
    )
    .join('');

  const models = Object.entries(a.models)
    .sort((x, y) => y[1].cost - x[1].cost)
    .map(([m, v]) => `<tr><td style="font-family:var(--mono);font-size:12px">${m}</td><td>${v.turns}</td><td>${fmtUsd(v.cost)}</td></tr>`)
    .join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>ctx</title>
<style>
  :root{--bg:#fff;--surface-2:#f5f5f4;--line:rgba(0,0,0,.09);--text:#1c1c1a;--muted:#6b6b66;
    --green:#0F6E56;--blue:#185FA5;--red:#A32D2D;--amber:#854F0B;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box}
  body{margin:0;padding:32px;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:13px;line-height:1.6}
  h1{font-size:15px;font-weight:500;margin:0}
  h2{font-size:14px;font-weight:500;margin:32px 0 12px}
  p{margin:0}
  table{border-collapse:collapse;width:100%}
  th{text-align:left;font-weight:500;font-size:12px;color:var(--muted);padding:6px 10px 6px 0;border-bottom:1px solid var(--line)}
  td{padding:7px 10px 7px 0;border-bottom:1px solid var(--line)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .muted{color:var(--muted)}
  .warn{color:var(--red)}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:baseline">
  <h1>ctx</h1>
  <span class="muted" style="font-size:12px">${a.turns} turns &middot; ${LOG_PATH}</span>
</div>

<h2>Spend</h2>
<div class="grid">
  ${metric('Actual spend', fmtUsd(a.cost), `${a.turns} API turns`)}
  ${metric('All-uncached baseline', fmtUsd(a.baseline), 'same tokens, zero cache hits')}
  ${metric('Saved', fmtUsd(a.saved), `${(a.savedPct * 100).toFixed(0)}% below baseline`)}
  ${metric('Cache hit rate', (a.hitRate * 100).toFixed(0) + '%', bar(a.hitRate, 'var(--green)') + '<div style="height:6px"></div>cached reads / billed input')}
</div>

<h2>Where the damage is</h2>
<div class="grid">
  ${metric('Prefix invalidations', a.invalidations, a.invalidations ? `<span class="warn">${fmtUsd(a.invalidationCost)} billed on those turns</span>` : 'none — prefix is stable')}
  ${metric('Tool results offloaded', a.offloaded, `~${a.offloadedTokens.toLocaleString()} tokens kept out of context`)}
  ${metric('Turns re-routed', a.routed, 'to a cheaper model')}
  ${metric('Output tokens', a.output.toLocaleString(), '5x input price per token')}
</div>

<h2>Tokens billed</h2>
<table>
  <tr><th>class</th><th>tokens</th><th style="width:45%">share</th></tr>
  <tr><td>Cache read (0.1x)</td><td style="font-family:var(--mono)">${a.cacheRead.toLocaleString()}</td><td>${bar(a.billed ? a.cacheRead / a.billed : 0, 'var(--green)')}</td></tr>
  <tr><td>Cache write (1.25x)</td><td style="font-family:var(--mono)">${a.cacheWrite.toLocaleString()}</td><td>${bar(a.billed ? a.cacheWrite / a.billed : 0, 'var(--amber)')}</td></tr>
  <tr><td>Full-price input (1x)</td><td style="font-family:var(--mono)">${a.input.toLocaleString()}</td><td>${bar(a.billed ? a.input / a.billed : 0, 'var(--red)')}</td></tr>
  <tr><td>Output (5x)</td><td style="font-family:var(--mono)">${a.output.toLocaleString()}</td><td>${bar(a.output ? a.output / (a.output + a.billed) : 0, 'var(--blue)')}</td></tr>
</table>
${a.input > a.cacheRead ? '<p class="warn" style="margin-top:10px">More tokens billed at full input price than at cache price. The prefix is changing between turns — check whether CLAUDE.md, memory files, skills or the connected tool set are being edited mid-session.</p>' : ''}

<h2>Sessions</h2>
<table>
  <tr><th>session</th><th>turns</th><th>spend</th><th>baseline</th><th>hit</th><th>offloaded</th><th>last</th></tr>
  ${rows || '<tr><td colspan="7" class="muted">no traffic yet</td></tr>'}
</table>

<h2>Models</h2>
<table>
  <tr><th>model</th><th>turns</th><th>spend</th></tr>
  ${models || '<tr><td colspan="3" class="muted">no traffic yet</td></tr>'}
</table>
</body></html>`;

  return { html, stats: a };
}
