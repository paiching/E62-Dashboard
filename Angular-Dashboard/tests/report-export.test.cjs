const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const db = require("../electron/database.cjs");

test("CSV export preserves negative readings and protects formula-like text", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "c62-report-export-"));
  db.initializeDatabase(directory);
  const { token } = db.login("admin", "SGS@1234").session;
  const reportDate = new Date().toISOString().slice(0, 10);
  db.saveSetting(token, "alarms.default_limits", { low: -30, high: -10 });
  const names = ["=1+1", "+1+1", "-1+1", "@SUM(A1)", 'Sensor "A", freezer'];
  db.ingestSnapshotAuthorized(token, {
    channels: names.map((name, index) => ({
      id: String(index + 1),
      name,
      pv: -25.3,
      sv: -25,
      st: 0,
      history: [],
    })),
  });
  const filePath = path.join(directory, "report.csv");
  const result = await db.exportReport(
    token,
    {
      applicant: "yves",
      phone: "0926101787",
      email: "yves.lin@sgs.com",
      site: "XX股份有限公司",
      from: reportDate,
      to: reportDate,
    },
    null,
    {
      showSaveDialog: async () => ({ canceled: false, filePath }),
    },
  );
  assert.equal(result.rowCount, names.length);
  const content = readFileSync(filePath, "utf8");
  assert.ok(content.startsWith("\ufeff"));
  const rows = content.split("\r\n").slice(1, names.length + 1);
  for (const row of rows) {
    assert.ok(row.includes(',"-25.3","-25","-30","-10",'), row);
  }
  for (let index = 0; index < 4; index++) {
    assert.ok(rows[index].includes(`,"'${names[index]}",`), rows[index]);
  }
  assert.ok(rows[4].includes(',"Sensor ""A"", freezer",'));
  assert.ok(
    content.includes(`"申請人","yves","開始時間","${reportDate} 00:00:00"`),
  );
  assert.ok(
    content.includes(`"手機","0926101787","結束時間","${reportDate} 23:59:59"`),
  );
  assert.match(
    content,
    /"信箱","yves\.lin@sgs\.com","報表時間","\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
  );
  assert.match(content, /"場域","XX股份有限公司"/);
});
