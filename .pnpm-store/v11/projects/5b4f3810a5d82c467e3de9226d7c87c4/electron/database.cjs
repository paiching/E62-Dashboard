const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

let database;
const sessions = new Map();
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
    CREATE TABLE IF NOT EXISTS sensor_readings(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL,channel_id TEXT NOT NULL,pv REAL,sv REAL,state TEXT NOT NULL,alarm_low REAL,alarm_high REAL,recorded_at TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,source TEXT NOT NULL DEFAULT 'api',raw_json TEXT NOT NULL,FOREIGN KEY(channel_id) REFERENCES sensor_channels(channel_id));
    CREATE INDEX IF NOT EXISTS idx_readings_recorded ON sensor_readings(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_readings_channel_time ON sensor_readings(channel_id,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_readings_state_time ON sensor_readings(state,recorded_at DESC);
    CREATE TABLE IF NOT EXISTS ingest_log(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL UNIQUE,source TEXT NOT NULL,source_url TEXT,channel_count INTEGER NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL,error_message TEXT);
  `);
  seedDatabase();
  return dbPath;
}

function seedDatabase() {
  const settings = [
    ['data.mode','mock','api','mock 或 live'],['api.data_url','http://127.0.0.1:8080/api/data','api','EC62 API 資料端點'],['api.auth_token','','api','X-EC62-Token'],
    ['api.poll_interval_ms',3000,'api','自動同步間隔'],['report.retention_days',365,'report','歷史資料保留天數'],
    ['dashboard.show_status',true,'display','顯示 Header 狀態列'],['ui.default_view','overview','display','登入後預設頁面'],
    ['notifications.enabled',true,'notification','允許桌面通知'],
  ];
  const insertSetting = database.prepare('INSERT OR IGNORE INTO app_settings(key,value_json,category,description) VALUES(?,?,?,?)');
  settings.forEach(([key,value,category,description]) => insertSetting.run(key,json(value),category,description));
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
    ['permissions','帳號權限','verified_user','permissions',50,'users.manage'],['account','測試','science','account',60,'tests.run'],['settings','設定','settings','settings',70,'settings.manage'],
  ];
  const insertMenu = database.prepare('INSERT INTO menu_items(menu_key,label,icon,route,sort_order,required_permission) VALUES(?,?,?,?,?,?) ON CONFLICT(menu_key) DO UPDATE SET label=excluded.label,icon=excluded.icon,route=excluded.route,sort_order=excluded.sort_order,required_permission=excluded.required_permission');
  menus.forEach((row) => insertMenu.run(...row));
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
  sessions.set(token,session); return {session,settings:settingsObject(),menus:menusForRole(user.role_id)};
}
function logout(token){sessions.delete(token);}
function saveSetting(token,key,value){requireSession(token,'settings.manage');if(!database.prepare('SELECT 1 AS ok FROM app_settings WHERE key=?').get(key))throw new Error(`未知設定：${key}`);database.prepare('UPDATE app_settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key=?').run(json(value),key);return settingsObject();}

function channelState(channel){if(Number(channel.st)===1||channel.pv===null||channel.pv===undefined)return'error';const pv=Number(channel.pv),low=Number(channel.web_lo),high=Number(channel.web_hi);return Number(channel.st)===2||channel.web_alarm||(Number.isFinite(low)&&pv<low)||(Number.isFinite(high)&&pv>high)?'alarm':'ok';}
function normalizeDate(value){if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date.toISOString();}
function ingestSnapshot(snapshot,source='api',sourceUrl=null){
  const channels=Array.isArray(snapshot?.channels)?snapshot.channels:[];if(!channels.length)throw new Error('API 回應沒有 channels 資料');
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
async function syncApi(token){requireSession(token,'dashboard.view');const settings=settingsObject(),url=String(settings['api.data_url']),apiToken=String(settings['api.auth_token']??'');const response=await fetch(url,{cache:'no-store',headers:apiToken?{'X-EC62-Token':apiToken}:{}});if(!response.ok)throw new Error(`API ${response.status}: ${response.statusText}`);const snapshot=await response.json();return{snapshot,result:ingestSnapshot(snapshot,'api',url)};}
function latestSnapshot(token){requireSession(token,'dashboard.view');return database.prepare('SELECT channel_id AS id,name,last_pv AS pv,sv,last_state,alarm_low AS web_lo,alarm_high AS web_hi,last_seen_at AS time,raw_json FROM sensor_channels ORDER BY CAST(channel_id AS INTEGER)').all().map((row)=>({...parseJson(row.raw_json,{}),id:row.id,name:row.name,pv:row.pv,sv:row.sv,web_lo:row.web_lo,web_hi:row.web_hi,time:row.time}));}

function reportWhere(filter={}){const clauses=[],values=[];if(filter.query){clauses.push('(r.channel_id LIKE ? OR c.name LIKE ?)');values.push(`%${filter.query}%`,`%${filter.query}%`);}if(filter.state&&filter.state!=='all'){clauses.push('r.state=?');values.push(filter.state);}if(filter.from){clauses.push('r.recorded_at>=?');values.push(normalizeDate(`${filter.from}T00:00:00`)||filter.from);}if(filter.to){clauses.push('r.recorded_at<=?');values.push(normalizeDate(`${filter.to}T23:59:59.999`)||filter.to);}return{sql:clauses.length?`WHERE ${clauses.join(' AND ')}`:'',values};}
function queryReport(token,filter={}){requireSession(token,'reports.view');const where=reportWhere(filter),limit=Math.min(1000,Math.max(1,Number(filter.limit)||50)),offset=Math.max(0,Number(filter.offset)||0);const total=database.prepare(`SELECT COUNT(*) AS count FROM sensor_readings r JOIN sensor_channels c ON c.channel_id=r.channel_id ${where.sql}`).get(...where.values).count;const rows=database.prepare(`SELECT r.id,r.batch_id,r.channel_id AS id,c.name,r.pv,r.sv,r.state,r.alarm_low AS web_lo,r.alarm_high AS web_hi,r.recorded_at AS time,r.source FROM sensor_readings r JOIN sensor_channels c ON c.channel_id=r.channel_id ${where.sql} ORDER BY r.recorded_at DESC,CAST(r.channel_id AS INTEGER) LIMIT ? OFFSET ?`).all(...where.values,limit,offset);return{rows,total,limit,offset};}
function csvCell(value){const text=value==null?'':String(value);return `"${(/^[=+\-@]/.test(text)?`'${text}`:text).replace(/"/g,'""')}"`;}
async function exportReport(token,filter,browserWindow,dialog){requireSession(token,'reports.export');const where=reportWhere(filter),rows=database.prepare(`SELECT r.channel_id AS id,c.name,r.state,r.pv,r.sv,r.alarm_low AS low,r.alarm_high AS high,r.recorded_at AS time,r.source FROM sensor_readings r JOIN sensor_channels c ON c.channel_id=r.channel_id ${where.sql} ORDER BY r.recorded_at DESC,CAST(r.channel_id AS INTEGER)`).all(...where.values);const result=await dialog.showSaveDialog(browserWindow,{title:'匯出 SQLite 報表',defaultPath:`E62報表_${new Date().toISOString().slice(0,10)}.csv`,filters:[{name:'CSV',extensions:['csv']}]});if(result.canceled||!result.filePath)return{canceled:true};const header=['通道','名稱','狀態','PV (°C)','SV (°C)','警報下限','警報上限','記錄時間','來源'];const content=`\ufeff${header.map(csvCell).join(',')}\r\n${rows.map((row)=>[row.id,row.name,row.state,row.pv,row.sv,row.low,row.high,row.time,row.source].map(csvCell).join(',')).join('\r\n')}`;fs.writeFileSync(result.filePath,content,'utf8');return{canceled:false,filePath:result.filePath,rowCount:rows.length};}

function listUsers(token){requireSession(token,'users.manage');return database.prepare('SELECT u.id,u.username,u.display_name AS displayName,r.code AS roleCode,r.display_name AS role,u.channel_scope AS scope,u.active FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id').all();}
function saveUser(token,input){requireSession(token,'users.manage');const username=String(input.username??'').trim().toLowerCase();if(!/^[a-z0-9._-]{3,32}$/.test(username))throw new Error('帳號格式不正確');if(input.id){database.prepare('UPDATE users SET display_name=?,role_id=(SELECT id FROM roles WHERE code=?),channel_scope=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(String(input.displayName),String(input.roleCode),String(input.scope||'all'),input.active===false?0:1,Number(input.id));if(input.password)database.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashPassword(String(input.password)),Number(input.id));}else createUser(username,String(input.displayName),String(input.password??''),String(input.roleCode),String(input.scope||'all'));return listUsers(token);}
function deleteUser(token,id){const session=requireSession(token,'users.manage'),target=database.prepare('SELECT username FROM users WHERE id=?').get(Number(id));if(!target||target.username==='admin'||Number(id)===session.userId)throw new Error('此帳號不可刪除');database.prepare('DELETE FROM users WHERE id=?').run(Number(id));return listUsers(token);}
function listRoles(token){requireSession(token,'users.manage');return database.prepare('SELECT code,display_name AS displayName FROM roles ORDER BY id').all();}

module.exports={initializeDatabase,settingsObject,login,logout,saveSetting,ingestSnapshotAuthorized,syncApi,latestSnapshot,queryReport,exportReport,listUsers,saveUser,deleteUser,listRoles};
