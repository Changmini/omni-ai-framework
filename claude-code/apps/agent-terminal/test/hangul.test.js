'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { HangulComposer } = require('../src/renderer/hangul');

const type = (s) => HangulComposer.type([...s]);

test('basic syllables and words', () => {
  assert.strictEqual(type('dkssudgktpdy'), '안녕하세요');
  assert.strictEqual(type('gksrmf'), '한글');
  assert.strictEqual(type('zmffhemzhem'), '클로드코드');
});

test('final consonant moves to the next syllable', () => {
  assert.strictEqual(type('rkrk'), '가가');
  assert.strictEqual(type('ekfrdmf'), '닭을');
  assert.strictEqual(type('dlqtk'), '입사');
  assert.strictEqual(type('djqtdj'), '없어');
});

test('compound vowels, compound finals, shifted keys', () => {
  assert.strictEqual(type('dhkdhkd'), '와왕');
  assert.strictEqual(type('dnjsdml'), '원의');
  assert.strictEqual(type('dksgdk'), '않아');
  assert.strictEqual(type('Tkdrjtm'), '쌍거스');
  assert.strictEqual(type('dPRkt'), '예깟');
  assert.strictEqual(type('OdOr'), 'ㅒ얙');
});

test('lone jamo, spaces and other keys pass through', () => {
  assert.strictEqual(type('rrr'), 'ㄱㄱㄱ');
  assert.strictEqual(type('k'), 'ㅏ');
  assert.strictEqual(type('gks rmf!'), '한 글!');
  assert.strictEqual(type('1gks2'), '1한2');
});

test('backspace removes one jamo while composing, then whole characters', () => {
  assert.strictEqual(type('gks\b'), '하');
  assert.strictEqual(type('gks\b\b'), 'ㅎ');
  assert.strictEqual(type('gks\b\b\b'), '');
  assert.strictEqual(type('dhk\b'), '오');
  assert.strictEqual(type('ekfr\b'), '달');
  assert.strictEqual(type('gks \b'), '한');
});

test('feed reports commit and preedit separately', () => {
  const h = new HangulComposer();
  assert.deepStrictEqual(h.feed('g'), { commit: '', preedit: 'ㅎ', handled: true });
  h.feed('k'); h.feed('s');
  assert.strictEqual(h.preedit, '한');
  assert.deepStrictEqual(h.feed('r'), { commit: '한', preedit: 'ㄱ', handled: true });
  assert.deepStrictEqual(h.feed('1'), { commit: '', preedit: 'ㄱ', handled: false });
  assert.strictEqual(h.flush(), 'ㄱ');
  assert.strictEqual(h.composing, false);
});
