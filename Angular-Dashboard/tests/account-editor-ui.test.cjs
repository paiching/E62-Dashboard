const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = readFileSync(path.join(__dirname, '../src/app/app.component.ts'), 'utf8');
const ast = ts.createSourceFile('app.component.ts', source, ts.ScriptTarget.Latest, true);
const component = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AppComponent');
const names = ['openAccountEditor', 'closeAccountEditor', 'saveAccountEdit', 'accountEditingAvailable', 'accountAccessProtected', 'selectedAccountPermissions'];
const members = component.members.filter(node => (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && names.includes(node.name.getText(ast)));
assert.equal(members.length, names.length);
const compiled = ts.transpileModule(`class EditorHarness { ${members.map(node => node.getText(ast)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup() {
  const Harness = new Function('window', `${compiled}; return EditorHarness;`)({ setTimeout: callback => callback() });
  const role = { code: 'operator', displayName: 'Operator', permissions: [{ code: 'dashboard.view', label: '檢視儀錶板' }] };
  const account = { id: 2, username: 'operator1', displayName: '操作員', role: 'Operator', roleCode: 'operator', scope: 'all', active: 0, password: 'must-not-copy' };
  const subject = Object.assign(new Harness(), { session: { username: 'admin', token: 'test', permissions: ['users.manage'] }, accountRoles: [], accounts: [account], db: { available: true, listRoles: async () => [role] } });
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  return { subject, account, dialog };
}

test('edit opens a copy, normalizes inactive state, and cancel leaves the row unchanged', async () => {
  const { subject, account, dialog } = setup();
  await subject.openAccountEditor(account, dialog);
  assert.equal(dialog.open, true);
  assert.equal(subject.accountDraft.active, false);
  assert.equal(subject.accountDraft.password, undefined);
  assert.equal(subject.selectedAccountPermissions[0].label, '檢視儀錶板');
  subject.accountDraft.displayName = 'Unsaved';
  subject.closeAccountEditor();
  assert.equal(dialog.open, false);
  assert.equal(subject.accountDraft, null);
  assert.equal(account.displayName, '操作員');
});

test('save sends edited values, refreshes rows and closes only after success', async () => {
  const { subject, account, dialog } = setup();
  await subject.openAccountEditor(account, dialog);
  subject.accountDraft.displayName = '  新名稱  ';
  let received;
  subject.db.saveUser = async (_token, input) => { received = input; return [{ ...input, password: undefined }]; };
  await subject.saveAccountEdit();
  assert.equal(received.displayName, '新名稱');
  assert.equal(received.password, undefined);
  assert.equal(subject.accounts[0].displayName, '新名稱');
  assert.equal(dialog.open, false);
  assert.match(subject.permissionMessage, /已儲存 operator1/);
});

test('failed saves keep the editor open and leave the original row intact', async () => {
  const { subject, account, dialog } = setup();
  await subject.openAccountEditor(account, dialog);
  subject.db.saveUser = async () => { throw new Error('測試拒絕儲存'); };
  subject.accountDraft.displayName = 'Unsaved';
  await subject.saveAccountEdit();
  assert.equal(dialog.open, true);
  assert.equal(account.displayName, '操作員');
  assert.equal(subject.accountEditorError, '測試拒絕儲存');
  assert.equal(subject.accountSaving, false);
});

test('browser preview explains why changes cannot be saved', async () => {
  const { subject, account, dialog } = setup();
  subject.db.available = false;
  await subject.openAccountEditor(account, dialog);
  assert.equal(dialog.open, true);
  assert.match(subject.accountEditorError, /Electron 桌面版/);
  assert.equal(subject.accountEditingAvailable, false);
});
