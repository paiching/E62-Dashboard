const { DatabaseSync } = require("node:sqlite");
const {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  ADMINISTRATOR,
  CATALOG,
  NODES,
  defaultPermissions,
  effectivePermissions,
  normalizePermissions,
  settingPermission,
} = require("./permissions.cjs");

let database;
const sessions = new Map();
let cleanupInProgress = false;
const DEFAULT_API_URL = "http://192.168.68.50:8088/api/v1/latest";
// EdgeSense API v1 (login cookie + /channels/current) for "live-multi".
const DEFAULT_API_V1_URL = "http://127.0.0.1:8765";
const DATA_MODES = ["mock", "mock-multi", "live", "live-multi"];
const API_V1_CREDENTIALS_KEY = "api.v1_credentials";
const json = (value) => JSON.stringify(value);
function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function initializeDatabase(userDataPath, forceMockMode = false) {
  const directory = path.join(userDataPath, "data");
  fs.mkdirSync(directory, { recursive: true });
  const dbPath = path.join(directory, "c62-dashboard.sqlite3");
  database = new DatabaseSync(dbPath);
  database.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'general',description TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS roles(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',is_system INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS permissions(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS role_permissions(role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,PRIMARY KEY(role_id,permission_id));
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE COLLATE NOCASE,display_name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',password_hash TEXT NOT NULL,role_id INTEGER NOT NULL REFERENCES roles(id),channel_scope TEXT NOT NULL DEFAULT 'all',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS menu_items(id INTEGER PRIMARY KEY AUTOINCREMENT,menu_key TEXT NOT NULL UNIQUE,label TEXT NOT NULL,icon TEXT NOT NULL,route TEXT NOT NULL,sort_order INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,required_permission TEXT);
    CREATE TABLE IF NOT EXISTS sensor_channels(channel_id TEXT PRIMARY KEY,name TEXT NOT NULL,sv REAL,alarm_low REAL,alarm_high REAL,last_pv REAL,last_state TEXT NOT NULL DEFAULT 'ok',last_seen_at TEXT,raw_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS channel_limits(channel_id TEXT PRIMARY KEY REFERENCES sensor_channels(channel_id),low REAL NOT NULL,high REAL NOT NULL,CHECK(low < high));
    CREATE TABLE IF NOT EXISTS sensor_readings(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL,channel_id TEXT NOT NULL,pv REAL,sv REAL,state TEXT NOT NULL,alarm_low REAL,alarm_high REAL,recorded_at TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,source TEXT NOT NULL DEFAULT 'api',raw_json TEXT NOT NULL,FOREIGN KEY(channel_id) REFERENCES sensor_channels(channel_id));
    CREATE INDEX IF NOT EXISTS idx_readings_recorded ON sensor_readings(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_readings_channel_time ON sensor_readings(channel_id,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_readings_state_time ON sensor_readings(state,recorded_at DESC);
    CREATE TABLE IF NOT EXISTS alarm_releases(id INTEGER PRIMARY KEY AUTOINCREMENT,channel_id TEXT NOT NULL,alarm_reason TEXT,release_reason TEXT NOT NULL,username TEXT NOT NULL,display_name TEXT NOT NULL DEFAULT '',released_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,cleared_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_alarm_releases_active ON alarm_releases(channel_id,active);
    CREATE TABLE IF NOT EXISTS alarm_latches(channel_id TEXT PRIMARY KEY,alarm_reason TEXT NOT NULL,latched_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ingest_log(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL UNIQUE,source TEXT NOT NULL,source_url TEXT,channel_count INTEGER NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL,error_message TEXT);
  `);
  const userColumns = new Set(
    database
      .prepare("PRAGMA table_info(users)")
      .all()
      .map((column) => column.name),
  );
  if (!userColumns.has("phone"))
    database.exec(
      "ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''",
    );
  if (!userColumns.has("email"))
    database.exec(
      "ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''",
    );
  seedDatabase();
  if (forceMockMode)
    database
      .prepare(
        "UPDATE app_settings SET value_json='\"mock\"',updated_at=CURRENT_TIMESTAMP WHERE key='data.mode'",
      )
      .run();
  refreshStoredLimits();
  return dbPath;
}

// Keep in sync with src/app/branding.ts.
const DEFAULT_TITLES = {
  title: "EdgeBox",
  subtitle: "感應器監控系統",
};
// Defaults seeded by the first titles release; replaced on startup.
const LEGACY_TITLES = {
  title: "Edge Dashboard",
  subtitle: "C62 溫度感應器監控系統",
};
const TITLE_MAX_LENGTH = 30;
const SUBTITLE_MAX_LENGTH = 40;
// The prefixes end with the base64 of the PNG / JPEG file signature.
const IMAGE_SETTINGS = {
  "ui.logo": {
    label: "Logo ",
    maxLength: 1_000_000,
    pattern: /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/,
  },
  "ui.sidebar_logo": {
    label: "Logo ",
    maxLength: 1_000_000,
    pattern: /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/,
  },
  "ui.login_background": {
    label: "背景圖",
    maxLength: 2_000_000,
    pattern: /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/,
  },
};
const LOGO_STYLES = ["inverse", "original", "light"];
const LOGO_SIZES = ["standard", "large", "xlarge"];
const CARD_SIZES = [85, 100, 125, 150, 200];
// Keep in sync with CARD_HOVER_SCALES in src/app/card-size.ts; 100 is off.
const CARD_HOVER_SCALES = [100, 103, 105, 108];
// Keep in sync with DEFAULT_READING_COLORS in src/app/card-size.ts.
const DEFAULT_READING_COLORS = { normal: "#148266", alarm: "#c43d4e" };
function normalizeReadingColors(value) {
  const result = {};
  for (const kind of Object.keys(DEFAULT_READING_COLORS)) {
    const color = value?.[kind];
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))
      throw new Error("讀值顏色需為 #RRGGBB 格式");
    result[kind] = color.toLowerCase();
  }
  return result;
}
const SETTINGS_TABS = ["theme", "data", "database", "alarm", "notification"];
function normalizeCardLayouts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("卡片排列格式不正確");
  const result = {};
  for (const [tab, columns] of Object.entries(value)) {
    const ids = Array.isArray(columns) ? columns.flat() : [];
    if (
      !SETTINGS_TABS.includes(tab) ||
      !Array.isArray(columns) ||
      columns.length < 1 ||
      columns.length > 20 ||
      !columns.every(Array.isArray) ||
      ids.length > 50 ||
      new Set(ids).size !== ids.length ||
      !ids.every((id) => typeof id === "string" && /^[a-z-]{1,40}$/.test(id))
    )
      throw new Error("卡片排列格式不正確");
    result[tab] = columns;
  }
  return result;
}
function normalizeTitles(value) {
  const text = (input) =>
    typeof input === "string" ? input.trim().replace(/\s+/g, " ") : null;
  const title = text(value?.title);
  const subtitle = text(value?.subtitle);
  if (!title) throw new Error("請輸入專案名稱");
  if (title.length > TITLE_MAX_LENGTH)
    throw new Error(`專案名稱不可超過 ${TITLE_MAX_LENGTH} 個字`);
  if (subtitle === null) throw new Error("次標必須為文字");
  if (subtitle.length > SUBTITLE_MAX_LENGTH)
    throw new Error(`次標不可超過 ${SUBTITLE_MAX_LENGTH} 個字`);
  return { title, subtitle };
}
function validateImage(key, value) {
  if (value === "") return;
  const { label, maxLength, pattern } = IMAGE_SETTINGS[key];
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    !pattern.test(value)
  )
    throw new Error(`${label}圖檔過大或格式不正確`);
}

function seedDatabase() {
  // Logos uploaded before styles existed keep the white tile they had.
  const uploadedLogo = database
    .prepare("SELECT 1 AS ok FROM app_settings WHERE key='ui.logo' AND value_json<>?")
    .get(json(""));
  const settings = [
    ["data.mode", "mock", "api", "mock、mock-multi、live 或 live-multi"],
    ["api.data_url", DEFAULT_API_URL, "api", "EC62 API 資料端點"],
    ["api.v1_url", DEFAULT_API_V1_URL, "api", "EdgeSense API v1 網址（多態）"],
    [
      API_V1_CREDENTIALS_KEY,
      { username: "", password: "" },
      "api",
      "EdgeSense API v1 登入帳密（password 為加密值）",
    ],
    ["api.auth_token", "", "api", "X-EC62-Token"],
    ["api.poll_interval_ms", 60000, "api", "自動同步間隔"],
    ["report.retention_days", 365, "report", "歷史資料保留天數"],
    ["dashboard.show_status", true, "display", "顯示 Header 狀態列"],
    ["ui.default_view", "overview", "display", "登入後預設頁面"],
    [
      "ui.font_sizes",
      { general: 100, topbar: 100, cards: 100, units: 100, trends: 100 },
      "display",
      "各區域字級百分比",
    ],
    ["ui.titles", DEFAULT_TITLES, "display", "專案名稱與次標"],
    ["ui.logo", "", "display", "登入頁 Logo（PNG data URL，空白為預設）"],
    [
      "ui.sidebar_logo",
      "",
      "display",
      "側邊選單 Logo（PNG data URL，空白沿用登入頁）",
    ],
    [
      "ui.logo_style",
      uploadedLogo ? "light" : "inverse",
      "display",
      "側邊選單 Logo 樣式",
    ],
    ["ui.logo_size", "standard", "display", "側邊選單 Logo 大小"],
    [
      LINE_KEY,
      { enabled: false, channelId: "", recipients: [], secret: "" },
      "notification",
      "LINE 官方帳號推播（secret 為加密值）",
    ],
    ["ui.card_size", 100, "display", "儀錶板卡片大小百分比"],
    ["ui.card_hover", 105, "display", "滑鼠移入卡片的放大百分比（100 為關閉）"],
    [
      "ui.reading_colors",
      DEFAULT_READING_COLORS,
      "display",
      "儀錶板讀值數字顏色（正常／警報）",
    ],
    ["ui.card_layouts", {}, "display", "各設定分頁的卡片排列"],
    [
      "ui.login_background",
      "",
      "display",
      "登入頁背景（JPEG data URL，空白為預設）",
    ],
    ["notifications.enabled", true, "notification", "允許桌面通知"],
    [
      "notifications.snapshot_stale_enabled",
      false,
      "notification",
      "顯示快照過期提醒",
    ],
    ["alarms.sound_enabled", true, "notification", "異常警報聲音"],
    [
      "alarms.sound_interval_seconds",
      3,
      "notification",
      "持續警報聲播放間隔（秒）",
    ],
    [
      "alarms.default_limits",
      { low: 2, high: 8 },
      "alarm",
      "未個別設定通道的預設溫度上下限",
    ],
    [
      "alarms.type_default_limits",
      { humidity: { low: 30, high: 70 } },
      "alarm",
      "溫度以外各類型（如濕度）的預設上下限",
    ],
    ["alarms.release_reasons", [], "alarm", "解除警報時可選擇的理由"],
  ];
  const insertSetting = database.prepare(
    "INSERT OR IGNORE INTO app_settings(key,value_json,category,description) VALUES(?,?,?,?)",
  );
  settings.forEach(([key, value, category, description]) =>
    insertSetting.run(key, json(value), category, description),
  );
  database
    .prepare(
      "UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key='ui.titles' AND value_json=?",
    )
    .run(json(DEFAULT_TITLES), json(LEGACY_TITLES));
  const legacyUrl = database
    .prepare("SELECT value_json FROM app_settings WHERE key='api.data_url'")
    .get()?.value_json;
  if (legacyUrl === json("http://127.0.0.1:8080/api/data")) {
    database
      .prepare(
        "UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key='api.data_url'",
      )
      .run(json(DEFAULT_API_URL));
  }
  database
    .prepare(
      "UPDATE app_settings SET value_json='60000',updated_at=CURRENT_TIMESTAMP WHERE key='api.poll_interval_ms' AND value_json NOT IN ('10000','30000','60000')",
    )
    .run();
  database
    .prepare(
      "UPDATE app_settings SET value_json='\"settings\"' WHERE key='ui.default_view' AND value_json='\"account\"'",
    )
    .run();
  const insertRole = database.prepare(
    "INSERT OR IGNORE INTO roles(code,display_name,description,is_system) VALUES(?,?,?,?)",
  );
  const newRoles = new Set();
  [
    [ADMINISTRATOR, "Administrator", "完整系統管理權限", 1],
    ["operator", "Operator", "監控、報表及警報操作", 1],
    ["guest", "Guest", "唯讀監控與報表", 1],
  ].forEach((row) => {
    if (insertRole.run(...row).changes) newRoles.add(row[0]);
  });
  const insertPermission = database.prepare(
    "INSERT OR IGNORE INTO permissions(code,display_name,description) VALUES(?,?,?)",
  );
  const renamePermission = database.prepare(
    "UPDATE permissions SET display_name=?,description=? WHERE code=?",
  );
  const newPermissions = new Set();
  const describePermissions = (nodes, parents) =>
    nodes.forEach((node) => {
      const trail = parents.join(" / ");
      if (insertPermission.run(node.code, node.label, trail).changes)
        newPermissions.add(node.code);
      else renamePermission.run(node.label, trail, node.code);
      describePermissions(node.children ?? [], [...parents, node.label]);
    });
  describePermissions(CATALOG, []);
  // Replaced by the test action of each notification card.
  database.prepare("DELETE FROM permissions WHERE code='tests.run'").run();
  // Defaults apply once, when a role or permission first appears, so that a
  // box unchecked in the role editor stays unchecked after a restart.
  for (const role of [ADMINISTRATOR, "operator", "guest"])
    grantPermissions(
      role,
      defaultPermissions(role).filter(
        (code) =>
          role === ADMINISTRATOR ||
          newRoles.has(role) ||
          newPermissions.has(code),
      ),
    );
  const menus = [
    ["overview", "儀錶板", "speed", "overview", 10, "dashboard.view"],
    ["trends", "趨勢圖", "trending_up", "trends", 20, "trends.view"],
    ["channels", "報表資料", "table_view", "channels", 30, "reports.view"],
    ["alarms", "警報中心", "notifications_active", "alarms", 40, "alarms.view"],
    [
      "permissions",
      "帳號權限",
      "verified_user",
      "permissions",
      50,
      "users.manage",
    ],
    ["settings", "設定", "settings", "settings", 70, "settings.manage"],
  ];
  const insertMenu = database.prepare(
    "INSERT INTO menu_items(menu_key,label,icon,route,sort_order,required_permission) VALUES(?,?,?,?,?,?) ON CONFLICT(menu_key) DO UPDATE SET label=excluded.label,icon=excluded.icon,route=excluded.route,sort_order=excluded.sort_order,required_permission=excluded.required_permission",
  );
  menus.forEach((row) => insertMenu.run(...row));
  database
    .prepare("UPDATE menu_items SET enabled=0 WHERE menu_key='account'")
    .run();
  if (!database.prepare("SELECT COUNT(*) AS count FROM users").get().count) {
    createUser("admin", "系統管理員", "SGS@1234", "administrator", "all");
    createUser("operator1", "操作員 1", "1234", "operator", "CH001-CH100");
    createUser("guest", "訪客", "", "guest", "readonly");
  }
}

function grantPermissions(roleCode, codes) {
  const link = database.prepare(
    "INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r,permissions p WHERE r.code=? AND p.code=?",
  );
  codes.forEach((code) => link.run(roleCode, code));
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function verifyPassword(password, stored) {
  const [, salt, expected] = String(stored).split(":");
  if (!salt || !expected) return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(expected, "hex"),
  );
}
function createUser(
  username,
  displayName,
  password,
  roleCode,
  channelScope,
  phone = "",
  email = "",
) {
  database
    .prepare(
      "INSERT INTO users(username,display_name,phone,email,password_hash,role_id,channel_scope) SELECT ?,?,?,?,?,id,? FROM roles WHERE code=?",
    )
    .run(
      username,
      displayName,
      phone,
      email,
      hashPassword(password),
      channelScope,
      roleCode,
    );
}
function settingsObject() {
  const settings = Object.fromEntries(
    database
      .prepare("SELECT key,value_json FROM app_settings ORDER BY key")
      .all()
      .map((row) => [row.key, parseJson(row.value_json)]),
  );
  // Sent to the renderer, so the encrypted LINE secret stays behind.
  if (settings[LINE_KEY]) {
    const { secret, ...visible } = settings[LINE_KEY];
    settings[LINE_KEY] = { ...visible, hasSecret: Boolean(secret) };
  }
  if (settings[API_V1_CREDENTIALS_KEY]) {
    const { username, password } = settings[API_V1_CREDENTIALS_KEY];
    settings[API_V1_CREDENTIALS_KEY] = {
      username: String(username ?? ""),
      hasPassword: Boolean(password),
    };
  }
  return settings;
}
/** What one session may read; the API token and LINE IDs have their own card. */
function visibleSettings(session) {
  const settings = settingsObject();
  const can = (code) => Boolean(session?.permissions.includes(code));
  if (!can("settings.data.api-token") && "api.auth_token" in settings)
    settings["api.auth_token"] = "";
  if (!can("settings.data.api-token") && settings[API_V1_CREDENTIALS_KEY])
    settings[API_V1_CREDENTIALS_KEY] = { username: "", hasPassword: false };
  if (!can("settings.notification.line") && settings[LINE_KEY])
    settings[LINE_KEY] = {
      enabled: settings[LINE_KEY].enabled,
      channelId: "",
      recipients: [],
      hasSecret: false,
    };
  return settings;
}
const LINE_KEY = "notifications.line";
const LINE_MAX_RECIPIENTS = 20;
const unavailableCodec = () => {
  throw new Error("此電腦無法加密儲存 LINE 密碼");
};
let secretCodec = { encrypt: unavailableCodec, decrypt: unavailableCodec };
function configureSecretCodec(codec) {
  secretCodec = codec;
}
function storedLineSettings() {
  return parseJson(
    database
      .prepare("SELECT value_json FROM app_settings WHERE key=?")
      .get(LINE_KEY).value_json,
  );
}
function saveLineSettings(token, input) {
  const session = requireSession(token, settingPermission(LINE_KEY));
  const current = storedLineSettings();
  const enabled = input?.enabled;
  const channelId = String(input?.channelId ?? "").trim();
  const newSecret = String(input?.secret ?? "").trim();
  const recipients = Array.isArray(input?.recipients)
    ? [...new Set(input.recipients.map((id) => String(id).trim()))]
    : null;
  if (typeof enabled !== "boolean") throw new Error("LINE 開關必須為布林值");
  const clearing =
    !enabled && !channelId && !newSecret && recipients?.length === 0;
  if (!clearing) {
    if (!/^\d{5,20}$/.test(channelId))
      throw new Error("請輸入正確的 Channel ID（數字）");
    if (newSecret && !/^[0-9A-Za-z]{16,128}$/.test(newSecret))
      throw new Error("Channel Secret 格式不正確");
    if (!newSecret && (!current.secret || current.channelId !== channelId))
      throw new Error("請輸入此 Channel 的 Channel Secret");
    if (
      !recipients?.length ||
      recipients.length > LINE_MAX_RECIPIENTS ||
      !recipients.every((id) => /^[UCR][0-9a-f]{32}$/.test(id))
    )
      throw new Error(
        `接收對象需為 1～${LINE_MAX_RECIPIENTS} 個 U／C／R 開頭的 LINE ID`,
      );
  }
  const secret = clearing
    ? ""
    : newSecret
      ? secretCodec.encrypt(newSecret)
      : current.secret;
  database
    .prepare(
      "UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=?",
    )
    .run(json({ enabled, channelId, recipients, secret }), LINE_KEY);
  return visibleSettings(session);
}
/** Main process only: includes the decrypted secret. */
function getLineDelivery(token, test = false) {
  requireSession(token, test ? settingPermission(LINE_KEY) : undefined);
  const { enabled, channelId, recipients, secret } = storedLineSettings();
  const title = settingsObject()["ui.titles"]?.title ?? DEFAULT_TITLES.title;
  if (!enabled && !test) return { enabled: false, recipients: [], title };
  if (!secret) throw new Error("尚未儲存 LINE 帳號與密碼");
  let plain;
  try {
    plain = secretCodec.decrypt(secret);
  } catch {
    throw new Error("無法解密 LINE 密碼，請重新輸入 Channel Secret");
  }
  return { enabled, channelId, recipients, secret: plain, title };
}
function menusForPermissions(permissions) {
  return database
    .prepare(
      "SELECT menu_key AS key,label,icon,route,required_permission AS required FROM menu_items WHERE enabled=1 ORDER BY sort_order",
    )
    .all()
    .filter(({ required }) => required === null || permissions.includes(required))
    .map(({ required, ...menu }) => menu);
}
function permissionsForRole(roleId) {
  return effectivePermissions(
    database
      .prepare(
        "SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?",
      )
      .all(roleId)
      .map((row) => row.code),
  );
}
/** A list of permissions means any one of them is enough. */
function requireSession(token, permission) {
  const session = sessions.get(token);
  if (!session) throw new Error("登入已失效，請重新登入");
  if (
    permission &&
    ![permission].flat().some((code) => session.permissions.includes(code))
  )
    throw new Error("權限不足");
  return session;
}
function login(username, password) {
  const user = database
    .prepare(
      "SELECT u.id,u.username,u.display_name,u.password_hash,u.role_id,u.channel_scope,r.code AS role_code,r.display_name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username=? AND u.active=1",
    )
    .get(String(username).trim().toLowerCase());
  if (!user || !verifyPassword(String(password), user.password_hash))
    throw new Error("帳號或密碼錯誤");
  const token = randomUUID();
  const permissions = permissionsForRole(user.role_id);
  const session = {
    token,
    userId: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role_name,
    roleCode: user.role_code,
    roleId: user.role_id,
    channelScope: user.channel_scope,
    permissions,
  };
  sessions.set(token, session);
  return {
    session,
    settings: visibleSettings(session),
    channelLimits: channelLimitsObject(),
    alarmReleases: alarmReleasesObject(),
    alarmRecordCounts: alarmRecordCounts(),
    alarmLatches: alarmLatchesObject(),
    menus: menusForPermissions(permissions),
  };
}
function logout(token) {
  sessions.delete(token);
}
function databaseStatus() {
  try {
    if (!database) throw new Error("資料庫尚未初始化");
    database.prepare("SELECT 1 FROM app_settings LIMIT 1").get();
    return { connected: true, checkedAt: new Date().toISOString() };
  } catch (error) {
    return {
      connected: false,
      checkedAt: new Date().toISOString(),
      error: error.message,
    };
  }
}

async function cleanupHistory(token, browserWindow, dialog) {
  requireSession(token, "settings.database.database.cleanup");
  if (cleanupInProgress) throw new Error("資料庫清理已在進行中");
  cleanupInProgress = true;
  try {
    const confirmation = await dialog.showMessageBox(browserWindow, {
      type: "warning",
      title: "清理 SQLite 歷史資料",
      message: "確定清除全部歷史資料？",
      detail:
        "將刪除所有感測歷史與同步紀錄，無法復原，請先備份資料庫。\n帳號、權限、系統設定及通道最新狀態會保留。\n清理完成後，自動同步會繼續產生新資料。",
      buttons: ["取消", "確認清理"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true };
    requireSession(token, "settings.database.database.cleanup");
    let readingsDeleted, logsDeleted;
    database.exec("BEGIN IMMEDIATE");
    try {
      readingsDeleted = Number(
        database.prepare("DELETE FROM sensor_readings").run().changes,
      );
      logsDeleted = Number(
        database.prepare("DELETE FROM ingest_log").run().changes,
      );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    // Deletion is already committed; report compaction failure separately.
    let warning = "";
    try {
      database.exec("VACUUM");
      const checkpoint = database
        .prepare("PRAGMA wal_checkpoint(TRUNCATE)")
        .get();
      if (checkpoint.busy)
        warning = "歷史資料已刪除；其他程式使用中，WAL 空間尚未完全回收。";
    } catch {
      warning =
        "歷史資料已刪除，但空間壓縮未完成；請關閉其他資料庫工具後再試。";
    }
    return { canceled: false, readingsDeleted, logsDeleted, warning };
  } finally {
    cleanupInProgress = false;
  }
}
function saveSetting(token, key, value) {
  const session = requireSession(token, settingPermission(key));
  if (
    key === "alarms.default_limits" ||
    key === "alarms.type_default_limits"
  ) {
    let stored;
    if (key === "alarms.default_limits") {
      validateLimits(value);
      stored = { low: value.low, high: value.high };
    } else stored = normalizeTypeDefaultLimits(value);
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(
          "UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=?",
        )
        .run(json(stored), key);
      refreshStoredLimits();
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return visibleSettings(session);
  }
  if (key === "alarms.release_reasons") {
    value = normalizeReleaseReasons(value);
    const current = settingsObject()["alarms.release_reasons"];
    const usage = releaseReasonUsageObject();
    const locked = (Array.isArray(current) ? current : []).find(
      (reason) => !value.includes(reason) && usage[reason],
    );
    if (locked)
      throw new Error(`「${locked}」已有解除紀錄，不能刪除，可改名`);
  }
  if (key === API_V1_CREDENTIALS_KEY) {
    saveApiV1Credentials(value);
    return visibleSettings(session);
  }
  if (key === "data.mode" && !DATA_MODES.includes(value))
    throw new Error("不支援的資料模式");
  if (key === "api.v1_url") value = normalizeApiV1Url(value);
  if (key === "api.poll_interval_ms" && ![10000, 30000, 60000].includes(value))
    throw new Error("刷新頻率僅支援 10、30、60 秒");
  if (
    [
      "notifications.enabled",
      "notifications.snapshot_stale_enabled",
      "alarms.sound_enabled",
    ].includes(key) &&
    typeof value !== "boolean"
  )
    throw new Error("開關設定必須為布林值");
  if (
    key === "alarms.sound_interval_seconds" &&
    (!Number.isInteger(value) || value < 1 || value > 300)
  )
    throw new Error("警報聲間隔需為 1～300 的整數秒");
  if (key === LINE_KEY) throw new Error("請由 LINE 設定儲存");
  if (key === "ui.font_sizes") value = normalizeFontSizes(value);
  if (key === "ui.titles") value = normalizeTitles(value);
  if (key === "ui.card_layouts") value = normalizeCardLayouts(value);
  if (Object.hasOwn(IMAGE_SETTINGS, key)) validateImage(key, value);
  if (key === "ui.logo_style" && !LOGO_STYLES.includes(value))
    throw new Error("不支援的 Logo 樣式");
  if (key === "ui.card_size" && !CARD_SIZES.includes(value))
    throw new Error("不支援的卡片大小");
  if (key === "ui.card_hover" && !CARD_HOVER_SCALES.includes(value))
    throw new Error("不支援的滑鼠移入效果");
  if (key === "ui.reading_colors") value = normalizeReadingColors(value);
  if (key === "ui.logo_size" && !LOGO_SIZES.includes(value))
    throw new Error("不支援的 Logo 大小");
  if (
    !database.prepare("SELECT 1 AS ok FROM app_settings WHERE key=?").get(key)
  )
    throw new Error("未知設定");
  database
    .prepare(
      "UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=?",
    )
    .run(json(value), key);
  return visibleSettings(session);
}
// Keep in sync with FONT_SIZE_AREAS in src/app/font-size.ts.
const FONT_SIZE_LIMITS = {
  general: 150,
  topbar: 200,
  cards: 200,
  units: 300,
  trends: 150,
};
// Areas added later default to 100% so older saved values stay valid.
const FONT_SIZE_OPTIONAL = new Set(["units"]);
function normalizeFontSizes(value) {
  const result = {};
  for (const [area, max] of Object.entries(FONT_SIZE_LIMITS)) {
    const percent =
      value && value[area] === undefined && FONT_SIZE_OPTIONAL.has(area)
        ? 100
        : value?.[area];
    if (!Number.isInteger(percent) || percent < 100 || percent > max)
      throw new Error(`字級需為 100～${max} 的整數百分比`);
    result[area] = percent;
  }
  return result;
}
const RELEASE_REASON_MAX_LENGTH = 60;
const RELEASE_REASON_MAX_COUNT = 50;
// A release silences a channel for one minute; if it is still out of range
// after that, the alarm fires again.
const ALARM_RELEASE_DURATION_MS = 60_000;
const releaseCutoff = (now = Date.now()) =>
  new Date(now - ALARM_RELEASE_DURATION_MS).toISOString();
function normalizeReleaseReason(value) {
  const reason = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!reason) throw new Error("請輸入解除理由");
  if (reason.length > RELEASE_REASON_MAX_LENGTH)
    throw new Error(`解除理由不可超過 ${RELEASE_REASON_MAX_LENGTH} 個字`);
  return reason;
}
function normalizeReleaseReasons(value) {
  if (!Array.isArray(value)) throw new Error("解除理由設定必須為清單");
  const reasons = [];
  for (const item of value) {
    const reason = normalizeReleaseReason(item);
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  if (reasons.length > RELEASE_REASON_MAX_COUNT)
    throw new Error(`解除理由最多 ${RELEASE_REASON_MAX_COUNT} 筆`);
  return reasons;
}
function releaseReasonUsageObject() {
  return Object.fromEntries(
    database
      .prepare(
        "SELECT release_reason,COUNT(*) AS count FROM alarm_releases GROUP BY release_reason",
      )
      .all()
      .map((row) => [row.release_reason, Number(row.count)]),
  );
}
function releaseReasonUsage(token) {
  requireSession(token);
  return releaseReasonUsageObject();
}
function renameReleaseReason(token, from, to) {
  const session = requireSession(
    token,
    settingPermission("alarms.release_reasons"),
  );
  const oldName = String(from ?? "").trim();
  const newName = normalizeReleaseReason(to);
  const current = settingsObject()["alarms.release_reasons"];
  const reasons = Array.isArray(current) ? current : [];
  const index = reasons.indexOf(oldName);
  if (index < 0) throw new Error("找不到要改名的解除理由，請重新整理");
  if (newName !== oldName && reasons.includes(newName))
    throw new Error("此理由已存在");
  const next = [...reasons];
  next[index] = newName;
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        "UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key='alarms.release_reasons'",
      )
      .run(json(normalizeReleaseReasons(next)));
    // Keep past records grouped under the option they were filed with.
    database
      .prepare(
        "UPDATE alarm_releases SET release_reason=? WHERE release_reason=?",
      )
      .run(newName, oldName);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return {
    settings: visibleSettings(session),
    releases: alarmReleasesObject(),
    usage: releaseReasonUsageObject(),
  };
}
// An alarm that "recovers" only because its limits were edited stays latched
// until someone releases it with a reason.
function alarmLatchesObject() {
  return Object.fromEntries(
    database
      .prepare("SELECT channel_id,alarm_reason,latched_at FROM alarm_latches")
      .all()
      .map((row) => [
        row.channel_id,
        { reason: row.alarm_reason, latchedAt: row.latched_at },
      ]),
  );
}
// The screen may show a newer reading than the stored one (manual refresh does
// not persist), so it reports the alarms it kept after a limit change.
function saveAlarmLatches(token, latches) {
  requireSession(token, [
    "sensor.limits.edit",
    settingPermission("alarms.default_limits"),
  ]);
  const insert = database.prepare(
    "INSERT OR IGNORE INTO alarm_latches(channel_id,alarm_reason,latched_at) SELECT channel_id,?,? FROM sensor_channels WHERE channel_id=?",
  );
  const now = new Date().toISOString();
  for (const [id, reason] of Object.entries(latches ?? {}))
    insert.run(String(reason || "警報").slice(0, 200), now, id);
  return alarmLatchesObject();
}
function alarmRecordCounts() {
  return Object.fromEntries(
    database
      .prepare(
        "SELECT channel_id,COUNT(*) AS count FROM alarm_releases GROUP BY channel_id",
      )
      .all()
      .map((row) => [row.channel_id, Number(row.count)]),
  );
}
function alarmReleasesObject() {
  return Object.fromEntries(
    database
      .prepare(
        "SELECT channel_id,release_reason,username,display_name,released_at FROM alarm_releases WHERE active=1 AND released_at>?",
      )
      .all(releaseCutoff())
      .map((row) => [
        row.channel_id,
        {
          reason: row.release_reason,
          username: row.username,
          displayName: row.display_name,
          releasedAt: row.released_at,
        },
      ]),
  );
}
function releaseAlarm(token, channelId, reason, saveAsOption = false) {
  const session = requireSession(token, "alarms.ack");
  const id = String(channelId ?? "").trim();
  const text = normalizeReleaseReason(reason);
  const row = database
    .prepare("SELECT raw_json FROM sensor_channels WHERE channel_id=?")
    .get(id);
  if (!row) throw new Error("通道不存在，請先刷新資料");
  const [channel] = applyChannelLimits([
    { ...parseJson(row.raw_json, {}), id },
  ]);
  const latch = database
    .prepare("SELECT alarm_reason FROM alarm_latches WHERE channel_id=?")
    .get(id);
  if (channelState(channel) === "ok" && !latch)
    throw new Error("此通道目前沒有警報，無需解除");
  if (outsideLimits(channel))
    throw new Error(
      "數值仍超出警報範圍，請先調整上下限並儲存個別設定，才能解除警報",
    );
  if (
    saveAsOption &&
    !session.permissions.includes(settingPermission("alarms.release_reasons"))
  )
    throw new Error("沒有解除理由設定權限，無法新增解除理由選項");
  database.exec("BEGIN IMMEDIATE");
  try {
    const now = new Date().toISOString();
    database
      .prepare(
        "UPDATE alarm_releases SET active=0,cleared_at=? WHERE channel_id=? AND active=1",
      )
      .run(now, id);
    database
      .prepare(
        "INSERT INTO alarm_releases(channel_id,alarm_reason,release_reason,username,display_name,released_at,active,cleared_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        channelState(channel) === "ok"
          ? latch.alarm_reason
          : channelReason(channel),
        text,
        session.username,
        session.displayName ?? "",
        now,
        // A latched channel is already back in range, so nothing is left to
        // silence: the next out-of-range reading must alarm at once.
        channelState(channel) === "ok" ? 0 : 1,
        channelState(channel) === "ok" ? now : null,
      );
    database.prepare("DELETE FROM alarm_latches WHERE channel_id=?").run(id);
    if (saveAsOption) {
      const current = settingsObject()["alarms.release_reasons"];
      const reasons = normalizeReleaseReasons([
        ...(Array.isArray(current) ? current : []),
        text,
      ]);
      database
        .prepare(
          "UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key='alarms.release_reasons'",
        )
        .run(json(reasons));
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return {
    releases: alarmReleasesObject(),
    recordCounts: alarmRecordCounts(),
    latches: alarmLatchesObject(),
    settings: visibleSettings(session),
    usage: releaseReasonUsageObject(),
  };
}
function getAlertSettings(token, test = false) {
  requireSession(
    token,
    test ? "settings.notification.desktop-notification.test" : undefined,
  );
  const settings = settingsObject();
  return {
    notificationsEnabled: settings["notifications.enabled"] !== false,
    soundEnabled: settings["alarms.sound_enabled"] !== false,
  };
}

function channelState(channel) {
  if (
    channel.status === "read_error" ||
    Number(channel.st) === 2 ||
    channel.pv === null ||
    channel.pv === undefined
  )
    return "error";
  const pv = Number(channel.pv),
    low = Number(channel.web_lo),
    high = Number(channel.web_hi);
  return Number(channel.st) === 3 ||
    channel.web_alarm ||
    (Number.isFinite(low) && pv < low) ||
    (Number.isFinite(high) && pv > high)
    ? "alarm"
    : "ok";
}
// A faulty sensor (error state) has no trustworthy value to compare.
function outsideLimits(channel) {
  if (channelState(channel) === "error") return false;
  const pv = Number(channel.pv),
    low = Number(channel.web_lo),
    high = Number(channel.web_hi);
  return (
    (Number.isFinite(low) && pv < low) || (Number.isFinite(high) && pv > high)
  );
}
function channelReason(channel) {
  const reasons = [];
  if (channel.status === "read_error") reasons.push("PV／SV 讀取失敗");
  else if (Number(channel.st) === 2) reasons.push("Sensor 異常");
  else if (channel.pv === null || channel.pv === undefined)
    reasons.push("PV 無讀值");
  if (Number(channel.st) === 3) reasons.push("讀值連續五筆相同");
  const pv = Number(channel.pv),
    low = Number(channel.web_lo),
    high = Number(channel.web_hi);
  if (channel.pv != null && Number.isFinite(low) && pv < low)
    reasons.push(`低於警報下限 ${withUnit(low, channelUnit(channel))}`);
  if (channel.pv != null && Number.isFinite(high) && pv > high)
    reasons.push(`高於警報上限 ${withUnit(high, channelUnit(channel))}`);
  if (channel.web_alarm) reasons.push("設備警報");
  return reasons.join("、") || null;
}
function validateLimits(value) {
  if (
    !value ||
    !Number.isFinite(value.low) ||
    !Number.isFinite(value.high) ||
    value.low >= value.high
  )
    throw new Error("請輸入有效數值，且下限必須小於上限");
}
function channelLimitsObject() {
  return Object.fromEntries(
    database
      .prepare("SELECT channel_id,low,high FROM channel_limits")
      .all()
      .map((row) => [row.channel_id, { low: row.low, high: row.high }]),
  );
}
const TYPE_UNITS = { temperature: "°C", humidity: "%" };
function channelType(channel) {
  return String(channel?.type ?? "").trim() || "temperature";
}
function channelUnit(channel) {
  return typeof channel?.unit === "string"
    ? channel.unit
    : (TYPE_UNITS[channelType(channel)] ?? "");
}
function withUnit(value, unit) {
  return unit ? `${value} ${unit}` : String(value);
}
// "alarms.default_limits" is for temperature (and untyped legacy channels);
// other types use "alarms.type_default_limits" and fall back to it.
const TYPE_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;
function typeDefaultLimits(settings, channel) {
  const type = channelType(channel);
  if (type === "temperature") return null;
  const byType = settings["alarms.type_default_limits"];
  return byType && typeof byType === "object" && byType[type]
    ? byType[type]
    : null;
}
function normalizeTypeDefaultLimits(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("類型預設上下限格式錯誤");
  const result = {};
  for (const [type, limits] of Object.entries(value)) {
    if (!TYPE_KEY_PATTERN.test(type) || type === "temperature")
      throw new Error(`不支援的類型：${type}`);
    validateLimits(limits);
    result[type] = { low: limits.low, high: limits.high };
  }
  return result;
}
function applyChannelLimits(channels) {
  const settings = settingsObject();
  const defaults = settings["alarms.default_limits"];
  const overrides = channelLimitsObject();
  return channels.map((channel) => {
    const id = String(channel.id ?? "").trim();
    const limits = overrides[id] ?? typeDefaultLimits(settings, channel) ?? defaults;
    return {
      ...channel,
      id,
      web_lo: limits.low,
      web_hi: limits.high,
      limit_source: overrides[id] ? "custom" : "default",
    };
  });
}
function refreshStoredLimits() {
  const channels = database
    .prepare("SELECT channel_id,raw_json FROM sensor_channels")
    .all()
    .map((row) => ({ ...parseJson(row.raw_json, {}), id: row.channel_id }));
  const update = database.prepare(
    "UPDATE sensor_channels SET alarm_low=?,alarm_high=?,last_state=?,raw_json=?,updated_at=CURRENT_TIMESTAMP WHERE channel_id=?",
  );
  const latch = database.prepare(
    "INSERT OR IGNORE INTO alarm_latches(channel_id,alarm_reason,latched_at) VALUES(?,?,?)",
  );
  const released = new Set(Object.keys(alarmReleasesObject()));
  const before = new Map(channels.map((channel) => [channel.id, channel]));
  const now = new Date().toISOString();
  for (const channel of applyChannelLimits(channels)) {
    const old = before.get(channel.id);
    if (
      old &&
      !released.has(channel.id) &&
      channelState(old) === "alarm" &&
      channelState(channel) === "ok"
    )
      latch.run(channel.id, channelReason(old) || "警報", now);
    update.run(
      channel.web_lo,
      channel.web_hi,
      channelState(channel),
      json(channel),
      channel.id,
    );
  }
}
function saveChannelLimits(token, channelId, limits) {
  requireSession(token, "sensor.limits.edit");
  const id = String(channelId ?? "").trim();
  if (
    !database
      .prepare("SELECT 1 FROM sensor_channels WHERE channel_id=?")
      .get(id)
  )
    throw new Error("通道不存在，請先刷新資料");
  if (limits !== null) validateLimits(limits);
  database.exec("BEGIN IMMEDIATE");
  try {
    if (limits === null)
      database.prepare("DELETE FROM channel_limits WHERE channel_id=?").run(id);
    else
      database
        .prepare(
          "INSERT INTO channel_limits(channel_id,low,high) VALUES(?,?,?) ON CONFLICT(channel_id) DO UPDATE SET low=excluded.low,high=excluded.high",
        )
        .run(id, limits.low, limits.high);
    refreshStoredLimits();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return channelLimitsObject();
}
function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function validateApiSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object")
    throw new Error("API 回應格式錯誤");
  if (
    Number(snapshot.schema_version) !== 1 ||
    Number(snapshot.status_version) !== 1 ||
    Number(snapshot.st_version) !== 2
  )
    throw new Error(
      `API 版本不支援 (schema=${snapshot.schema_version}, status=${snapshot.status_version}, st=${snapshot.st_version})`,
    );
  if (!Array.isArray(snapshot.channels) || !snapshot.channels.length)
    throw new Error("API 回應沒有 channels 資料");
  if (
    snapshot.channel_count != null &&
    Number(snapshot.channel_count) !== snapshot.channels.length
  )
    throw new Error("API channel_count 與 channels 數量不符");
}
function hydrateChannels(channels) {
  const stats = database.prepare(
    "SELECT MIN(pv) AS min,MAX(pv) AS max,AVG(pv) AS avg,COUNT(pv) AS count FROM sensor_readings WHERE channel_id=?",
  );
  const history = database.prepare(
    "SELECT recorded_at AS time,pv AS value FROM sensor_readings WHERE channel_id=? AND pv IS NOT NULL ORDER BY recorded_at DESC,id DESC LIMIT 500",
  );
  const releases = alarmReleasesObject();
  const latches = alarmLatchesObject();
  return applyChannelLimits(channels).map((channel) => {
    const id = String(channel.id ?? "").trim(),
      summary = stats.get(id),
      points = history.all(id).reverse();
    return {
      ...channel,
      id,
      time: normalizeDate(channel.time) || null,
      history: points,
      min: summary.min,
      max: summary.max,
      avg: summary.avg,
      count: Number(summary.count),
      web_alarm: Boolean(channel.web_alarm),
      web_alarm_ack:
        Boolean(channel.web_alarm_ack) ||
        (Boolean(releases[id]) && channelState(channel) !== "ok"),
      alarm_release: releases[id] ?? null,
      alarm_latch: latches[id] ?? null,
    };
  });
}
function ingestSnapshot(snapshot, source = "api", sourceUrl = null) {
  const channels = applyChannelLimits(
    Array.isArray(snapshot?.channels) ? snapshot.channels : [],
  );
  if (!channels.length) throw new Error("API 回應沒有 channels 資料");
  const batchId = randomUUID(),
    recordedAt =
      normalizeDate(snapshot.collected_at) ||
      normalizeDate(snapshot.time) ||
      new Date().toISOString();
  const upsert = database.prepare(
    `INSERT INTO sensor_channels(channel_id,name,sv,alarm_low,alarm_high,last_pv,last_state,last_seen_at,raw_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(channel_id) DO UPDATE SET name=excluded.name,sv=excluded.sv,alarm_low=excluded.alarm_low,alarm_high=excluded.alarm_high,last_pv=excluded.last_pv,last_state=excluded.last_state,last_seen_at=excluded.last_seen_at,raw_json=excluded.raw_json,updated_at=CURRENT_TIMESTAMP`,
  );
  const clearRelease = database.prepare(
    "UPDATE alarm_releases SET active=0,cleared_at=? WHERE channel_id=? AND active=1",
  );
  const expireReleases = database.prepare(
    "UPDATE alarm_releases SET active=0,cleared_at=? WHERE active=1 AND released_at<=?",
  );
  const insert = database.prepare(
    "INSERT INTO sensor_readings(batch_id,channel_id,pv,sv,state,alarm_low,alarm_high,recorded_at,source,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    const nowIso = new Date().toISOString();
    expireReleases.run(nowIso, releaseCutoff());
    for (const channel of channels) {
      const id = String(channel.id ?? "").trim();
      if (!id) throw new Error("API Channel 缺少 id");
      const state = channelState(channel),
        rowTime = normalizeDate(channel.time) || recordedAt;
      const pv = channel.pv == null ? null : Number(channel.pv),
        sv = channel.sv == null ? null : Number(channel.sv),
        low = channel.web_lo == null ? null : Number(channel.web_lo),
        high = channel.web_hi == null ? null : Number(channel.web_hi);
      const normalized = { ...channel, id, time: rowTime };
      // A release only covers the current abnormal episode; recovery re-arms
      // it, and it never covers a reading outside the limits.
      if (state === "ok" || outsideLimits(channel))
        clearRelease.run(rowTime, id);
      upsert.run(
        id,
        String(channel.name ?? `CH${id}`),
        sv,
        low,
        high,
        pv,
        state,
        rowTime,
        json(normalized),
      );
      insert.run(
        batchId,
        id,
        pv,
        sv,
        state,
        low,
        high,
        rowTime,
        source,
        json(normalized),
      );
    }
    database
      .prepare(
        "INSERT INTO ingest_log(batch_id,source,source_url,channel_count,status) VALUES(?,?,?,?,?)",
      )
      .run(batchId, source, sourceUrl, channels.length, "success");
    const days = Math.max(
      1,
      Number(settingsObject()["report.retention_days"] ?? 365),
    );
    database
      .prepare(
        "DELETE FROM sensor_readings WHERE recorded_at < datetime('now', ?)",
      )
      .run(`-${days} days`);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { batchId, channelCount: channels.length, recordedAt };
}
// Recording and alarm notices run in the background for whoever is signed in,
// so they need a session but no particular menu.
function normalizeApiV1Url(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("API v1 網址格式不正確");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("API v1 網址需為 http 或 https");
  // Accept a pasted endpoint and keep only the site the API lives on.
  const base = url.pathname.replace(/\/api\/v1(\/.*)?$/, "").replace(/\/+$/, "");
  return `${url.origin}${base}`;
}
function saveApiV1Credentials(input) {
  const username = String(input?.username ?? "").trim();
  const newPassword = String(input?.password ?? "");
  if (username.length > 80) throw new Error("API v1 帳號最多 80 字元");
  if (Buffer.byteLength(newPassword, "utf8") > 1024)
    throw new Error("API v1 密碼過長");
  const current = parseJson(
    database
      .prepare("SELECT value_json FROM app_settings WHERE key=?")
      .get(API_V1_CREDENTIALS_KEY).value_json,
    {},
  );
  if (username && !newPassword && !current.password)
    throw new Error("請輸入 API v1 密碼");
  // A blank password keeps the saved one; a blank username clears both.
  const password = !username
    ? ""
    : newPassword
      ? secretCodec.encrypt(newPassword)
      : current.password;
  database
    .prepare(
      "UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=?",
    )
    .run(json({ username, password }), API_V1_CREDENTIALS_KEY);
  apiV1Session = null;
}
function apiV1Credentials() {
  const stored = parseJson(
    database
      .prepare("SELECT value_json FROM app_settings WHERE key=?")
      .get(API_V1_CREDENTIALS_KEY)?.value_json,
    {},
  );
  if (!stored?.username || !stored.password)
    throw new Error("尚未設定 API v1 帳號與密碼");
  let password;
  try {
    password = secretCodec.decrypt(stored.password);
  } catch {
    throw new Error("API v1 密碼無法解密，請重新儲存");
  }
  return { username: stored.username, password };
}
// Login cookie kept in the main process only; reset when settings change.
let apiV1Session = null;
async function apiV1Error(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail = typeof body?.detail === "string" ? body.detail : "";
  } catch {
    // Errors may not be JSON.
  }
  return new Error(
    `API v1 ${response.status}${detail ? `：${detail}` : `: ${response.statusText ?? ""}`}`.trim(),
  );
}
async function apiV1Login(base) {
  const { username, password } = apiV1Credentials();
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(base).origin,
    },
    body: JSON.stringify({ username, password }),
  });
  if (response.status === 401) throw new Error("API v1 帳號或密碼錯誤");
  if (response.status === 429) {
    const wait = response.headers?.get?.("retry-after");
    throw new Error(
      `API v1 登入過於頻繁${wait ? `，請 ${wait} 秒後再試` : ""}`,
    );
  }
  if (!response.ok) throw await apiV1Error(response);
  const cookies =
    response.headers?.getSetCookie?.() ??
    [response.headers?.get?.("set-cookie")].filter(Boolean);
  const cookie = cookies
    .map((line) => String(line).split(";")[0].trim())
    .find((pair) => pair.startsWith("edgesense_session="));
  if (!cookie) throw new Error("API v1 登入未取得 Session Cookie");
  apiV1Session = { base, username, cookie };
}
async function apiV1Get(base, path) {
  const { username } = apiV1Credentials();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (apiV1Session?.base !== base || apiV1Session.username !== username)
      await apiV1Login(base);
    const response = await fetch(`${base}${path}`, {
      cache: "no-store",
      headers: { Cookie: apiV1Session.cookie },
    });
    // Sessions end after 8 hours or a backend restart: sign in again once.
    if (response.status === 401 && attempt === 0) {
      apiV1Session = null;
      continue;
    }
    if (!response.ok) throw await apiV1Error(response);
    return response.json();
  }
  throw new Error("API v1 無法登入");
}
/** Maps /api/v1/channels/current onto the snapshot shape the app stores. */
function apiV1Snapshot(current, pollSeconds, now = Date.now()) {
  if (!current || !Array.isArray(current.channels))
    throw new Error("API v1 回應格式錯誤");
  if (!current.channels.length)
    throw new Error("API v1 沒有可查看的監測點");
  const collectedAt = normalizeDate(current.snapshot_at) || new Date(now).toISOString();
  const channels = current.channels.map((channel) => {
    const value =
      typeof channel.value === "number" && Number.isFinite(channel.value)
        ? channel.value
        : null;
    // st null with no time means the first reading has not arrived yet.
    const waiting = channel.st == null && value === null;
    return {
      id: String(channel.id ?? "").trim(),
      name: String(channel.name ?? channel.id ?? ""),
      type: String(channel.type ?? ""),
      unit: String(channel.unit ?? ""),
      pv: value,
      sv: null,
      st: waiting ? 2 : channel.st,
      status: value === null ? "read_error" : "ok",
      time: normalizeDate(channel.time),
      ...(waiting ? { waiting: true } : {}),
    };
  });
  const times = channels
    .map((channel) => (channel.time ? Date.parse(channel.time) : NaN))
    .filter(Number.isFinite);
  const ageSeconds = times.length
    ? Math.max(0, (now - Math.max(...times)) / 1000)
    : 0;
  return {
    collected_at: collectedAt,
    status: "connected",
    channel_count: channels.length,
    channels,
    age_seconds: ageSeconds,
    stale: times.length > 0 && ageSeconds > Math.max(120, pollSeconds * 3),
  };
}
async function syncApiV1(token, persist) {
  const settings = settingsObject();
  const base = normalizeApiV1Url(settings["api.v1_url"] ?? DEFAULT_API_V1_URL);
  const current = await apiV1Get(base, "/api/v1/channels/current");
  requireSession(token);
  const snapshot = apiV1Snapshot(
    current,
    Number(settings["api.poll_interval_ms"] ?? 60000) / 1000,
  );
  const url = `${base}/api/v1/channels/current`;
  const result = persist
    ? { ...ingestSnapshot(snapshot, "api-v1", url), persisted: true }
    : {
        batchId: null,
        channelCount: snapshot.channels.length,
        recordedAt: snapshot.collected_at,
        persisted: false,
      };
  return {
    snapshot: {
      ...snapshot,
      channels: hydrateChannels(
        snapshot.channels.map((channel) => ({
          ...channel,
          time: channel.time || snapshot.collected_at,
        })),
      ),
    },
    result,
  };
}
function ingestSnapshotAuthorized(token, snapshot, source = "mock") {
  requireSession(token);
  return ingestSnapshot(snapshot, source, null);
}
async function syncApi(token, persist = true) {
  requireSession(token);
  if (settingsObject()["data.mode"] === "live-multi")
    return syncApiV1(token, persist);
  const settings = settingsObject(),
    url = String(settings["api.data_url"]),
    apiToken = String(settings["api.auth_token"] ?? "");
  const response = await fetch(url, {
    cache: "no-store",
    headers: apiToken ? { "X-EC62-Token": apiToken } : {},
  });
  if (!response.ok)
    throw new Error(`API ${response.status}: ${response.statusText}`);
  const snapshot = await response.json();
  validateApiSnapshot(snapshot);
  requireSession(token);
  const recordedAt =
    normalizeDate(snapshot.collected_at) ||
    normalizeDate(snapshot.time) ||
    new Date().toISOString();
  const result = persist
    ? { ...ingestSnapshot(snapshot, "api", url), persisted: true }
    : {
        batchId: null,
        channelCount: snapshot.channels.length,
        recordedAt,
        persisted: false,
      };
  const current = snapshot.channels.map((channel) => ({
    ...channel,
    time: normalizeDate(channel.time) || result.recordedAt,
  }));
  return {
    snapshot: {
      ...snapshot,
      collected_at: result.recordedAt,
      channels: hydrateChannels(current),
    },
    result,
  };
}
function latestSnapshot(token) {
  requireSession(token, [
    "dashboard.view",
    "trends.view",
    "alarms.view",
    "sensor.detail",
  ]);
  return hydrateChannels(
    database
      .prepare(
        "SELECT channel_id AS id,name,last_pv AS pv,sv,last_state,alarm_low AS web_lo,alarm_high AS web_hi,last_seen_at AS time,raw_json FROM sensor_channels ORDER BY CAST(channel_id AS INTEGER)",
      )
      .all()
      .map((row) => ({
        ...parseJson(row.raw_json, {}),
        id: row.id,
        name: row.name,
        pv: row.pv,
        sv: row.sv,
        web_lo: row.web_lo,
        web_hi: row.web_hi,
        time: row.time,
      })),
  );
}

function reportWhere(filter = {}) {
  const clauses = [],
    values = [];
  if (filter.query) {
    clauses.push("(r.channel_id LIKE ? OR c.name LIKE ?)");
    values.push(`%${filter.query}%`, `%${filter.query}%`);
  }
  if (filter.state && filter.state !== "all") {
    clauses.push("r.state=?");
    values.push(filter.state);
  }
  if (filter.from) {
    clauses.push("r.recorded_at>=?");
    values.push(normalizeDate(`${filter.from}T00:00:00`) || filter.from);
  }
  if (filter.to) {
    clauses.push("r.recorded_at<=?");
    values.push(normalizeDate(`${filter.to}T23:59:59.999`) || filter.to);
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}
function queryReport(token, filter = {}) {
  requireSession(token, "reports.table");
  const where = reportWhere(filter),
    limit = Math.min(1000, Math.max(1, Number(filter.limit) || 50)),
    offset = Math.max(0, Number(filter.offset) || 0);
  const total = database
    .prepare(
      `SELECT COUNT(*) AS count FROM sensor_readings r JOIN sensor_channels c ON c.channel_id=r.channel_id ${where.sql}`,
    )
    .get(...where.values).count;
  const rows = database
    .prepare(
      `SELECT r.id,r.batch_id,r.channel_id AS id,c.name,r.pv,r.sv,r.state,r.alarm_low AS web_lo,r.alarm_high AS web_hi,r.recorded_at AS time,r.source,r.raw_json FROM sensor_readings r JOIN sensor_channels c ON c.channel_id=r.channel_id ${where.sql} ORDER BY r.recorded_at DESC,CAST(r.channel_id AS INTEGER) LIMIT ? OFFSET ?`,
    )
    .all(...where.values, limit, offset)
    .map((row) => {
      const raw = parseJson(row.raw_json, {}),
        reason = channelReason({
          ...raw,
          pv: row.pv,
          web_lo: row.web_lo,
          web_hi: row.web_hi,
        });
      delete row.raw_json;
      return { ...row, reason };
    });
  return { rows, total, limit, offset };
}
function csvCell(value) {
  const text = value == null ? "" : String(value);
  // SQLite numeric values are safe; only text needs formula-prefix protection.
  const isNumber = typeof value === "number" && Number.isFinite(value);
  return `"${(!isNumber && /^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}
function exportTimeBoundary(value, isEnd) {
  return value ? `${value} ${isEnd ? "23:59:59" : "00:00:00"}` : "";
}
function exportTimestamp() {
  const date = new Date(),
    pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
async function exportReport(token, filter, browserWindow, dialog) {
  requireSession(token, "reports.export");
  const where = reportWhere(filter),
    rows = database
      .prepare(
        `SELECT r.channel_id AS id,c.name,r.state,r.pv,r.sv,r.alarm_low AS low,r.alarm_high AS high,r.recorded_at AS time,r.source,r.raw_json FROM sensor_readings r JOIN sensor_channels c ON c.channel_id=r.channel_id ${where.sql} ORDER BY r.recorded_at DESC,CAST(r.channel_id AS INTEGER)`,
      )
      .all(...where.values)
      .map((row) => ({
        ...row,
        ...(() => {
          const raw = parseJson(row.raw_json, {});
          return {
            unit: channelUnit(raw),
            reason: channelReason({
              ...raw,
              pv: row.pv,
              web_lo: row.low,
              web_hi: row.high,
            }),
          };
        })(),
      }));
  const result = await dialog.showSaveDialog(browserWindow, {
    title: "匯出 SQLite 報表",
    defaultPath: `EdgeBox報表_${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const header = [
    "通道",
    "名稱",
    "狀態",
    "異常原因",
    "PV",
    "SV",
    "單位",
    "警報下限",
    "警報上限",
    "記錄時間",
    "來源",
  ];
  const metadata = [
    [
      "申請人",
      filter.applicant,
      "開始時間",
      exportTimeBoundary(filter.from, false),
    ],
    ["手機", filter.phone, "結束時間", exportTimeBoundary(filter.to, true)],
    ["信箱", filter.email, "報表時間", exportTimestamp()],
    ["場域", filter.site],
  ];
  const content = `\ufeff${header.map(csvCell).join(",")}\r\n${rows.map((row) => [row.id, row.name, row.state, row.reason ?? "", row.pv, row.sv, row.unit, row.low, row.high, row.time, row.source].map(csvCell).join(",")).join("\r\n")}\r\n\r\n${metadata.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  fs.writeFileSync(result.filePath, content, "utf8");
  return { canceled: false, filePath: result.filePath, rowCount: rows.length };
}
function localTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function alarmReleaseRows(channelId) {
  const id = String(channelId ?? "").trim();
  return database
    .prepare(
      "SELECT a.channel_id AS id,COALESCE(c.name,'') AS name,a.alarm_reason,a.release_reason,a.display_name,a.username,a.released_at,a.cleared_at,a.active FROM alarm_releases a LEFT JOIN sensor_channels c ON c.channel_id=a.channel_id WHERE a.channel_id=? ORDER BY a.released_at DESC,a.id DESC",
    )
    .all(id);
}
async function exportAlarmReleases(token, channelId, browserWindow, dialog) {
  requireSession(token, "sensor.records");
  const id = String(channelId ?? "").trim();
  const rows = alarmReleaseRows(id);
  if (!rows.length) throw new Error("此感應器尚無解除警報紀錄");
  const result = await dialog.showSaveDialog(browserWindow, {
    title: "匯出解除警報紀錄",
    defaultPath: `CH${id}_解除警報紀錄_${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: "Excel CSV", extensions: ["csv"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const header = [
    "通道",
    "名稱",
    "警報原因",
    "解除理由",
    "解除人員",
    "帳號",
    "解除時間",
    "恢復時間",
    "狀態",
  ];
  const lines = rows.map((row) =>
    [
      `CH${row.id}`,
      row.name,
      row.alarm_reason ?? "",
      row.release_reason,
      row.display_name,
      row.username,
      localTimestamp(row.released_at),
      localTimestamp(row.cleared_at),
      row.active ? "解除中" : "已結束",
    ]
      .map(csvCell)
      .join(","),
  );
  fs.writeFileSync(
    result.filePath,
    `\ufeff${header.map(csvCell).join(",")}\r\n${lines.join("\r\n")}\r\n\r\n${["匯出時間", exportTimestamp()].map(csvCell).join(",")}`,
    "utf8",
  );
  return { canceled: false, filePath: result.filePath, rowCount: rows.length };
}

function listUsers(token) {
  requireSession(token, "users.accounts.list");
  return database
    .prepare(
      "SELECT u.id,u.username,u.display_name AS displayName,u.phone,u.email,r.code AS roleCode,r.display_name AS role,u.channel_scope AS scope,u.active FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id",
    )
    .all();
}
/** Nobody may hand out, or take over, more access than they have. */
function assertWithinAccess(actor, ...roleIds) {
  for (const id of roleIds)
    if (
      permissionsForRole(id).some((code) => !actor.permissions.includes(code))
    )
      throw new Error("權限不足：不可操作權限高於自己的角色或帳號");
}
function saveUser(token, input) {
  const actor = requireSession(
    token,
    input.id != null ? "users.accounts.edit" : "users.accounts.create",
  );
  const username = String(input.username ?? "")
    .trim()
    .toLowerCase();
  const displayName = String(input.displayName ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const email = String(input.email ?? "").trim();
  const scope = String(input.scope ?? "").trim() || "all";
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("帳號格式不正確");
  if (!displayName || displayName.length > 80)
    throw new Error("顯示名稱需為 1～80 個字");
  if (phone.length > 30 || (phone && !/^[0-9+()\s-]+$/.test(phone)))
    throw new Error("手機格式不正確");
  if (
    email.length > 254 ||
    (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new Error("信箱格式不正確");
  if (scope.length > 200) throw new Error("通道範圍過長");
  const role = database
    .prepare("SELECT id,code,display_name FROM roles WHERE code=?")
    .get(String(input.roleCode));
  if (!role) throw new Error("角色不存在");
  if (input.id != null) {
    const id = Number(input.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("帳號 ID 不正確");
    const target = database
      .prepare(
        "SELECT id,username,role_id,active,channel_scope FROM users WHERE id=?",
      )
      .get(id);
    if (!target) throw new Error("帳號不存在");
    assertWithinAccess(actor, target.role_id, role.id);
    if (username !== target.username) throw new Error("不可變更登入帳號");
    const active =
      input.active == null
        ? target.active
        : input.active === false || input.active === 0
          ? 0
          : 1;
    if (
      (target.username === "admin" || target.id === actor.userId) &&
      (role.id !== target.role_id || !active)
    ) {
      throw new Error("內建管理員及目前登入帳號不可停用或變更角色");
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(
          "UPDATE users SET display_name=?,phone=?,email=?,role_id=?,channel_scope=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .run(displayName, phone, email, role.id, scope, active, id);
      if (input.password)
        database
          .prepare(
            "UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .run(hashPassword(String(input.password)), id);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    const accessChanged =
      role.id !== target.role_id ||
      active !== target.active ||
      scope !== target.channel_scope ||
      Boolean(input.password);
    for (const [sessionToken, session] of sessions) {
      if (session.userId !== id) continue;
      if (accessChanged && sessionToken !== token)
        sessions.delete(sessionToken);
      else {
        session.displayName = displayName;
        session.channelScope = scope;
      }
    }
  } else {
    assertWithinAccess(actor, role.id);
    createUser(
      username,
      displayName,
      String(input.password ?? ""),
      role.code,
      scope,
      phone,
      email,
    );
  }
  return listUsers(token);
}
function deleteUser(token, id) {
  const session = requireSession(token, "users.accounts.delete"),
    target = database
      .prepare("SELECT username,role_id FROM users WHERE id=?")
      .get(Number(id));
  if (!target || target.username === "admin" || Number(id) === session.userId)
    throw new Error("此帳號不可刪除");
  assertWithinAccess(session, target.role_id);
  database.prepare("DELETE FROM users WHERE id=?").run(Number(id));
  return listUsers(token);
}
function listRoles(token) {
  requireSession(token, ["users.accounts.list", "users.roles.list"]);
  const labels = new Map(NODES.map((node) => [node.code, node.label]));
  return database
    .prepare(
      "SELECT r.id,r.code,r.display_name AS displayName,r.description,r.is_system AS isSystem,(SELECT COUNT(*) FROM users u WHERE u.role_id=r.id) AS userCount FROM roles r ORDER BY r.id",
    )
    .all()
    .map(({ id, ...role }) => ({
      ...role,
      isSystem: Boolean(role.isSystem),
      userCount: Number(role.userCount),
      permissions: permissionsForRole(id).map((code) => ({
        code,
        label: labels.get(code),
      })),
    }));
}
const ROLE_NAME_MAX_LENGTH = 30;
const ROLE_DESCRIPTION_MAX_LENGTH = 120;
/** Adds a role when the input has no code. Returns the code that was saved. */
function saveRole(token, input) {
  const editing = input?.code != null;
  const actor = requireSession(
    token,
    editing ? "users.roles.edit" : "users.roles.create",
  );
  const text = (value) =>
    String(value ?? "")
      .trim()
      .replace(/\s+/g, " ");
  const displayName = text(input?.displayName);
  const description = text(input?.description);
  if (!displayName || displayName.length > ROLE_NAME_MAX_LENGTH)
    throw new Error(`角色名稱需為 1～${ROLE_NAME_MAX_LENGTH} 個字`);
  if (description.length > ROLE_DESCRIPTION_MAX_LENGTH)
    throw new Error(`角色說明不可超過 ${ROLE_DESCRIPTION_MAX_LENGTH} 個字`);
  const permissions = normalizePermissions(input?.permissions);
  const code = editing ? String(input.code) : `role-${randomUUID()}`;
  const role = database
    .prepare("SELECT id FROM roles WHERE code=?")
    .get(code);
  if (editing) {
    if (!role) throw new Error("角色不存在，請重新整理");
    if (code === ADMINISTRATOR)
      throw new Error("Administrator 固定擁有全部權限，不可修改");
    if (role.id === actor.roleId)
      throw new Error("不可修改目前登入帳號所屬的角色");
    assertWithinAccess(actor, role.id);
  }
  if (permissions.some((item) => !actor.permissions.includes(item)))
    throw new Error("權限不足：不可授予自己沒有的權限");
  if (
    database
      .prepare(
        "SELECT 1 FROM roles WHERE display_name=? COLLATE NOCASE AND code<>?",
      )
      .get(displayName, code)
  )
    throw new Error("角色名稱已存在");
  database.exec("BEGIN IMMEDIATE");
  try {
    if (editing) {
      database
        .prepare("UPDATE roles SET display_name=?,description=? WHERE id=?")
        .run(displayName, description, role.id);
      database
        .prepare("DELETE FROM role_permissions WHERE role_id=?")
        .run(role.id);
    } else
      database
        .prepare(
          "INSERT INTO roles(code,display_name,description,is_system) VALUES(?,?,?,0)",
        )
        .run(code, displayName, description);
    grantPermissions(code, permissions);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  // Their permissions were read at login.
  if (editing)
    for (const [sessionToken, session] of sessions)
      if (session.roleId === role.id) sessions.delete(sessionToken);
  return { code, roles: listRoles(token) };
}
function deleteRole(token, code) {
  const actor = requireSession(token, "users.roles.delete");
  const role = database
    .prepare(
      "SELECT r.id,r.is_system,(SELECT COUNT(*) FROM users u WHERE u.role_id=r.id) AS userCount FROM roles r WHERE r.code=?",
    )
    .get(String(code));
  if (!role) throw new Error("角色不存在，請重新整理");
  if (role.is_system) throw new Error("內建角色不可刪除");
  if (role.userCount)
    throw new Error(
      `尚有 ${role.userCount} 個帳號使用此角色，請先改用其他角色`,
    );
  assertWithinAccess(actor, role.id);
  database.prepare("DELETE FROM roles WHERE id=?").run(role.id);
  return listRoles(token);
}

module.exports = {
  initializeDatabase,
  getAlertSettings,
  databaseStatus,
  cleanupHistory,
  settingsObject,
  configureSecretCodec,
  saveLineSettings,
  getLineDelivery,
  login,
  logout,
  saveSetting,
  saveChannelLimits,
  releaseAlarm,
  releaseReasonUsage,
  renameReleaseReason,
  alarmRecordCounts,
  alarmLatchesObject,
  saveAlarmLatches,
  ALARM_RELEASE_DURATION_MS,
  alarmReleaseRows,
  exportAlarmReleases,
  ingestSnapshotAuthorized,
  syncApi,
  apiV1Snapshot,
  latestSnapshot,
  queryReport,
  exportReport,
  listUsers,
  saveUser,
  deleteUser,
  listRoles,
  saveRole,
  deleteRole,
  visibleSettings,
};
