// Notion 共用工具（沿用 SnakeG scripts/sync-notion.mjs 的 helper 與連接方式）。
// 只在本機 / GitHub Actions 的 Node 裡跑，token 不會進到瀏覽器。
import { Client } from '@notionhq/client';

export function createClient() {
  return new Client({ auth: process.env.NOTION_TOKEN });
}

/** 接受完整 Notion 網址、純 ID 或帶 - 的 UUID，取出第一個 32 位 16 進位 ID。 */
export function extractId(raw) {
  if (!raw) return null;
  const match = String(raw).replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return match ? match[0] : null;
}

export const getTitle = (p) => (p?.title || []).map((t) => t.plain_text).join('');
export const getRichText = (p) => (p?.rich_text || []).map((t) => t.plain_text).join('');
export const getSelectName = (p) => p?.select?.name ?? null;
export const getNumber = (p) => (typeof p?.number === 'number' ? p.number : null);
export const getDate = (p) => p?.date?.start?.slice(0, 10) ?? null;
export const getCheckbox = (p) => p?.checkbox === true;

/** 以本地時間得到 YYYY-MM-DD */
export function localToday(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const dateProp = (d) => ({ date: d ? { start: d } : null });

/**
 * 把 Firestore 單詞進度文件轉成 Notion 頁面屬性。只寫文件裡有的欄位：
 * 學習進度只在 progressDirty 不為 false 時才寫（舊文件沒有此旗標，視為需要寫）；
 * 只記了小測次數的文件不含 status，也不會把 Status 等欄位清掉或用舊值覆蓋 Notion 上的手動修改。
 */
export function toNotionProperties(data) {
  const props = {};
  if (typeof data.status === 'string' && data.progressDirty !== false) {
    props.Status = { select: { name: data.status } };
    props['Review Times'] = { number: typeof data.reviewTimes === 'number' ? data.reviewTimes : null };
    props['Next Review Date'] = dateProp(data.nextReviewDate);
    props['Last Review Date'] = dateProp(data.lastReviewDate);
    props.Defer = { checkbox: data.defer === true };
  }
  if (typeof data.quizCorrect === 'number') props['Quiz Correct'] = { number: data.quizCorrect };
  if (typeof data.quizWrong === 'number') props['Quiz Wrong'] = { number: data.quizWrong };
  if (typeof data.lastQuizDate === 'string') props['Last Quiz Date'] = dateProp(data.lastQuizDate);
  return props;
}

/**
 * 從 Vocabulary 父頁找出每位學生的單詞資料庫。
 * 子頁標題為 Vocabulary_<Name>（例：Vocabulary_Henness、Vocabulary_HANNA），
 * 其下有一個 child_database。回傳 [{ id, name, databaseId }]，依名稱排序。
 */
export async function findStudentDatabases(notion, parentPageId) {
  const students = [];
  let cursor;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await notion.blocks.children.list({ block_id: parentPageId, page_size: 100, start_cursor: cursor });
    for (const block of res.results) {
      if (block.type !== 'child_page') continue;
      const m = block.child_page.title.match(/^Vocabulary[_\s-]+(.+)$/i);
      if (!m) continue;
      const raw = m[1].trim();
      const name = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase(); // HANNA → Hanna
      // eslint-disable-next-line no-await-in-loop
      const kids = await notion.blocks.children.list({ block_id: block.id, page_size: 100 });
      const db = kids.results.find((b) => b.type === 'child_database');
      if (!db) {
        console.warn(`[notion] 子頁「${block.child_page.title}」裡找不到資料庫，略過。`);
        continue;
      }
      students.push({ id: name.toLowerCase(), name, databaseId: db.id });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return students.sort((a, b) => a.name.localeCompare(b.name));
}

export async function queryAll(notion, database_id, extra = {}) {
  const pages = [];
  let cursor;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await notion.databases.query({ database_id, page_size: 100, start_cursor: cursor, ...extra });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}
