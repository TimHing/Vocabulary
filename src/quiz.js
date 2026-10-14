// 小測出題與判分（純函數，不碰 DOM / Firestore，rng 可注入方便單測）。
//
// 題型：
//   mcq        看英文單詞，4 選 1 中文意思
//   spell      看中文意思，拼出單詞
//   cloze      例句挖空，拼出單詞
//   dictation  聽發音，拼出單詞
//   test       Understanding Test 原文，答案是單個英文詞時才用
//
// word 需要的欄位：id, word, meaning, example, test, answer（見 scripts/sync-notion.mjs parseWord）。
// ctx：{ canSpeak: boolean, distractors: number }（可用的干擾項數量，見 countDistractors）。

export const TYPES = ['mcq', 'spell', 'cloze', 'dictation', 'test'];

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isSingleEnglishWord = (s) => /^[A-Za-z][A-Za-z'-]*$/.test(String(s ?? '').trim());

/** 洗牌（Fisher–Yates），不修改原陣列。 */
export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pickOne = (arr, rng) => arr[Math.floor(rng() * arr.length)];

/**
 * 把例句中的單詞（含常見詞尾變化）挖成 ____。找不到時回傳 null。
 * 支援：s/es/ed/d/ing/er、去 e 加 ing（make→making）、y→ies/ied、雙寫尾字母（stop→stopped）。
 */
export function maskExample(word, example) {
  const w = String(word ?? '').trim();
  const ex = String(example ?? '');
  if (!w || !ex) return null;

  const base = escapeRe(w).replace(/\s+/g, '\\s+');
  const last = w.slice(-1);
  const stem = escapeRe(w.slice(0, -1)).replace(/\s+/g, '\\s+');
  const alts = [`${base}(?:s|es|ed|d|ing|er)?`];
  if (last === 'e') alts.push(`${stem}ing`);
  if (last === 'y') alts.push(`${stem}(?:ies|ied)`);
  if (/[a-z]/i.test(last)) alts.push(`${base}${escapeRe(last)}(?:ed|ing|er)`);

  const re = new RegExp(`\\b(?:${alts.join('|')})\\b`, 'i');
  return re.test(ex) ? ex.replace(re, '____') : null;
}

/** 這個單詞有幾個可作干擾項的「不同意思」。 */
export function countDistractors(word, pool) {
  const correct = norm(word.meaning);
  return new Set(
    pool
      .filter((w) => w.id !== word.id && norm(w.meaning) && norm(w.meaning) !== correct)
      .map((w) => norm(w.meaning)),
  ).size;
}

/** 這個單詞目前可出哪些題型。 */
export function availableTypes(word, ctx = {}) {
  const types = [];
  if (norm(word.meaning) && (ctx.distractors ?? 0) >= 1) types.push('mcq');
  if (norm(word.meaning)) types.push('spell');
  if (maskExample(word.word, word.example)) types.push('cloze');
  if (ctx.canSpeak) types.push('dictation');
  if (norm(word.test) && isSingleEnglishWord(word.answer)) types.push('test');
  return types;
}

// Review 題型階梯（依 Review Times，空視為 0）
const TIERS = [
  { max: 1, types: ['mcq'] },
  { max: 3, types: ['spell', 'cloze', 'test'] },
  { max: Infinity, types: ['dictation', 'spell', 'cloze'] },
];
const FALLBACK_ORDER = ['spell', 'cloze', 'test', 'dictation', 'mcq'];

/** 依 Review Times 選題型；該階梯都不可用時退回其他可用題型，完全沒有就回傳 null。 */
export function pickReviewType(reviewTimes, word, ctx, rng = Math.random) {
  const rt = reviewTimes ?? 0;
  const avail = availableTypes(word, ctx);
  const tier = TIERS.find((t) => rt <= t.max);
  const candidates = tier.types.filter((t) => avail.includes(t));
  if (candidates.length) return pickOne(candidates, rng);
  const fallback = FALLBACK_ORDER.find((t) => avail.includes(t));
  return fallback ?? null;
}

/** 組出一題。pool 是可用來產生選項的單詞（通常是同一學生的全部單詞）。 */
export function buildQuestion(type, word, pool = [], rng = Math.random) {
  const base = { type, wordId: word.id, answer: word.word };
  switch (type) {
    case 'mcq': {
      const correct = word.meaning;
      const seen = new Set([norm(correct)]);
      const others = [];
      for (const w of shuffle(pool, rng)) {
        const m = norm(w.meaning);
        if (w.id === word.id || !m || seen.has(m)) continue;
        seen.add(m);
        others.push(w.meaning);
        if (others.length === 3) break;
      }
      return {
        ...base,
        answer: correct,
        prompt: word.word,
        options: shuffle([correct, ...others], rng),
      };
    }
    case 'spell':
      return { ...base, prompt: word.meaning, hint: word.word.charAt(0) };
    case 'cloze':
      return { ...base, prompt: maskExample(word.word, word.example), meaning: word.meaning };
    case 'dictation':
      return { ...base, prompt: '' };
    case 'test':
      return { ...base, answer: String(word.answer).trim(), prompt: word.test };
    default:
      throw new Error(`未知的題型：${type}`);
  }
}

/** Mastered 小測：3 題不同題型（不含 mcq），可用題型不足 3 種時以 spell 補足。 */
export function buildMasteredQuiz(word, pool, ctx, rng = Math.random) {
  const avail = availableTypes(word, ctx).filter((t) => t !== 'mcq');
  if (!avail.length) return [];
  const types = shuffle(avail, rng).slice(0, 3);
  const fill = avail.includes('spell') ? 'spell' : types[0];
  while (types.length < 3) types.push(fill);
  return types.map((t) => buildQuestion(t, word, pool, rng));
}

/** 判分：選擇題要完全一致；拼寫題忽略大小寫與多餘空格，其餘必須完全一致。 */
export function checkAnswer(question, input) {
  if (question.type === 'mcq') return input === question.answer;
  return norm(input) === norm(question.answer);
}
