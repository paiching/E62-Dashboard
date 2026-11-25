const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const db = require("../electron/database.cjs");

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==";

test("titles, logo and login background are seeded, validated, persisted and admin only", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "c62-branding-"));
  db.initializeDatabase(directory, true);
  assert.deepEqual(db.settingsObject()["ui.titles"], {
    title: "EdgeBox",
    subtitle: "感應器監控系統",
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
  assert.equal(db.settingsObject()["ui.sidebar_logo"], "");
  assert.equal(
    db.saveSetting(token, "ui.sidebar_logo", PNG)["ui.sidebar_logo"],
    PNG,
  );
  assert.equal(
    db.saveSetting(token, "ui.sidebar_logo", "")["ui.logo"],
    PNG,
  );
  for (const invalid of [
    null,
    "https://example.com/logo.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,AAAA",
    `${PNG}" onerror="`,
    `data:image/png;base64,iVBORw0KGgo${"A".repeat(1_000_000)}`,
  ])
    for (const key of ["ui.logo", "ui.sidebar_logo"])
      assert.throws(() => db.saveSetting(token, key, invalid), /Logo/);
  assert.equal(db.settingsObject()["ui.logo_style"], "inverse");
  for (const style of ["original", "light", "inverse"])
    assert.equal(
      db.saveSetting(token, "ui.logo_style", style)["ui.logo_style"],
      style,
    );
  for (const invalid of [null, "", "dark", ["light"]])
    assert.throws(
      () => db.saveSetting(token, "ui.logo_style", invalid),
      /Logo 樣式/,
    );
  assert.equal(db.settingsObject()["ui.logo_size"], "standard");
  assert.equal(
    db.saveSetting(token, "ui.logo_size", "xlarge")["ui.logo_size"],
    "xlarge",
  );
  for (const invalid of [null, "", "huge", 2])
    assert.throws(
      () => db.saveSetting(token, "ui.logo_size", invalid),
      /Logo 大小/,
    );
  assert.equal(db.settingsObject()["ui.login_background"], "");
  assert.equal(
    db.saveSetting(token, "ui.login_background", JPEG)["ui.login_background"],
    JPEG,
  );
  for (const invalid of [
    null,
    PNG,
    "https://example.com/a.jpg",
    "data:image/jpeg;base64,AAAA",
    `${JPEG}"),url("https://example.com`,
    `data:image/jpeg;base64,/9j/${"A".repeat(2_000_000)}`,
  ])
    assert.throws(
      () => db.saveSetting(token, "ui.login_background", invalid),
      /背景圖/,
    );
  const guest = db.login("guest", "").session;
  assert.throws(() => db.saveSetting(guest.token, "ui.titles", titles));
  assert.throws(() => db.saveSetting(guest.token, "ui.logo", ""));
  assert.throws(() => db.saveSetting(guest.token, "ui.sidebar_logo", ""));
  assert.throws(() => db.saveSetting(guest.token, "ui.login_background", ""));
  db.initializeDatabase(directory, true);
  assert.deepEqual(db.settingsObject()["ui.titles"], titles);
  assert.equal(db.settingsObject()["ui.logo"], PNG);
  assert.equal(db.settingsObject()["ui.login_background"], JPEG);
  const admin = db.login("admin", "SGS@1234").session;
  assert.equal(db.saveSetting(admin.token, "ui.logo", "")["ui.logo"], "");
});

test("titles still at the first release's defaults move to the new defaults", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "c62-branding-"));
  db.initializeDatabase(directory, true);
  const { token } = db.login("admin", "SGS@1234").session;
  db.saveSetting(token, "ui.titles", {
    title: "Edge Dashboard",
    subtitle: "C62 溫度感應器監控系統",
  });
  db.initializeDatabase(directory, true);
  assert.deepEqual(db.settingsObject()["ui.titles"], {
    title: "EdgeBox",
    subtitle: "感應器監控系統",
  });
});

test("a logo uploaded before styles existed keeps its white tile", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "c62-branding-"));
  const { DatabaseSync } = require("node:sqlite");
  const file = db.initializeDatabase(directory, true);
  const { token } = db.login("admin", "SGS@1234").session;
  db.saveSetting(token, "ui.logo", PNG);
  const raw = new DatabaseSync(file);
  raw.exec("DELETE FROM app_settings WHERE key='ui.logo_style'");
  raw.close();
  db.initializeDatabase(directory, true);
  assert.equal(db.settingsObject()["ui.logo_style"], "light");
});

test("card layouts are validated, persisted and admin only", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "c62-cards-"));
  db.initializeDatabase(directory, true);
  assert.deepEqual(db.settingsObject()["ui.card_layouts"], {});
  const { token } = db.login("admin", "SGS@1234").session;
  const layouts = { theme: [["titles", "font-size"], [], ["status-bar"]] };
  assert.deepEqual(
    db.saveSetting(token, "ui.card_layouts", layouts)["ui.card_layouts"],
    layouts,
  );
  for (const invalid of [
    null,
    [],
    "theme",
    { other: [["titles"]] },
    { theme: [] },
    { theme: ["titles"] },
    { theme: [["titles"], ["titles"]] },
    { theme: [["<b>"]] },
    { theme: [[1]] },
    { theme: Array.from({ length: 21 }, () => []) },
  ])
    assert.throws(
      () => db.saveSetting(token, "ui.card_layouts", invalid),
      /卡片排列/,
    );
  const guest = db.login("guest", "").session;
  assert.throws(() => db.saveSetting(guest.token, "ui.card_layouts", {}));
  db.initializeDatabase(directory, true);
  assert.deepEqual(db.settingsObject()["ui.card_layouts"], layouts);
});
