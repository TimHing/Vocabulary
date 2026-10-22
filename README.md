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
| Mastered | 通過 3 題小測後：Status=Finished，退出 Today/Review |

Review Times 為空代表「從未 Finished 過」。

## 分數（純累計）

分數是**事件累計制**，存在每個單詞的 Notion `Points` 欄位，首頁顯示兩位學生各自所有單詞 Points 的總和（總分不會低於 0）。**不跟單詞總數掛鉤**，沒有滿分也沒有百分比，所以新增單詞不會讓分數變動。

| 事件 | 分數 |
|---|---|
| 輸入題（聽寫／看意思拼詞／例句填空／理解測試）答對 | +1 |
| 完成一次 Finished（第一次學完） | +1 |
| 完成一次 Review（每次溫習） | +1 |
| 完成 Mastered | +2 |
| 選擇題答錯（每錯一次） | −1 |

例：Today 新詞第一次學完（聽寫答對）= +1 + 1 = **+2**；溫習第 2 次（聽寫答對）= +1 + 1 = **+2**；溫習第 1 次（選擇題答對）= **+1**；Mastered 3 題全對 = 2 + 3 = **+5**。選擇題答對、輸入題答錯、Learn Next Time 都不加不扣。Mastered 要 3 題全對才一次給分，中途答錯一分不給。通過頁會顯示「本次獲得 +N 分」。

既有分數：沒有 `Points` 的單詞用舊公式（從沒 Finished 過 0 分，否則 1 + Review Times）當起始值，遷移腳本會把它寫進 Notion，孩子已賺到的分數不會消失。

## 小測（考核與練習）

Finished 和 Mastered 都要先通過小測，答對才寫入進度；答錯不寫入，單詞留在原處。題目全部用現有欄位產生。

**錄入題**＝要自己把單詞輸入的題型（聽寫、看意思拼詞、例句填空、理解測試），相對於選擇題。**聽寫**：進入小測時自動讀兩次單詞（中間停頓約 1 秒），孩子聽完輸入，也可按 🔊 再聽。

| 情境 | 小測 |
|---|---|
| 單詞第一次點 Finished（含 Learn Next Time 之後的第一次） | 1 題**錄入題**（聽寫，進入時自動讀兩次單詞）；不能聽寫的裝置退回看意思拼詞。答對才進入 Learning |
| Review 第 1 次 | 選擇題（進入時自動讀兩次題目單詞） |
| Review **第 2 次、第 6 次** | **錄入題**（聽寫，自動讀兩次） |
| Review 第 3、4 次 | 看意思拼詞／例句填空／理解測試，隨機 |
| Review 第 5 次 | 聽寫／看意思拼詞／例句填空，隨機 |
| 點 Mastered | 3 題不同題型（不含選擇題、不給提示），**全對**才標 Finished，否則單詞照原排程 |
| Learn Next Time | 不出題 |

拼寫忽略大小寫和多餘空格，錯一個字母算錯。缺資料的單詞會自動換別的題型；完全沒有可出的題目時，讓孩子直接完成，不卡住。拼寫類題型（看意思拼詞、例句填空、理解測試）不會自動讀單詞，免得洩漏答案。出題與計分邏輯在 `src/quiz.js`（`pickLearnType`、`pickReviewType`、`passPoints`、`wrongPenalty`）與 `src/scheduler.js`（`wordPoints`、`studentStats`），都有單測，頁面在 `src/pages/quiz.js`。

**Review 跳過學習卡**：Finished 過至少一次的 Review 單詞（Review Times 不為空），在清單裡標示「直接小測」，點進去直接是小測，看不到答案，避免照抄；答錯後的結果頁才提供「回學習卡再看看」。從沒 Finished 過的（例如 Today 點了 Learn Next Time 的新詞）還沒學會，仍先看學習卡。小測頁底部有「挑戰 Mastered 小測」入口。判斷在 `canQuizDirectly`（`src/scheduler.js`）。

**Mastered 冷卻**：Mastered 小測答錯**任何一題**就立刻開始冷卻 10 分鐘（中途離開也逃不掉）。冷卻期間學習卡上的 Mastered 按鈕停用並顯示剩餘分鐘，直接開網址也會被擋。冷卻時間戳存在 Firestore 的 `masteredFailAt`（換裝置也有效，不寫回 Notion）。長度由 `MASTERED_COOLDOWN_MS`（`src/scheduler.js`）決定。

## Notion 表結構

兩個學生的 Vocabulary Database 統一有：Word、Type、Pronunciation、Meaning、Collocation、Example、Synonyms、Antonyms、Understanding Test、Test Answer、Source、Status(New/Learning/Finished)、Learning Date、Review Times、Next Review Date、Last Review Date、Defer，以及小測記錄 Quiz Correct、Quiz Wrong、Last Quiz Date，和累計分 Points。`Learned?` 已不再使用（保留未刪）。

**小測記錄**（給家長在 Notion 看，網頁上不顯示）：孩子每答一題（Today / Review / Mastered 的每一題，答對答錯都算）就累計一次到該單詞的 Quiz Correct 或 Quiz Wrong，並更新 Last Quiz Date。在 Notion 資料庫按 Quiz Wrong 由大到小排序，就能找出常錯的詞；Last Quiz Date 可看孩子最近有沒有在練。和學習進度一樣先存 Firestore，每小時由 Actions 寫回 Notion。

用 `npm run migrate:notion` 檢查（dry-run），`npm run migrate:notion -- --apply` 才真的新增缺少的欄位、把空的 Learning Date 錯開補上，並用舊公式初始化空的 Points。可重複執行（冪等）。

## 部署權限與 firebase-tools 版本

Firebase 部署固定使用 `firebase-tools 15.34.0`（新版需要服務帳戶多一個 Service Usage 權限，否則 403）。想升級回最新版時，照 [docs/firebase-部署權限.md](docs/firebase-部署權限.md) 的步驟做即可。

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
