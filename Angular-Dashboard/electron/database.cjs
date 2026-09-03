const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

let database;
const sessions = new Map();
let cleanupInProgress = false;
const json = (value) => JSON.stringify(value);
function parseJson(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }

function initializeDatabase(userDataPath) {
  const directory = path.join(userDataPath, 'data');
  fs.mkdirSync(directory, { recursive: true });
  const dbPath = path.join(directory, 'e62-dashboard.sqlite3');
  database = new DatabaseSync(dbPath);
  database.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'general',description TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS roles(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',is_system INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS permissions(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS role_permissions(role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,PRIMARY KEY(role_id,permission_id));
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE COLLATE NOCASE,display_name TEXT NOT NULL,password_hash TEXT NOT NULL,role_id INTEGER NOT NULL REFERENCES roles(id),channel_scope TEXT NOT NULL DEFAULT 'all',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS menu_items(id INTEGER PRIMARY KEY AUTOINCREMENT,menu_key TEXT NOT NULL UNIQUE,label TEXT NOT NULL,icon TEXT NOT NULL,route TEXT NOT NULL,sort_order INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,required_permission TEXT);
    CREATE TABLE IF NOT EXISTS sensor_channels(channel_id TEXT PRIMARY KEY,name TEXT NOT NULL,sv REAL,alarm_low REAL,alarm_high REAL,last_pv REAL,last_state TEXT NOT NULL DEFAULT 'ok',last_seen_at TEXT,raw_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS channel_limits(channel_id TEXT PRIMARY KEY REFERENCES sensor_channels(channel_id),low REAL NOT NULL,high REAL NOT NULL,CHECK(low < high));
    CREATE TABLE IF NOT EXISTS sensor_readings(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL,channel_id TEXT NOT NULL,pv REAL,sv REAL,state TEXT NOT NULL,alarm_low REAL,alarm_high REAL,recorded_at TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,source TEXT NOT NULL DEFAULT 'api',raw_json TEXT NOT NULL,FOREIGN KEY(channel_id) REFERENCES sensor_channels(channel_id));
    CREATE INDEX IF NOT EXISTS idx_readings_recorded ON sensor_readings(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_readings_channel_time ON sensor_readings(channel_id,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_readings_state_time ON sensor_readings(state,recorded_at DESC);
    CREATE TABLE IF NOT EXISTS ingest_log(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL UNIQUE,source TEXT NOT NULL,source_url TEXT,channel_count INTEGER NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL,error_message TEXT);
  `);
  seedDatabase();
  refreshStoredLimits();
  return dbPath;
}

function seedDatabase() {
  const settings = [
    ['data.mode','mock','api','mock 或 live'],['api.data_url','http://127.0.0.1:8080/api/data','api','EC62 API 資料端點'],['api.auth_token','','api','X-EC62-Token'],
    ['api.poll_interval_ms',60000,'api','自動同步間隔'],['report.retention_days',365,'report','歷史資料保留天數'],
    ['dashboard.show_status',true,'display','顯示 Header 狀態列'],['ui.default_view','overview','display','登入後預設頁面'],
    ['notifications.enabled',true,'notification','允許桌面通知'],
    ['alarms.sound_enabled',true,'notification','異常警報聲音'],
    ['alarms.sound_interval_seconds',3,'notification','持續警報聲播放間隔（秒）'],
    ['alarms.default_limits',{low:2,high:8},'alarm','未個別設定通道的預設溫度上下限'],
  ];
  const insertSetting = database.prepare('INSERT OR IGNORE INTO app_settings(key,value_json,category,description) VALUES(?,?,?,?)');
  settings.forEach(([key,value,category,description]) => insertSetting.run(key,json(value),category,description));
  database.prepare("UPDATE app_settings SET value_json='60000',updated_at=CURRENT_TIMESTAMP WHERE key='api.poll_interval_ms' AND value_json NOT IN ('10000','30000','60000')").run();
  database.prepare("UPDATE app_settings SET value_json='\"settings\"' WHERE key='ui.default_view' AND value_json='\"account\"'").run();
  const insertRole = database.prepare('INSERT OR IGNORE INTO roles(code,display_name,description,is_system) VALUES(?,?,?,?)');
  [['administrator','Administrator','完整系統管理權限',1],['operator','Operator','監控、報表及警報操作',1],['guest','Guest','唯讀監控與報表',1]].forEach((row) => insertRole.run(...row));
  const permissionRows = [
    ['dashboard.view','檢視儀錶板','即時感應器監控'],['trends.view','檢視趨勢','即時趨勢圖'],['reports.view','查詢報表','SQLite 歷史資料查詢'],
    ['reports.export','匯出報表','匯出 CSV'],['alarms.view','檢視警報','警報與斷線事件'],['alarms.ack','確認警報','解除警報'],
    ['users.manage','帳號管理','帳號、角色與權限'],['settings.manage','系統設定','API 與應用設定'],['tests.run','功能測試','通知與聲音測試'],
  ];
  const insertPermission = database.prepare('INSERT OR IGNORE INTO permissions(code,display_name,description) VALUES(?,?,?)');
  permissionRows.forEach((row) => insertPermission.run(...row));
  const matrix = {
    administrator: permissionRows.map((row) => row[0]),
    operator: ['dashboard.view','trends.view','reports.view','reports.export','alarms.view','alarms.ack','tests.run'],
    guest: ['dashboard.view','trends.view','reports.view','alarms.view'],
  };
  const link = database.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r,permissions p WHERE r.code=? AND p.code=?');
  Object.entries(matrix).forEach(([role,codes]) => codes.forEach((code) => link.run(role,code)));
  const menus = [
    ['overview','儀錶板','speed','overview',10,'dashboard.view'],['trends','趨勢圖','trending_up','trends',20,'trends.view'],
    ['channels','報表資料','table_view','channels',30,'reports.view'],['alarms','警報中心','notifications_active','alarms',40,'alarms.view'],
    ['permissions','帳號權限','verified_user','permissions',50,'users.manage'],['settings','設定','settings','settings',70,'settings.manage'],
  ];
  const insertMenu = database.prepare('INSERT INTO menu_items(menu_key,label,icon,route,sort_order,required_permission) VALUES(?,?,?,?,?,?) ON CONFLICT(menu_key) DO UPDATE SET label=excluded.label,icon=excluded.icon,route=excluded.route,sort_order=excluded.sort_order,required_permission=excluded.required_permission');
  menus.forEach((row) => insertMenu.run(...row));
  database.prepare("UPDATE menu_items SET enabled=0 WHERE menu_key='account'").run();
  if (!database.prepare('SELECT COUNT(*) AS count FROM users').get().count) {
    createUser('admin','系統管理員','SGS@1234','administrator','all');
    createUser('operator1','操作員 1','1234','operator','CH001-CH100');
    createUser('guest','訪客','','guest','readonly');
  }
}

function hashPassword(password) { const salt=randomBytes(16).toString('hex'); return `scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
function verifyPassword(password,stored) { const [,salt,expected]=String(stored).split(':'); if(!salt||!expected)return false; return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(expected,'hex')); }
function createUser(username,displayName,password,roleCode,channelScope) {
  database.prepare('INSERT INTO users(username,display_name,password_hash,role_id,channel_scope) SELECT ?,?,?,id,? FROM roles WHERE code=?').run(username,displayName,hashPassword(password),channelScope,roleCode);
}
function settingsObject() { return Object.fromEntries(database.prepare('SELECT key,value_json FROM app_settings ORDER BY key').all().map((row)=>[row.key,parseJson(row.value_json)])); }
function menusForRole(roleId) { return database.prepare(`SELECT m.menu_key AS key,m.label,m.icon,m.route FROM menu_items m LEFT JOIN permissions p ON p.code=m.required_permission LEFT JOIN role_permissions rp ON rp.permission_id=p.id AND rp.role_id=? WHERE m.enabled=1 AND (m.required_permission IS NULL OR rp.role_id IS NOT NULL) ORDER BY m.sort_order`).all(roleId); }
function permissionsForRole(roleId) { return database.prepare('SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?').all(roleId).map((row)=>row.code); }
function requireSession(token,permission) { const session=sessions.get(token); if(!session)throw new Error('登入已失效，請重新登入'); if(permission&&!session.permissions.includes(permission))throw new Error('權限不足'); return session; }
function login(username,password) {
  const user=database.prepare('SELECT u.id,u.username,u.display_name,u.password_hash,u.role_id,u.channel_scope,r.code AS role_code,r.display_name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username=? AND u.active=1').get(String(username).trim().toLowerCase());
  if(!user||!verifyPassword(String(password),user.password_hash))throw new Error('帳號或密碼錯誤');
  const token=randomUUID(); const permissions=permissionsForRole(user.role_id);
  const session={token,userId:user.id,username:user.username,displayName:user.display_name,role:user.role_name,roleCode:user.role_code,roleId:user.role_id,channelScope:user.channel_scope,permissions};
  sessions.set(token,session); return {session,settings:settingsObject(),channelLimits:channelLimitsObject(),menus:menusForRole(user.role_id)};
}
function logout(token){sessions.delete(token);}
function databaseStatus() {
  try {
    if (!database) throw new Error('資料庫尚未初始化');
    database.prepare('SELECT 1 FROM app_settings LIMIT 1').get();
    return { connected: true, checkedAt: new Date().toISOString() };
  } catch (error) {
    return { connected: false, checkedAt: new Date().toISOString(), error: error.message };
  }
}

async function cleanupHistory(token, browserWindow, dialog) {
  requireSession(token, 'settings.manage');
  if (cleanupInProgress) throw new Error('資料庫清理已在進行中');
  cleanupInProgress = true;
  try {
    const confirmation = await dialog.showMessageBox(browserWindow, {
      type: 'warning', title: '清理 SQLite 歷史資料',
      message: '確定清除全部歷史資料？',
      detail: '將刪除所有感測歷史與同步紀錄，無法復原，請先備份資料庫。\n帳號、權限、系統設定及通道最新狀態會保留。\n清理完成後，自動同步會繼續產生新資料。',
      buttons: ['取消', '確認清理'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true };
    requireSession(token, 'settings.manage');
    let readingsDeleted, logsDeleted;
    database.exec('BEGIN IMMEDIATE');
    try {
      readingsDeleted = Number(database.prepare('DELETE FROM sensor_readings').run().changes);
      logsDeleted = Number(database.prepare('DELETE FROM ingest_log').run().changes);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    // Deletion is already committed; report compaction failure separately.
    let warning = '';
    try {
      database.exec('VACUUM');
      const checkpoint = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      if (checkpoint.busy) warning = '歷史資料已刪除；其他程式使用中，WAL 空間尚未完全回收。';
    } catch {
      warning = '歷史資料已刪除，但空間壓縮未完成；請關閉其他資料庫工具後再試。';
    }
    return { canceled: false, readingsDeleted, logsDeleted, warning };
  } finally {
    cleanupInProgress = false;
  }
}
function saveSetting(token, key, value) {
  requireSession(token, 'settings.manage');
  if (key === 'alarms.default_limits') {
    validateLimits(value);
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=?').run(json({low:value.low,high:value.high}), key);
      refreshStoredLimits();
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    return settingsObject();
  }
  if (key === 'api.poll_interval_ms' && ![10000, 30000, 60000].includes(value)) throw new Error('刷新頻率僅支援 10、30、60 秒');
  if (['notifications.enabled', 'alarms.sound_enabled'].includes(key) && typeof value !== 'boolean') throw new Error('開關設定必須為布林值');
  if (key === 'alarms.sound_interval_seconds' && (!Number.isInteger(value) || value < 1 || value > 300)) throw new Error('警報聲間隔需為 1～300 的整數秒');
  if (!database.prepare('SELECT 1 AS ok FROM app_settings WHERE key=?').get(key)) throw new Error('未知設定');
  database.prepare('UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=?').run(json(value), key);
  return settingsObject();
}
function getAlertSettings(token, test = false) {
  requireSession(token, test ? 'tests.run' : 'dashboard.view');
  const settings = settingsObject();
  return { notificationsEnabled: settings['notifications.enabled'] !== false, soundEnabled: settings['alarms.sound_enabled'] !== false };
}

function channelState(channel){if(Number(channel.st)===1||channel.pv===null||channel.pv===undefined)return'error';const pv=Number(channel.pv),low=Number(channel.web_lo),high=Number(channel.web_hi);return Number(channel.st)===2||channel.web_alarm||(Number.isFinite(low)&&pv<low)||(Number.isFinite(high)&&pv>high)?'alarm':'ok';}
function validateLimits(value) {
  if (!value || !Number.isFinite(value.low) || !Number.isFinite(value.high) || value.low >= value.high) throw new Error('請輸入有效數值，且下限必須小於上限');
}
function channelLimitsObject() {
  return Object.fromEntries(database.prepare('SELECT channel_id,low,high FROM channel_limits').all().map(row => [row.channel_id,{low:row.low,high:row.high}]));
}
function applyChannelLimits(channels) {
  const defaults = settingsObject()['alarms.default_limits'];
  const overrides = channelLimitsObject();
  return channels.map(channel => {
    const id = String(channel.id ?? '').padStart(3, '0');
    const limits = overrides[id] ?? defaults;
    return {...channel,id,web_lo:limits.low,web_hi:limits.high,limit_source:overrides[id] ? 'custom' : 'default'};
  });
}
function refreshStoredLimits() {
  const channels = database.prepare('SELECT channel_id,raw_json FROM sensor_channels').all().map(row => ({...parseJson(row.raw_json,{}),id:row.channel_id}));
  const update = database.prepare('UPDATE sensor_channels SET alarm_low=?,alarm_high=?,last_state=?,raw_json=?,updated_at=CURRENT_TIMESTAMP WHERE channel_id=?');
  for (const channel of applyChannelLimits(channels)) update.run(channel.web_lo,channel.web_hi,channelState(channel),json(channel),channel.id);
}
function saveChannelLimits(token, channelId, limits) {
  requireSession(token, 'settings.manage');
  const id = String(channelId ?? '').padStart(3, '0');
  if (!database.prepare('SELECT 1 FROM sensor_channels WHERE channel_id=?').get(id)) throw new Error('通道不存在，請先刷新資料');
  if (limits !== null) validateLimits(limits);
  database.exec('BEGIN IMMEDIATE');
  try {
    if (limits === null) database.prepare('DELETE FROM channel_limits WHERE channel_id=?').run(id);
    else database.prepare('INSERT INTO channel_limits(channel_id,low,high) VALUES(?,?,?) ON CONFLICT(channel_id) DO UPDATE SET low=excluded.low,high=excluded.high').run(id,limits.low,limits.high);
    refreshStoredLimits();
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
  return channelLimitsObject();
}
function normalizeDate(value){if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date.toISOString();}
function ingestSnapshot(snapshot,source='api',sourceUrl=null){
  const channels=applyChannelLimits(Array.isArray(snapshot?.channels)?snapshot.channels:[]);if(!channels.length)throw new Error('API 回應沒有 channels 資料');
  const batchId=randomUUID(),recordedAt=normalizeDate(snapshot.time)||new Date().toISOString();
  const upsert=database.prepare(`INSERT INTO sensor_channels(channel_id,name,sv,alarm_low,alarm_high,last_pv,last_state,last_seen_at,raw_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(channel_id) DO UPDATE SET name=excluded.name,sv=excluded.sv,alarm_low=excluded.alarm_low,alarm_high=excluded.alarm_high,last_pv=excluded.last_pv,last_state=excluded.last_state,last_seen_at=excluded.last_seen_at,raw_json=excluded.raw_json,updated_at=CURRENT_TIMESTAMP`);
  const insert=database.prepare('INSERT INTO sensor_readings(batch_id,channel_id,pv,sv,state,alarm_low,alarm_high,recorded_at,source,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?)');
  database.exec('BEGIN IMMEDIATE');
  try{
    for(const channel of channels){const id=String(channel.id??'').padStart(3,'0'),state=channelState(channel),rowTime=normalizeDate(channel.time)||recordedAt;const pv=channel.pv==null?null:Number(channel.pv),sv=channel.sv==null?null:Number(channel.sv),low=channel.web_lo==null?null:Number(channel.web_lo),high=channel.web_hi==null?null:Number(channel.web_hi);upsert.run(id,String(channel.name??`CH${id}`),sv,low,high,pv,state,rowTime,json(channel));insert.run(batchId,id,pv,sv,state,low,high,rowTime,source,json(channel));}
    database.prepare('INSERT INTO ingest_log(batch_id,source,source_url,channel_count,status) VALUES(?,?,?,?,?)').run(batchId,source,sourceUrl,channels.length,'success');
    const days=Math.max(1,Number(settingsObject()['report.retention_days']??365));database.prepare("DELETE FROM sensor_readings WHERE recorded_at < datetime('now', ?)").run(`-${days} days`);database.exec('COMMIT');
  }catch(error){database.exec('ROLLBACK');throw error;}
  return{batchId,channelCount:channels.length,recordedAt};
}
function ingestSnapshotAuthorized(token,snapshot,source='mock'){requireSession(token,'dashboard.view');return ingestSnapshot(snapshot,source,null);}
async function syncApi(token){requireSession(token,'dashboard.view');const settings=settingsObject(),url=String(settings['api.data_url']),apiToken=String(settings['api.auth_token']??'');const response=await fetch(url,{cache:'no-store',headers:apiToken?{'X-EC62-Token':apiToken}:{}});if(!response.ok)throw new Error(`API ${response.status}: ${response.statusText}`);const snapshot=await response.json();requireSession(token,'dashboard.view');const result=ingestSnapshot(snapshot,'api',url);return{snapshot:{...snapshot,channels:applyChannelLimits(snapshot.channels)},result};}
function latestSnapshot(token){requireSession(token,'dashboard.view');return applyChannelLimits(database.prepare('SELECT channel_id AS id,name,last_pv AS pv,sv,last_state,alarm_low AS web_lo,alarm_high AS web_hi,last_seen_at AS time,raw_json FROM sensor_channels ORDER BY CAST(channel_id AS INTEGER)').all().map((row)=>({...parseJson(row.raw_json,{}),id:row.id,name:row.name,pv:row.pv,sv:row.sv,web_lo:row.web_lo,web_hi:row.web_hi,time:row.time})));}

function reportWhere(filter={}){const clauses=[],values=[];if(filter.query){clauses.push('(r.channel_id LIKE ? OR c.name LIKE ?)');values.push(`%${filter.query}%`,`%${filter.query}%`);}if(filter.state&&filter.state!=='all'){clauses.push('r.state=?');values.push(filter.state);}if(filter.from){clauses.push('r.recorded_at>=?');values.push(normalizeDate(`${filter.from}T00:00:00`)||filter.from);}if(filter.to){clauses.push('r.recorded_at<=?');values.push(normalizeDate(`${filter.to}T23:59:59.999`)||filter.to);}return{sql:clauses.length?`WHERE ${clauses.join(' AND ')}`:'',values};}
function queryReport(token,filter={}){requireSession(token,'reports.view');const where=reportWhere(filter),limit=Math.min(1000,Math.max(1,Number(filter.limit)||50)),offset=Math.max(0,Number(filter.offset)||0);const total=database.prepare(`SELECT COUNT(*) AS count FROM sensor_readings r JOIN sensor_channels c ON c.channel_id=r.channel_id ${where.sql}`).get(...where.values).count;const rows=database.prepare(`SELECT r.id,r.batch_id,r.channel_id AS id,c.name,r.pv,r.sv,r.state,r.alarm_low AS web_lo,r.alarm_high AS web_hi,r.recorded_at AS time,r.source FROM sensor_readings r JOIN sensor_channels c ON c.channel_id=r.channel_id ${where.sql} ORDER BY r.recorded_at DESC,CAST(r.channel_id AS INTEGER) LIMIT ? OFFSET ?`).all(...where.values,limit,offset);return{rows,total,limit,offset};}
function csvCell(value){const text=value==null?'':String(value);return `"${(/^[=+\-@]/.test(text)?`'${text}`:text).replace(/"/g,'""')}"`;}
async function exportReport(token,filter,browserWindow,dialog){requireSession(token,'reports.export');const where=reportWhere(filter),rows=database.prepare(`SELECT r.channel_id AS id,c.name,r.state,r.pv,r.sv,r.alarm_low AS low,r.alarm_high AS high,r.recorded_at AS time,r.source FROM sensor_readings r JOIN sensor_channels c ON c.channel_id=r.channel_id ${where.sql} ORDER BY r.recorded_at DESC,CAST(r.channel_id AS INTEGER)`).all(...where.values);const result=await dialog.showSaveDialog(browserWindow,{title:'匯出 SQLite 報表',defaultPath:`E62報表_${new Date().toISOString().slice(0,10)}.csv`,filters:[{name:'CSV',extensions:['csv']}]});if(result.canceled||!result.filePath)return{canceled:true};const header=['通道','名稱','狀態','PV (°C)','SV (°C)','警報下限','警報上限','記錄時間','來源'];const content=`\ufeff${header.map(csvCell).join(',')}\r\n${rows.map((row)=>[row.id,row.name,row.state,row.pv,row.sv,row.low,row.high,row.time,row.source].map(csvCell).join(',')).join('\r\n')}`;fs.writeFileSync(result.filePath,content,'utf8');return{canceled:false,filePath:result.filePath,rowCount:rows.length};}

function listUsers(token){requireSession(token,'users.manage');return database.prepare('SELECT u.id,u.username,u.display_name AS displayName,r.code AS roleCode,r.display_name AS role,u.channel_scope AS scope,u.active FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id').all();}
function saveUser(token, input) {
  const actor = requireSession(token, 'users.manage');
  const username = String(input.username ?? '').trim().toLowerCase();
  const displayName = String(input.displayName ?? '').trim();
  const scope = String(input.scope ?? '').trim() || 'all';
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('帳號格式不正確');
  if (!displayName || displayName.length > 80) throw new Error('顯示名稱需為 1～80 個字');
  if (scope.length > 200) throw new Error('通道範圍過長');
  const role = database.prepare('SELECT id,code,display_name FROM roles WHERE code=?').get(String(input.roleCode));
  if (!role) throw new Error('角色不存在');
  if (input.id != null) {
    const id = Number(input.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('帳號 ID 不正確');
    const target = database.prepare('SELECT id,username,role_id,active,channel_scope FROM users WHERE id=?').get(id);
    if (!target) throw new Error('帳號不存在');
    if (username !== target.username) throw new Error('不可變更登入帳號');
    const active = input.active == null ? target.active : (input.active === false || input.active === 0 ? 0 : 1);
    if ((target.username === 'admin' || target.id === actor.userId) && (role.id !== target.role_id || !active)) {
      throw new Error('內建管理員及目前登入帳號不可停用或變更角色');
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('UPDATE users SET display_name=?,role_id=?,channel_scope=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(displayName, role.id, scope, active, id);
      if (input.password) database.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashPassword(String(input.password)), id);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    const accessChanged = role.id !== target.role_id || active !== target.active || scope !== target.channel_scope || Boolean(input.password);
    for (const [sessionToken, session] of sessions) {
      if (session.userId !== id) continue;
      if (accessChanged && sessionToken !== token) sessions.delete(sessionToken);
      else { session.displayName = displayName; session.channelScope = scope; }
    }
  } else {
    createUser(username, displayName, String(input.password ?? ''), role.code, scope);
  }
  return listUsers(token);
}
function deleteUser(token,id){const session=requireSession(token,'users.manage'),target=database.prepare('SELECT username FROM users WHERE id=?').get(Number(id));if(!target||target.username==='admin'||Number(id)===session.userId)throw new Error('此帳號不可刪除');database.prepare('DELETE FROM users WHERE id=?').run(Number(id));return listUsers(token);}
function listRoles(token) {
  requireSession(token, 'users.manage');
  return database.prepare('SELECT id,code,display_name AS displayName FROM roles ORDER BY id').all().map(role => ({
    code: role.code, displayName: role.displayName,
    permissions: database.prepare('SELECT p.code,p.display_name AS label FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=? ORDER BY p.id').all(role.id),
  }));
}

module.exports={initializeDatabase,getAlertSettings,databaseStatus,cleanupHistory,settingsObject,login,logout,saveSetting,saveChannelLimits,ingestSnapshotAuthorized,syncApi,latestSnapshot,queryReport,exportReport,listUsers,saveUser,deleteUser,listRoles};
