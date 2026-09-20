import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HOME = process.env.CTX_HOME || path.join(os.homedir(), '.ctx');
export const LOG_PATH = path.join(HOME, 'log.jsonl');
export const CONFIG_PATH = path.join(HOME, 'config.json');
export const STORE_DIR = path.join(HOME, 'store');

export const DEFAULTS = {
  port: 8787,
  upstream: 'https://api.anthropic.com',
  offload: {
    enabled: true,
    minChars: 4000, // only offload tool results longer than this
    keepChars: 1200, // how much of the head to leave in context
    keepTailChars: 400, // tail matters for errors/logs, keep a slice of it
  },
  tools: {
    enabled: true,
    pruneAbove: 10, // only prune when the client sends more tools than this
    keepTop: 8,
  },
  routing: {
    enabled: false,
    rules: [], // [{ match: 'regex', model: 'claude-haiku-4-5' }]
  },
};

export function ensureHome() {
  fs.mkdirSync(HOME, { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n');
  }
}

export function loadConfig() {
  ensureHome();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      ...DEFAULTS,
      ...raw,
      offload: { ...DEFAULTS.offload, ...(raw.offload || {}) },
      tools: { ...DEFAULTS.tools, ...(raw.tools || {}) },
      routing: { ...DEFAULTS.routing, ...(raw.routing || {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

export function appendRecord(rec) {
  fs.appendFileSync(LOG_PATH, JSON.stringify(rec) + '\n');
}

export function readRecords() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs
    .readFileSync(LOG_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function reset() {
  if (fs.existsSync(LOG_PATH)) fs.rmSync(LOG_PATH);
}
