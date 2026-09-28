# Player-Club Minecraft Website

[繁體中文](#繁體中文) | [English](#english)

---

## 繁體中文

Player Club 社群的 Minecraft 世界座標網站。集中存放各世界的村莊、要塞、基地等座標，方便朋友查詢、複製與提交。

網站：https://spacesquare640.github.io/Player-Club_Minecraft_Website/

> 網站建置中，尚未上線。

### 功能概要

| 功能 | 說明 |
| --- | --- |
| 世界資訊 | 世界名稱、遊戲版本、Seed 與世界出生座標置頂顯示，可一鍵複製 |
| 維度分頁 | 主世界、地獄、終界 |
| 座標卡片 | 名稱、標籤、X Y Z、說明、提交者、更新時間；一鍵複製「X Y Z」 |
| 搜尋與篩選 | 關鍵字搜尋與標籤篩選；畫面狀態寫入網址，可直接分享連結 |
| 多世界與多版本 | 支援多個世界及 Java 版、基岩版，由資料設定 |
| 雙語介面 | 繁體中文、英文 |
| 連線資訊 | Radmin VPN 網絡名稱；密碼不公開，請向創建者取得 |
| 社群入口 | Discord 社群邀請連結 |
| 變更紀錄 | 網站更新與座標更動紀錄 |

### 提交與修改座標

所有座標請求皆透過 GitHub Issue 表單提交，須經擁有者核准後才會寫入網站。表單將於網站上線時開放。

| 表單 | 用途 |
| --- | --- |
| 新增座標 / Add a point | 新增一筆座標 |
| 修改座標 / Edit a point | 修改既有座標（需座標 id） |
| 刪除座標 / Delete a point | 刪除既有座標（需座標 id） |
| 修改世界出生座標 / Edit world spawn | 修改世界出生座標（出生座標不可刪除） |

流程：

1. 從 [Issue 表單頁](https://github.com/SpaceSquare640/Player-Club_Minecraft_Website/issues/new/choose) 或網站的提交入口開啟表單。修改與刪除可從座標卡片的「⋯」選單開啟，座標 id 會自動帶入。
2. 送出後系統自動檢查格式並留言回報；若有錯誤，直接編輯 Issue 修正即會重新檢查。
3. 擁有者核准後，系統自動寫入資料、新增變更紀錄條目並更新網站，完成後留言附網站連結並關閉 Issue。網站可能需數分鐘才會顯示更新。
4. 擁有者未核准即關閉 Issue，表示不採用該請求。

注意事項：

- 一個 Issue 只處理一筆座標。
- Issue 內容公開，提交者的 GitHub 帳號會顯示於座標卡片。
- 核准後再編輯 Issue 內容，核准會被取消，需重新審核。

沒有 GitHub 帳號：請加入 [Discord 社群](https://discord.gg/aaUQVJeCgC)，告知擁有者後由擁有者代為登錄。

### 變更紀錄

本 repo 不另設變更紀錄檔。網站更新與座標更動統一記錄於網站的「變更紀錄」頁，分為「更新紀錄」與「座標更動」兩個子分頁；條目格式為「日期 - 變更描述 - 影響範圍」，日期以台北時間計。

### 專案結構（規劃中）

純靜態網站（HTML、CSS、JavaScript），不使用框架。座標等資料以 JSON 存放並與介面分離，每個資料檔皆帶 `schemaVersion`。GitHub Actions 負責驗證 Issue 請求、寫入資料與部署至 GitHub Pages。

```text
.github/        Issue 表單與 GitHub Actions workflows
site/           網站（GitHub Pages 根目錄）
  data/         世界、座標、標籤、變更紀錄等 JSON 資料
  i18n/         繁中、英文介面字典
schemas/v1/     JSON Schema
scripts/        資料驗證、Issue 處理與部署腳本（Node.js）
tests/          單元測試
```

### 開發

開發中。本機開發環境、指令與資料維護流程將於功能完成後補充。

### 授權

© 2026 Kingsley。保留所有權利（All rights reserved）。原始碼公開僅供參考；未經書面同意，不得複製、修改、散布或二次創作。第三方元件依其各自授權。詳見 [LICENSE](LICENSE)。

### 聲明

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
（非官方 Minecraft 產品，未經 Mojang 或 Microsoft 核准，亦與其無關。）

社群 Icon 中的第三方商標（如 Roblox、GTA、Rockstar）歸各自所有者所有。

---

## English

A Minecraft world coordinate website for the Player Club community. It keeps coordinates of villages, strongholds, bases and more in one place, so friends can look them up, copy them and submit new ones.

Website: https://spacesquare640.github.io/Player-Club_Minecraft_Website/

> Under construction. The website is not live yet.

### Features

| Feature | Description |
| --- | --- |
| World info | World name, game version, seed and world spawn pinned at the top, each with one-click copy |
| Dimension tabs | Overworld, The Nether, The End |
| Point cards | Name, tags, X Y Z, note, submitter and last update; one-click copy of "X Y Z" |
| Search and filter | Keyword search and tag filters; view state is stored in the URL for sharing |
| Worlds and editions | Multiple worlds, Java Edition and Bedrock Edition, configured by data |
| Bilingual UI | Traditional Chinese and English |
| Connection info | Radmin VPN network name; the password is not published, please ask the creator |
| Community | Discord community invite link |
| Change Log | Site updates and coordinate changes |

### Submitting and editing points

All coordinate requests are submitted through GitHub Issue forms and are applied only after the owner approves them. The forms will open when the website goes live.

| Form | Purpose |
| --- | --- |
| 新增座標 / Add a point | Add a new point |
| 修改座標 / Edit a point | Edit an existing point (point id required) |
| 刪除座標 / Delete a point | Delete an existing point (point id required) |
| 修改世界出生座標 / Edit world spawn | Edit the world spawn (the world spawn cannot be deleted) |

Process:

1. Open a form from the [Issue form page](https://github.com/SpaceSquare640/Player-Club_Minecraft_Website/issues/new/choose) or the submit entry on the website. Edit and delete requests can be opened from the "⋯" menu on a point card, with the point id filled in automatically.
2. After submission, the format is checked automatically and the result is posted as a comment. If there are errors, edit the issue to fix them and the check runs again.
3. Once the owner approves, the data is written, a Change Log entry is added and the website is updated. A comment with the website link is posted and the issue is closed. The website may take a few minutes to show the update.
4. If the owner closes the issue without approval, the request is declined.

Notes:

- One issue handles one point only.
- Issues are public, and the submitter's GitHub username is shown on the point card.
- Editing an issue after approval revokes the approval and requires a new review.

No GitHub account: join the [Discord community](https://discord.gg/aaUQVJeCgC) and tell the owner, who will add the point for you.

### Change Log

This repository does not keep a separate change log file. Site updates and coordinate changes are recorded on the website's "Change Log" page, which has two sub-tabs, "Updates" and "Coordinate changes". Entries follow the format "Date - Description - Scope", with dates in Taipei time.

### Project structure (planned)

A static website (HTML, CSS, JavaScript) with no framework. Coordinates and other data are stored as JSON, separated from the UI, and every data file carries a `schemaVersion`. GitHub Actions validates issue requests, writes data and deploys to GitHub Pages.

```text
.github/        Issue forms and GitHub Actions workflows
site/           Website (GitHub Pages root)
  data/         JSON data: worlds, points, tags, change log
  i18n/         Traditional Chinese and English UI dictionaries
schemas/v1/     JSON Schema
scripts/        Validation, issue processing and deployment scripts (Node.js)
tests/          Unit tests
```

### Development

In progress. Local setup, commands and the data maintenance workflow will be documented once the features are complete.

### License

© 2026 Kingsley. All rights reserved. The source code is publicly visible for reference only. Copying, modification, distribution or derivative works are not permitted without written permission. Third-party components remain under their own licenses. See [LICENSE](LICENSE).

### Disclaimer

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

Third-party trademarks in the community icon (such as Roblox, GTA and Rockstar) belong to their respective owners.
