// 把 Firestore 裡「尚未同步」（dirty:true）的學習進度寫回 Notion，成功後標記 dirty:false。
// 讀 Firestore 沿用 SnakeG 的完全開放規則（不需密鑰）；只寫 Notion 的
// Status／Review Times／Next Review Date／Last Review Date／Defer（學習進度）與
// Quiz Correct／Quiz Wrong／Last Quiz Date（小測記錄）欄位。
// 只在本機手動或 GitHub Actions 排程裡跑。
import 'dotenv/config';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, query, where, getDocs, runTransaction,
} from 'firebase/firestore';
import { firebaseConfig } from '../src/firebaseConfig.js';
import {
  createClient, extractId, findStudentDatabases, sleep, toNotionProperties,
} from './notion-lib.mjs';

const THROTTLE_MS = 350; // Notion 速率限制約每秒 3 次

async function main() {
  if (!process.env.NOTION_TOKEN) {
    console.warn('[push-notion] 沒有設定 NOTION_TOKEN，略過。');
    return;
  }
  const parentId = extractId(process.env.NOTION_VOCAB_PAGE_ID);
  if (!parentId) throw new Error('NOTION_VOCAB_PAGE_ID 未設定或無效');

  const notion = createClient();
  const db = getFirestore(initializeApp(firebaseConfig, 'push-notion'));
  const students = await findStudentDatabases(notion, parentId);

  let pushed = 0;
  let failed = 0;
  for (const s of students) {
    // eslint-disable-next-line no-await-in-loop
    const snap = await getDocs(query(
      collection(db, 'vocab_students', s.id, 'words'),
      where('dirty', '==', true),
    ));
    for (const d of snap.docs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await notion.pages.update({ page_id: d.id, properties: toNotionProperties(d.data()) });
        // eslint-disable-next-line no-await-in-loop
        // 推送期間若孩子又答題（updatedAt 變了）就維持 dirty，留給下一輪，避免漏掉新的記錄
        await runTransaction(db, async (tx) => {
          const cur = await tx.get(d.ref);
          if (cur.data()?.updatedAt?.toMillis?.() === d.data().updatedAt?.toMillis?.()) {
            tx.update(d.ref, { dirty: false, progressDirty: false });
          }
        });
        pushed += 1;
      } catch (err) {
        failed += 1;
        console.error(`[push-notion] ${s.name}/${d.id} 失敗（保持 dirty，下次再試）：`, err.body || err.message);
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(THROTTLE_MS);
    }
  }
  console.log(`[push-notion] 已推回 ${pushed} 筆，失敗 ${failed} 筆。`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.body || err);
  process.exit(1);
});
