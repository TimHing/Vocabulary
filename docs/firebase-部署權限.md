# Firebase 部署權限與 firebase-tools 版本

> 這份文檔是給**之後想把 firebase-tools 升回最新版**的時候用的。照著做就行，不需要再問人。
> 目前網站完全正常，不做這件事也沒關係（見「不做會怎樣」）。

## 一、現況

- GitHub Actions 每小時會把網站部署到兩個地方：**GitHub Pages** 和 **Firebase Hosting**（`https://snakegame-91f56-vocab.web.app`）。
- Firebase 這一段由 `FirebaseExtended/action-hosting-deploy` 執行，內部用 `firebase-tools` 這個工具。
- 2026-10-21 起 `firebase-tools 15.34.1` 在部署前多了一個檢查，需要服務帳戶有 `serviceusage.services.get` 權限。我們用的服務帳戶沒有，所以部署回傳 **403**，Firebase 站點停止更新（GitHub Pages 不受影響，孩子的學習進度也不受影響，進度存在 Firestore）。
- **目前的處理**：在 [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) 把版本固定在最後一次成功的 `15.34.0`：

  ```yaml
  firebaseToolsVersion: 15.34.0
  ```

### 失敗時的樣子（用來認出同一個問題）

Actions 裡 `deploy-firebase` 變紅，日誌最後出現：

```
HTTP Error: 403, Permission denied to get service [firebasehosting.googleapis.com]
"permission": "serviceusage.services.get"
```

### 不做會怎樣

不用做任何事，網站照常運作。風險只有一個：固定在舊版本，哪天 Google 的服務改版讓 15.34.0 不能用了，Firebase 站點會再次停止更新。到時再回來做這份文檔就好。

---

## 二、要做什麼（三步）

1. 在 Google Cloud 給 CI 用的服務帳戶加上 **Service Usage Consumer** 角色。
2. 把 `deploy.yml` 的版本固定拿掉（改回 `latest`）。
3. 到 GitHub Actions 看一次部署是否全綠；失敗就退回舊版本。

預計 10 分鐘。需要用**這個 Firebase 專案的擁有者（Owner）帳戶**登入 Google（你自己的 `timhingwong@gmail.com`）。

---

## 三、詳細步驟

### 步驟 1：確認是哪個服務帳戶

CI 部署用的是 GitHub 的 Secret `FIREBASE_SERVICE_ACCOUNT`，裡面是服務帳戶的私密金鑰。要加角色的就是這把金鑰所屬的服務帳戶。

按照當初的做法（Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰），這個帳戶應該是：

```
firebase-adminsdk-fbsvc@snakegame-91f56.iam.gserviceaccount.com
```

**怎麼確認**（任選一個）：
- 如果還留著當初下載的金鑰檔 `snakegame-91f56-firebase-adminsdk-fbsvc-xxxx.json`，用記事本打開，找 `"client_email"` 那一行，後面就是服務帳戶的完整郵件地址。**只看這一行，不要把檔案內容貼給任何人。**
- 打開 <https://console.cloud.google.com/iam-admin/serviceaccounts?project=snakegame-91f56>，列表裡找名稱以 `firebase-adminsdk` 開頭的那一個，複製它的「電子郵件」欄。如果列表裡有好幾個，用上面第一種方式確認。

> 如果你當初用的是別的服務帳戶，以金鑰檔裡的 `client_email` 為準。

### 步驟 2：給這個服務帳戶加角色

1. 打開 IAM 頁面：<https://console.cloud.google.com/iam-admin/iam?project=snakegame-91f56>
   （左上角專案名稱要顯示 `snakegame-91f56`，不是的話點它切換。）
2. 在列表上方的篩選框貼上步驟 1 的郵件地址（或輸入 `firebase-adminsdk`），找到那一列。
3. 點該列最右邊的**鉛筆圖示**（英文介面：*Edit principal*）。
4. 在右邊展開的面板點 **新增其他角色**（*Add another role*）。
5. 在「選取角色」框輸入 `Service Usage Consumer`，選中它（英文名稱完全一樣；角色 ID 是 `roles/serviceusage.serviceUsageConsumer`）。
6. 按 **儲存**（*Save*）。

完成後，該服務帳戶那一列的角色清單裡會多出 **Service Usage Consumer**。

> 這個角色包含三個權限：`serviceusage.services.get`（這次缺的）、`list`、`use`。
> 想要更小的權限，也可以改選 **Service Usage Viewer**（只有 `get` 和 `list`，沒有 `use`）。如果選 Viewer 之後部署仍然 403，再改成 Consumer。
>
> 權限變更需要等 **2～7 分鐘** 才會完全生效，剛按完儲存就測試可能還是失敗。

### 步驟 3：把 workflow 的版本固定拿掉

在 `.github/workflows/deploy.yml` 找到這一段（在檔案最下面，`deploy-firebase` 工作裡）：

```yaml
          # 固定 firebase-tools 版本，不要用 latest：15.34.1（2026-10-21）起部署前會多檢查
          # serviceusage.services.get 權限，目前的服務帳戶沒有，會 403。15.34.0 是最後一次成功的版本。
          # 之後若要升級，先給服務帳戶 Service Usage Consumer 角色，再改這個版本號。
          firebaseToolsVersion: 15.34.0
```

把這四行**整段刪掉**（不寫就等於 `latest`）。

做法（任選一個）：
- **網頁直接改**：打開 <https://github.com/TimHing/Vocabulary/blob/main/.github/workflows/deploy.yml> → 右上角鉛筆圖示 → 刪掉上面四行 → 右上角綠色按鈕 **Commit changes** → 再按 **Commit changes**。
- **或者請 Claude 改**：說「把 deploy.yml 的 firebase-tools 版本固定拿掉並推送」。

### 步驟 4：確認結果

1. 提交後會自動開始一次部署。打開 <https://github.com/TimHing/Vocabulary/actions>，點最新那一筆。
2. 等 3～5 分鐘，左邊三個工作 **build**、**deploy-pages**、**deploy-firebase** 都要是綠色勾。
3. 在 `deploy-firebase` 裡展開 `Run FirebaseExtended/action-hosting-deploy@v0`，應該看到 `firebaseToolsVersion: latest`，且沒有 403。

### 步驟 5：如果還是失敗 → 退回

1. 看 `deploy-firebase` 日誌最後的錯誤。如果是**同樣的 403 `serviceusage.services.get`**：通常是權限還沒生效，等 5 分鐘後到 Actions 頁面右上角按 **Re-run failed jobs**。
2. 還是不行，就**退回舊版本**：把這四行加回 `deploy.yml`，網站會回到目前的正常狀態：

   ```yaml
          firebaseToolsVersion: 15.34.0
   ```

---

## 四、疑難排解

| 狀況 | 做法 |
|---|---|
| 錯誤變成別的權限，例如 `permission=firebasehosting.sites.update` 或其他 `xxx.yyy.zzz` | 日誌裡 `"permission":` 後面就是缺的權限。到 <https://docs.cloud.google.com/iam/docs/roles-permissions> 搜尋這個權限名稱，找到包含它的最小角色，照步驟 2 加上去 |
| IAM 頁面沒有「編輯」的鉛筆圖示 | 目前登入的 Google 帳戶不是專案擁有者。改用 `timhingwong@gmail.com` 登入 |
| 找不到那個服務帳戶 | 先確認左上角專案是 `snakegame-91f56`；再到 <https://console.cloud.google.com/iam-admin/serviceaccounts?project=snakegame-91f56> 看列表 |
| 想換一把新金鑰（舊金鑰外洩或要輪替） | Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰 → 把整份 JSON 貼進 GitHub → Settings → Secrets and variables → Actions → `FIREBASE_SERVICE_ACCOUNT` → Update secret；完成後到 Google Cloud 的服務帳戶頁刪掉舊金鑰 |
| 不確定現在 Firebase 站點是不是最新 | 打開 <https://snakegame-91f56-vocab.web.app>，和 <https://timhing.github.io/Vocabulary/> 比較，兩邊內容應該一樣 |

## 五、安全提醒

- 服務帳戶金鑰檔（`*-firebase-adminsdk-*.json`）等於這個帳戶的密碼。**不要提交到 git、不要貼到聊天或文件**。專案的 `.gitignore` 已經擋住它，但還是請在 Secret 設好後把檔案從資料夾刪掉。
- 這個帳戶是 Firebase 的 Admin SDK 帳戶，權限本來就不小。上面加的 Service Usage 角色只是讓它「查看／使用服務」，沒有增加新的管理能力，但仍然不要隨意分享。
