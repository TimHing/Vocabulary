import { describe, it, expect } from 'vitest';
import { toNotionProperties } from '../scripts/notion-lib.mjs';

const progress = {
  status: 'Learning', reviewTimes: 2, nextReviewDate: '2026-10-20', lastReviewDate: '2026-10-16', defer: false,
};

describe('toNotionProperties', () => {
  it('學習進度 + 小測記錄都寫', () => {
    const p = toNotionProperties({
      ...progress, quizCorrect: 5, quizWrong: 2, lastQuizDate: '2026-10-16', progressDirty: true,
    });
    expect(p.Status).toEqual({ select: { name: 'Learning' } });
    expect(p['Review Times']).toEqual({ number: 2 });
    expect(p['Next Review Date']).toEqual({ date: { start: '2026-10-20' } });
    expect(p.Defer).toEqual({ checkbox: false });
    expect(p['Quiz Correct']).toEqual({ number: 5 });
    expect(p['Quiz Wrong']).toEqual({ number: 2 });
    expect(p['Last Quiz Date']).toEqual({ date: { start: '2026-10-16' } });
  });

  it('points 寫到 Notion 的 Points 欄位（含 0 與負數），不受 progressDirty 影響', () => {
    expect(toNotionProperties({ points: 12 }).Points).toEqual({ number: 12 });
    expect(toNotionProperties({ points: 0 }).Points).toEqual({ number: 0 });
    expect(toNotionProperties({ points: -3 }).Points).toEqual({ number: -3 });
    expect(toNotionProperties({ ...progress, progressDirty: false, points: 4 }).Points).toEqual({ number: 4 });
    expect(toNotionProperties({ quizCorrect: 1 }).Points).toBeUndefined();
  });

  it('舊文件沒有 progressDirty 旗標 → 仍寫學習進度（向下相容）', () => {
    expect(toNotionProperties(progress).Status).toEqual({ select: { name: 'Learning' } });
  });

  it('progressDirty=false → 只寫小測，不用舊的學習進度覆蓋 Notion', () => {
    const p = toNotionProperties({
      ...progress, progressDirty: false, quizCorrect: 1, quizWrong: 0, lastQuizDate: '2026-10-16',
    });
    expect(Object.keys(p).sort()).toEqual(['Last Quiz Date', 'Quiz Correct', 'Quiz Wrong']);
  });

  it('只有小測欄位的文件（沒有 status）不會產生進度屬性', () => {
    const p = toNotionProperties({ quizCorrect: 0, quizWrong: 3, lastQuizDate: '2026-10-16' });
    expect(p.Status).toBeUndefined();
    expect(p['Quiz Wrong']).toEqual({ number: 3 });
    expect(p['Quiz Correct']).toEqual({ number: 0 }); // 0 也要寫
  });

  it('Review Times / 日期為空時清空欄位', () => {
    const p = toNotionProperties({ status: 'Finished', reviewTimes: null, nextReviewDate: null, lastReviewDate: '2026-10-16' });
    expect(p['Review Times']).toEqual({ number: null });
    expect(p['Next Review Date']).toEqual({ date: null });
  });

  it('空文件不產生任何屬性', () => {
    expect(toNotionProperties({})).toEqual({});
  });
});
