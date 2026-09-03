const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Exercise the actual component methods without booting Angular or a database.
const source = readFileSync(path.join(__dirname, '../src/app/app.component.ts'), 'utf8');
const ast = ts.createSourceFile('app.component.ts', source, ts.ScriptTarget.Latest, true);
const component = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AppComponent');
const methods = component.members.filter(node => ts.isMethodDeclaration(node) && ['runReportQuery', 'saveDatabaseSetting', 'refreshReport'].includes(node.name.getText(ast)));
assert.equal(methods.length, 3);
const compiled = ts.transpileModule(`class FeedbackHarness { ${methods.map(node => node.getText(ast)).join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness() {
  const ticks = [100, 125.5];
  const Harness = new Function('performance', `${compiled}; return FeedbackHarness;`)({ now: () => ticks.shift() });
  return Object.assign(new Harness(), {
    session: { token: 'test' }, reportMessage: '舊查詢提示', settingsMessage: '設定已儲存',
    reportFilter: () => ({}), applyDatabaseSettings() {},
    db: { available: true, queryReport: async () => ({ total: 200, rows: [] }) },
  });
}

test('query success reports elapsed time without changing settings feedback', async () => {
  const subject = harness();
  const query = subject.runReportQuery();
  assert.equal(subject.reportMessage, '');
  await query;
  assert.equal(subject.reportMessage, '完成查詢，共 200 筆，耗時 25.5 ms');
  assert.equal(subject.settingsMessage, '設定已儲存');
  assert.equal(subject.reportTotal, 200);
});

test('setting success and failure do not overwrite report feedback', async () => {
  const subject = harness();
  subject.db.saveSetting = async () => ({ 'data.mode': 'mock' });
  await subject.saveDatabaseSetting('data.mode', 'mock');
  assert.equal(subject.settingsMessage, '設定已儲存');
  assert.equal(subject.reportMessage, '舊查詢提示');
  subject.db.saveSetting = async () => { throw new Error('測試儲存失敗'); };
  await subject.saveDatabaseSetting('data.mode', 'live');
  assert.equal(subject.settingsMessage, '測試儲存失敗');
  assert.equal(subject.reportMessage, '舊查詢提示');
});

test('query failures remain report-only', async () => {
  const subject = harness();
  subject.db.queryReport = async () => { throw new Error('測試查詢失敗'); };
  await subject.runReportQuery();
  assert.equal(subject.reportMessage, '測試查詢失敗');
  assert.equal(subject.settingsMessage, '設定已儲存');
});

test('refresh keeps query, status and dates while returning to the first page', () => {
  const subject = harness();
  Object.assign(subject, { channelQuery: 'CH001', channelStatus: 'alarm', channelDateFrom: '2026-09-01', channelDateTo: '2026-09-03', channelPage: 4 });
  let queries = 0;
  subject.runReportQuery = () => { queries++; };
  subject.refreshReport();
  assert.equal(queries, 1);
  assert.equal(subject.channelPage, 1);
  assert.equal(subject.channelQuery, 'CH001');
  assert.equal(subject.channelStatus, 'alarm');
  assert.equal(subject.channelDateFrom, '2026-09-01');
  assert.equal(subject.channelDateTo, '2026-09-03');
});

test('settings and reports bind their own feedback in the template', () => {
  const template = readFileSync(path.join(__dirname, '../src/app/app.component.html'), 'utf8');
  const settings = template.split('<ng-container *ngIf="view===\'settings\'">')[1].split('</ng-container>')[0];
  assert.match(settings, /\{\{ settingsMessage \}\}/);
  assert.doesNotMatch(settings, /reportMessage/);
  assert.equal((template.match(/\{\{ reportMessage \}\}/g) || []).length, 1);
  assert.doesNotMatch(template, /SQLite 報表/);
  assert.match(template, /\(click\)="refreshReport\(\)"[^>]*><mat-icon>refresh<\/mat-icon>刷新/);
  assert.doesNotMatch(template, /resetChannelFilters|SQLite 權限模式|class="database-cleanup-hint"/);
  assert.match(template, /\(click\)="openAccountEditor\(account, accountEditor\)"/);
});
