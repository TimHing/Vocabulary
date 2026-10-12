# Vocabulary 單詞學習

孩子（Hanna、Henness）的日常單詞積累網頁。單詞放在 Notion，按遺忘曲線安排 **Today**（今天新詞）與 **Review**（溫習），學習卡可發音、顯示答案，並標記 **Learn Next Time / Finished / Mastered**。

## 運作方式（與 SnakeG 同一套模式）

```
Notion ──(sync-notion, Actions 每小時)──▶ src/data/words.json ──▶ 靜態網頁（GitHub Pages + Firebase Hosting）
                                                                      │ 孩子點按鈕
Notion ◀──(push-notion, Actions 每小時)── Firestore vocab_students/{學生}/words/{單詞} (dirty:true) ◀┘
```

- 瀏覽器**不碰 Notion**，token 只在本機 `.env` / GitHub Secrets。
- 點按鈕 → 立即存 Firestore（畫面即時生效）；Actions 每小時把進度寫回 Notion，並重新讀取 Notion 的新單詞。**Notion 最多延遲約 1 小時**，新加的單詞也最多 1 小時後出現。

## 學習規則

| 項目 | 規則 |
|---|---|
| Today | Status=New 且 Learning Date ≤ 今天（或為空） |
| Review | Status=Learning 且（Defer 勾選 或 Next Review Date ≤ 今天）；沒點 Finished 就一直留著 |
| Today 點 Finished | Status=Learning、Review Times=0、明天複習 |
| Today 點 Learn Next Time | Status=Learning、Defer=true，一直留在 Review，直到點 Finished（不加分） |
| Review 點 Finished | Review Times+1，下次間隔 2、4、7、15、30 天（每次從完成當日起算，逾期不堆疊）；第 6 次溫習後 Status=Finished |
| Mastered | 按下前先確認；Status=Finished，退出 Today/Review，**不補分** |
| 分數 | 只有點 Finished 才加分：首次 +1、每次溫習 +1，每個單詞滿分 7。首頁「換算分數」= 累計分 ÷ (總詞數×7) ×100 |

Review Times 為空代表「從未 Finished 過」（0 分）。

## Notion 表結構

兩個學生的 Vocabulary Database 統一有：Word、Type、Pronunciation、Meaning、Collocation、Example、Synonyms、Antonyms、Understanding Test、Test Answer、Source、Status(New/Learning/Finished)、Learning Date、Review Times、Next Review Date、Last Review Date、Defer。`Learned?` 已不再使用（保留未刪）。

用 `npm run migrate:notion` 檢查（dry-run），`npm run migrate:notion -- --apply` 才真的新增缺少的欄位並把空的 Learning Date 補成今天。

## 本機開發

```bash
npm install
cp .env.example .env     # 填入 NOTION_TOKEN
npm run dev              # 先同步 Notion → words.json，再開 http://localhost:5174
npm test                 # 排程 / 計分單測
npm run push:notion      # 手動把 Firestore 進度推回 Notion
```

沒有 `NOTION_TOKEN` 時改用 `src/data/words.sample.json`。

## 部署（一次性設定）

1. 新建 GitHub repo，推上去，Settings → Pages 選 GitHub Actions。
2. Repo Secrets：`NOTION_TOKEN`、`NOTION_VOCAB_PAGE_ID`、`FIREBASE_SERVICE_ACCOUNT`（與 SnakeG 同一把即可）。
3. Firebase（專案 `snakegame-91f56`）：
   - 建立 Hosting site：`firebase hosting:sites:create snakegame-91f56-vocab`（名稱要與 `firebase.json` 的 `site` 一致，或改成你想要的）。
   - 部署 Firestore 規則：`firebase deploy --only firestore:rules`。**注意**規則是整個專案只有一份，本 repo 的 `firestore.rules` 已包含 SnakeG / tug-of-war 現有規則，部署前請先對照 `SnakeG/firestore.rules` 確認沒有後來新增的內容被漏掉。
4. 把 Vocabulary 父頁分享給 Notion integration（已與 SnakeG 同一個 integration 可讀）。
