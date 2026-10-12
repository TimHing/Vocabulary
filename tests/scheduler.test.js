import { describe, it, expect } from 'vitest';
import {
  addDays, isToday, isReview, applyAction, wordScore, studentStats, INTERVALS,
} from '../src/scheduler.js';

const TODAY = '2026-10-12';
const base = (over = {}) => ({
  status: 'New', learningDate: TODAY, reviewTimes: null, nextReviewDate: null,
  lastReviewDate: null, defer: false, ...over,
});
const merge = (w, patch) => ({ ...w, ...patch });

describe('addDays', () => {
  it('跨月跨年', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-12', 30)).toBe('2026-11-11');
  });
});

describe('Today / Review 篩選', () => {
  it('Today：New 且 Learning Date ≤ 今天或為空', () => {
    expect(isToday(base(), TODAY)).toBe(true);
    expect(isToday(base({ learningDate: '2026-10-01' }), TODAY)).toBe(true);
    expect(isToday(base({ learningDate: null }), TODAY)).toBe(true);
    expect(isToday(base({ learningDate: '2026-10-13' }), TODAY)).toBe(false);
    expect(isToday(base({ status: 'Learning' }), TODAY)).toBe(false);
    expect(isToday(base({ status: 'Finished' }), TODAY)).toBe(false);
  });

  it('Review：Learning 且（defer 或 Next Review ≤ 今天）', () => {
    const l = (o) => base({ status: 'Learning', reviewTimes: 0, nextReviewDate: TODAY, ...o });
    expect(isReview(l(), TODAY)).toBe(true);
    expect(isReview(l({ nextReviewDate: '2026-10-01' }), TODAY)).toBe(true); // 逾期仍在
    expect(isReview(l({ nextReviewDate: '2026-10-13' }), TODAY)).toBe(false);
    expect(isReview(l({ nextReviewDate: '2026-10-13', defer: true }), TODAY)).toBe(true);
    expect(isReview(base({ status: 'Finished' }), TODAY)).toBe(false);
    expect(isReview(base({ status: 'New' }), TODAY)).toBe(false);
  });
});

describe('Finished 與遺忘曲線', () => {
  it('首次 Finished：Learning、Review Times=0、明天複習', () => {
    const w = merge(base(), applyAction(base(), 'finished', TODAY));
    expect(w).toMatchObject({
      status: 'Learning', reviewTimes: 0, nextReviewDate: '2026-10-13',
      lastReviewDate: TODAY, defer: false,
    });
  });

  it('走完整條曲線：間隔 1、2、4、7、15、30，第 6 次溫習後 Finished', () => {
    let w = base();
    let day = TODAY;
    w = merge(w, applyAction(w, 'finished', day));
    const gaps = [w.nextReviewDate];
    expect(w.nextReviewDate).toBe(addDays(day, INTERVALS[0]));
    for (let i = 1; i <= 6; i += 1) {
      day = w.nextReviewDate;
      expect(isReview(w, day)).toBe(true);
      w = merge(w, applyAction(w, 'finished', day));
      expect(w.reviewTimes).toBe(i);
      if (i < 6) {
        expect(w.status).toBe('Learning');
        gaps.push(w.nextReviewDate);
      }
    }
    expect(w).toMatchObject({ status: 'Finished', reviewTimes: 6, nextReviewDate: null });
    expect(wordScore(w)).toBe(7);
    // 累計距離首次學習：1、3、7、14、29、59 天
    expect(gaps).toEqual(['2026-10-13', '2026-10-15', '2026-10-19', '2026-10-26', '2026-11-10', '2026-12-10']);
    expect(day).toBe(addDays(TODAY, 59));
  });

  it('逾期溫習：從完成當日起算，不堆疊', () => {
    let w = merge(base(), applyAction(base(), 'finished', TODAY)); // next 10-13
    w = merge(w, applyAction(w, 'finished', '2026-10-20')); // 遲了 7 天才複習
    expect(w.reviewTimes).toBe(1);
    expect(w.nextReviewDate).toBe('2026-10-22'); // 完成日 + 2
  });

  it('Finished 會清除 defer', () => {
    let w = base({ status: 'Learning', defer: true });
    w = merge(w, applyAction(w, 'finished', TODAY));
    expect(w.defer).toBe(false);
    expect(w.reviewTimes).toBe(0);
  });
});

describe('Learn Next Time', () => {
  it('新詞：變 Learning、defer、不動 Review Times、不加分', () => {
    const w = merge(base(), applyAction(base(), 'later', TODAY));
    expect(w).toMatchObject({ status: 'Learning', defer: true, reviewTimes: null, nextReviewDate: null });
    expect(isToday(w, TODAY)).toBe(false);
    expect(isReview(w, TODAY)).toBe(true);
    expect(isReview(w, '2026-12-01')).toBe(true);
    expect(wordScore(w)).toBe(0);
  });

  it('延後的新詞之後點 Finished 走首次 Finished 邏輯', () => {
    let w = merge(base(), applyAction(base(), 'later', TODAY));
    w = merge(w, applyAction(w, 'finished', '2026-10-14'));
    expect(w).toMatchObject({
      status: 'Learning', reviewTimes: 0, nextReviewDate: '2026-10-15', defer: false,
    });
  });

  it('溫習中的詞點 Learn Next Time：保持原進度並一直留在 Review', () => {
    let w = merge(base(), applyAction(base(), 'finished', TODAY));
    w = merge(w, applyAction(w, 'finished', '2026-10-13')); // reviewTimes 1, next 10-15
    const before = w.reviewTimes;
    w = merge(w, applyAction(w, 'later', '2026-10-15'));
    expect(w.reviewTimes).toBe(before);
    expect(w.defer).toBe(true);
    expect(isReview(w, '2026-10-16')).toBe(true);
  });
});

describe('Mastered', () => {
  it('Today 的新詞直接掌握：Finished、不加分、退出清單', () => {
    const w = merge(base(), applyAction(base(), 'mastered', TODAY));
    expect(w).toMatchObject({ status: 'Finished', defer: false, nextReviewDate: null, reviewTimes: null });
    expect(isToday(w, TODAY)).toBe(false);
    expect(isReview(w, TODAY)).toBe(false);
    expect(wordScore(w)).toBe(0);
  });

  it('Review 中的詞掌握：保留已賺到的分數', () => {
    let w = merge(base(), applyAction(base(), 'finished', TODAY));
    w = merge(w, applyAction(w, 'finished', '2026-10-13'));
    w = merge(w, applyAction(w, 'finished', '2026-10-15')); // reviewTimes 2 → 3 分
    expect(wordScore(w)).toBe(3);
    w = merge(w, applyAction(w, 'mastered', '2026-10-19'));
    expect(w.status).toBe('Finished');
    expect(wordScore(w)).toBe(3);
    expect(isReview(w, '2026-12-01')).toBe(false);
  });
});

describe('計分與統計', () => {
  it('wordScore', () => {
    expect(wordScore(base())).toBe(0);
    expect(wordScore(base({ reviewTimes: 0 }))).toBe(1);
    expect(wordScore(base({ reviewTimes: 6 }))).toBe(7);
  });

  it('studentStats', () => {
    const words = [
      base(), // New, today
      base({ status: 'Learning', reviewTimes: 0, nextReviewDate: TODAY }), // 1 分，review
      base({ status: 'Learning', defer: true }), // 0 分，review
      base({ status: 'Finished', reviewTimes: 6 }), // 7 分
    ];
    const s = studentStats(words, TODAY);
    expect(s).toMatchObject({
      total: 4, new: 1, learning: 2, finished: 1, today: 1, review: 2, score: 8, maxScore: 28, percent: 29,
    });
  });

  it('空列表不會除以 0', () => {
    expect(studentStats([], TODAY).percent).toBe(0);
  });
});
