# Player-Club Minecraft Website

[English](#english) | [繁體中文](#繁體中文)

---

## English

A Minecraft world coordinate website for the Player Club community. It keeps coordinates of villages, strongholds, bases and more in one place, so friends can look them up, copy them and submit new ones.

Website: https://spacesquare640.github.io/Player-Club_Minecraft_Website/

### Features

| Feature | Description |
| --- | --- |
| World info | World name, game version, seed and world spawn pinned at the top, each with one-click copy; world type and respawn radius when set |
| Dimension tabs | Overworld, The Nether, The End |
| Point cards | Name, tags, X Y Z, note, submitter and last update; one-click copy of "X Y Z" |
| Search and filter | Keyword search and tag filters; view state is stored in the URL for sharing |
| Worlds and editions | Multiple worlds, Java Edition and Bedrock Edition, configured by data |
| Bilingual UI | English and Traditional Chinese (English by default) |
| Connection info | Radmin VPN network name; the password is not published, please ask the creator |
| Community | Discord community invite link |
| Change Log | Site updates and coordinate changes |

### Submitting and editing points

All coordinate requests are submitted through GitHub Issue forms and are applied only after the owner approves them.

| Form | Purpose |
| --- | --- |
| Add a point / 新增座標 | Add a new point |
| Edit a point / 修改座標 | Edit an existing point (point id required) |
| Delete a point / 刪除座標 | Delete an existing point (point id required) |
| Edit world spawn / 修改世界出生座標 | Edit the world spawn (the world spawn cannot be deleted) |

Process:

1. Open a form from the [Issue form page](https://github.com/SpaceSquare640/Player-Club_Minecraft_Website/issues/new/choose) or the submit entry on the website. Edit and delete requests can be opened from the "⋯" menu on a point card, with the point id filled in automatically.
2. After submission, the format is checked automatically and the result is posted as a comment. If there are errors, edit the issue to fix them and the check runs again.
3. Once the owner approves the request by adding the `approved` label, the data is written, a Change Log entry is added and the website is updated. A comment with the website link is posted and the issue is closed only after the website update is complete. The website may take a few minutes to show the update. If publishing is cancelled or fails, the issue stays open until the next run completes.
4. If the owner closes the issue without approval, the request is declined.

Notes:

- One issue handles one point only.
- Issues are public, and the submitter's GitHub username is shown on the point card.
- Editing an issue after approval revokes the approval and requires a new review.
- To rename a point, use Edit a point and fill in only the Name.

No GitHub account: join the [Discord community](https://discord.gg/aaUQVJeCgC) and tell the owner, who will add the point for you.

### Change Log

This repository does not keep a separate change log file. Site updates and coordinate changes are recorded on the website's "Change Log" page, which has two sub-tabs, "Updates" and "Coordinate changes". Entries follow the format "Date - Description - Scope", with dates in Taipei time.

### Project structure

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

#### Requirements

- Node.js 22 or later
- npm (bundled with Node.js)

The website is plain HTML, CSS and JavaScript with no build step. Node.js is used only for local preview, data validation, tests and the maintenance scripts. The only direct dependencies are `ajv` and `ajv-formats` (dev dependencies, locked in `package-lock.json`).

#### Setup

```bash
git clone https://github.com/SpaceSquare640/Player-Club_Minecraft_Website.git
cd Player-Club_Minecraft_Website
npm ci
```

#### Local preview

```bash
npm run serve
```

Open http://127.0.0.1:5173/. The preview server binds to 127.0.0.1 only and serves the files inside `site/`. Use `npm run serve -- --port <port>` to change the port.

#### Commands

| Command | Description |
| --- | --- |
| `npm run check` | Full check before pushing: data validation (JSON Schema and cross rules, including the id sequence check against `origin/Source_Code` and change log coverage for manual edits), Issue form consistency and unit tests |
| `npm run check:ci` | Data validation and unit tests only; run by the publish workflow before deployment |
| `npm run validate` | Data validation only |
| `npm run format` | Rewrites data and dictionary files in canonical format, then validates |
| `npm test` | Unit tests only |
| `npm run new-id -- point` | Allocates the next id and records it in `site/data/manifest.json`; kinds are `point`, `change` and `update`; add `--dry-run` to preview |
| `npm run changelog:sync` | Compares the working tree with `HEAD`, adds "Coordinate changes" entries for edited points and world spawns, and fills point timestamps |
| `npm run changelog:update` | Adds a bilingual "Updates" entry, asked interactively or passed as options |
| `npm run gen:forms` | Regenerates the Issue forms in `.github/ISSUE_TEMPLATE` from worlds, tags, dictionaries and config; the publish workflow also regenerates them after a push when they are out of date |
| `npm run serve` | Local preview |

`changelog:update` accepts all values as options:

```bash
npm run changelog:update -- --summary-en "..." --summary-zh "..." --scope-en "..." --scope-zh "..." [--date YYYY-MM-DD] [--dry-run]
```

Change log text is public. Do not include internal notes or local paths. The script rejects text that matches known patterns (such as tool names, note-related words, and Windows and home directory paths), but it cannot catch all internal information, so check the text yourself before pushing.

#### Owner data maintenance

The owner edits the JSON data directly and pushes to `Source_Code` without a pull request.

1. Run `git pull` so the id sequences are up to date, including requests already written by the bot.
2. For a new point, run `npm run new-id -- point` to allocate its id.
3. Edit the files under `site/data/`. Points are stored per world in `site/data/points/<worldId>.json`. Timestamps of a new point can be left as empty strings.
4. Record the change:
   - Point or world spawn changes: `npm run changelog:sync` adds the "Coordinate changes" entries and fills the timestamps.
   - Site or feature changes, seed changes and new worlds: `npm run changelog:update`.
   - Changes to worlds, tags or dictionaries: also run `npm run gen:forms`.
     - If the forms-check job of the publish workflow fails because the encoded forms patch is over the size limit (about 75 KB of changes), run `npm run gen:forms` locally and push the result.
5. Run `npm run check` and make sure it passes.
6. Commit and push to `Source_Code`. The publish workflow then runs `npm run check:ci`, regenerates the Issue forms when needed and deploys the website. If validation fails, nothing is deployed and the website keeps the previous version; fix the problem and push again.

Mistakes are undone with `git revert`; history is never rewritten with a force push. If a revert lowers an id sequence in `site/data/manifest.json`, `npm run check` rejects it. Set the sequence back to the higher value before pushing, so that no id is ever reused. Deleting a world or tag fails validation while any point still references it.

#### Issue workflow

Coordinate requests submitted through the Issue forms are handled by GitHub Actions.

| Stage | Description |
| --- | --- |
| Validation | Runs when an open issue with the `coord-request` label is opened, edited or reopened. The request is checked and a single report comment is posted or updated. A passing request gets `pending-review`, a failing one gets `needs-fix`. Editing an issue runs the check again and removes `approved`. |
| Approval and write | The owner adds the `approved` label. The data and a change log entry are written and committed by `github-actions[bot]`. A daily scheduled run and manual runs also pick up approved issues that are still open. |
| Deployment | The website is deployed to GitHub Pages; deployments are queued and run in order. Once the update is live, a comment with the website link is posted, the issue is labelled `applied` and closed. If the deployment is cancelled or fails, the issue stays open and keeps `approved`, so the next run deploys again and closes it; a failed deployment also adds `deploy-failed`. |

The validation script can be run locally against a saved event file without calling the GitHub API:

```bash
node scripts/validate-issue.mjs --event <event.json> --dry-run
```

### License

© 2026 Kingsley. All rights reserved. The source code is publicly visible for reference only. Copying, modification, distribution or derivative works are not permitted without written permission. Third-party components remain under their own licenses. See [LICENSE](LICENSE).

### Disclaimer

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

Third-party trademarks in the community icon (such as Roblox, GTA and Rockstar) belong to their respective owners.


---

## 繁體中文

Player Club 社群的 Minecraft 世界座標網站。集中存放各世界的村莊、要塞、基地等座標，方便朋友查詢、複製與提交。

網站：https://spacesquare640.github.io/Player-Club_Minecraft_Website/

### 功能概要

| 功能 | 說明 |
| --- | --- |
| 世界資訊 | 世界名稱、遊戲版本、Seed 與世界出生座標置頂顯示，可一鍵複製；世界類型與重生半徑（有設定時） |
| 維度分頁 | 主世界、地獄、終界 |
| 座標卡片 | 名稱、標籤、X Y Z、說明、提交者、更新時間；一鍵複製「X Y Z」 |
| 搜尋與篩選 | 關鍵字搜尋與標籤篩選；畫面狀態寫入網址，可直接分享連結 |
| 多世界與多版本 | 支援多個世界及 Java 版、基岩版，由資料設定 |
| 雙語介面 | 英文、繁體中文（預設英文） |
| 連線資訊 | Radmin VPN 網絡名稱；密碼不公開，請向創建者取得 |
| 社群入口 | Discord 社群邀請連結 |
| 變更紀錄 | 網站更新與座標更動紀錄 |

### 提交與修改座標

所有座標請求皆透過 GitHub Issue 表單提交，須經擁有者核准後才會寫入網站。

| 表單 | 用途 |
| --- | --- |
| 新增座標 / Add a point | 新增一筆座標 |
| 修改座標 / Edit a point | 修改既有座標（需座標 id） |
| 刪除座標 / Delete a point | 刪除既有座標（需座標 id） |
| 修改世界出生座標 / Edit world spawn | 修改世界出生座標（出生座標不可刪除） |

流程：

1. 從 [Issue 表單頁](https://github.com/SpaceSquare640/Player-Club_Minecraft_Website/issues/new/choose) 或網站的提交入口開啟表單。修改與刪除可從座標卡片的「⋯」選單開啟，座標 id 會自動帶入。
2. 送出後系統自動檢查格式並留言回報；若有錯誤，直接編輯 Issue 修正即會重新檢查。
3. 擁有者加上 `approved` 標籤核准後，系統自動寫入資料、新增變更紀錄條目並更新網站；網站更新完成後才留言附網站連結並關閉 Issue。網站可能需數分鐘才會顯示更新。發布取消或失敗時，Issue 會保留開啟，直到下次執行完成。
4. 擁有者未核准即關閉 Issue，表示不採用該請求。

注意事項：

- 一個 Issue 只處理一筆座標。
- Issue 內容公開，提交者的 GitHub 帳號會顯示於座標卡片。
- 核准後再編輯 Issue 內容，核准會被取消，需重新審核。
- 座標改名請使用修改座標表單，只填名稱。

沒有 GitHub 帳號：請加入 [Discord 社群](https://discord.gg/aaUQVJeCgC)，告知擁有者後由擁有者代為登錄。

### 變更紀錄

本 repo 不另設變更紀錄檔。網站更新與座標更動統一記錄於網站的「變更紀錄」頁，分為「更新紀錄」與「座標更動」兩個子分頁；條目格式為「日期 - 變更描述 - 影響範圍」，日期以台北時間計。

### 專案結構

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

#### 環境需求

- Node.js 22 以上
- npm（隨 Node.js 安裝）

網站為純 HTML、CSS、JavaScript，無建置步驟。Node.js 僅用於本機預覽、資料驗證、測試與維護腳本。直接依賴只有 `ajv` 與 `ajv-formats`（devDependencies，版本鎖定於 `package-lock.json`）。

#### 安裝

```bash
git clone https://github.com/SpaceSquare640/Player-Club_Minecraft_Website.git
cd Player-Club_Minecraft_Website
npm ci
```

#### 本機預覽

```bash
npm run serve
```

開啟 http://127.0.0.1:5173/。預覽伺服器只綁定 127.0.0.1，只提供 `site/` 內的檔案。可用 `npm run serve -- --port <port>` 更換連接埠。

#### 指令

| 指令 | 說明 |
| --- | --- |
| `npm run check` | 推送前的完整檢查：資料驗證（JSON Schema 與交叉規則，含對 `origin/Source_Code` 的 id 序號檢查、手改資料的變更紀錄覆蓋檢查）、Issue 表單一致性、單元測試 |
| `npm run check:ci` | 只跑資料驗證與單元測試；由 publish workflow 於部署前執行 |
| `npm run validate` | 只跑資料驗證 |
| `npm run format` | 將資料與字典檔改寫為標準格式後再驗證 |
| `npm test` | 只跑單元測試 |
| `npm run new-id -- point` | 取下一個 id 並寫入 `site/data/manifest.json`；類型為 `point`、`change`、`update`；加 `--dry-run` 可預覽 |
| `npm run changelog:sync` | 比對工作目錄與 `HEAD`，為修改過的座標與世界出生座標補「座標更動」條目，並補上座標時間戳 |
| `npm run changelog:update` | 新增雙語「更新紀錄」條目，可互動輸入或以參數傳入 |
| `npm run gen:forms` | 依世界、標籤、字典與設定重新產生 `.github/ISSUE_TEMPLATE` 內的 Issue 表單；推送後若表單過期，publish workflow 亦會自動重產 |
| `npm run serve` | 本機預覽 |

`changelog:update` 可全部以參數傳入：

```bash
npm run changelog:update -- --summary-en "..." --summary-zh "..." --scope-en "..." --scope-zh "..." [--date YYYY-MM-DD] [--dry-run]
```

變更紀錄內容會公開，不得包含內部筆記或本機路徑。腳本會拒絕符合已知樣式的文字（例如工具名稱、筆記相關字詞、Windows 與家目錄路徑），但無法攔下所有內部資訊，推送前仍需自行檢查。

#### 擁有者資料維護

擁有者直接編輯 JSON 資料，並直接推送至 `Source_Code`，不經 Pull Request。

1. 先 `git pull`，確保 id 序號為最新（含 bot 已寫入的請求）。
2. 新增座標時，先執行 `npm run new-id -- point` 取得 id。
3. 編輯 `site/data/` 下的檔案。座標依世界存放於 `site/data/points/<worldId>.json`；新座標的時間戳可留空字串。
4. 補變更紀錄：
   - 座標或世界出生座標變更：`npm run changelog:sync` 會補「座標更動」條目與時間戳。
   - 網站或功能變更、seed 變更、新增世界：`npm run changelog:update`。
   - 世界、標籤或字典變更：另執行 `npm run gen:forms`。
     - 若 publish workflow 的 forms-check 因表單差異過大（編碼後超過上限，約 75 KB）而失敗：在本機執行 `npm run gen:forms` 後推送結果。
5. 執行 `npm run check`，確認全數通過。
6. commit 後推送至 `Source_Code`。推送後由 publish workflow 執行 `npm run check:ci`、必要時重產 Issue 表單並部署網站；驗證失敗時不會部署，網站維持上一版，修正後再推送即可。

改錯時一律以 `git revert` 回溯，不以 force push 改寫歷史。若 revert 使 `site/data/manifest.json` 的 id 序號倒退，`npm run check` 會擋下；推送前須將序號改回較大的值，確保 id 永不重複使用。仍有座標引用的世界或標籤，刪除後無法通過驗證。

#### Issue 流程

透過 Issue 表單提交的座標請求由 GitHub Actions 處理。

| 階段 | 說明 |
| --- | --- |
| 驗證 | 帶有 `coord-request` 標籤的未關閉 Issue 在開啟、編輯或重新開啟時觸發。系統檢查請求內容，並新增或更新唯一一則報告留言；通過加上 `pending-review`，失敗加上 `needs-fix`。編輯 Issue 會重新檢查並移除 `approved`。 |
| 核准與寫入 | 擁有者加上 `approved` 標籤後，由 `github-actions[bot]` 寫入資料與變更紀錄條目並 commit。另有每日排程與手動執行，會處理仍未關閉的已核准 Issue。 |
| 部署 | 部署至 GitHub Pages，部署依序排隊執行。網站更新完成後留言附網站連結，加上 `applied` 標籤並關閉 Issue。部署取消或失敗時，Issue 保留開啟並保留 `approved`，由下次執行重新部署後關閉；部署失敗另加上 `deploy-failed`。 |

驗證腳本可在本機以儲存的事件檔執行，不呼叫 GitHub API：

```bash
node scripts/validate-issue.mjs --event <event.json> --dry-run
```

### 授權

© 2026 Kingsley。保留所有權利（All rights reserved）。原始碼公開僅供參考；未經書面同意，不得複製、修改、散布或二次創作。第三方元件依其各自授權。詳見 [LICENSE](LICENSE)。

### 聲明

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
（非官方 Minecraft 產品，未經 Mojang 或 Microsoft 核准，亦與其無關。）

社群 Icon 中的第三方商標（如 Roblox、GTA、Rockstar）歸各自所有者所有。
