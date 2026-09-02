# E62 Angular Dashboard

此專案是獨立的 Angular + TypeScript + Electron 桌面版，介面與 React 版一致，但不依賴 React 專案。

## SQLite 資料庫

桌面程式使用 Electron 內建的 `node:sqlite`，不需要另外安裝 SQLite。資料庫預設位置：

```text
%APPDATA%\angular-dashboard\data\e62-dashboard.sqlite3
```

- API 每次同步成功後，所有通道寫入 `sensor_readings`。
- `sensor_channels` 保存每個通道的最新狀態。
- 報表畫面從 `sensor_readings` 查詢，CSV 也由相同查詢條件輸出。
- API、刷新頻率、保留天數及畫面設定保存在 `app_settings`。
- 帳號密碼、角色、權限與可見菜單保存在 `users`、`roles`、`permissions`、`role_permissions`、`menu_items`。
- 密碼以含隨機 salt 的 scrypt 雜湊保存，不儲存明文。

完整文件請參考 [`docs/README.md`](docs/README.md)，其中包含資料庫設計、ER、API 契約、容量估算、安全、備份還原與維運說明。

## 展示帳號

- `admin` / `SGS@1234`
- `operator1` / `1234`
- `guest` / 密碼留空

## 開發與建置

```powershell
pnpm install
pnpm start
pnpm build
pnpm package:windows
```

Windows portable 執行檔會輸出至 `release/E62-Angular-Dashboard-Demo-1.0.0-Windows-x64.exe`。
