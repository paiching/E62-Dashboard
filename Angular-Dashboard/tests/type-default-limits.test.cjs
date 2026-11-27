const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const db = require("../electron/database.cjs");

test("each channel type uses its own default limits (isolated database)", () => {
  db.initializeDatabase(mkdtempSync(path.join(tmpdir(), "c62-type-limits-")));
  const admin = db.login("admin", "SGS@1234");
  const token = admin.session.token;
  assert.deepEqual(admin.settings["alarms.type_default_limits"], {
    humidity: { low: 30, high: 70 },
  });
  db.ingestSnapshotAuthorized(token, {
    time: new Date().toISOString(),
    channels: [
      { id: "1", name: "T", type: "temperature", unit: "°C", pv: 5, st: 0 },
      { id: "2", name: "H", type: "humidity", unit: "%", pv: 55, st: 0 },
      { id: "3", name: "P", type: "pressure", unit: "kPa", pv: 5, st: 0 },
      { id: "4", name: "Legacy", pv: 5, st: 0 },
    ],
  });
  const limits = () =>
    Object.fromEntries(
      db.latestSnapshot(token).map((c) => [c.id, [c.web_lo, c.web_hi]]),
    );
  // Untyped and unconfigured types fall back to the temperature default.
  assert.deepEqual(limits(), {
    1: [2, 8],
    2: [30, 70],
    3: [2, 8],
    4: [2, 8],
  });

  db.saveSetting(token, "alarms.type_default_limits", {
    humidity: { low: 40, high: 60 },
    pressure: { low: 90, high: 110 },
  });
  db.saveSetting(token, "alarms.default_limits", { low: 0, high: 10 });
  assert.deepEqual(limits(), {
    1: [0, 10],
    2: [40, 60],
    3: [90, 110],
    4: [0, 10],
  });

  assert.throws(() =>
    db.saveSetting(token, "alarms.type_default_limits", {
      humidity: { low: 60, high: 40 },
    }),
  );
  assert.throws(() =>
    db.saveSetting(token, "alarms.type_default_limits", {
      temperature: { low: 1, high: 2 },
    }),
  );
  assert.deepEqual(limits()[2], [40, 60]);
});
