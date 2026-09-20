import { fmtUsd } from './pricing.js';

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
const n = (x) => Number(x).toLocaleString();
const pct = (x) => (x * 100).toFixed(0) + '%';

const metric = (label, value, sub, warn) => `<div style="background:var(--surface-2);border-radius:8px;padding:12px 14px">
  <div style="font-size:12px;color:var(--muted);margin-bottom:4px">${label}</div>
  <div style="font-size:22px;font-weight:500;${warn ? 'color:var(--red)' : ''}">${value}</div>
  <div style="font-size:12px;color:var(--muted);margin-top:2px">${sub || ''}</div>
</div>`;

const bar = (p, c) =>
  `<div style="height:8px;background:var(--surface-3);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.max(0, Math.min(100, p * 100)).toFixed(1)}%;background:${c}"></div></div>`;

export function renderAudit(total, sessions, source) {
  const maxCost = sessions[0]?.cost || 1;
  const rows = sessions
    .slice(0, 25)
    .map(
      (s) => `<tr>
      <td style="font-family:var(--mono);font-size:12px">${esc(s.project.replace(/^-Users-ssss/, '~'))}</td>
      <td>${s.turns}</td>
      <td>${fmtUsd(s.cost)}</td>
      <td>${pct(s.hitRate)}</td>
      <td>${(s.peak / 1000).toFixed(0)}k</td>
      <td style="${s.invalidations > 5 ? 'color:var(--red)' : ''}">${s.invalidations}</td>
      <td style="width:22%">${bar(s.cost / maxCost, 'var(--blue)')}</td>
    </tr>`
    )
    .join('');

  const billed = total.cacheRead + total.cacheWrite + total.plainInput;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>ctx audit</title>
<style>
  :root{--bg:#fff;--surface-2:#f5f5f4;--surface-3:#e8e8e5;--line:rgba(0,0,0,.09);--text:#1c1c1a;
    --muted:#6b6b66;--green:#0F6E56;--blue:#185FA5;--red:#A32D2D;--amber:#854F0B;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
    --mono:ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box}
  body{margin:0;padding:32px;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:13px;line-height:1.6}
  h1{font-size:15px;font-weight:500;margin:0}
  h2{font-size:14px;font-weight:500;margin:32px 0 12px}
  table{border-collapse:collapse;width:100%}
  th{text-align:left;font-weight:500;font-size:12px;color:var(--muted);padding:6px 10px 6px 0;border-bottom:1px solid var(--line)}
  td{padding:7px 10px 7px 0;border-bottom:1px solid var(--line);vertical-align:middle}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
  .muted{color:var(--muted)}
  .note{background:var(--surface-2);border-radius:8px;padding:14px 16px;margin-top:12px}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:baseline">
  <h1>ctx audit</h1>
  <span class="muted" style="font-size:12px">${n(total.sessions)} sessions &middot; ${n(total.turns)} turns</span>
</div>

<h2>Spend, modelled at API rates</h2>
<div class="grid">
  ${metric('Modelled spend', fmtUsd(total.cost), `${n(total.turns)} assistant turns`)}
  ${metric('All-uncached baseline', fmtUsd(total.baseline), 'same tokens, no caching')}
  ${metric('Saved by caching', fmtUsd(total.saved), pct(total.savedPct) + ' below baseline')}
  ${metric('Cache hit rate', pct(total.hitRate), bar(total.hitRate, 'var(--green)') + '<div style="height:6px"></div>cached reads / billed input')}
</div>

<h2>Where it leaks</h2>
<div class="grid">
  ${metric('Prefix rebuilds', n(total.invalidations), n(total.invalidationTokens) + ' tokens re-billed at full price', true)}
  ${metric('Rebuild cost', fmtUsd(total.rebuildCost), 'the avoidable part', true)}
  ${metric('Tool output', n(total.toolTokens) + ' tok', 'total tool result weight')}
  ${metric('Thinking tokens', n(total.thinking), 'billed at output rate')}
  ${metric('Peak context', (Math.max(...sessions.map((s) => s.peak)) / 1000).toFixed(0) + 'k', 'largest session window')}
  ${metric('Avg static prefix', n(total.avgPrefix), 'system + tools, before turn one')}
</div>

<div class="note">
  <strong>What a prefix rebuild is:</strong> a turn where the cached read drops sharply,
  meaning the system prompt, tool list or model changed and the whole prefix has to be
  re-sent at full input price instead of 0.1x. ${n(total.invalidations)} of them across
  ${n(total.sessions)} sessions. The usual causes are editing CLAUDE.md or memory
  mid-session, connecting or disconnecting MCP servers and plugins, switching model,
  and session compaction.
</div>

<h2>Tokens billed</h2>
<table>
  <tr><th>class</th><th>tokens</th><th style="width:45%">share</th></tr>
  <tr><td>Cache read (0.1x)</td><td style="font-family:var(--mono)">${n(total.cacheRead)}</td><td>${bar(total.cacheRead / billed, 'var(--green)')}</td></tr>
  <tr><td>Cache write (1h, 2x)</td><td style="font-family:var(--mono)">${n(total.cacheWrite)}</td><td>${bar(total.cacheWrite / billed, 'var(--amber)')}</td></tr>
  <tr><td>Full-price input (1x)</td><td style="font-family:var(--mono)">${n(total.plainInput)}</td><td>${bar(total.plainInput / billed, 'var(--red)')}</td></tr>
  <tr><td>Output (5x)</td><td style="font-family:var(--mono)">${n(total.output)}</td><td>${bar(total.output / (total.output + billed), 'var(--blue)')}</td></tr>
</table>

<h2>Most expensive sessions</h2>
<table>
  <tr><th>project</th><th>turns</th><th>spend</th><th>hit</th><th>peak</th><th>rebuilds</th><th></th></tr>
  ${rows}
</table>

<p class="muted" style="margin-top:24px;font-size:12px">
  Source: ${esc(source)}. Read from Claude Code's local transcripts — no proxy, no network.
  Figures are modelled at public API rates; on a Pro/Max subscription this is what the
  usage would be worth, not what you are invoiced.
</p>
</body></html>`;
}
