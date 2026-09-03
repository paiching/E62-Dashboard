const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../electron/database.cjs');

test('database health and safe history cleanup (isolated temporary database)', async (t) => {
  assert.equal(db.databaseStatus().connected, false);
  const testDirectory = mkdtempSync(path.join(tmpdir(), 'e62-maintenance-test-'));
  const dbPath = db.initializeDatabase(testDirectory);
  t.diagnostic(`Only disposable test data used: ${dbPath}`);
  const inspector = new DatabaseSync(dbPath);
  const admin = db.login('admin', 'SGS@1234').session;
  const guest = db.login('guest', '').session;
  const operator = db.login('operator1', '1234').session;
  const confirm = { showMessageBox: async () => ({ response: 1 }) };
  const ingest = () => db.ingestSnapshotAuthorized(admin.token, { channels: [{ id: '001', name: 'Test channel', pv: 20, sv: 22, web_lo: 10, web_hi: 30 }] });
  const count = (table) => inspector.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const snapshot = (table) => inspector.prepare(`SELECT * FROM ${table}`).all();
  ingest();

  await t.test('health reflects a real database query and recovers after failure', () => {
    assert.equal(db.databaseStatus().connected, true);
    inspector.exec('ALTER TABLE app_settings RENAME TO test_unavailable_settings');
    assert.equal(db.databaseStatus().connected, false);
    inspector.exec('ALTER TABLE test_unavailable_settings RENAME TO app_settings');
    assert.equal(db.databaseStatus().connected, true);
  });

  await t.test('unauthenticated, guest and operator cannot request cleanup', async () => {
    let shown = false;
    const dialog = { showMessageBox: async () => { shown = true; return { response: 1 }; } };
    for (const token of ['invalid', guest.token, operator.token]) {
      await assert.rejects(db.cleanupHistory(token, null, dialog), /登入已失效|權限不足/);
    }
    assert.equal(shown, false);
    assert.equal(count('sensor_readings'), 1);
  });

  await t.test('cancel is the default and preserves all data', async () => {
    const result = await db.cleanupHistory(admin.token, null, {
      showMessageBox: async (_window, options) => {
        assert.equal(options.defaultId, 0);
        assert.equal(options.cancelId, 0);
        return { response: 0 };
      },
    });
    assert.equal(result.canceled, true);
    assert.equal(count('sensor_readings'), 1);
    assert.equal(count('ingest_log'), 1);
  });

  await t.test('double requests are blocked until the confirmation closes', async () => {
    let finish;
    const pending = db.cleanupHistory(admin.token, null, { showMessageBox: () => new Promise(resolve => { finish = resolve; }) });
    await assert.rejects(db.cleanupHistory(admin.token, null, confirm), /已在進行中/);
    finish({ response: 0 });
    assert.equal((await pending).canceled, true);
  });

  await t.test('session is checked again after confirmation', async () => {
    const temporaryAdmin = db.login('admin', 'SGS@1234').session;
    await assert.rejects(db.cleanupHistory(temporaryAdmin.token, null, {
      showMessageBox: async () => { db.logout(temporaryAdmin.token); return { response: 1 }; },
    }), /登入已失效/);
    assert.equal(count('sensor_readings'), 1);
  });

  await t.test('failed deletion rolls back both tables', async () => {
    inspector.exec("CREATE TRIGGER test_block_log_delete BEFORE DELETE ON ingest_log BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
    await assert.rejects(db.cleanupHistory(admin.token, null, confirm), /test rollback/);
    assert.equal(count('sensor_readings'), 1);
    assert.equal(count('ingest_log'), 1);
    inspector.exec('DROP TRIGGER test_block_log_delete');
  });

  await t.test('confirmed cleanup deletes only history and ingest logs', async () => {
    const preserved = ['app_settings', 'users', 'roles', 'permissions', 'role_permissions', 'menu_items', 'sensor_channels'];
    const before = new Map(preserved.map(table => [table, snapshot(table)]));
    const result = await db.cleanupHistory(admin.token, null, confirm);
    assert.equal(result.canceled, false);
    assert.equal(result.readingsDeleted, 1);
    assert.equal(result.logsDeleted, 1);
    assert.equal(result.warning, '');
    assert.equal(count('sensor_readings'), 0);
    assert.equal(count('ingest_log'), 0);
    for (const table of preserved) assert.deepEqual(snapshot(table), before.get(table), table);
    assert.equal(db.queryReport(admin.token).total, 0);
    assert.equal(db.databaseStatus().connected, true);
    assert.equal(db.login('admin', 'SGS@1234').session.username, 'admin');
  });

  await t.test('empty cleanup succeeds and new data can still be written', async () => {
    const result = await db.cleanupHistory(admin.token, null, confirm);
    assert.equal(result.readingsDeleted, 0);
    assert.equal(result.logsDeleted, 0);
    ingest();
    assert.equal(db.queryReport(admin.token).total, 1);
    assert.equal(count('ingest_log'), 1);
  });
  inspector.close();
});
