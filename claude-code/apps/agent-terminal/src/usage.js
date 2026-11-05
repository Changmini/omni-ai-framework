'use strict';

// Context usage of a Claude Code session, from the end of its transcript
// (JSONL; `transcript_path` in every hook event). The last main-chain
// assistant message carries `message.usage` and `message.model`, as written
// by Claude Code 2.1.318; the format is not documented, so every field is
// optional. The context window size is not in the transcript: it is assumed
// to be 200k tokens, or 1M once usage goes past 200k.

const fs = require('node:fs');

const TAIL_BYTES = 512 * 1024;
const SMALL_WINDOW = 200000;
const LARGE_WINDOW = 1000000;

function contextWindow(tokens) {
  return tokens > SMALL_WINDOW ? LARGE_WINDOW : SMALL_WINDOW;
}

// Pure: the usage of the last assistant line in `text` (JSONL tail).
function usageFromTail(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; } // a cut first line
    if (d.type !== 'assistant' || d.isSidechain) continue;
    const u = d.message && d.message.usage;
    if (!u) continue;
    const n = (k) => (Number.isFinite(u[k]) ? u[k] : 0);
    const tokens = n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens') + n('output_tokens');
    if (!tokens) continue;
    const window = contextWindow(tokens);
    return { tokens, window, pct: Math.min(100, Math.round((tokens / window) * 100)), model: (d.message && d.message.model) || null };
  }
  return null;
}

// Reads only the last TAIL_BYTES, asynchronously. Resolves null when unknown.
async function readContextUsage(file) {
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const { size } = await fh.stat();
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    return usageFromTail(buf.toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

module.exports = { readContextUsage, usageFromTail, contextWindow, SMALL_WINDOW, LARGE_WINDOW };
