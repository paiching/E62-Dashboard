# Edge Dashboard

獨立的 React + TypeScript 感應器監控前端。開發環境使用 200 點模擬資料，正式建置讀取 EC62 API。

## 執行

```powershell
pnpm install
pnpm dev
```

開發預設帳號：

- `admin` / `SGS@1234`
- `operator1` / `1234`
- `guest` / 密碼留空

## 資料模式

- `.env.development`：`VITE_DATA_MODE=mock`
- `.env.production`：`VITE_DATA_MODE=live`
- 正式資料：`http://127.0.0.1:8080/api/data`

正式模式的登入會呼叫同一台主機的 `/api/login`，資料請求會帶入 `X-EC62-Token`。若 React 網站與 EC62 API 使用不同來源，API Server 必須允許該網站來源的 CORS 請求。

## 建置

```powershell
pnpm build
```
