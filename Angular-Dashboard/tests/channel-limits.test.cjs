const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const db = require('../electron/database.cjs');

test('persistent default/individual limits and ingestion (isolated database)', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'e62-channel-limits-'));
  const inspector = new DatabaseSync(db.initializeDatabase(directory));
  let admin = db.login('admin', 'SGS@1234').session;
  const sample = id => ({ id, name: `Test ${id}`, pv: 5, st: 0, web_lo: -100, web_hi: 100, web_alarm: false, history: [] });
  const ingest = () => db.ingestSnapshotAuthorized(admin.token, { channels: [sample('001'),sample('002')] });
  const current = () => db.latestSnapshot(admin.token);
  const history = () => inspector.prepare('SELECT * FROM sensor_readings ORDER BY id').all();
  ingest();

  await t.test('existing API values are not mistaken for individually saved settings', () => {
    assert.deepEqual(db.settingsObject()['alarms.default_limits'], { low: 2, high: 8 });
    assert.deepEqual(db.login('admin', 'SGS@1234').channelLimits, {});
    assert.deepEqual(current().map(c => [c.web_lo,c.web_hi,c.limit_source]), [[2,8,'default'],[2,8,'default']]);
    assert.ok(history().every(row => row.alarm_low === 2 && row.alarm_high === 8 && row.state === 'ok'));
  });
  await t.test('custom limits survive ingestion; changing defaults affects only inherited channels', () => {
    const before = history();
    db.saveChannelLimits(admin.token, '001', { low: 3, high: 4 });
    db.saveSetting(admin.token, 'alarms.default_limits', { low: -10, high: 10 });
    assert.deepEqual(history(), before);
    assert.deepEqual(current().map(c => [c.web_lo,c.web_hi,c.limit_source]), [[3,4,'custom'],[-10,10,'default']]);
    assert.equal(inspector.prepare("SELECT last_state FROM sensor_channels WHERE channel_id='001'").get().last_state, 'alarm');
    ingest();
    assert.deepEqual(current().map(c => [c.web_lo,c.web_hi]), [[3,4],[-10,10]]);
    assert.deepEqual(history().slice(-2).map(r => [r.alarm_low,r.alarm_high,r.state]), [[3,4,'alarm'],[-10,10,'ok']]);
  });
  await t.test('restart preserves saved defaults and custom limits, then reset resumes inheritance', () => {
    db.initializeDatabase(directory);
    const result = db.login('admin', 'SGS@1234');
    admin = result.session;
    assert.deepEqual(result.channelLimits, { '001': { low: 3, high: 4 } });
    assert.deepEqual(result.settings['alarms.default_limits'], { low: -10, high: 10 });
    db.saveChannelLimits(admin.token, '001', null);
    db.saveSetting(admin.token, 'alarms.default_limits', { low: -5, high: 6 });
    assert.ok(current().every(c => c.web_lo === -5 && c.web_hi === 6 && c.limit_source === 'default'));
    // Explicit save equal to the default must still become an override.
    db.saveChannelLimits(admin.token, '001', { low: -5, high: 6 });
    db.saveSetting(admin.token, 'alarms.default_limits', { low: 0, high: 3 });
    assert.equal(current()[0].web_hi, 6);
    assert.equal(current()[1].web_hi, 3);
  });
  await t.test('invalid values and unauthorized writes leave saved values untouched', () => {
    const before = db.login('admin', 'SGS@1234');
    for (const limits of [undefined, {}, {low:null,high:8}, {low:'2',high:8}, {low:8,high:8}, {low:9,high:8}, {low:NaN,high:8}, {low:2,high:Infinity}]) {
      assert.throws(() => db.saveChannelLimits(admin.token, '001', limits));
      assert.throws(() => db.saveSetting(admin.token, 'alarms.default_limits', limits));
    }
    for (const token of ['invalid', db.login('guest','').session.token, db.login('operator1','1234').session.token]) {
      assert.throws(() => db.saveChannelLimits(token,'001',{low:1,high:2}), /登入已失效|權限不足/);
      assert.throws(() => db.saveChannelLimits(token,'001',null), /登入已失效|權限不足/);
      assert.throws(() => db.saveSetting(token,'alarms.default_limits',{low:1,high:2}), /登入已失效|權限不足/);
    }
    assert.throws(() => db.saveChannelLimits(admin.token, '999', {low:1,high:2}), /通道不存在/);
    assert.deepEqual(db.settingsObject(), before.settings);
    assert.deepEqual(db.login('admin','SGS@1234').channelLimits, before.channelLimits);
  });
  await t.test('transaction failure rolls back both settings and current channel changes', () => {
    inspector.exec("CREATE TRIGGER limits_fail BEFORE UPDATE ON sensor_channels BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    const before = db.login('admin','SGS@1234');
    assert.throws(() => db.saveSetting(admin.token, 'alarms.default_limits', {low:20,high:30}), /test failure/);
    assert.throws(() => db.saveChannelLimits(admin.token, '001', {low:20,high:30}), /test failure/);
    assert.deepEqual(db.settingsObject(), before.settings);
    assert.deepEqual(db.login('admin','SGS@1234').channelLimits, before.channelLimits);
    inspector.exec('DROP TRIGGER limits_fail');
  });
  await t.test('live sync returns effective limits, including saves made while API is pending', async () => {
    const originalFetch = global.fetch;
    let resolveFetch;
    global.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
    try {
      const syncing = db.syncApi(admin.token);
      db.saveChannelLimits(admin.token, '001', {low:4,high:7});
      db.saveSetting(admin.token, 'alarms.default_limits', {low:3,high:9});
      resolveFetch({ok:true,json:async () => ({schema_version:1,status_version:1,st_version:2,status:'connected',collected_at:new Date().toISOString(),channel_count:2,age_seconds:0,stale:false,channels:[sample('001'),sample('002')]})});
      const result = await syncing;
      assert.deepEqual(result.snapshot.channels.map(c => [c.web_lo,c.web_hi,c.limit_source]), [[4,7,'custom'],[3,9,'default']]);
    } finally { global.fetch = originalFetch; }
  });
  await t.test('history cleanup preserves individual settings', async () => {
    const before = db.login('admin','SGS@1234').channelLimits;
    await db.cleanupHistory(admin.token,null,{showMessageBox:async () => ({response:1})});
    assert.equal(history().length, 0);
    assert.deepEqual(db.login('admin','SGS@1234').channelLimits, before);
  });
  inspector.close();
});

const source = readFileSync(path.join(__dirname, '../src/app/app.component.ts'), 'utf8');
const ast = ts.createSourceFile('app.component.ts', source, ts.ScriptTarget.Latest, true);
const component = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AppComponent');
const names = ['defaultLimits','canManageLimits','limitsAccessMessage','refreshLimitDisplay','openSensor','saveSensorLimits','saveDefaultLimits','refreshData'];
const members = component.members.filter(node => (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && names.includes(node.name.getText(ast)));
assert.equal(members.length, names.length);
const compiled = ts.transpileModule(`class Harness { ${members.map(node => node.getText(ast)).join('\n')} }`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup() {
  const initial = [{id:'001',web_lo:-100,web_hi:100,history:[],pv:5,st:0}];
  const Harness = new Function('createMockChannels', `${compiled}; return Harness;`)(() => initial.map(c => ({...c})));
  const subject = Object.assign(new Harness(), {
    channels:initial.map(c => ({...c})), channelLimits:{}, appSettings:{}, session:{token:'admin',permissions:['settings.manage']},
    db:{available:true,ingestSnapshot:async()=>({})}, focusSensorEditor(){}, notifyLimitAlarms(){}, syncAlarmSound(){}, alarmTracker:{collect:()=>[]},
    applyDatabaseSettings(){this.refreshLimitDisplay();},
  });
  subject.refreshLimitDisplay(); subject.openSensor(subject.channels[0]);
  return subject;
}
test('unsaved input never changes effective values; success waits for persistence', async () => {
  const subject = setup();
  let finish, calls = 0;
  subject.db.saveChannelLimits = async (token,id,limits) => {calls++; assert.deepEqual(limits,{low:3,high:4}); return new Promise(resolve => {finish=resolve;});};
  subject.editLow=3; subject.editHigh=4;
  assert.equal(subject.selectedSensor.web_hi,8);
  const pending=subject.saveSensorLimits();
  await subject.saveSensorLimits();
  assert.equal(calls,1); assert.equal(subject.selectedSensor.web_hi,8);
  finish({'001':{low:3,high:4}}); await pending;
  assert.equal(subject.selectedSensor.web_hi,4); assert.equal(subject.selectedSensor.limit_source,'custom');
  assert.equal(subject.modalFailed,false);
  await subject.refreshData();
  assert.equal(subject.selectedSensor.web_hi,4);
});
test('failure/invalid input/readonly preview never report a successful save', async () => {
  const subject=setup();
  let calls=0;
  subject.db.saveChannelLimits=async()=>{calls++;throw new Error('write failed');};
  for (const low of [null,NaN,Infinity,8,9]) {subject.editLow=low;await subject.saveSensorLimits();}
  assert.equal(calls,0);
  subject.editLow=2;await subject.saveSensorLimits();
  assert.equal(subject.modalFailed,true);assert.match(subject.modalMessage,/write failed/);
  assert.equal(subject.selectedSensor.limit_source,'default');
  subject.db.available=false;await subject.saveSensorLimits();
  assert.equal(calls,1);assert.match(subject.modalMessage,/瀏覽器預覽.*Electron/);
});
test('changing default updates inherited values only and reset uses the latest default', async () => {
  const subject=setup();
  subject.channels.push({...subject.channels[0],id:'002'});
  subject.channelLimits={'001':{low:3,high:4}};
  subject.defaultLow=-10;subject.defaultHigh=10;
  subject.db.saveSetting=async(token,key,limits)=>{assert.equal(key,'alarms.default_limits');return{[key]:limits};};
  await subject.saveDefaultLimits();
  assert.equal(subject.defaultLimitsFailed,false);
  assert.deepEqual(subject.channels.map(c=>c.web_hi),[4,10]);
  subject.db.saveChannelLimits=async(token,id,limits)=>{assert.equal(limits,null);return{};};
  await subject.saveSensorLimits(true);
  assert.equal(subject.selectedSensor.limit_source,'default');assert.equal(subject.editHigh,10);
});
test('default validation, failure and logout during save preserve active values', async () => {
  const subject=setup();
  let calls=0;
  subject.db.saveSetting=async()=>{calls++;throw new Error('disk full');};
  subject.defaultLow=null;subject.defaultHigh=8;await subject.saveDefaultLimits();assert.equal(calls,0);
  subject.defaultLow=3;await subject.saveDefaultLimits();assert.equal(calls,1);
  assert.equal(subject.defaultLimitsFailed,true);assert.equal(subject.defaultLimits.low,2);
  let finish;
  subject.db.saveChannelLimits=()=>new Promise(resolve=>{finish=resolve;});
  const pending=subject.saveSensorLimits();subject.session=null;finish({'001':{low:3,high:4}});await pending;
  assert.deepEqual(subject.channelLimits,{});assert.equal(subject.limitsSaving,false);
});
test('renderer reapplies the latest saved policy over stale in-flight API results', async () => {
  const subject=setup();
  subject.appSettings['data.mode']='live';
  let finish;
  subject.db.syncApi=()=>new Promise(resolve=>{finish=resolve;});
  const pending=subject.refreshData();
  subject.channelLimits={'001':{low:3,high:7}};
  finish({snapshot:{channels:[{id:'001',web_lo:2,web_hi:8,history:[]}]}});
  await pending;
  assert.equal(subject.selectedSensor.web_hi,7);assert.equal(subject.selectedSensor.limit_source,'custom');
});
