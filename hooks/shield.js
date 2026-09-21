#!/usr/bin/env node
// Junk-file shield. Stops Claude Code from reading files that are
// guaranteed to waste context: lockfiles, minified bundles, binary data,
// sourcemaps, compressed archives, etc.
//
// It never denies the read — it caps it to 50 lines and tells the model
// what the file is and why it's useless. That way the model doesn't retry
// with a different approach; it just moves on.

import fs from 'node:fs';

// Files that should never be read in full. Matched by extension or name pattern.
const JUNK_PATTERNS = [
  // Lockfiles
  { pattern: /(^|\/)package-lock\.json$/, reason: 'npm lockfile — 50k+ lines of dependency hashes' },
  { pattern: /(^|\/)yarn\.lock$/, reason: 'yarn lockfile — dependency tree' },
  { pattern: /(^|\/)pnpm-lock\.yaml$/, reason: 'pnpm lockfile — dependency tree' },
  { pattern: /(^|\/)Cargo\.lock$/, reason: 'cargo lockfile — dependency hashes' },
  { pattern: /(^|\/)go\.(sum|mod)$/, reason: 'go module lockfile' },
  { pattern: /(^|\/)composer\.lock$/, reason: 'composer lockfile' },
  { pattern: /(^|\/)Gemfile\.lock$/, reason: 'bundler lockfile' },
  { pattern: /(^|\/)poetry\.lock$/, reason: 'poetry lockfile' },
  { pattern: /(^|\/)mix\.lock$/, reason: 'mix lockfile' },
  { pattern: /\.dsa$/i, reason: 'macOS directory store file' },
  // Minified / bundles
  { pattern: /\.min\.(js|mjs|css)$/, reason: 'minified bundle — not meant for human reading' },
  { pattern: /(^|\/)bundle\.js$/, reason: 'webpack bundle output' },
  { pattern: /(^|\/)vendor\.(js|css)$/, reason: 'vendor bundle — third-party code' },
  { pattern: /(^|\/)dist\/.*\.(js|css)$/, reason: 'build output — read the source instead' },
  { pattern: /(^|\/)build\/.*\.(js|css)$/, reason: 'build output — read the source instead' },
  { pattern: /\.chunk\.(js|css)$/, reason: 'webpack chunk — build output' },
  { pattern: /(^|\/)\.next\/.*\.(js|json)$/, reason: 'Next.js build cache — not source' },
  // Sourcemaps
  { pattern: /\.map$/, reason: 'sourcemap — binary mapping data' },
  // Binary / media
  { pattern: /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|tiff?)$/i, reason: 'image file — use a vision tool, not Read' },
  { pattern: /\.(mp[34]|wav|flac|ogg|webm|mov|avi|mkv)$/i, reason: 'media file — cannot be read as text' },
  { pattern: /\.(zip|tar|gz|tgz|bz2|xz|7z|rar|dmg|iso|deb|rpm|apk|aab|ipa)$/i, reason: 'archive — extract first, then read' },
  { pattern: /\.(pdf|docx?|pptx?|xlsx?|odt|epub)$/i, reason: 'binary document — use a dedicated parser' },
  { pattern: /\.(woff2?|ttf|otf|eot)$/i, reason: 'font file — binary' },
  { pattern: /\.(so|o|a|dylib|dll|exe|bin|wasm)$/i, reason: 'compiled binary — not readable as text' },
  { pattern: /\.(sqlite|db|duckdb|mdb)$/i, reason: 'database file — query it, do not read it' },
  { pattern: /\.(node|node_modules)$/i, reason: 'compiled native module' },
  // Generated / cache
  { pattern: /(^|\/)\.git\/objects\//, reason: 'git internal — object store' },
  { pattern: /(^|\/)__pycache__\//, reason: 'python bytecode cache' },
  { pattern: /\.(pyc|pyo)$/, reason: 'python bytecode — not readable' },
  { pattern: /(^|\/)\.venv\//, reason: 'virtual environment — not your code' },
  { pattern: /(^|\/)node_modules\//, reason: 'dependency — read the source in your project, not the installed copy' },
];

const CAP = 50; // show first 50 lines max for junk files

function checkBinary(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(512);
    const n = fs.readSync(fd, buf, 0, 512, 0);
    if (n <= 0) return false;
    // Null bytes in the first 512 bytes = binary
    for (let i = 0; i < n; i++) {
      if (buf[i] === 0) return true;
    }
    // High proportion of non-printable bytes also = binary
    let nonPrintable = 0;
    for (let i = 0; i < n; i++) {
      const b = buf[i];
      if (b < 0x09 || (b > 0x0d && b < 0x20)) nonPrintable++;
    }
    return nonPrintable / n > 0.30;
  } catch {
    return false;
  } finally {
    if (fd) fs.closeSync(fd);
  }
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return;
  }
  if (p.hook_event_name && p.hook_event_name !== 'PreToolUse') return;
  if (p.tool_name !== 'Read') return;

  const input = { ...(p.tool_input || {}) };
  const fp = input.file_path;
  if (!fp) return;
  if (input.limit && input.limit <= CAP) return; // already capped tight

  // Check name patterns
  for (const { pattern, reason } of JUNK_PATTERNS) {
    if (pattern.test(fp)) {
      const updated = { ...input, limit: CAP };
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            updatedInput: updated,
            additionalContext: `Blocked full read of ${fp}: ${reason}. Showing first ${CAP} lines only — do not attempt to read more of this file.`,
          },
        })
      );
      return;
    }
  }

  // Check if the file is binary (by content, not name)
  let st;
  try {
    st = fs.statSync(fp);
  } catch {
    return;
  }
  if (st.isDirectory()) return;
  if (st.size > 1024 * 1024 && checkBinary(fp)) {
    // >1MB binary file — cap it
    const updated = { ...input, limit: CAP };
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: updated,
          additionalContext: `This file appears to be binary (non-text). Showing first ${CAP} lines only — use a proper parser or tool for this file type.`,
        },
      })
    );
    return;
  }
});
