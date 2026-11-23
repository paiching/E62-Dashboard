const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const db = require("../electron/database.cjs");

db.initializeDatabase(mkdtempSync(path.join(tmpdir(), "c62-release-")), true);

function snapshot(pv) {
  return {
    time: new Date().toISOString(),
    channels: [{ id: "002", name: "A1-R01-2", pv, sv: 4, st: 0 }],
  };
}

test("release reasons are validated, trimmed and de-duplicated", () => {
  const { session } = db.login("admin", "SGS@1234");
  assert.deepEqual(db.settingsObject()["alarms.release_reasons"], []);
  const settings = db.saveSetting(session.token, "alarms.release_reasons", [
    " 設備維修中 ",
    "設備維修中",
    "除霜作業",
  ]);
  assert.deepEqual(settings["alarms.release_reasons"], ["設備維修中", "除霜作業"]);
  assert.throws(
    () => db.saveSetting(session.token, "alarms.release_reasons", [""]),
    /請輸入解除理由/,
  );
  assert.throws(
    () => db.saveSetting(session.token, "alarms.release_reasons", "x"),
    /清單/,
  );
});

test("releasing an alarm lasts until the channel recovers", () => {
  const { session } = db.login("admin", "SGS@1234");
  db.ingestSnapshotAuthorized(session.token, snapshot(-24.7));
  const result = db.releaseAlarm(session.token, "002", "盤點中", true);
  assert.equal(result.releases["002"].reason, "盤點中");
  assert.ok(result.settings["alarms.release_reasons"].includes("盤點中"));
  const [released] = db.latestSnapshot(session.token);
  assert.equal(released.web_alarm_ack, true);

  db.ingestSnapshotAuthorized(session.token, snapshot(4));
  assert.equal(db.login("admin", "SGS@1234").alarmReleases["002"], undefined);
  assert.throws(
    () => db.releaseAlarm(session.token, "002", "盤點中"),
    /沒有警報/,
  );
});

test("release records export as an Excel-ready CSV", async () => {
  const { session } = db.login("admin", "SGS@1234");
  const filePath = path.join(
    mkdtempSync(path.join(tmpdir(), "c62-release-export-")),
    "records.csv",
  );
  const result = await db.exportAlarmReleases(session.token, "002", null, {
    showSaveDialog: async () => ({ canceled: false, filePath }),
  });
  const content = require("node:fs").readFileSync(filePath, "utf8");
  assert.equal(result.rowCount, db.alarmReleaseRows("002").length);
  assert.ok(content.startsWith("﻿\"通道\",\"名稱\",\"警報原因\",\"解除理由\""));
  assert.match(content, /"盤點中"/);
  assert.match(content, /"已結束"/);
  await assert.rejects(
    db.exportAlarmReleases(session.token, "999", null, {}),
    /尚無解除警報紀錄/,
  );
});

test("used reasons cannot be deleted but can be renamed with their history", () => {
  const { session } = db.login("admin", "SGS@1234");
  const reasons = db.settingsObject()["alarms.release_reasons"];
  assert.ok(reasons.includes("盤點中"));
  assert.ok(db.releaseReasonUsage(session.token)["盤點中"] > 0);
  assert.throws(
    () =>
      db.saveSetting(
        session.token,
        "alarms.release_reasons",
        reasons.filter((item) => item !== "盤點中"),
      ),
    /已有解除紀錄，不能刪除/,
  );
  // Unused reasons can still be removed.
  const trimmed = db.saveSetting(
    session.token,
    "alarms.release_reasons",
    reasons.filter((item) => item !== "除霜作業"),
  );
  assert.ok(!trimmed["alarms.release_reasons"].includes("除霜作業"));

  const renamed = db.renameReleaseReason(session.token, "盤點中", "年度盤點");
  const list = renamed.settings["alarms.release_reasons"];
  assert.equal(
    list.indexOf("年度盤點"),
    trimmed["alarms.release_reasons"].indexOf("盤點中"),
  );
  assert.ok(!list.includes("盤點中"));
  assert.ok(renamed.usage["年度盤點"] > 0);
  assert.equal(renamed.usage["盤點中"], undefined);
  assert.ok(
    db.alarmReleaseRows("002").every((row) => row.release_reason !== "盤點中"),
  );
  assert.throws(
    () => db.renameReleaseReason(session.token, "年度盤點", "設備維修中"),
    /已存在/,
  );
  const operator = db.login("operator1", "1234").session;
  assert.throws(
    () => db.renameReleaseReason(operator.token, "年度盤點", "x"),
    /權限不足/,
  );
});

test("guests cannot release alarms and operators cannot add reason options", () => {
  const guest = db.login("guest", "").session;
  const operator = db.login("operator1", "1234").session;
  db.ingestSnapshotAuthorized(operator.token, snapshot(-24.7));
  assert.throws(() => db.releaseAlarm(guest.token, "002", "x"), /權限不足/);
  assert.throws(
    () => db.releaseAlarm(operator.token, "002", "新理由", true),
    /設定權限/,
  );
  assert.equal(
    db.releaseAlarm(operator.token, "002", "新理由").releases["002"].username,
    "operator1",
  );
});

test("a release expires after one minute and the alarm fires again", () => {
  const start = Date.now();
  mock.timers.enable({ apis: ["Date"], now: start });
  try {
    const { session } = db.login("admin", "SGS@1234");
    db.ingestSnapshotAuthorized(session.token, snapshot(-24.7));
    db.releaseAlarm(session.token, "002", "到期測試");
    mock.timers.tick(db.ALARM_RELEASE_DURATION_MS - 1000);
    db.ingestSnapshotAuthorized(session.token, snapshot(-24.7));
    assert.equal(db.latestSnapshot(session.token)[0].alarm_release.reason, "到期測試");

    mock.timers.tick(2000);
    db.ingestSnapshotAuthorized(session.token, snapshot(-24.7));
    const [channel] = db.latestSnapshot(session.token);
    assert.equal(channel.alarm_release, null);
    assert.equal(channel.web_alarm_ack, false);
    assert.equal(db.login("admin", "SGS@1234").alarmReleases["002"], undefined);
    const [latest] = db.alarmReleaseRows("002");
    assert.equal(latest.active, 0);
    assert.ok(latest.cleared_at);
  } finally {
    mock.timers.reset();
  }
});

test("record counts are per sensor and returned on login and release", () => {
  const { session } = db.login("admin", "SGS@1234");
  const before = db.alarmRecordCounts()["002"] ?? 0;
  assert.ok(before > 0);
  assert.equal(db.alarmRecordCounts()["999"], undefined);
  assert.equal(db.login("admin", "SGS@1234").alarmRecordCounts["002"], before);
  db.ingestSnapshotAuthorized(session.token, snapshot(-24.7));
  const result = db.releaseAlarm(session.token, "002", "計數測試");
  assert.equal(result.recordCounts["002"], before + 1);
});

test("editing limits keeps an alarm latched until it is released", () => {
  const { session } = db.login("admin", "SGS@1234");
  db.saveChannelLimits(session.token, "002", null);
  db.ingestSnapshotAuthorized(session.token, snapshot(4)); // clears releases
  db.ingestSnapshotAuthorized(session.token, snapshot(-24.7));
  assert.equal(db.alarmLatchesObject()["002"], undefined);

  db.saveChannelLimits(session.token, "002", { low: -30, high: 8.5 });
  const latch = db.alarmLatchesObject()["002"];
  assert.match(latch.reason, /低於警報下限/);
  // New readings inside the new range do not clear the latch.
  db.ingestSnapshotAuthorized(session.token, snapshot(-24.7));
  assert.ok(db.latestSnapshot(session.token)[0].alarm_latch);
  assert.ok(db.login("admin", "SGS@1234").alarmLatches["002"]);

  const result = db.releaseAlarm(session.token, "002", "調整範圍");
  assert.equal(result.latches["002"], undefined);
  assert.match(db.alarmReleaseRows("002")[0].alarm_reason, /低於警報下限/);
  assert.throws(
    () => db.releaseAlarm(session.token, "002", "再次"),
    /沒有警報/,
  );
  // Editing limits of a channel that is not alarming never latches.
  db.saveChannelLimits(session.token, "002", { low: -31, high: 8.5 });
  assert.equal(db.alarmLatchesObject()["002"], undefined);
  db.saveChannelLimits(session.token, "002", null);
});
