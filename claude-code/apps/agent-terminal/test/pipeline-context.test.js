'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { PipelineContext, MAX_TEXT, SKILL, NOT_BOUND } = require('../src/pipeline-context');

const prompt = (sid, text = 'hi') => ({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: text });

test('pipeline context: auto text once per Claude session and text', () => {
  const c = new PipelineContext();
  assert.strictEqual(c.reply('1', prompt('s1')), null); // nothing set
  c.set({ auto: { 1: 'A', 2: '', 3: 7, [`${'x'.repeat(21)}`]: 'B' } });
  assert.deepStrictEqual([...c.auto.keys()], ['1']); // empty, non-text and odd ids dropped
  assert.strictEqual(c.reply('1', prompt('s1')), 'A');
  assert.strictEqual(c.reply('1', prompt('s1')), null); // already told
  c.set({ auto: { 1: 'A' } });
  assert.strictEqual(c.reply('1', prompt('s1')), null); // same text set again
  c.set({ auto: { 1: 'A2' } });
  assert.strictEqual(c.reply('1', prompt('s1')), 'A2'); // changed: once more
  assert.strictEqual(c.reply('1', prompt('s2')), 'A2'); // a new Claude session never saw it
  c.compacted('1', 's1'); // another session's compaction: nothing to resend
  assert.strictEqual(c.reply('1', prompt('s2')), null);
  c.compacted('1', 's2'); // its own: the summary may have dropped it
  assert.strictEqual(c.reply('1', prompt('s2')), 'A2');
  c.set({});
  assert.strictEqual(c.reply('1', prompt('s2')), null); // notify off or unbound
  c.set({ auto: { 1: 'y'.repeat(MAX_TEXT + 10) } });
  assert.strictEqual(c.reply('1', prompt('s3')).length, MAX_TEXT);
  c.set(null);
  assert.strictEqual(c.auto.size + c.demand.size, 0);
});

test('pipeline context: the skill always answers, typed or used by Claude', () => {
  const c = new PipelineContext();
  c.set({ auto: { 1: 'A' }, demand: { 1: 'D', 2: 'D2' } });
  const typed = (sid, name = SKILL) => ({ hook_event_name: 'UserPromptExpansion', session_id: sid, command_name: name });
  const used = (sid, skill = SKILL) => ({ hook_event_name: 'PostToolUse', session_id: sid, tool_name: 'Skill', tool_input: { skill } });
  // Typed: the prompt itself adds nothing, the expansion the full text.
  assert.strictEqual(c.reply('1', prompt('s1', `/${SKILL} 다음 노드는?`)), null);
  assert.strictEqual(c.reply('1', typed('s1')), 'D');
  assert.strictEqual(c.reply('1', prompt('s1')), null); // Claude has the auto text now too
  assert.strictEqual(c.reply('2', used('s9')), 'D2'); // notify off there: still answered
  assert.strictEqual(c.reply('2', used('s9')), 'D2'); // every time it is asked
  assert.strictEqual(c.reply('3', typed('s3')), NOT_BOUND); // not bound to a node
  // Other commands, skills and tools add nothing.
  assert.strictEqual(c.reply('1', typed('s1', 'compact')), null);
  assert.strictEqual(c.reply('1', used('s1', 'other:pipeline')), null);
  assert.strictEqual(c.reply('1', { hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Bash', tool_input: {} }), null);
  assert.strictEqual(c.reply('1', { hook_event_name: 'Stop', session_id: 's1' }), null);
});
