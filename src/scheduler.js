// 單詞排程與計分的純函數（不碰 DOM / Firestore / Notion），方便單測。
//
// 單詞狀態欄位：
//   status          'New' | 'Learning' | 'Finished'
//   learningDate    'YYYY-MM-DD' | null   這天起才出現在 Today
//   reviewTimes     null | 0..6           null = 從未 Finished 過；0 = 首次 Finished 後；1–6 = 已完成溫習次數
//   nextReviewDate  'YYYY-MM-DD' | null   下次該溫習日
//   lastReviewDate  'YYYY-MM-DD' | null
//   defer           boolean               下次再學（一直留在 Review，直到點 Finished）

// 遺忘曲線間隔（天）。每次都從「完成當日」往後數，逾期不堆疊。
// 首次 Finished 後 +1 天；之後完成第 n 次溫習，下次間隔 INTERVALS[n]；完成第 6 次溫習即 Finished。
export const INTERVALS = [1, 2, 4, 7, 15, 30];
export const MAX_REVIEWS = INTERVALS.length; // 6
export const MAX_SCORE_PER_WORD = MAX_REVIEWS + 1; // 首次 Finished 1 分 + 6 次溫習

const pad = (n) => String(n).padStart(2, '0');

/** 以本地時間得到 YYYY-MM-DD */
export function toDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' 加 n 天（用中午避開夏令時間邊界） */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  dt.setDate(dt.getDate() + n);
  return toDateStr(dt);
}

export function isToday(word, today) {
  const status = word.status || 'New';
  return status === 'New' && (!word.learningDate || word.learningDate <= today);
}

export function isReview(word, today) {
  return word.status === 'Learning'
    && (word.defer === true || !word.nextReviewDate || word.nextReviewDate <= today);
}

export function todayList(words, today) {
  return words.filter((w) => isToday(w, today));
}

export function reviewList(words, today) {
  return words.filter((w) => isReview(w, today));
}

// 首次 Finished（Review Times 為空）和之後的溫習 Finished。
function finish(word, today) {
  if (word.reviewTimes == null) {
    return {
      status: 'Learning',
      reviewTimes: 0,
      nextReviewDate: addDays(today, INTERVALS[0]),
      lastReviewDate: today,
      defer: false,
    };
  }
  const reviewTimes = word.reviewTimes + 1;
  if (reviewTimes >= MAX_REVIEWS) {
    return {
      status: 'Finished',
      reviewTimes: MAX_REVIEWS,
      nextReviewDate: null,
      lastReviewDate: today,
      defer: false,
    };
  }
  return {
    status: 'Learning',
    reviewTimes,
    nextReviewDate: addDays(today, INTERVALS[reviewTimes]),
    lastReviewDate: today,
    defer: false,
  };
}

/**
 * 套用學習動作，回傳要更新的欄位（不修改原物件）。
 * action: 'finished' | 'later'（Learn Next Time） | 'mastered'
 */
export function applyAction(word, action, today) {
  switch (action) {
    case 'finished':
      return finish(word, today);
    case 'later':
      // 新詞點下次再學 → 視為已接觸（Learning），一直留在 Review；Review Times 不動，不加分
      return { status: 'Learning', defer: true };
    case 'mastered':
      // 完全掌握：退出 Today / Review，不補分（Review Times 不變）
      return {
        status: 'Finished',
        defer: false,
        nextReviewDate: null,
        lastReviewDate: today,
      };
    default:
      throw new Error(`未知的動作：${action}`);
  }
}

/** Mastered 小測答錯後，要等多久才能再挑戰（毫秒）。 */
export const MASTERED_COOLDOWN_MS = 10 * 60 * 1000;

/** Mastered 冷卻還剩幾毫秒（0 = 可以挑戰）。masteredFailAt 是最近一次 Mastered 答錯的時間戳（毫秒）。 */
export function masteredCooldownLeft(word, now = Date.now(), cooldownMs = MASTERED_COOLDOWN_MS) {
  if (!word.masteredFailAt) return 0;
  return Math.max(0, word.masteredFailAt + cooldownMs - now);
}

/**
 * Review 單詞是否可以跳過學習卡、直接考：已經 Finished 過至少一次（Review Times 不為空）才行。
 * 從沒真正完成過的（例如 Today 點了 Learn Next Time 的）還沒學會，要先看卡片。
 */
export function canQuizDirectly(word) {
  return word.status === 'Learning' && word.reviewTimes != null;
}

/**
 * 記錄一題小測的結果（累計答對/答錯次數 + 最後小測日期），回傳要更新的欄位，不修改原物件。
 * 與排程、分數無關：只是給家長在 Notion 看孩子有沒有認真練、哪些詞常錯。
 */
export function recordQuizResult(word, ok, today) {
  return {
    quizCorrect: (word.quizCorrect || 0) + (ok ? 1 : 0),
    quizWrong: (word.quizWrong || 0) + (ok ? 0 : 1),
    lastQuizDate: today,
  };
}

/** 單詞得分：Review Times 為空 = 從未 Finished 過 = 0 分，否則 1 + Review Times */
export function wordScore(word) {
  return word.reviewTimes == null ? 0 : 1 + word.reviewTimes;
}

/** 學生統計：各狀態數量、累計分數、滿分、百分制換算分數 */
export function studentStats(words, today) {
  const stats = {
    total: words.length,
    new: 0,
    learning: 0,
    finished: 0,
    today: 0,
    review: 0,
    score: 0,
    maxScore: words.length * MAX_SCORE_PER_WORD,
    percent: 0,
  };
  for (const w of words) {
    const status = w.status || 'New';
    if (status === 'Finished') stats.finished += 1;
    else if (status === 'Learning') stats.learning += 1;
    else stats.new += 1;
    if (isToday(w, today)) stats.today += 1;
    if (isReview(w, today)) stats.review += 1;
    stats.score += wordScore(w);
  }
  stats.percent = stats.maxScore ? Math.round((stats.score / stats.maxScore) * 100) : 0;
  return stats;
}
