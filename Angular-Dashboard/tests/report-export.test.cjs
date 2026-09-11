const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const db = require('../electron/database.cjs');

test('CSV export preserves negative readings and protects formula-like text', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'e62-report-export-'));
  db.initializeDatabase(directory);
  const { token } = db.login('admin', 'SGS@1234').session;
  db.saveSetting(token, 'alarms.default_limits', { low: -30, high: -10 });
  const names = ['=1+1', '+1+1', '-1+1', '@SUM(A1)', 'Sensor "A", freezer'];
  db.ingestSnapshotAuthorized(token, { channels: names.map((name, index) => ({
    id: String(index + 1), name, pv: -25.3, sv: -25, st: 0, history: [],
  })) });
  const filePath = path.join(directory, 'report.csv');
  const result = await db.exportReport(token, {}, null, {
    showSaveDialog: async () => ({ canceled: false, filePath }),
  });
  assert.equal(result.rowCount, names.length);
  const content = readFileSync(filePath, 'utf8');
  assert.ok(content.startsWith('\ufeff'));
  const rows = content.split('\r\n').slice(1);
  for (const row of rows) {
    assert.ok(row.includes(',"-25.3","-25","-30","-10",'), row);
  }
  for (let index = 0; index < 4; index++) {
    assert.ok(rows[index].includes(`,"'${names[index]}",`), rows[index]);
  }
  assert.ok(rows[4].includes(',"Sensor ""A"", freezer",'));
});
