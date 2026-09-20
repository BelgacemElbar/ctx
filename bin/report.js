#!/usr/bin/env node
import { renderDashboard } from '../src/dashboard.js';
import { fmtUsd } from '../src/pricing.js';

const { stats: a } = renderDashboard();

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log(`\nctx — ${a.turns} turns\n`);
console.log(`  ${pad('actual spend', 22)}${num(fmtUsd(a.cost), 10)}`);
console.log(`  ${pad('all-uncached baseline', 22)}${num(fmtUsd(a.baseline), 10)}`);
console.log(`  ${pad('saved', 22)}${num(fmtUsd(a.saved), 10)}   ${(a.savedPct * 100).toFixed(0)}%`);
console.log(`  ${pad('cache hit rate', 22)}${num((a.hitRate * 100).toFixed(0) + '%', 10)}`);
console.log('');
console.log(`  ${pad('prefix invalidations', 22)}${num(a.invalidations, 10)}   ${fmtUsd(a.invalidationCost)} billed on those turns`);
console.log(`  ${pad('tool results offloaded', 22)}${num(a.offloaded, 10)}   ~${a.offloadedTokens.toLocaleString()} tokens withheld`);
console.log(`  ${pad('turns re-routed', 22)}${num(a.routed, 10)}`);
console.log('');
console.log(`  ${pad('cache read', 22)}${num(a.cacheRead.toLocaleString(), 10)}`);
console.log(`  ${pad('cache write', 22)}${num(a.cacheWrite.toLocaleString(), 10)}`);
console.log(`  ${pad('full-price input', 22)}${num(a.input.toLocaleString(), 10)}`);
console.log(`  ${pad('output', 22)}${num(a.output.toLocaleString(), 10)}`);
console.log('');
if (a.input > a.cacheRead && a.turns > 0) {
  console.log('  ! more tokens at full price than at cache price. something is editing');
  console.log('    the prefix mid-session: CLAUDE.md, memory, skills, or the tool set.');
}
