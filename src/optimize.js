import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { STORE_DIR } from './store.js';

// ---------------------------------------------------------------------------
// Session state. Kept in memory: the whole point is that decisions made on the
// first request of a session stay frozen for the rest of it, because changing
// the tool list or the system prompt invalidates the prefix cache.
// ---------------------------------------------------------------------------
const sessions = new Map();

function session(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { prefixHash: null, keptTools: null, firstUserText: '', turns: 0 });
  }
  return sessions.get(id);
}

export function sessionIds() {
  return [...sessions.keys()];
}

/**
 * Hash of everything that must stay byte-identical for the prompt cache to hit.
 * If this changes between turns, Anthropic re-bills the entire prefix at full
 * input price instead of 0.1x. That is the most expensive thing that can
 * happen to a session, so it gets measured explicitly.
 */
export function prefixHash(body) {
  const shape = {
    system: body.system ?? null,
    tools: (body.tools || []).map((t) => t.name),
    model: body.model,
  };
  return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
}

export function firstUserText(body) {
  for (const m of body.messages || []) {
    if (m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      for (const b of c) if (b.type === 'text' && b.text) return b.text;
    }
  }
  return '';
}

const STOP = new Set(
  'the and for with that this from into your have will can please read write file files make use want need look check'.split(
    ' '
  )
);

function keywords(text) {
  return [
    ...new Set(
      String(text)
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((w) => w.length > 3 && !STOP.has(w))
    ),
  ];
}

/**
 * Tool pruning. Every tool definition is re-sent on every turn, so a client
 * with 60 MCP tools pays for 60 schemas forever. We score tools against the
 * first user message of the session, keep the top N, and then FREEZE that set
 * so the prefix stays cacheable.
 */
export function pruneTools(body, sid, cfg) {
  const tools = body.tools || [];
  const total = tools.length;
  const s = session(sid);

  if (!cfg.tools.enabled || total <= cfg.tools.pruneAbove) {
    return { toolsTotal: total, toolsKept: total, pruned: 0, cacheBreak: false };
  }

  if (s.keptTools) {
    // Frozen set from the first turn. Reuse in canonical order.
    const keep = new Set(s.keptTools);
    body.tools = tools.filter((t) => keep.has(t.name));
    return {
      toolsTotal: total,
      toolsKept: body.tools.length,
      pruned: total - body.tools.length,
      cacheBreak: false,
    };
  }

  const text = firstUserText(body);
  const kws = keywords(text);
  const scored = tools.map((t, i) => {
    const hay = (t.name + ' ' + (t.description || '')).toLowerCase();
    let score = 0;
    for (const k of kws) {
      if (hay.includes(k)) score += t.name.toLowerCase().includes(k) ? 5 : 1;
    }
    return { t, i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const keep = scored.slice(0, cfg.tools.keepTop).sort((a, b) => a.i - b.i);
  s.keptTools = keep.map((x) => x.t.name);
  body.tools = keep.map((x) => x.t);
  return {
    toolsTotal: total,
    toolsKept: body.tools.length,
    pruned: total - body.tools.length,
    cacheBreak: true,
  };
}

/**
 * Tool-result offloading. A 500-line file read or a full build log enters the
 * context permanently and is re-billed on every subsequent turn. We swap the
 * body for a head + tail plus an absolute path on disk, which the agent can
 * re-read or grep with its normal file tools if it actually needs it.
 */
export function offloadToolResults(body, sid, cfg) {
  const out = { count: 0, savedChars: 0, files: [] };
  if (!cfg.offload.enabled) return out;

  const dir = path.join(STORE_DIR, sid.replace(/[^a-z0-9_-]/gi, '_'));
  const messages = body.messages || [];

  for (let i = 0; i < messages.length; i++) {
    const content = messages[i].content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const text = typeof block.content === 'string' ? block.content : extractText(block.content);
      if (!text || text.length < cfg.offload.minChars) continue;

      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const id = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
      const file = path.join(dir, `${id}.txt`);
      if (!fs.existsSync(file)) fs.writeFileSync(file, text);

      const head = text.slice(0, cfg.offload.keepChars);
      const tail = text.slice(-cfg.offload.keepTailChars);
      block.content =
        `${head}\n\n` +
        `[ctx] ${(text.length - cfg.offload.keepChars - cfg.offload.keepTailChars).toLocaleString()} chars offloaded to save context. Full output: ${file}\n` +
        `Re-read or grep only the part you need; do not read the whole file.\n\n` +
        `...\n${tail}`;

      out.count++;
      out.savedChars += text.length - cfg.offload.keepChars - cfg.offload.keepTailChars;
      out.files.push(file);
    }
  }
  return out;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && b.type === 'text' ? b.text : '')).join('\n');
  }
  return '';
}

/**
 * Model routing. Mechanical work does not need Opus. Rules are matched against
 * the latest user message; first match wins.
 */
export function routeModel(body, cfg) {
  if (!cfg.routing.enabled || !cfg.routing.rules?.length) return { model: body.model, routed: false };
  const text = lastUserText(body);
  for (const r of cfg.routing.rules) {
    try {
      if (new RegExp(r.match, 'i').test(text)) {
        return { model: r.model, routed: r.model !== body.model };
      }
    } catch {
      /* bad regex in config, skip */
    }
  }
  return { model: body.model, routed: false };
}

function lastUserText(body) {
  const msgs = (body.messages || []).filter((m) => m.role === 'user');
  const last = msgs[msgs.length - 1];
  if (!last) return '';
  return typeof last.content === 'string' ? last.content : extractText(last.content);
}

/**
 * Detect prefix changes: the 10x cost event. Compares this request's prefix
 * hash with the previous one in the same session.
 */
export function checkPrefix(body, sid) {
  const h = prefixHash(body);
  const s = session(sid);
  s.turns++;
  const prev = s.prefixHash;
  s.prefixHash = h;
  return { hash: h, invalidated: prev !== null && prev !== h, turns: s.turns };
}

export { session };
