// 讀取 Notion 兩位學生的單詞表，輸出 src/data/words.json，由 Vite 打包進網頁（瀏覽器不碰 Notion）。
// 沒設定 NOTION_TOKEN 時改用 words.sample.json（本機開發 / 還沒設好 secrets 時不報錯）。
import 'dotenv/config';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createClient, extractId, findStudentDatabases, queryAll,
  getTitle, getRichText, getSelectName, getNumber, getDate, getCheckbox,
} from './notion-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const OUT = join(DATA_DIR, 'words.json');
const SAMPLE = join(DATA_DIR, 'words.sample.json');

export function parseWord(page) {
  const p = page.properties;
  const reviewTimes = getNumber(p['Review Times']);
  return {
    id: page.id,
    word: getTitle(p.Word).trim(),
    type: getSelectName(p.Type),
    pronunciation: getRichText(p.Pronunciation),
    meaning: getRichText(p.Meaning),
    collocation: getRichText(p.Collocation),
    example: getRichText(p.Example),
    synonyms: getRichText(p.Synonyms),
    antonyms: getRichText(p.Antonyms),
    test: getRichText(p['Understanding Test']),
    answer: getRichText(p['Test Answer']),
    source: getRichText(p.Source),
    status: getSelectName(p.Status) || 'New',
    learningDate: getDate(p['Learning Date']),
    reviewTimes,
    // 累計分；Notion 還沒有 Points 時用舊公式（從沒 Finished 過 0 分，否則 1 + Review Times）當起始值
    points: getNumber(p.Points) ?? (reviewTimes == null ? 0 : 1 + reviewTimes),
    nextReviewDate: getDate(p['Next Review Date']),
    lastReviewDate: getDate(p['Last Review Date']),
    defer: getCheckbox(p.Defer),
    quizCorrect: getNumber(p['Quiz Correct']) ?? 0,
    quizWrong: getNumber(p['Quiz Wrong']) ?? 0,
    lastQuizDate: getDate(p['Last Quiz Date']),
  };
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  if (!process.env.NOTION_TOKEN) {
    console.warn('[sync-notion] 沒有設定 NOTION_TOKEN，改用 words.sample.json。');
    copyFileSync(SAMPLE, OUT);
    return;
  }
  const parentId = extractId(process.env.NOTION_VOCAB_PAGE_ID);
  if (!parentId) throw new Error('NOTION_VOCAB_PAGE_ID 未設定或無效');

  const notion = createClient();
  const students = await findStudentDatabases(notion, parentId);
  if (!students.length) throw new Error('找不到任何學生單詞資料庫');

  const out = [];
  for (const s of students) {
    // eslint-disable-next-line no-await-in-loop
    const pages = await queryAll(notion, s.databaseId);
    const words = pages.map(parseWord).filter((w) => w.word);
    console.log(`[sync-notion] ${s.name}：${words.length} 個單詞`);
    out.push({ id: s.id, name: s.name, words });
  }

  // generatedAt 用來判斷 Firestore 的進度是否比這份快照更新（見 src/store.js）
  writeFileSync(OUT, `${JSON.stringify({ generatedAt: Date.now(), students: out }, null, 2)}\n`);
  console.log(`[sync-notion] 已寫入 ${OUT}`);
}

main().catch((err) => {
  console.error(err.body || err);
  process.exit(1);
});
