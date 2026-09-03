const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const source = readFileSync(path.join(__dirname, '../src/app/app.component.ts'), 'utf8');
const ast = ts.createSourceFile('app.component.ts', source, ts.ScriptTarget.Latest, true);
const component = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AppComponent');
const names = ['stopAlarmSound', 'syncAlarmSound', 'hasActiveSoundAlarm', 'playAlertSound', 'saveSoundInterval', 'logout'];
const members = component.members.filter(node => (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && names.includes(node.name.getText(ast)));
assert.equal(members.length, names.length);
const compiled = ts.transpileModule(`class Harness { ${members.map(node => node.getText(ast)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup() {
  const timers = new Map();
  let next = 0, plays = 0;
  const scheduler = { setInterval(callback, ms) { const id = ++next; timers.set(id, { callback, ms }); return id; }, clearInterval(id) { timers.delete(id); } };
  const Harness = new Function('window', 'sensorState', `${compiled}; return Harness;`)(scheduler, channel => channel.st === 1 ? 'error' : channel.web_alarm_ack ? 'ok' : channel.st === 2 ? 'alarm' : 'ok');
  const subject = Object.assign(new Harness(), { session: { token: 'test' }, alarmSnapshotReady: true, soundEnabled: true, soundIntervalSeconds: 3, channels: [{ id: '1', st: 2 }], syncError: '', activeAlarmOscillators: new Set(), audioGeneration: 0, alarmTracker: { reset() {} }, db: { available: false } });
  const realPlay = subject.playAlertSound.bind(subject);
  subject.playAlertSound = async () => { plays++; };
  return { subject, timers, realPlay, plays: () => plays };
}

test('starts immediately, repeats every 3 seconds, and does not reset on refresh', () => {
  const { subject, timers, plays } = setup();
  subject.syncAlarmSound();
  const originalTimer = subject.alarmSoundTimer;
  assert.equal(plays(), 1);
  assert.equal(timers.get(originalTimer).ms, 3000);
  timers.get(originalTimer).callback();
  timers.get(originalTimer).callback();
  assert.equal(plays(), 3);
  subject.syncAlarmSound();
  assert.equal(subject.alarmSoundTimer, originalTimer);
  assert.equal(timers.size, 1);
  assert.equal(plays(), 3);
});

test('interval changes replace the timer, without replaying or notifying immediately', () => {
  const { subject, timers, plays } = setup();
  subject.syncAlarmSound();
  subject.soundIntervalSeconds = 7;
  subject.syncAlarmSound();
  assert.equal(timers.size, 1);
  assert.equal(timers.get(subject.alarmSoundTimer).ms, 7000);
  assert.equal(plays(), 1);
});

test('recovery, disabling and logout stop; re-enabling an ongoing alarm starts again', () => {
  const { subject, timers, plays } = setup();
  subject.syncAlarmSound();
  subject.channels[0].st = 0;
  subject.syncAlarmSound();
  assert.equal(timers.size, 0);
  subject.channels[0].st = 2;
  subject.syncAlarmSound();
  subject.soundEnabled = false;
  subject.syncAlarmSound();
  assert.equal(timers.size, 0);
  subject.soundEnabled = true;
  subject.syncAlarmSound();
  assert.equal(timers.size, 1);
  assert.equal(plays(), 3);
  subject.logout();
  assert.equal(timers.size, 0);
  assert.equal(subject.hasActiveSoundAlarm, false);
});

test('an acknowledged but unrecovered alarm and sync failure still sound', () => {
  const { subject, timers } = setup();
  subject.channels[0].web_alarm_ack = true;
  subject.syncAlarmSound();
  assert.equal(timers.size, 1);
  subject.channels[0].st = 0;
  subject.syncError = 'API offline';
  subject.syncAlarmSound();
  assert.equal(timers.size, 1);
  subject.syncError = '';
  subject.syncAlarmSound();
  assert.equal(timers.size, 0);
});

test('no automatic alarm before the first authenticated snapshot', () => {
  const { subject, timers, plays } = setup();
  subject.alarmSnapshotReady = false;
  subject.syncAlarmSound();
  assert.equal(timers.size, 0);
  assert.equal(plays(), 0);
});

test('stop cancels active oscillators and audio waiting for activation', async () => {
  const { subject, realPlay } = setup();
  let stopped = 0, started = 0, resume;
  subject.activeAlarmOscillators.add({ stop() { stopped++; } });
  subject.stopAlarmSound();
  assert.equal(stopped, 1);
  subject.prepareAlertAudio = () => new Promise(resolve => { resume = resolve; });
  const pending = realPlay(true);
  subject.stopAlarmSound();
  resume({ createOscillator() { started++; }, currentTime: 0 });
  await pending;
  assert.equal(started, 0);
  assert.equal(subject.soundStarting, false);
});

test('sound interval saves independently from data refresh and rejects invalid input', async () => {
  const { subject } = setup();
  const saved = [];
  subject.saveDatabaseSetting = async (key, value) => { saved.push([key, value]); return true; };
  for (const invalid of [0, -1, 1.5, 301, NaN]) { subject.pendingSoundIntervalSeconds = invalid; await subject.saveSoundInterval(); }
  assert.equal(saved.length, 0);
  subject.pendingSoundIntervalSeconds = 5;
  await subject.saveSoundInterval();
  assert.deepEqual(saved, [['alarms.sound_interval_seconds', 5]]);
});

test('database seeds 3 seconds, persists a changed value, and validates it', () => {
  const db = require('../electron/database.cjs');
  db.initializeDatabase(mkdtempSync(path.join(tmpdir(), 'e62-repeat-alarm-test-')));
  const admin = db.login('admin', 'SGS@1234').session;
  assert.equal(db.settingsObject()['alarms.sound_interval_seconds'], 3);
  for (const invalid of [0, -3, 1.1, 301, '3', null]) assert.throws(() => db.saveSetting(admin.token, 'alarms.sound_interval_seconds', invalid));
  db.saveSetting(admin.token, 'alarms.sound_interval_seconds', 7);
  assert.equal(db.login('admin', 'SGS@1234').settings['alarms.sound_interval_seconds'], 7);
  assert.equal(db.settingsObject()['api.poll_interval_ms'], 60000);
});
