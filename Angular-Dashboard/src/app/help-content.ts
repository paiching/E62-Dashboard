/**
 * 「使用說明」選單的手冊內容與互動導覽。
 *
 * 維護規則：新增、調整或移除任何畫面功能時，請同步更新本檔：
 *  1. 修改對應章節的說明文字（sections）。
 *  2. 若畫面元素的 class／data-card 改名，更新導覽步驟的 target；
 *     tests/help-content.test.cjs 會檢查 target 是否仍存在於畫面範本。
 *  3. 在 HELP_CHANGELOG 最上方加一筆更新紀錄，並更新 HELP_UPDATED。
 */
import type { ViewKey } from "./dashboard.model";

export type HelpSettingsTab =
  | "theme"
  | "data"
  | "database"
  | "alarm"
  | "notification";
export type HelpPermissionTab = "accounts" | "roles";

export interface HelpTourStep {
  /** CSS selector of the element to highlight. */
  target: string;
  title: string;
  text: string;
  /** Page to show before highlighting. */
  view?: ViewKey;
  settingsTab?: HelpSettingsTab;
  permissionTab?: HelpPermissionTab;
  /** Opens a sensor's detail dialog first (the first alarm when there is one). */
  openSensor?: boolean;
  /** Skipped for accounts without this permission. */
  permission?: string;
}

export interface HelpSection {
  heading: string;
  text?: string;
  /** Numbered how-to steps. */
  steps?: string[];
  bullets?: string[];
  tip?: string;
}

export interface HelpChapter {
  id: string;
  title: string;
  icon: string;
  summary: string;
  /** Page the chapter explains; offers「前往此功能」. */
  view?: ViewKey;
  /** Shown as「未開放」when the account lacks it. */
  permission?: string;
  sections: HelpSection[];
  tour?: HelpTourStep[];
}

export interface HelpChange {
  date: string;
  items: string[];
}

export const HELP_UPDATED = "2026-11-27";

export const HELP_CHAPTERS: HelpChapter[] = [
  {
    id: "start",
    title: "快速開始",
    icon: "explore",
    summary: "第一次使用？先認識畫面配置、選單與登入登出。",
    sections: [
      {
        heading: "登入",
        steps: [
          "輸入帳號（不分大小寫）與密碼（區分大小寫）。",
          "按「登入系統」。系統會依您的角色，只顯示被授權的選單與按鈕。",
          "若顯示「帳號或密碼錯誤」，請確認大小寫；帳號被停用時也無法登入，請聯絡管理員。",
        ],
      },
      {
        heading: "畫面配置",
        bullets: [
          "左側選單：切換儀錶板、趨勢圖、報表資料、警報中心、帳號權限、設定與使用說明。",
          "頂部標題列：顯示目前頁面名稱；儀錶板會另外顯示警報狀態列與即時時鐘。",
          "右上角「？」：隨時打開與目前頁面相關的使用說明。",
          "左下角：目前登入的人員與角色，旁邊是登出按鈕。",
        ],
      },
      {
        heading: "互動導覽怎麼用",
        text: "每個章節上方都有「開始互動導覽」。導覽會帶您到實際畫面，逐一框出重點並說明用途。",
        bullets: [
          "按「下一步」或鍵盤 → 繼續；按「上一步」或 ← 返回。",
          "按「結束」或 Esc 隨時離開，畫面會停在目前的頁面，方便直接操作。",
          "您的帳號沒有開放的功能會自動略過。",
        ],
      },
      {
        heading: "登出",
        text: "按左下角的登出圖示。登出後警報聲會停止；離開座位前建議登出，避免他人用您的權限操作。",
      },
    ],
    tour: [
      {
        target: ".sidebar-nav",
        title: "主選單",
        text: "從這裡切換各功能頁。只會出現您的角色被授權的選單。",
      },
      {
        target: ".topbar-help",
        title: "使用說明",
        text: "不確定怎麼操作時，按這裡會直接打開目前頁面的說明。",
      },
      {
        target: ".sidebar-user",
        title: "登入人員與登出",
        text: "顯示目前登入的人員與角色；右邊的按鈕可以登出。",
      },
    ],
  },
  {
    id: "overview",
    title: "儀錶板",
    icon: "speed",
    view: "overview",
    permission: "dashboard.view",
    summary: "所有監測點的即時讀值與狀態，一眼看出哪裡異常。",
    sections: [
      {
        heading: "看懂狀態顏色",
        bullets: [
          "綠色「正常」：讀值在警報範圍內。",
          "紅色「警報」：讀值超出上限或低於下限，卡片會寫出原因。",
          "灰色「異常」：感應器斷線或讀不到值。",
        ],
      },
      {
        heading: "頂部警報狀態列與統計卡",
        text: "有警報時頂部會出現紅色狀態列；下方四張卡片分別是正常、警報、Sensor 異常的數量，以及自動刷新頻率。",
        steps: [
          "點狀態列或任一張數量卡片，下方感應器會立即篩選成該狀態。",
          "點「刷新頻率」卡片可切換 10／30／60 秒自動更新（管理員套用後會保存）。",
        ],
      },
      {
        heading: "搜尋與篩選",
        steps: [
          "在搜尋框輸入編號或名稱，例如「CH012」或「冷凍」。",
          "用「全部類型」選單只看溫度或濕度等特定類型的監測點。",
          "用「全部狀態」選單只看正常、警報或異常。",
          "監測點超過 50 個時，用左側的「1–50、51–100…」切換分頁。",
          "按「刷新」立即取得最新資料。",
        ],
      },
      {
        heading: "三種展示模式",
        bullets: [
          "精簡：一次看最多點位，適合巡檢總覽。",
          "詳細：卡片多顯示歷史最低、平均、最高與筆數。",
          "全螢幕：投放到大螢幕或監控牆，按 Esc 離開。",
        ],
        tip: "卡片大小、字級與讀值顏色可在「設定 → 主題設定」調整，讓監控牆遠看也清楚。",
      },
      {
        heading: "查看單一監測點",
        text: "點卡片上的名稱即可開啟「通道詳細視窗」，請參考下一章。",
      },
    ],
    tour: [
      {
        view: "overview",
        target: ".topbar-status-slot",
        title: "警報狀態列",
        text: "有警報時整條變紅並顯示數量，點一下就篩出警報監測點。",
        permission: "dashboard.status-bar",
      },
      {
        view: "overview",
        target: ".summary-grid",
        title: "狀態統計卡",
        text: "正常／警報／異常數量與刷新頻率。點數量卡片即可篩選，點刷新頻率可調整更新間隔。",
      },
      {
        view: "overview",
        target: ".sensor-filters",
        title: "搜尋與篩選",
        text: "依編號或名稱搜尋，也可依類型、狀態篩選；「刷新」立即更新資料。",
        permission: "dashboard.toolbar",
      },
      {
        view: "overview",
        target: ".range-tabs",
        title: "分頁",
        text: "每頁顯示 50 個監測點，點這裡切換。",
        permission: "dashboard.toolbar",
      },
      {
        view: "overview",
        target: ".display-mode-picker",
        title: "展示模式",
        text: "切換精簡、詳細或全螢幕。",
        permission: "dashboard.sensors",
      },
      {
        view: "overview",
        target: ".sensor-grid .sensor-card",
        title: "感應器卡片",
        text: "上方顏色代表狀態，中間是即時讀值，下方是警報範圍。點名稱開啟詳細視窗。",
        permission: "dashboard.sensors",
      },
    ],
  },
  {
    id: "sensor",
    title: "通道詳細視窗",
    icon: "monitor_heart",
    view: "overview",
    permission: "sensor.detail",
    summary: "查看單一監測點的統計、設定個別上下限、解除警報與下載紀錄。",
    sections: [
      {
        heading: "開啟方式",
        text: "在儀錶板點卡片名稱，或在報表資料點表格中的通道編號、名稱。",
      },
      {
        heading: "視窗內容",
        bullets: [
          "即時讀值與狀態，警報時會說明超出上限或低於下限。",
          "歷史統計：歷史最低（MIN）、平均（AVG）、最高（MAX）。",
          "警報範圍：顯示目前使用「預設值」或「個別設定」。",
          "右上角下載按鈕：匯出這個監測點的解除警報紀錄。",
        ],
      },
      {
        heading: "設定個別上下限",
        steps: [
          "在「下限」「上限」輸入數值（下限必須小於上限）。",
          "按「儲存個別設定」。之後刷新、同步或重新開機都不會被覆蓋。",
          "若儲存後警報狀態會改變，系統會先跳出「警報狀態將變更」請您確認。",
          "想回到所屬類型的預設範圍，按「恢復預設值」。",
        ],
        tip: "冷凍、冷藏、常溫的合理範圍不同，建議依實際用途個別設定。",
      },
    ],
    tour: [
      {
        view: "overview",
        openSensor: true,
        target: ".sensor-modal-reading",
        title: "即時讀值",
        text: "大字顯示目前讀值與狀態；警報時會寫出原因。",
        permission: "sensor.reading",
      },
      {
        view: "overview",
        openSensor: true,
        target: ".sensor-stats",
        title: "歷史統計",
        text: "歷史最低、平均與最高值。",
        permission: "sensor.stats",
      },
      {
        view: "overview",
        openSensor: true,
        target: ".sensor-settings-form",
        title: "警報範圍",
        text: "輸入下限、上限後按「儲存個別設定」；「恢復預設值」回到類型預設範圍。警報時這裡也有「解除警報」按鈕。",
        permission: "sensor.limits",
      },
    ],
  },
  {
    id: "trends",
    title: "趨勢圖",
    icon: "trending_up",
    view: "trends",
    permission: "trends.view",
    summary: "同時比較多個監測點的即時曲線，觀察變化趨勢。",
    sections: [
      {
        heading: "比較多個監測點",
        steps: [
          "在左側「選擇通道」清單搜尋並勾選，最多 8 個。",
          "右側圖表以不同顏色顯示，線尾標示最新值。",
          "點圖例上的 × 可移除該監測點。",
        ],
      },
      {
        heading: "控制列",
        bullets: [
          "保留點數：選擇圖表保留的資料點數（30～500 點）。",
          "暫停更新：凍結畫面方便觀察，按「繼續即時更新」恢復。",
        ],
      },
    ],
    tour: [
      {
        view: "trends",
        target: ".trend-toolbar",
        title: "更新控制列",
        text: "選擇保留點數，或暫停／繼續即時更新。",
        permission: "trends.toolbar",
      },
      {
        view: "trends",
        target: ".trend-channel-panel",
        title: "選擇通道",
        text: "搜尋、依狀態篩選並勾選要比較的監測點，最多 8 個。",
        permission: "trends.channels",
      },
      {
        view: "trends",
        target: ".trend-chart-panel",
        title: "即時曲線",
        text: "每條線一種顏色，線尾顯示最新值；點上方圖例的 × 可移除。",
        permission: "trends.chart",
      },
    ],
  },
  {
    id: "reports",
    title: "報表資料",
    icon: "table_view",
    view: "channels",
    permission: "reports.view",
    summary: "查詢歷史紀錄，並匯出 Excel 可直接開啟的 CSV 檔。",
    sections: [
      {
        heading: "查詢歷史資料",
        steps: [
          "輸入通道或名稱關鍵字後按 Enter。",
          "選擇狀態（全部／正常／警報／異常）。",
          "選擇起始日期與結束日期。",
          "按「刷新」會保留條件、回到第一頁重新查詢。",
        ],
      },
      {
        heading: "匯出報表",
        steps: [
          "先設定好查詢條件。",
          "在「匯出資訊」填寫申請人、手機、信箱、場域（選填），會寫入檔案表頭。",
          "按「匯出 CSV」並選擇存檔位置。",
        ],
        tip: "匯出的是所有符合條件的資料，不只目前這一頁；Excel 開啟中文不會亂碼。",
      },
      {
        heading: "瀏覽結果",
        text: "表格下方可切換每頁 25／50／100 筆與上一頁、下一頁。點通道編號或名稱可開啟通道詳細視窗。",
      },
    ],
    tour: [
      {
        view: "channels",
        target: ".channel-filters",
        title: "查詢條件",
        text: "關鍵字、狀態、起訖日期；右側是「刷新」與「匯出 CSV」。",
        permission: "reports.filter",
      },
      {
        view: "channels",
        target: ".report-export-details",
        title: "匯出資訊",
        text: "申請人、手機、信箱、場域會一併寫入匯出檔。",
        permission: "reports.export-info",
      },
      {
        view: "channels",
        target: ".table-panel .table-scroll",
        title: "歷史資料表",
        text: "每筆紀錄的讀值、狀態與異常原因；點通道可開啟詳細視窗。",
        permission: "reports.table",
      },
      {
        view: "channels",
        target: ".table-pagination",
        title: "分頁",
        text: "切換每頁筆數與上一頁、下一頁。",
        permission: "reports.table",
      },
    ],
  },
  {
    id: "alarms",
    title: "警報中心與解除警報",
    icon: "notifications_active",
    view: "alarms",
    permission: "alarms.view",
    summary: "集中處理所有警報與異常，並依規則解除警報、留下紀錄。",
    sections: [
      {
        heading: "警報中心",
        bullets: [
          "上方分頁可切換「全部／警報／異常」，並顯示各自數量。",
          "清單列出監測點、原因與時間，點選即可開啟通道詳細視窗處理。",
          "沒有異常時會顯示「目前沒有異常」。",
        ],
      },
      {
        heading: "解除警報的步驟",
        steps: [
          "開啟該監測點的通道詳細視窗，按「解除警報」。",
          "從下拉選單選擇解除理由；沒有合適的選「其他」自行輸入。",
          "可勾選「同時加入解除理由選項」，下次直接選用。",
          "按「確認解除」。系統會記錄解除人、時間與理由。",
        ],
      },
      {
        heading: "解除規則",
        bullets: [
          "讀值仍超出警報範圍時不能解除，會顯示「無法解除警報」與目前讀值、範圍；請先處理現場或調整上下限。",
          "因修改上下限而「看起來恢復」的警報會保留，仍需填寫理由解除，避免異常被悄悄帶過。",
          "解除後該監測點靜音 1 分鐘；之後若仍異常會再次提醒。",
          "每個監測點的解除紀錄可在通道詳細視窗右上角下載。",
        ],
        tip: "常用的解除理由（例如「設備維修中」「除霜作業」）可由管理員在「設定 → 警報設定 → 解除理由設定」預先建立。",
      },
    ],
    tour: [
      {
        view: "alarms",
        target: ".alarm-filter-tabs",
        title: "分類切換",
        text: "全部、警報（超出範圍）、異常（斷線或讀取失敗），並顯示數量。",
      },
      {
        view: "alarms",
        target: ".alarm-list",
        title: "異常清單",
        text: "點任一筆即開啟通道詳細視窗，查看原因或解除警報。",
      },
    ],
  },
  {
    id: "notify",
    title: "警報提醒方式",
    icon: "volume_up",
    summary: "畫面、聲音、桌面通知、LINE 推播，多管道確保不漏接。",
    sections: [
      {
        heading: "發生異常時",
        steps: [
          "畫面變色：卡片轉紅或灰，儀錶板頂部出現警報列。",
          "警報聲：每次響三聲，異常期間持續重複（間隔可設定）。",
          "桌面通知：Windows 右下角跳出通知，程式最小化也收得到。",
          "LINE 推播：啟用後推送到指定的 LINE 人員或群組。",
          "處理完成後依規則解除警報，或待讀值恢復正常。",
        ],
      },
      {
        heading: "不會一直重複轟炸",
        bullets: [
          "同一個異常不會每次刷新都重複通知；恢復後再發生才會再提醒。",
          "全部恢復正常、關閉聲音、登出或結束程式時，警報聲會停止。",
          "Windows 勿擾模式或系統靜音可能讓提醒看不到、聽不到，請一併確認。",
        ],
      },
      {
        heading: "在哪裡開關",
        text: "警報聲在「設定 → 警報設定」，桌面通知、快照提醒與 LINE 在「設定 → 通知設定」。每項都有「測試」按鈕可確認是否正常。",
      },
    ],
  },
  {
    id: "permissions",
    title: "帳號權限",
    icon: "verified_user",
    view: "permissions",
    permission: "users.manage",
    summary: "建立人員帳號，並用角色決定每個人能看什麼、能改什麼。",
    sections: [
      {
        heading: "新增或編輯帳號（帳號分頁）",
        steps: [
          "按「新增帳號」，或在清單中按「編輯」。",
          "填寫顯示名稱、手機、信箱（選填）。",
          "選擇角色，並填寫負責的通道範圍（例如 all 或 CH001-CH100）。",
          "勾選「啟用帳號」後按「儲存變更」。",
        ],
        bullets: [
          "不再使用的帳號可停用或刪除。",
          "內建管理員與目前登入的帳號不能停用或變更角色。",
          "變更角色或停用後，該帳號其他已登入的畫面需要重新登入。",
        ],
      },
      {
        heading: "自訂角色（角色分頁）",
        steps: [
          "按「新增角色」，或按現有角色旁的複製圖示，從相近角色開始修改。",
          "輸入角色名稱與說明，例如「夜班值班」。",
          "勾選權限：依「選單 → 分頁 → 卡片 → 操作」逐層勾選；勾操作會一併開放所屬卡片。",
          "可用「全選」「全部僅檢視」「全部清除」或各選單的「僅檢視」快速設定。",
          "按「儲存角色」。使用此角色的帳號需重新登入才會套用。",
        ],
        bullets: [
          "管理員（Administrator）固定擁有全部權限。",
          "操作員、訪客為內建角色，可以調整權限但不能刪除。",
          "仍有帳號使用的角色不能刪除；也不能修改自己所屬的角色。",
        ],
      },
    ],
    tour: [
      {
        view: "permissions",
        permissionTab: "accounts",
        target: ".settings-tabs",
        title: "帳號／角色分頁",
        text: "人員帳號與角色權限分開管理。",
      },
      {
        view: "permissions",
        permissionTab: "accounts",
        target: ".permission-table",
        title: "帳號清單",
        text: "每個帳號的角色、通道範圍與權限數量；右側可編輯或刪除。",
        permission: "users.accounts.list",
      },
      {
        view: "permissions",
        permissionTab: "accounts",
        target: ".page-inline-actions",
        title: "新增帳號",
        text: "建立新的人員帳號。",
        permission: "users.accounts.create",
      },
      {
        view: "permissions",
        permissionTab: "roles",
        target: ".role-list",
        title: "角色清單",
        text: "顯示每個角色的帳號數與權限數；可新增或複製角色。",
        permission: "users.roles.list",
      },
      {
        view: "permissions",
        permissionTab: "roles",
        target: ".role-editor",
        title: "權限勾選",
        text: "逐項勾選此角色能使用的選單、卡片與操作，完成後按「儲存角色」。",
        permission: "users.roles.list",
      },
    ],
  },
  {
    id: "settings",
    title: "系統設定",
    icon: "settings",
    view: "settings",
    permission: "settings.manage",
    summary: "外觀、資料來源、資料庫、警報與通知，依分頁分類設定。",
    sections: [
      {
        heading: "通用操作",
        bullets: [
          "設定依「主題設定、資料設定、資料庫維護、警報設定、通知設定」分頁；分頁出現紅色驚嘆號代表該頁有問題需要處理。",
          "卡片可拖拉左上角圖示調整位置（或點圖示後用方向鍵），排列會自動儲存；按「恢復預設排列」可還原。",
          "只開放檢視的卡片會標示「唯讀」，無法修改。",
        ],
      },
      {
        heading: "主題設定",
        bullets: [
          "登入頁 Logo、側邊選單 Logo：上傳 PNG／JPG／WebP，可選大小與顏色樣式，隨時恢復預設。",
          "登入背景設定：換成工廠、倉儲等現場照片。",
          "標題設定：系統名稱（同時是視窗標題）與副標題。",
          "儀錶板卡片大小與顏色：卡片 85%～200%、滑鼠移入放大，正常／警報讀值顏色可選色或用滴管吸取。",
          "字級設定：頂部時間列、儀錶板卡片、趨勢圖、一般介面可分開調整。",
        ],
      },
      {
        heading: "資料設定",
        bullets: [
          "資料模式：MOCK 模擬資料、模擬多態（溫度／濕度）、LIVE 正式 API、正式 API 多態（API v1）。",
          "更新頻率：背景自動更新 10／30／60 秒。",
          "API 資料端點與 EC62 API Token：連線現場設備的位址與驗證碼。",
          "API v1 網址與帳密：使用正式 API 多態時填寫，密碼加密存在本機。",
          "報表保留天數：超過天數的舊資料會自動清除。",
        ],
      },
      {
        heading: "資料庫維護",
        text: "綠燈表示資料庫正常（每 10 秒自動檢查）。「清理歷史資料」會刪除所有歷史讀值且無法復原，執行前請先備份。",
      },
      {
        heading: "警報設定",
        bullets: [
          "預設上下限：依監測類型（溫度、濕度…）分別設定；未個別設定的監測點都跟隨這裡。",
          "解除理由設定：新增常用理由；已使用過的理由只能改名、不能刪除。",
          "異常警報聲音：開關、測試，並設定每幾秒響一次（1～300 秒）。",
          "儀錶板警報狀態列：控制頂部警報列是否顯示。",
        ],
      },
      {
        heading: "通知設定",
        bullets: [
          "桌面異常通知：Windows 通知開關與測試。",
          "快照提醒：設備資料過期時提示（預設關閉）。",
          "LINE 通知：填入公司 LINE 官方帳號的 Channel ID、Channel Secret 與接收對象 ID，儲存後按「測試 LINE」確認；不是個人 LINE 帳密。",
        ],
      },
    ],
    tour: [
      {
        view: "settings",
        target: ".settings-tabs",
        title: "設定分頁",
        text: "依類別切換設定；出現紅色驚嘆號代表該頁有問題。",
      },
      {
        view: "settings",
        settingsTab: "theme",
        target: '[data-card="login-logo"]',
        title: "主題：Logo",
        text: "上傳客戶 Logo，登入頁與側邊選單可分開設定。",
        permission: "settings.theme.login-logo",
      },
      {
        view: "settings",
        settingsTab: "theme",
        target: '[data-card="card-size"]',
        title: "主題：卡片大小與顏色",
        text: "調整儀錶板卡片大小與讀值顏色，下方有即時預覽。",
        permission: "settings.theme.card-size",
      },
      {
        view: "settings",
        settingsTab: "data",
        target: '[data-card="data-mode"]',
        title: "資料：資料模式",
        text: "切換模擬資料或正式設備，儲存後立即生效。",
        permission: "settings.data.data-mode",
      },
      {
        view: "settings",
        settingsTab: "database",
        target: '[data-card="database"]',
        title: "資料庫維護",
        text: "確認資料庫連線燈號；清理歷史資料前請先備份。",
        permission: "settings.database.database",
      },
      {
        view: "settings",
        settingsTab: "alarm",
        target: '[data-card="default-limits"]',
        title: "警報：預設上下限",
        text: "依類型設定預設警報範圍。",
        permission: "settings.alarm.default-limits",
      },
      {
        view: "settings",
        settingsTab: "alarm",
        target: '[data-card="alarm-sound"]',
        title: "警報：警報聲音",
        text: "開關警報聲、設定間隔，並可測試喇叭。",
        permission: "settings.alarm.alarm-sound",
      },
      {
        view: "settings",
        settingsTab: "notification",
        target: '[data-card="line"]',
        title: "通知：LINE",
        text: "設定 LINE 官方帳號推播；儲存後可測試。",
        permission: "settings.notification.line",
      },
    ],
  },
  {
    id: "faq",
    title: "常見問題",
    icon: "help_outline",
    summary: "遇到狀況時先看這裡。",
    sections: [
      {
        heading: "畫面出現「資料同步失敗」或「設備 API」紅字",
        text: "代表無法從設備取得資料。請確認網路、設備電源，以及「設定 → 資料設定」中的端點與驗證碼；仍無法排除請聯絡管理員。",
      },
      {
        heading: "按「解除警報」卻顯示「無法解除警報」",
        text: "讀值仍超出警報範圍時不能解除。請先處理現場狀況；若範圍設定不合理，可在通道詳細視窗調整上下限。",
      },
      {
        heading: "聽不到警報聲或沒收到桌面通知",
        text: "到「設定 → 警報設定／通知設定」確認開關已開啟並按「測試」；也請確認電腦音量與 Windows 勿擾模式。",
      },
      {
        heading: "看不到某個選單或按鈕",
        text: "您的角色沒有開放這項功能。請管理員在「帳號權限 → 角色」調整，調整後需重新登入。",
      },
      {
        heading: "匯出的報表用 Excel 開啟亂碼",
        text: "請直接用 Excel 開啟匯出的 CSV 檔；若用其他軟體轉存過，請重新匯出。",
      },
      {
        heading: "忘記密碼",
        text: "請聯絡管理員重設；系統不會保存明文密碼，無法查回原密碼。",
      },
    ],
  },
];

/** Newest first. */
export const HELP_CHANGELOG: HelpChange[] = [
  {
    date: "2026-11-27",
    items: [
      "新增「使用說明」選單：操作手冊、互動導覽與常見問題。",
      "儀錶板可依監測類型（溫度／濕度）篩選；各類型可設定預設上下限。",
      "主題設定新增讀值顏色（可用滴管選色）與滑鼠移入放大。",
      "資料模式新增模擬多態與正式 API 多態（API v1）。",
    ],
  },
  {
    date: "2026-11-25",
    items: [
      "帳號權限新增「角色」分頁，可自訂角色並逐項勾選權限。",
      "新增 LINE 通知、主題設定（Logo、背景、標題、卡片大小、字級）。",
      "設定改為分頁並可拖拉調整卡片排列。",
      "解除警報新增規則：讀值仍超出範圍時不能解除。",
    ],
  },
];

/** Chapter opened by the「？」button on each page. */
export const HELP_CHAPTER_FOR_VIEW: Partial<Record<ViewKey, string>> = {
  overview: "overview",
  trends: "trends",
  channels: "reports",
  alarms: "alarms",
  permissions: "permissions",
  settings: "settings",
  help: "start",
};
