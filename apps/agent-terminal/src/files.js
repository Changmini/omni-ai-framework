'use strict';

// Reads a file for the in-app viewer: at most VIEW_MAX bytes (the start of a
// larger file), no binary content, UTF-8 text. Nothing is ever written.

const fs = require('node:fs');

const VIEW_MAX = 1024 * 1024;
const SNIFF = 8192; // a NUL byte in this much means binary

// Fills `buf` from `pos`: one read may return less than asked (network file
// systems such as \\wsl.localhost). Returns the bytes read (less at EOF).
async function readFully(fh, buf, pos) {
  let got = 0;
  while (got < buf.length) {
    const { bytesRead } = await fh.read(buf, got, buf.length - got, pos + got);
    if (!bytesRead) break;
    got += bytesRead;
  }
  return got;
}

async function readTextFile(file) {
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const st = await fh.stat();
    if (!st.isFile()) return { error: '파일이 아닙니다' };
    const buf = Buffer.alloc(Math.min(st.size, VIEW_MAX));
    const len = await readFully(fh, buf, 0);
    if (buf.subarray(0, Math.min(len, SNIFF)).includes(0)) return { size: st.size, binary: true };
    let text = buf.subarray(0, len).toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    // A multi-byte character cut at the limit decodes as U+FFFD: drop it.
    if (st.size > len) text = text.replace(/�$/, '');
    return { size: st.size, text, truncated: st.size > len };
  } catch (e) {
    return { error: e && e.code === 'ENOENT' ? '파일이 없습니다 (지워졌거나 옮겨졌습니다)' : '파일을 읽을 수 없습니다' };
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

module.exports = { readTextFile, readFully, VIEW_MAX };
