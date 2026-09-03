const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const db = require('../electron/database.cjs');
const { createNotifier } = require('../electron/notifications.cjs');
const trackerSource = readFileSync(path.join(__dirname, '../src/app/alert-state.ts'), 'utf8');
const trackerModule = { exports: {} };
new Function('exports', ts.transpileModule(trackerSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(trackerModule.exports);
const { AlarmTracker } = trackerModule.exports;
const state = channel => channel.st === 1 ? 'error' : channel.st === 2 ? 'alarm' : 'ok';

test('initial abnormalities, transitions, recovery and recurrence are deduplicated', () => {
  const tracker = new AlarmTracker();
  assert.equal(tracker.collect([{ id: '1', st: 2 }, { id: '2', st: 1 }], state).length, 2);
  assert.equal(tracker.collect([{ id: '1', st: 2 }, { id: '2', st: 1 }], state).length, 0);
  assert.equal(tracker.collect([{ id: '1', st: 1 }, { id: '2', st: 1 }], state).length, 1);
  assert.equal(tracker.collect([{ id: '1', st: 0 }, { id: '2', st: 0 }], state).length, 0);
  assert.equal(tracker.collect([{ id: '1', st: 2 }], state).length, 1);
  tracker.reset();
  assert.equal(tracker.collect([{ id: '1', st: 2 }], state).length, 1);
});

test('sync failure alerts only once per failure episode', () => {
  const tracker = new AlarmTracker();
  assert.equal(tracker.fail(), true);
  assert.equal(tracker.fail(), false);
  tracker.collect([], state);
  assert.equal(tracker.fail(), true);
});

test('native notification honors switch, support and failure, without default OS sound', async () => {
  const created = [];
  let enabled = true, supported = true, fail = false;
  class FakeNotification extends EventEmitter {
    static isSupported() { return supported; }
    constructor(options) { super(); created.push(options); }
    show() { this.emit(fail ? 'failed' : 'show'); this.emit('close'); }
  }
  const notify = createNotifier(FakeNotification, (token, test) => {
    if (token !== 'valid') throw new Error('denied');
    return { notificationsEnabled: enabled };
  });
  await assert.rejects(notify('invalid', 'alarm'), /denied/);
  enabled = false;
  assert.equal((await notify('valid', 'alarm')).sent, false);
  assert.equal(created.length, 0);
  enabled = true;
  assert.equal((await notify('valid', 'alarm')).sent, true);
  assert.equal(created[0].silent, true);
  assert.equal(created[0].title, 'E62 異常警報');
  assert.equal((await notify('valid', 'test', true)).sent, true);
  assert.equal(created[1].title, 'E62 通知測試');
  fail = true;
  assert.equal((await notify('valid', 'alarm')).sent, false);
  supported = false;
  assert.match((await notify('valid', 'alarm')).message, /不支援/);
});

test('defaults, saved switches, fast-interval migration and menu move', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'e62-alert-settings-test-'));
  const inspector = new DatabaseSync(db.initializeDatabase(directory));
  let admin = db.login('admin', 'SGS@1234').session;
  assert.equal(db.settingsObject()['api.poll_interval_ms'], 60000);
  assert.deepEqual(db.getAlertSettings(admin.token), { notificationsEnabled: true, soundEnabled: true });
  for (const interval of [1000, 3000, 5000, NaN, '60000']) assert.throws(() => db.saveSetting(admin.token, 'api.poll_interval_ms', interval));
  db.saveSetting(admin.token, 'notifications.enabled', false);
  db.saveSetting(admin.token, 'alarms.sound_enabled', false);
  assert.deepEqual(db.getAlertSettings(admin.token), { notificationsEnabled: false, soundEnabled: false });
  assert.throws(() => db.saveSetting(admin.token, 'notifications.enabled', 'false'));
  inspector.exec("UPDATE app_settings SET value_json='3000' WHERE key='api.poll_interval_ms'");
  inspector.exec("INSERT INTO menu_items(menu_key,label,icon,route,sort_order,required_permission) VALUES('account','測試','science','account',60,'tests.run')");
  db.initializeDatabase(directory);
  const login = db.login('admin', 'SGS@1234');
  admin = login.session;
  assert.equal(login.settings['api.poll_interval_ms'], 60000);
  assert.equal(login.settings['notifications.enabled'], false);
  assert.equal(login.settings['alarms.sound_enabled'], false);
  assert.equal(login.menus.some(menu => menu.key === 'account'), false);
  assert.equal(login.menus.some(menu => menu.key === 'settings'), true);
  db.saveSetting(admin.token, 'api.poll_interval_ms', 30000);
  assert.equal(db.settingsObject()['api.poll_interval_ms'], 30000);
  const guest = db.login('guest', '').session;
  assert.throws(() => db.getAlertSettings(guest.token, true), /權限不足/);
  assert.throws(() => db.saveSetting(guest.token, 'alarms.sound_enabled', true), /權限不足/);
  assert.throws(() => db.getAlertSettings('invalid'), /登入已失效/);
  inspector.close();
});

const componentText = readFileSync(path.join(__dirname, '../src/app/app.component.ts'), 'utf8');
const ast = ts.createSourceFile('app.component.ts', componentText, ts.ScriptTarget.Latest, true);
const component = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AppComponent');
const names = ['refreshData', 'playAlertSound', 'sendAlertNotification', 'emitAlarm'];
const methods = component.members.filter(node => ts.isMethodDeclaration(node) && names.includes(node.name.getText(ast)));
const compiled = ts.transpileModule(`class AlertHarness { ${methods.map(node => node.getText(ast)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('refresh actually dispatches new alerts and deduplicates failed API requests', async () => {
  const Harness = new Function('createMockChannels', `${compiled}; return AlertHarness;`)(() => [{ id: '1', st: 2, history: [] }]);
  const subject = Object.assign(new Harness(), { session: { token: 'test' }, channels: [], appSettings: {}, db: { available: false }, alarmTracker: new AlarmTracker(), state, statusLabel: value => value, syncAlarmSound() {} });
  const alerts = [];
  subject.emitAlarm = async body => alerts.push(body);
  await subject.refreshData(); await subject.refreshData();
  assert.equal(alerts.length, 1);
  subject.db.available = true;
  subject.appSettings['data.mode'] = 'live';
  subject.db.syncApi = async () => { throw new Error('network unavailable'); };
  await subject.refreshData(); await subject.refreshData();
  assert.equal(alerts.length, 2);
  assert.match(alerts[1], /同步失敗/);
  assert.equal(subject.refreshing, false);
});

test('disabled sound and notifications are independent; enabled sound schedules 3 pulses', async () => {
  const Harness = new Function('createMockChannels', `${compiled}; return AlertHarness;`)(() => []);
  let sounds = 0, notifications = 0;
  const subject = Object.assign(new Harness(), { soundEnabled: false, notificationsEnabled: false, activeAlarmOscillators: new Set(), session: { token: 'test' }, db: { available: true, notify: async () => { notifications++; return { sent: true }; } } });
  subject.prepareAlertAudio = async () => ({ currentTime: 0, destination: {}, createOscillator: () => ({ connect() {}, frequency: {}, start() { sounds++; }, stop() {} }), createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }) });
  await subject.playAlertSound(); await subject.emitAlarm('alarm');
  assert.equal(sounds, 0); assert.equal(notifications, 0);
  subject.soundEnabled = true;
  await subject.playAlertSound(); await subject.emitAlarm('alarm');
  assert.equal(sounds, 3); assert.equal(notifications, 0);
  subject.soundEnabled = false; subject.notificationsEnabled = true;
  await subject.playAlertSound(); await subject.emitAlarm('alarm');
  assert.equal(sounds, 3); assert.equal(notifications, 1);
});

test('tests and switches are in settings; only 10/30/60 second options remain', () => {
  const template = readFileSync(path.join(__dirname, '../src/app/app.component.html'), 'utf8');
  assert.doesNotMatch(template, /view==='account'|\[1,3,5,10,30,60\]/);
  assert.match(componentText, /refreshOptions = \[10, 30, 60\]/);
  assert.match(componentText, /pollIntervalMs = 60000/);
  const settings = template.split('<ng-container *ngIf="view===\'settings\'">')[1].split('</ng-container>')[0];
  assert.match(settings, /testSound\(\)/); assert.match(settings, /testNotification\(\)/);
  assert.match(settings, /啟用警報聲音/); assert.match(settings, /啟用桌面通知/);
});
