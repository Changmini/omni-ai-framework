'use strict';

// Context usage of a Claude Code session, from the end of its transcript
// (JSONL; `transcript_path` in every hook event). The last main-chain
// assistant message carries `message.usage` and `message.model`, as written
// by Claude Code 2.1.318; the format is not documented, so every field is
// optional. The context window size is not in the transcript: it is assumed
// to be 200k tokens, or 1M once usage goes past 200k. After /compact (or an
// automatic compaction) the newest entry is a "compact_boundary" system line
// whose compactMetadata gives the tokens left (postTokens) and before
// (preTokens); until the next answer that is the usage.

const fs = require('node:fs');
const { readFully } = require('./files');

const TAIL_FIRST = 64 * 1024; // usually holds the last answer
const TAIL_BYTES = 512 * 1024; // a long tool result can push it further back
const SMALL_WINDOW = 200000;
const LARGE_WINDOW = 1000000;

function contextWindow(tokens) {
  return tokens > SMALL_WINDOW ? LARGE_WINDOW : SMALL_WINDOW;
}

const result = (tokens, window, model) => ({
  tokens, window, pct: Math.min(100, Math.round((tokens / window) * 100)), model: model || null,
});

// Pure: the usage of the last assistant line in `text` (JSONL tail).
function usageFromTail(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const boundary = line.includes('"compact_boundary"');
    if (!boundary && (!line.includes('"usage"') || !line.includes('"assistant"'))) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; } // a cut first line
    if (d.isSidechain) continue;
    if (boundary && d.subtype === 'compact_boundary') {
      const m = d.compactMetadata || {};
      if (!Number.isFinite(m.postTokens)) return null; // compacted, size unknown
      // The window is judged from the size before compacting.
      return result(m.postTokens, contextWindow(Math.max(m.postTokens, Number(m.preTokens) || 0)), null);
    }
    if (d.type !== 'assistant') continue;
    const u = d.message && d.message.usage;
    if (!u) continue;
    const n = (k) => (Number.isFinite(u[k]) ? u[k] : 0);
    const tokens = n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens') + n('output_tokens');
    if (!tokens) continue;
    return result(tokens, contextWindow(tokens), d.message && d.message.model);
  }
  return null;
}

// Reads the last TAIL_FIRST bytes, and the last TAIL_BYTES only when that
// held no answer, asynchronously (on Windows the file is often on
// \\wsl.localhost). Resolves null when unknown.
async function readContextUsage(file) {
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const { size } = await fh.stat();
    const tail = async (bytes) => {
      const len = Math.min(size, bytes);
      const buf = Buffer.alloc(len);
      const got = await readFully(fh, buf, size - len);
      return usageFromTail(buf.subarray(0, got).toString('utf8'));
    };
    const first = await tail(TAIL_FIRST);
    return first || size <= TAIL_FIRST ? first : await tail(TAIL_BYTES);
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

module.exports = { readContextUsage, usageFromTail, contextWindow, SMALL_WINDOW, LARGE_WINDOW };
