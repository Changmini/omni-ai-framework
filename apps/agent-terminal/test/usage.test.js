'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { usageFromTail, readContextUsage, contextWindow } = require('../src/usage');
const { SessionManager } = require('../src/sessions');

const line = (o) => JSON.stringify(o);
const assistant = (usage, extra = {}) => line({ type: 'assistant', isSidechain: false, message: { model: 'claude-opus-5-5', usage }, ...extra });

test('usage comes from the last main-chain assistant line', () => {
  const tail = [
    'ial line cut by the tail read"}',
    assistant({ input_tokens: 5, cache_read_input_tokens: 1000 }),
    assistant({ input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 120000, output_tokens: 500 }),
    assistant({ input_tokens: 1, cache_read_input_tokens: 999999 }, { isSidechain: true }), // a subagent: ignored
    line({ type: 'user', message: { content: 'hi' } }),
  ].join('\n');
  assert.deepStrictEqual(usageFromTail(tail), { tokens: 122510, window: 200000, pct: 61, model: 'claude-opus-5-5' });
  assert.strictEqual(usageFromTail('no usage here\n'), null);
});

test('past 200k tokens the window is taken as 1M', () => {
  assert.strictEqual(contextWindow(150000), 200000);
  assert.strictEqual(contextWindow(877000), 1000000);
  assert.strictEqual(usageFromTail(assistant({ cache_read_input_tokens: 877000 })).pct, 88);
});

test('readContextUsage reads only the tail of a large transcript', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-usage-')), 't.jsonl');
  const filler = line({ type: 'user', message: { content: 'x'.repeat(1000) } });
  fs.writeFileSync(f, `${Array(2000).fill(filler).join('\n')}\n${assistant({ input_tokens: 40000 })}\n`);
  assert.strictEqual((await readContextUsage(f)).tokens, 40000);
  assert.strictEqual(await readContextUsage('/nonexistent/t.jsonl'), null);
});

test('sessions read usage asynchronously, at most every 3s, always at Stop', async () => {
  let t = 0;
  const reads = [];
  const fake = () => ({ onData() {}, onExit() {}, write() {}, kill() {} });
  const events = [];
  const m = new SessionManager({
    spawn: fake, emit: (c, p) => events.push([c, p]), shell: { file: 'sh', args: [] }, pollMs: 0, now: () => t,
    readUsage: async (file) => { reads.push(file); return { tokens: 50000, window: 200000, pct: 25, model: 'm' }; },
  });
  const { id } = m.create({});
  const ev = (name, extra = {}) => m.onHookEvent(id, { hook_event_name: name, session_id: 'A', transcript_path: '/t/A.jsonl', ...extra });
  ev('UserPromptSubmit'); ev('PreToolUse'); t = 1000; ev('PostToolUse');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(reads.length, 1, 'throttled');
  t = 1500; ev('Stop');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(reads.length, 2, 'Stop always reads');
  const view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.deepStrictEqual(view.context, { tokens: 50000, window: 200000, pct: 25, model: 'm' });
});

test('after /compact the boundary line gives the usage, and a 1M session keeps its window', () => {
  const boundary = line({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'manual', preTokens: 902792, postTokens: 16851 } });
  const before = assistant({ cache_read_input_tokens: 900000 });
  assert.deepStrictEqual(usageFromTail(`${before}\n${boundary}\n`), { tokens: 16851, window: 1000000, pct: 2, model: null });
  // The next answer is newer than the boundary again.
  assert.strictEqual(usageFromTail(`${boundary}\n${assistant({ input_tokens: 30000 })}\n`).tokens, 30000);
  assert.strictEqual(usageFromTail(`${before}\n${line({ type: 'system', subtype: 'compact_boundary' })}\n`), null);
});

test('readContextUsage widens the tail when the last answer is further back', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-usage-')), 't.jsonl');
  // A 200 KB tool result after the answer: beyond the first 64 KB read.
  fs.writeFileSync(f, `${assistant({ input_tokens: 70000 })}\n${line({ type: 'user', message: { content: 'y'.repeat(200000) } })}\n`);
  assert.strictEqual((await readContextUsage(f)).tokens, 70000);
});

test('a Stop during a running read reads once more; a 1M window is kept', async () => {
  const reads = [];
  let release;
  const answers = [
    { tokens: 600000, window: 1000000, pct: 60, model: 'm' },
    { tokens: 20000, window: 200000, pct: 10, model: 'm' },
  ];
  const fake = () => ({ onData() {}, onExit() {}, write() {}, kill() {} });
  const events = [];
  const m = new SessionManager({
    spawn: fake, emit: (c, p) => events.push([c, p]), shell: { file: 'sh', args: [] }, pollMs: 0, now: () => 0,
    readUsage: (file) => { reads.push(file); const a = answers[reads.length - 1]; return reads.length === 1 ? new Promise((r) => { release = () => r(a); }) : Promise.resolve(a); },
  });
  const { id } = m.create({});
  const ev = (name) => m.onHookEvent(id, { hook_event_name: name, session_id: 'A', transcript_path: '/t/A.jsonl' });
  ev('UserPromptSubmit');
  await new Promise((r) => setImmediate(r));
  ev('Stop'); // first read still running
  assert.strictEqual(reads.length, 1);
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(reads.length, 2, 'the Stop read runs after the pending one');
  const view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.deepStrictEqual(view.context, { tokens: 20000, window: 1000000, pct: 2, model: 'm' });
});
