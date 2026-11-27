# EdgeBox（Angular-Dashboard）專案規則

## 功能變更必須同步更新「使用說明」

App 內「使用說明」選單（手冊、互動導覽、常見問題）的內容全部在 `src/app/help-content.ts`。
只要新增、調整或移除任何使用者看得到的功能（畫面、按鈕、設定卡片、規則、權限），同一個變更內就要：

1. 更新 `HELP_CHAPTERS` 中對應章節的說明文字；新選單要新增章節，並在 `HELP_CHAPTER_FOR_VIEW` 對應。
2. 畫面 class 或 `data-card` 改名時，更新互動導覽步驟的 `target`。
3. 在 `HELP_CHANGELOG` 最上方加一筆（日期 + 使用者看得懂的變更說明），並把 `HELP_UPDATED` 改成同一天。
4. 執行 `node --test tests/help-content.test.cjs`，確認導覽目標、權限代碼與章節都仍有效。

說明文字寫給現場使用者看：繁體中文、操作步驟導向，不寫程式或資料庫細節。
