'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { PipelineContext, MAX_TEXT } = require('../src/pipeline-context');

test('pipeline context: once per Claude session and text', () => {
  const c = new PipelineContext();
  assert.strictEqual(c.forPrompt('1', 's1'), null); // nothing set for the terminal
  c.set({ 1: 'A', 2: '', 3: 7, [`${'x'.repeat(21)}`]: 'B' });
  assert.deepStrictEqual([...c.texts.keys()], ['1']); // empty, non-text and odd ids dropped
  assert.strictEqual(c.forPrompt('1', 's1'), 'A');
  assert.strictEqual(c.forPrompt('1', 's1'), null); // already told
  c.set({ 1: 'A' });
  assert.strictEqual(c.forPrompt('1', 's1'), null); // same text set again
  c.set({ 1: 'A2' });
  assert.strictEqual(c.forPrompt('1', 's1'), 'A2'); // changed: once more
  assert.strictEqual(c.forPrompt('1', 's2'), 'A2'); // a new Claude session never saw it
  c.set({});
  assert.strictEqual(c.forPrompt('1', 's2'), null); // notify off or unbound
  c.set({ 1: 'y'.repeat(MAX_TEXT + 10) });
  assert.strictEqual(c.forPrompt('1', 's3').length, MAX_TEXT);
  c.set(null);
  assert.strictEqual(c.texts.size, 0);
});
