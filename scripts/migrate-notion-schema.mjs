// 一次性（冪等）修正 Notion 單詞表結構：兩位學生的 Vocabulary Database 統一加上
//   Learning Date（date）／Next Review Date（date）／Defer（checkbox）
//   Quiz Correct／Quiz Wrong（number，小測累計答對/答錯次數）／Last Quiz Date（date）
//   Points（number，累計分；空的會用舊公式 1 + Review Times 初始化，保留孩子已賺到的分數）
// 並把 Learning Date 為空的單詞從今天起每天 5 個錯開。Review Times 沿用現有欄位，Learned? 暫不刪除。
//
// 預設 dry-run，只印出會做的事；加 --apply 才真的寫入：
//   node scripts/migrate-notion-schema.mjs           # dry-run
//   node scripts/migrate-notion-schema.mjs --apply
import 'dotenv/config';
import {
  createClient, extractId, findStudentDatabases, queryAll, localToday, sleep, getDate, getNumber,
} from './notion-lib.mjs';

const APPLY = process.argv.includes('--apply');
const THROTTLE_MS = 350;
const PER_DAY = 5; // 每天最多幾個新詞

const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localToday(new Date(y, m - 1, d + n, 12));
};

const NEW_PROPS = {
  'Learning Date': { date: {} },
  'Next Review Date': { date: {} },
  Defer: { checkbox: {} },
  'Quiz Correct': { number: { format: 'number' } },
  'Quiz Wrong': { number: { format: 'number' } },
  'Last Quiz Date': { date: {} },
  Points: { number: { format: 'number' } }, // 累計分（取代舊的由 Review Times 推算的分數）
};

async function main() {
  if (!process.env.NOTION_TOKEN) throw new Error('沒有設定 NOTION_TOKEN');
  const parentId = extractId(process.env.NOTION_VOCAB_PAGE_ID);
  if (!parentId) throw new Error('NOTION_VOCAB_PAGE_ID 無效');

  const notion = createClient();
  const today = localToday();
  console.log(APPLY ? '== 套用模式 ==' : '== dry-run（加 --apply 才會寫入）==');

  const students = await findStudentDatabases(notion, parentId);
  if (!students.length) throw new Error('找不到任何學生資料庫');

  for (const student of students) {
    console.log(`\n[${student.name}] 資料庫 ${student.databaseId}`);
    // eslint-disable-next-line no-await-in-loop
    const db = await notion.databases.retrieve({ database_id: student.databaseId });

    const missing = Object.entries(NEW_PROPS).filter(([name]) => !db.properties[name]);
    if (missing.length) {
      console.log(`  新增欄位：${missing.map(([n]) => n).join('、')}`);
      if (APPLY) {
        // eslint-disable-next-line no-await-in-loop
        await notion.databases.update({
          database_id: student.databaseId,
          properties: Object.fromEntries(missing),
        });
      }
    } else {
      console.log('  欄位已齊全');
    }

    // Learning Date 為空 → 從今天起每天 PER_DAY 個錯開（已有日期的單詞不動，並計入當天數量）。
    // 欄位剛新增時 dry-run 沒有欄位可查，視為全部為空。
    // eslint-disable-next-line no-await-in-loop
    const pages = await queryAll(notion, student.databaseId);
    pages.sort((a, b) => a.created_time.localeCompare(b.created_time));
    const perDay = new Map();
    for (const p of pages) {
      const d = getDate(p.properties['Learning Date']);
      if (d) perDay.set(d, (perDay.get(d) || 0) + 1);
    }
    const plan = [];
    let day = today;
    for (const page of pages.filter((p) => !getDate(p.properties['Learning Date']))) {
      while ((perDay.get(day) || 0) >= PER_DAY) day = addDays(day, 1);
      plan.push({ page, date: day });
      perDay.set(day, (perDay.get(day) || 0) + 1);
    }
    const spread = [...new Set(plan.map((x) => x.date))].map((d) => `${d}×${plan.filter((x) => x.date === d).length}`);
    console.log(`  共 ${pages.length} 個單詞，Learning Date 為空：${plan.length} 個 → 每天最多 ${PER_DAY} 個錯開`);
    if (plan.length) console.log(`  分配：${spread.join('、')}`);
    if (APPLY) {
      for (const { page, date } of plan) {
        // eslint-disable-next-line no-await-in-loop
        await notion.pages.update({
          page_id: page.id,
          properties: { 'Learning Date': { date: { start: date } } },
        });
        // eslint-disable-next-line no-await-in-loop
        await sleep(THROTTLE_MS);
      }
    }

    // Points 為空 → 用舊公式（從沒 Finished 過 0 分，否則 1 + Review Times）初始化，保留孩子已賺到的分數。
    // 已經有 Points 的不動（冪等）。欄位剛新增時 dry-run 沒有欄位可查，視為全部為空。
    const needPoints = pages.filter((p) => getNumber(p.properties.Points) == null);
    const initial = (p) => {
      const rt = getNumber(p.properties['Review Times']);
      return rt == null ? 0 : 1 + rt;
    };
    const total = needPoints.reduce((sum, p) => sum + initial(p), 0);
    console.log(`  Points 為空：${needPoints.length} 個 → 以舊公式初始化（合計 ${total} 分）`);
    if (APPLY) {
      for (const page of needPoints) {
        // eslint-disable-next-line no-await-in-loop
        await notion.pages.update({
          page_id: page.id,
          properties: { Points: { number: initial(page) } },
        });
        // eslint-disable-next-line no-await-in-loop
        await sleep(THROTTLE_MS);
      }
    }
  }
  console.log(APPLY ? '\n完成。' : '\ndry-run 結束，沒有寫入任何東西。');
}

main().catch((err) => {
  console.error(err.body || err);
  process.exit(1);
});
