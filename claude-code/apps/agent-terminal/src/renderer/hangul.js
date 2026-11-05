'use strict';

// Built-in Korean input (2-beolsik / dubeolsik layout) for systems where no
// input method reaches the app, e.g. Electron inside WSLg. Pure logic: keys
// in, committed text and the syllable being composed out. Loaded as a plain
// script in the page (window.HangulComposer) and as a module in tests.
(function (root) {
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  const JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'; // index 0 = none

  // QWERTY key -> jamo. Shift only changes ㅂㅈㄷㄱㅅㅐㅔ; other capitals act
  // like their lower-case key.
  const KEYS = {
    q: 'ㅂ', w: 'ㅈ', e: 'ㄷ', r: 'ㄱ', t: 'ㅅ', y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', p: 'ㅔ',
    a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ', h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
    z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ', b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
    Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ', O: 'ㅒ', P: 'ㅖ',
  };
  const VOWEL_PAIRS = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
  const FINAL_PAIRS = {
    'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ',
    'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ',
  };
  const SPLIT_FINAL = Object.fromEntries(Object.entries(FINAL_PAIRS).map(([pair, f]) => [f, [pair[0], pair[1]]]));

  const isVowel = (j) => JUNG.includes(j);

  function jamoFor(key) {
    if (KEYS[key]) return KEYS[key];
    if (key.length === 1 && /[A-Z]/.test(key)) return KEYS[key.toLowerCase()] || null;
    return null;
  }

  // A syllable block { cho, jung, jong } (jamo strings or '') as text.
  function render({ cho, jung, jong }) {
    if (cho && jung) {
      return String.fromCharCode(0xac00 + (CHO.indexOf(cho) * 21 + JUNG.indexOf(jung)) * 28 + (jong ? JONG.indexOf(jong) : 0));
    }
    return (cho || '') + (jung || '') + (jong || '');
  }

  class HangulComposer {
    constructor() { this.reset(); }

    reset() {
      this.block = { cho: '', jung: '', jong: '' };
      this.history = []; // previous blocks, for backspace one jamo at a time
    }

    get composing() { return Boolean(this.block.cho || this.block.jung); }
    get preedit() { return render(this.block); }

    // Ends composition. Returns the text to send.
    flush() {
      const text = this.preedit;
      this.reset();
      return text;
    }

    // Feeds one key. Returns { commit, preedit, handled }; handled is false
    // when the key is not a Hangul key (the caller sends it as usual, after
    // calling flush()).
    feed(key) {
      const j = jamoFor(key);
      if (!j) return { commit: '', preedit: this.preedit, handled: false };
      const commit = isVowel(j) ? this.vowel(j) : this.consonant(j);
      return { commit, preedit: this.preedit, handled: true };
    }

    // Removes the last jamo typed. Returns false when nothing is composed
    // (the caller then sends a normal backspace).
    backspace() {
      if (!this.composing) return false;
      this.block = this.history.pop() || { cho: '', jung: '', jong: '' };
      return true;
    }

    start(block) {
      this.block = { cho: '', jung: '', jong: '', ...block };
      this.history = [];
    }

    push(block) {
      this.history.push(this.block);
      this.block = { ...this.block, ...block };
    }

    consonant(c) {
      const { cho, jung, jong } = this.block;
      if (cho && jung && !jong) {
        if (JONG.includes(c)) { this.push({ jong: c }); return ''; }
      } else if (cho && jung && jong) {
        const pair = FINAL_PAIRS[jong + c];
        if (pair) { this.push({ jong: pair }); return ''; }
      }
      const out = this.flush();
      this.start({ cho: c });
      return out;
    }

    vowel(v) {
      const { cho, jung, jong } = this.block;
      if (!jong && jung) {
        const pair = VOWEL_PAIRS[jung + v];
        if (pair) { this.push({ jung: pair }); return ''; }
      }
      if (cho && !jung) { this.push({ jung: v }); return ''; }
      if (cho && jung && jong) {
        // The final consonant moves to the next syllable: 각 + ㅏ -> 가가, 닭 + ㅏ -> 달가
        const split = SPLIT_FINAL[jong];
        const keep = split ? split[0] : '';
        const move = split ? split[1] : jong;
        const out = render({ cho, jung, jong: keep });
        this.start({ cho: move });
        this.push({ jung: v });
        return out;
      }
      const out = this.flush();
      this.start({ jung: v });
      return out;
    }
  }

  // Types a whole key sequence (for tests): returns the final text.
  HangulComposer.type = (keys) => {
    const h = new HangulComposer();
    let out = '';
    for (const k of keys) {
      if (k === '\b') { if (!h.backspace()) out = out.slice(0, -1); continue; }
      const r = h.feed(k);
      out += r.commit;
      if (!r.handled) out += h.flush() + k;
    }
    return out + h.flush();
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = { HangulComposer };
  else root.HangulComposer = HangulComposer;
})(typeof window !== 'undefined' ? window : globalThis);
