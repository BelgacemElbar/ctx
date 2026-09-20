// Per-million-token prices, USD. Sourced from docs.anthropic.com pricing page.
// Order matters: first match wins, so more specific patterns come first.

const TABLE = [
  { re: /fable-5\.1|mythos-5\.1/, name: 'fable/mythos 5.1', in: 10, w5: 12.5, w1: 20, read: 0.25, out: 50 },
  { re: /fable-5|mythos-5/, name: 'fable/mythos 5', in: 10, w5: 12.5, w1: 20, read: 1, out: 50 },
  { re: /opus-4\.1|opus-4(?![.\d])/, name: 'opus 4.x legacy', in: 15, w5: 18.75, w1: 30, read: 1.5, out: 75 },
  { re: /opus/, name: 'opus 5 / 4.5+', in: 5, w5: 6.25, w1: 10, read: 0.5, out: 25 },
  { re: /sonnet-5/, name: 'sonnet 5', in: 2, w5: 2.5, w1: 4, read: 0.2, out: 10 },
  { re: /sonnet-4\.6|sonnet-4\.5|sonnet-4(?![.\d])/, name: 'sonnet 4.5/4.6', in: 3, w5: 3.75, w1: 6, read: 0.3, out: 15 },
  { re: /haiku-4\.5/, name: 'haiku 4.5', in: 1, w5: 1.25, w1: 2, read: 0.1, out: 5 },
  { re: /haiku-3\.5/, name: 'haiku 3.5', in: 0.8, w5: 1, w1: 1.6, read: 0.08, out: 4 },
];

const FALLBACK = { name: 'unknown (billed as sonnet 5)', in: 2, w5: 2.5, w1: 4, read: 0.2, out: 10 };

export function priceFor(model = '') {
  const m = String(model).toLowerCase();
  for (const row of TABLE) if (row.re.test(m)) return { ...row, exact: true };
  return { ...FALLBACK, exact: false };
}

// usage: { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens }
export function costOf(price, usage) {
  const input = usage.input_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  const M = 1_000_000;
  const parts = {
    input: (input * price.in) / M,
    cacheWrite: (cw * price.w5) / M,
    cacheRead: (cr * price.read) / M,
    output: (out * price.out) / M,
  };
  parts.total = parts.input + parts.cacheWrite + parts.cacheRead + parts.output;
  // Counterfactual: what this same request would have cost with zero cache hits
  // and no long-context discount. This is the number the daemon is trying to shrink.
  parts.baseline = ((input + cw + cr) * price.in + out * price.out) / M;
  return parts;
}

export function fmtUsd(n) {
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '$' + n.toFixed(4);
}
