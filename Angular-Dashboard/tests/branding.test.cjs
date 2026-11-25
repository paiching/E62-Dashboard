const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const db = require("../electron/database.cjs");

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("titles and logo are seeded, validated, persisted and admin only", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "c62-branding-"));
  db.initializeDatabase(directory, true);
  assert.deepEqual(db.settingsObject()["ui.titles"], {
    title: "Edge Dashboard",
    subtitle: "C62 溫度感應器監控系統",
  });
  assert.equal(db.settingsObject()["ui.logo"], "");
  const { token } = db.login("admin", "SGS@1234").session;
  const titles = { title: "冷鏈監控", subtitle: "" };
  assert.deepEqual(
    db.saveSetting(token, "ui.titles", {
      title: "  冷鏈監控 ",
      subtitle: " ",
      extra: 1,
    })["ui.titles"],
    titles,
  );
  for (const invalid of [
    null,
    {},
    { title: " ", subtitle: "x" },
    { title: "x".repeat(31), subtitle: "" },
    { title: "x", subtitle: "x".repeat(41) },
    { title: "x" },
    { title: 1, subtitle: "" },
  ])
    assert.throws(
      () => db.saveSetting(token, "ui.titles", invalid),
      /專案名稱|次標/,
    );
  assert.equal(db.saveSetting(token, "ui.logo", PNG)["ui.logo"], PNG);
  for (const invalid of [
    null,
    "https://example.com/logo.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,AAAA",
    `${PNG}" onerror="`,
    `data:image/png;base64,iVBORw0KGgo${"A".repeat(1_000_000)}`,
  ])
    assert.throws(() => db.saveSetting(token, "ui.logo", invalid), /Logo/);
  const guest = db.login("guest", "").session;
  assert.throws(() => db.saveSetting(guest.token, "ui.titles", titles));
  assert.throws(() => db.saveSetting(guest.token, "ui.logo", ""));
  db.initializeDatabase(directory, true);
  assert.deepEqual(db.settingsObject()["ui.titles"], titles);
  assert.equal(db.settingsObject()["ui.logo"], PNG);
  const admin = db.login("admin", "SGS@1234").session;
  assert.equal(db.saveSetting(admin.token, "ui.logo", "")["ui.logo"], "");
});
