const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../electron/database.cjs');

test('account editing uses isolated test data', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'e62-account-edit-test-'));
  const inspector = new DatabaseSync(db.initializeDatabase(directory));
  const admin = db.login('admin', 'SGS@1234').session;
  const operator = db.login('operator1', '1234').session;
  const account = name => db.listUsers(admin.token).find(user => user.username === name);
  const passwordHash = () => inspector.prepare("SELECT password_hash FROM users WHERE username='operator1'").get().password_hash;

  await t.test('role preview matches assigned permissions', () => {
    const role = db.listRoles(admin.token).find(role => role.code === 'operator');
    assert.deepEqual(role.permissions.map(item => item.code).sort(), [...operator.permissions].sort());
    assert.ok(role.permissions.every(item => item.label));
  });
  await t.test('unauthorized users cannot edit accounts', () => {
    assert.throws(() => db.saveUser(operator.token, { ...account('operator1'), displayName: 'Forbidden' }), /權限不足/);
    assert.throws(() => db.saveUser('invalid', account('operator1')), /登入已失效/);
  });
  await t.test('save updates fields and effective role without changing password', () => {
    const beforeHash = passwordHash();
    db.saveUser(admin.token, { ...account('operator1'), displayName: '唯讀測試', roleCode: 'guest', scope: 'CH001-CH050', active: true });
    assert.equal(account('operator1').displayName, '唯讀測試');
    assert.equal(account('operator1').roleCode, 'guest');
    assert.equal(account('operator1').scope, 'CH001-CH050');
    assert.equal(passwordHash(), beforeHash);
    assert.throws(() => db.queryReport(operator.token), /登入已失效/);
    assert.equal(db.login('operator1', '1234').session.permissions.includes('reports.export'), false);
  });
  await t.test('disabled accounts cannot log in and numeric zero remains disabled', () => {
    const session = db.login('operator1', '1234').session;
    db.saveUser(admin.token, { ...account('operator1'), active: false });
    assert.equal(account('operator1').active, 0);
    assert.throws(() => db.login('operator1', '1234'), /帳號或密碼錯誤/);
    assert.throws(() => db.queryReport(session.token), /登入已失效/);
    db.saveUser(admin.token, { ...account('operator1'), displayName: '仍停用' });
    assert.equal(account('operator1').active, 0);
    db.saveUser(admin.token, { ...account('operator1'), active: true });
    assert.equal(db.login('operator1', '1234').session.username, 'operator1');
  });
  await t.test('built-in and current administrators cannot be locked out', () => {
    assert.throws(() => db.saveUser(admin.token, { ...account('admin'), active: false }), /不可停用/);
    assert.throws(() => db.saveUser(admin.token, { ...account('admin'), roleCode: 'guest' }), /不可停用/);
    db.saveUser(admin.token, { username: 'testadmin', displayName: 'Test Admin', roleCode: 'administrator', password: 'test-password', scope: 'all' });
    const other = db.login('testadmin', 'test-password').session;
    assert.throws(() => db.saveUser(other.token, { ...account('testadmin'), roleCode: 'guest' }), /不可停用/);
    db.saveUser(admin.token, { ...account('admin'), displayName: '更新顯示名稱' });
    assert.equal(admin.displayName, '更新顯示名稱');
  });
  await t.test('invalid role, missing user, rename and blank names leave data intact', () => {
    const original = account('operator1');
    for (const invalid of [{ roleCode: 'missing' }, { id: 999999 }, { username: 'renamed' }, { displayName: '  ' }]) {
      assert.throws(() => db.saveUser(admin.token, { ...original, ...invalid }));
      assert.deepEqual(account('operator1'), original);
    }
  });
  inspector.close();
});
