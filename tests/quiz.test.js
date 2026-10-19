import { describe, it, expect } from 'vitest';
import {
  maskExample, countDistractors, availableTypes, pickReviewType, pickLearnType, pickTypedType,
  passPoints, wrongPenalty, isTypedType,
  buildQuestion, buildMasteredQuiz, checkAnswer, shuffle,
} from '../src/quiz.js';

// 可重現的偽隨機
const seeded = (seed = 1) => () => {
  // mulberry32
  seed += 0x6D2B79F5;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const mk = (id, word, meaning, extra = {}) => ({
  id, word, meaning, example: '', test: '', answer: '', ...extra,
});

const chair = mk('1', 'chair', '椅子', {
  example: 'Please sit on the chair.',
  test: '如果我要說「請坐在椅子上」，該用哪個字？',
  answer: 'chair',
});
const pool = [
  chair,
  mk('2', 'desk', '書桌'),
  mk('3', 'friend', '朋友'),
  mk('4', 'teacher', '老師'),
  mk('5', 'bag', '書包'),
  mk('6', 'pen', '椅子'), // 與 chair 同一個意思，不能當干擾項
];
const ctx = { canSpeak: true, distractors: countDistractors(chair, pool) };

describe('maskExample', () => {
  it('挖掉原形', () => {
    expect(maskExample('chair', 'Please sit on the chair.')).toBe('Please sit on the ____.');
  });
  it('不分大小寫', () => {
    expect(maskExample('although', 'Although it was raining, we played.')).toBe('____ it was raining, we played.');
  });
  it('詞尾變化 s / ed / ing', () => {
    expect(maskExample('book', 'She reads many books.')).toBe('She reads many ____.');
    expect(maskExample('compare', 'Compare the two results.')).toBe('____ the two results.');
    expect(maskExample('compare', 'She compared the two.')).toBe('She ____ the two.');
    expect(maskExample('walk', 'We are walking home.')).toBe('We are ____ home.');
  });
  it('去 e 加 ing、y→ies、雙寫尾字母', () => {
    expect(maskExample('make', 'He is making a cake.')).toBe('He is ____ a cake.');
    expect(maskExample('study', 'She studies hard.')).toBe('She ____ hard.');
    expect(maskExample('stop', 'The car stopped.')).toBe('The car ____.');
  });
  it('詞組', () => {
    expect(maskExample('sit down', 'Please sit down now.')).toBe('Please ____ now.');
  });
  it('只挖整個詞，不挖詞的一部分', () => {
    expect(maskExample('art', 'The party was fun.')).toBeNull();
  });
  it('找不到或缺資料回傳 null', () => {
    expect(maskExample('chair', 'We went to school.')).toBeNull();
    expect(maskExample('chair', '')).toBeNull();
    expect(maskExample('', 'abc')).toBeNull();
  });
});

describe('availableTypes', () => {
  it('資料齊全時五種都可用', () => {
    expect(availableTypes(chair, ctx).sort()).toEqual(['cloze', 'dictation', 'mcq', 'spell', 'test']);
  });
  it('沒有語音就沒有聽寫', () => {
    expect(availableTypes(chair, { ...ctx, canSpeak: false })).not.toContain('dictation');
  });
  it('例句找不到單詞就沒有挖空', () => {
    expect(availableTypes({ ...chair, example: 'Nothing here.' }, ctx)).not.toContain('cloze');
  });
  it('Test Answer 不是單個英文詞就沒有理解測試', () => {
    expect(availableTypes({ ...chair, answer: '轉折。' }, ctx)).not.toContain('test');
    expect(availableTypes({ ...chair, answer: 'used to' }, ctx)).not.toContain('test');
    expect(availableTypes({ ...chair, test: '' }, ctx)).not.toContain('test');
  });
  it('沒有干擾項就沒有選擇題；沒有意思就沒有選擇題與拼詞', () => {
    expect(availableTypes(chair, { ...ctx, distractors: 0 })).not.toContain('mcq');
    const t = availableTypes({ ...chair, meaning: '' }, ctx);
    expect(t).not.toContain('mcq');
    expect(t).not.toContain('spell');
  });
});

describe('pickReviewType 階梯（第 2、6 次溫習是錄入題）', () => {
  const rng = seeded(7);
  it('第 1 次溫習（Review Times 空/0）→ 選擇題', () => {
    for (const rt of [null, undefined, 0]) {
      expect(pickReviewType(rt, chair, ctx, rng)).toBe('mcq');
    }
  });
  it('第 2 次溫習（Review Times 1）→ 聽寫（錄入）', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(pickReviewType(1, chair, ctx, seeded(i))).toBe('dictation');
    }
  });
  it('第 3 次（Review Times 2）→ spell / cloze / test；第 4 次（3）同階梯', () => {
    for (let i = 0; i < 30; i += 1) {
      expect(['spell', 'cloze', 'test']).toContain(pickReviewType(2 + (i % 2), chair, ctx, seeded(i)));
    }
  });
  it('第 5 次溫習（Review Times 4）→ dictation / spell / cloze', () => {
    for (let i = 0; i < 30; i += 1) {
      expect(['dictation', 'spell', 'cloze']).toContain(pickReviewType(4, chair, ctx, seeded(i)));
    }
  });
  it('第 6 次溫習（Review Times 5）→ 聽寫（錄入）', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(pickReviewType(5, chair, ctx, seeded(i))).toBe('dictation');
    }
  });
  it('錄入題的回退：不能聽寫就用看意思拼詞，仍是錄入題', () => {
    const noSpeech = { ...ctx, canSpeak: false };
    for (const rt of [1, 5]) {
      expect(isTypedType(pickReviewType(rt, chair, noSpeech, rng))).toBe(true);
      expect(pickReviewType(rt, chair, noSpeech, rng)).toBe('spell');
    }
  });
  it('階梯題型不可用時回退到其他可用題型', () => {
    // 沒有干擾項 → 不能 mcq，退回 spell
    expect(pickReviewType(0, chair, { ...ctx, distractors: 0 }, rng)).toBe('spell');
    // 第 5 次的聽寫不可用，但 spell/cloze 仍可用
    expect(['spell', 'cloze']).toContain(pickReviewType(4, chair, { ...ctx, canSpeak: false }, rng));
  });
  it('完全沒有可用題型回傳 null', () => {
    const empty = mk('9', 'x', '');
    expect(pickReviewType(0, empty, { canSpeak: false, distractors: 0 }, rng)).toBeNull();
    expect(pickReviewType(1, empty, { canSpeak: false, distractors: 0 }, rng)).toBeNull();
  });
});

describe('pickLearnType（點 Finished 第一次學完 → 錄入題）', () => {
  it('優先聽寫', () => {
    expect(pickLearnType(chair, ctx)).toBe('dictation');
  });
  it('不能聽寫時退回看意思拼詞，仍是錄入題', () => {
    expect(pickLearnType(chair, { ...ctx, canSpeak: false })).toBe('spell');
  });
  it('沒有意思但有發音 → 聽寫；只有選擇題可用時才退回選擇題', () => {
    expect(pickLearnType(mk('9', 'x', ''), ctx)).toBe('dictation');
    expect(pickTypedType(mk('9', 'x', ''), { canSpeak: false, distractors: 0 })).toBeNull();
  });
});

describe('計分：passPoints / wrongPenalty', () => {
  const q = (type) => ({ type });
  it('learn：完成 Finished +1，輸入題答對 +1', () => {
    expect(passPoints('learn', [q('dictation')])).toBe(2);
    expect(passPoints('learn', [q('spell')])).toBe(2);
    expect(passPoints('learn', [q('mcq')])).toBe(1); // 選擇題答對不加分
  });
  it('review：完成 Review +1，輸入題答對 +1', () => {
    expect(passPoints('review', [q('mcq')])).toBe(1);
    expect(passPoints('review', [q('dictation')])).toBe(2);
    expect(passPoints('review', [q('cloze')])).toBe(2);
  });
  it('mastered：完成 +2，3 題輸入各 +1，全對一次給 5 分', () => {
    expect(passPoints('mastered', [q('spell'), q('cloze'), q('dictation')])).toBe(5);
  });
  it('未知模式丟錯', () => {
    expect(() => passPoints('nope', [])).toThrow();
  });
  it('只有選擇題答錯才扣 1 分，輸入題答錯不扣', () => {
    expect(wrongPenalty(q('mcq'))).toBe(-1);
    for (const t of ['spell', 'cloze', 'dictation', 'test']) expect(wrongPenalty(q(t))).toBe(0);
  });
  it('isTypedType', () => {
    expect(['mcq', 'spell', 'cloze', 'dictation', 'test'].map(isTypedType)).toEqual([false, true, true, true, true]);
  });
});

describe('buildQuestion', () => {
  it('mcq：4 個不重複選項、含正確答案、不含同義重複', () => {
    for (let s = 1; s <= 20; s += 1) {
      const q = buildQuestion('mcq', chair, pool, seeded(s));
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.options).toContain('椅子');
      expect(q.options.filter((o) => o === '椅子')).toHaveLength(1); // pen 的「椅子」不會當干擾項
      expect(q.prompt).toBe('chair');
      expect(q.answer).toBe('椅子');
    }
  });
  it('mcq：干擾項不足時有幾個用幾個', () => {
    const small = [chair, mk('2', 'desk', '書桌')];
    const q = buildQuestion('mcq', chair, small, seeded(1));
    expect(q.options.sort()).toEqual(['書桌', '椅子'].sort());
  });
  it('spell / cloze / dictation / test', () => {
    expect(buildQuestion('spell', chair, pool)).toMatchObject({ prompt: '椅子', hint: 'c', answer: 'chair' });
    expect(buildQuestion('cloze', chair, pool)).toMatchObject({ prompt: 'Please sit on the ____.', answer: 'chair' });
    expect(buildQuestion('dictation', chair, pool)).toMatchObject({ answer: 'chair' });
    expect(buildQuestion('test', chair, pool)).toMatchObject({ prompt: chair.test, answer: 'chair' });
  });
  it('未知題型丟錯', () => {
    expect(() => buildQuestion('nope', chair, pool)).toThrow();
  });
});

describe('buildMasteredQuiz', () => {
  it('3 題、不同題型、不含 mcq', () => {
    for (let s = 1; s <= 20; s += 1) {
      const qs = buildMasteredQuiz(chair, pool, ctx, seeded(s));
      expect(qs).toHaveLength(3);
      expect(new Set(qs.map((q) => q.type)).size).toBe(3);
      expect(qs.map((q) => q.type)).not.toContain('mcq');
    }
  });
  it('可用題型不足 3 種時以 spell 補足', () => {
    const bare = mk('9', 'desk', '書桌'); // 只有 spell（沒語音、無例句、無 test）
    const qs = buildMasteredQuiz(bare, pool, { canSpeak: false, distractors: 5 }, seeded(1));
    expect(qs).toHaveLength(3);
    expect(qs.every((q) => q.type === 'spell')).toBe(true);
  });
  it('完全沒有可用題型回傳空陣列', () => {
    expect(buildMasteredQuiz(mk('9', 'x', ''), pool, { canSpeak: false, distractors: 0 })).toEqual([]);
  });
});

describe('checkAnswer', () => {
  const spell = buildQuestion('spell', chair, pool);
  it('忽略大小寫與多餘空格', () => {
    expect(checkAnswer(spell, 'chair')).toBe(true);
    expect(checkAnswer(spell, '  Chair ')).toBe(true);
    expect(checkAnswer(buildQuestion('spell', mk('9', 'sit down', '坐下'), pool), 'sit   DOWN')).toBe(true);
  });
  it('錯一個字母算錯', () => {
    expect(checkAnswer(spell, 'chiar')).toBe(false);
    expect(checkAnswer(spell, 'chairs')).toBe(false);
    expect(checkAnswer(spell, '')).toBe(false);
    expect(checkAnswer(spell, undefined)).toBe(false);
  });
  it('mcq 要與正確選項完全一致', () => {
    const q = buildQuestion('mcq', chair, pool, seeded(3));
    expect(checkAnswer(q, '椅子')).toBe(true);
    expect(checkAnswer(q, '書桌')).toBe(false);
  });
});

describe('shuffle', () => {
  it('不修改原陣列且保留所有元素', () => {
    const a = [1, 2, 3, 4, 5];
    const s = shuffle(a, seeded(2));
    expect(a).toEqual([1, 2, 3, 4, 5]);
    expect([...s].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
