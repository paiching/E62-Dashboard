const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const db = require("../electron/database.cjs");

test("font sizes are seeded, validated, persisted and admin only", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "c62-font-size-"));
  db.initializeDatabase(directory, true);
  const standard = {
    general: 100,
    topbar: 100,
    cards: 100,
    units: 100,
    trends: 100,
  };
  assert.deepEqual(db.settingsObject()["ui.font_sizes"], standard);
  const { session } = db.login("admin", "SGS@1234");
  const sizes = {
    general: 115,
    topbar: 200,
    cards: 150,
    units: 250,
    trends: 130,
  };
  assert.deepEqual(
    db.saveSetting(session.token, "ui.font_sizes", { ...sizes, extra: 1 })[
      "ui.font_sizes"
    ],
    sizes,
  );
  for (const invalid of [
    null,
    {},
    { ...sizes, general: 200 },
    { ...sizes, cards: 99 },
    { ...sizes, topbar: "150" },
    { ...sizes, units: 350 },
  ])
    assert.throws(
      () => db.saveSetting(session.token, "ui.font_sizes", invalid),
      /字級/,
    );
  // Values saved before the units area existed still load and save.
  const { units, ...older } = sizes;
  assert.equal(
    db.saveSetting(session.token, "ui.font_sizes", older)["ui.font_sizes"]
      .units,
    100,
  );
  db.saveSetting(session.token, "ui.font_sizes", sizes);
  const guest = db.login("guest", "").session;
  assert.throws(() => db.saveSetting(guest.token, "ui.font_sizes", standard));
  db.initializeDatabase(directory, true);
  assert.deepEqual(db.settingsObject()["ui.font_sizes"], sizes);
});
