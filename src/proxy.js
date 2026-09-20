import http from 'node:http';
import { appendRecord, loadConfig, LOG_PATH } from './store.js';
import { priceFor, costOf } from './pricing.js';
import { pruneTools, offloadToolResults, routeModel, checkPrefix } from './optimize.js';
import { renderDashboard } from './dashboard.js';

const cfg = loadConfig();

const HOP = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'te',
  'upgrade',
  'proxy-authorization',
]);

function copyHeaders(src, dst) {
  for (const [k, v] of Object.entries(src)) {
    if (!HOP.has(k.toLowerCase())) dst[k] = v;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function forward(bodyBuf, req) {
  const headers = {};
  copyHeaders(req.headers, headers);
  headers['content-length'] = String(bodyBuf.length);
  const url = cfg.upstream.replace(/\/$/, '') + req.url;
  return fetch(url, { method: req.method, headers, body: bodyBuf });
}

function recordFromUsage(meta, usage, extra = {}) {
  const price = priceFor(meta.model);
  const cost = costOf(price, usage);
  const billed = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
  appendRecord({
    ts: new Date().toISOString(),
    sid: meta.sid,
    model: meta.model,
    requestedModel: meta.requestedModel,
    routed: meta.routed,
    priceKnown: price.exact,
    input: usage.input_tokens || 0,
    cacheWrite: usage.cache_creation_input_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    output: usage.output_tokens || 0,
    hitRate: billed ? (usage.cache_read_input_tokens || 0) / billed : 0,
    cost: cost.total,
    baseline: cost.baseline,
    invalidated: meta.invalidated,
    turn: meta.turns,
    toolsTotal: meta.toolsTotal,
    toolsKept: meta.toolsKept,
    offloaded: meta.offloaded.count,
    offloadedChars: meta.offloaded.savedChars,
    ...extra,
  });
}

async function handleMessages(req, res, raw) {
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'ctx: body was not JSON' }));
  }

  const sid = req.headers['x-ctx-session'] || 'default';
  const requestedModel = body.model;

  const prefix = checkPrefix(body, sid);
  const tools = pruneTools(body, sid, cfg);
  const offloaded = offloadToolResults(body, sid, cfg);
  const routed = routeModel(body, cfg);
  body.model = routed.model;

  const meta = {
    sid,
    model: body.model,
    requestedModel,
    routed: routed.routed,
    invalidated: prefix.invalidated || tools.cacheBreak,
    turns: prefix.turns,
    toolsTotal: tools.toolsTotal,
    toolsKept: tools.toolsKept,
    offloaded,
  };

  const out = Buffer.from(JSON.stringify(body), 'utf8');
  let upstream;
  try {
    upstream = await forward(out, req);
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'ctx: upstream unreachable', detail: String(err) }));
  }

  const resHeaders = {};
  copyHeaders(Object.fromEntries(upstream.headers), resHeaders);
  delete resHeaders['content-length'];
  delete resHeaders['content-encoding'];
  res.writeHead(upstream.status, resHeaders);

  if (!upstream.ok) {
    const text = await upstream.text();
    res.end(text);
    recordFromUsage(meta, {}, { status: upstream.status, error: text.slice(0, 200) });
    return;
  }

  if (body.stream && upstream.body) {
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const usage = {};
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const ev = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of ev.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const o = JSON.parse(line.slice(6));
              if (o.type === 'message_start' && o.message?.usage) Object.assign(usage, o.message.usage);
              if (o.type === 'message_delta' && o.usage) Object.assign(usage, o.usage);
            } catch {
              /* keepalive or non-json event */
            }
          }
        }
      }
    } catch (err) {
      // client hung up mid-stream; still record what we saw
      recordFromUsage(meta, usage, { status: 499, error: String(err).slice(0, 120) });
      try {
        res.end();
      } catch {}
      return;
    }
    res.end();
    recordFromUsage(meta, usage, { status: upstream.status });
  } else {
    const text = await upstream.text();
    res.end(text);
    let usage = {};
    try {
      usage = JSON.parse(text)?.usage || {};
    } catch {
      /* non-json response */
    }
    recordFromUsage(meta, usage, { status: upstream.status });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/stats.json')) {
    const body = renderDashboard();
    if (url.pathname === '/stats.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(body, null, 2));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(body.html);
  }

  if (req.method === 'POST' && url.pathname === '/reset') {
    const { reset } = await import('./store.js');
    reset();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }

  const raw = await readBody(req);

  if (url.pathname.startsWith('/v1/messages')) {
    return handleMessages(req, res, raw);
  }

  // Anything else: pass through untouched, no accounting.
  try {
    const upstream = await forward(raw, req);
    const headers = {};
    copyHeaders(Object.fromEntries(upstream.headers), headers);
    delete headers['content-length'];
    delete headers['content-encoding'];
    res.writeHead(upstream.status, headers);
    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'ctx: upstream unreachable', detail: String(err) }));
  }
});

server.listen(cfg.port, () => {
  console.log(`ctx listening on http://localhost:${cfg.port}`);
  console.log(`  upstream : ${cfg.upstream}`);
  console.log(`  log      : ${LOG_PATH}`);
  console.log(`  dashboard: http://localhost:${cfg.port}/`);
  console.log(`\nPoint your client at it:`);
  console.log(`  export ANTHROPIC_BASE_URL=http://localhost:${cfg.port}`);
});
