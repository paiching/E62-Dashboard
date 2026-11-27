const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const ts = require("typescript");
const db = require("../electron/database.cjs");
const permissions = require("../electron/permissions.cjs");

const directory = mkdtempSync(path.join(tmpdir(), "c62-role-test-"));
const inspector = new DatabaseSync(db.initializeDatabase(directory));
let admin = db.login("admin", "SGS@1234").session;
const signIn = (name, password = "1234") => db.login(name, password).session;
const role = (code, token = admin.token) =>
  db.listRoles(token).find((item) => item.code === code);
const codes = (code) => role(code).permissions.map((item) => item.code);
const input = (code, list) => ({
  code,
  displayName: role(code).displayName,
  description: role(code).description,
  permissions: list,
});
let nextUser = 1;
/** Signs in as a new account holding a new role with these permissions. */
function userWith(list) {
  const name = `tester${nextUser++}`;
  const { code } = db.saveRole(admin.token, {
    displayName: `Role ${name}`,
    description: "",
    permissions: list,
  });
  db.saveUser(admin.token, {
    username: name,
    displayName: name,
    password: "1234",
    roleCode: code,
    scope: "all",
  });
  return { ...db.login(name, "1234"), name, code };
}

test("catalog codes are unique and cover every setting and settings card", () => {
  assert.equal(new Set(permissions.ALL_CODES).size, permissions.ALL_CODES.length);
  const html = readFileSync(
    path.join(__dirname, "../src/app/app.component.html"),
    "utf8",
  );
  for (const [, code] of html.matchAll(/\bcan\(\s*'([^']+)'\s*\)/g))
    assert.ok(permissions.ALL_CODES.includes(code), code);
  const cards = [...html.matchAll(/data-card="([a-z-]+)"/g)].map((m) => m[1]);
  const granted = permissions.NODES.filter(
    (node) => node.type === "card" && node.code.startsWith("settings."),
  ).map((node) => node.code.split(".").at(-1));
  assert.deepEqual(cards.sort(), granted.sort());
  for (const code of Object.values(permissions.SETTING_PERMISSIONS).flat())
    assert.ok(permissions.ALL_CODES.includes(code), code);
  const handled = new Set(Object.keys(permissions.SETTING_PERMISSIONS));
  const orphans = Object.keys(db.settingsObject()).filter(
    (key) => !handled.has(key),
  );
  assert.deepEqual(orphans, ["ui.default_view"]);
});

test("renderer and main process normalize a selection the same way", () => {
  const source = readFileSync(
    path.join(__dirname, "../src/app/permissions.ts"),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name) => require(path.join(__dirname, "../src/app", name)),
    module,
    module.exports,
  );
  const ui = module.exports;
  for (const list of [
    [],
    ["settings.theme.titles.edit"],
    ["alarms.ack", "dashboard.sensors"],
    ["settings.manage", "settings.theme"],
    permissions.ALL_CODES,
  ])
    assert.deepEqual(
      ui.normalizePermissions(list),
      permissions.normalizePermissions(list),
    );
  for (const item of ui.builtInRoles())
    assert.deepEqual(
      item.permissions.map(({ code }) => code),
      permissions.defaultPermissions(item.code),
    );

  const find = (code) =>
    ui.flattenPermissions(ui.PERMISSION_CATALOG).find((n) => n.code === code);
  const theme = find("settings.theme");
  let granted = ui.setPermission([], find("settings.theme.titles.edit"), true);
  assert.deepEqual(granted, [
    "settings.manage",
    "settings.theme",
    "settings.theme.titles",
    "settings.theme.titles.edit",
  ]);
  assert.equal(ui.checkState(new Set(granted), theme), "some");
  granted = ui.setPermission(granted, theme, true);
  assert.equal(ui.checkState(new Set(granted), theme), "all");
  granted = ui.setViewOnly(granted, theme);
  assert.ok(granted.includes("settings.theme.titles"));
  assert.ok(!granted.some((code) => code.endsWith(".edit")));
  assert.deepEqual(
    ui.setPermission(["settings.theme.titles.edit"], find("settings.theme.titles"), false),
    [],
  );
});

test("unchecked permissions stay off after a restart, on fresh and old databases", () => {
  db.saveRole(
    admin.token,
    input(
      "guest",
      codes("guest").filter((code) => !code.startsWith("trends.")),
    ),
  );
  db.initializeDatabase(directory);
  admin = signIn("admin", "SGS@1234");
  assert.ok(!codes("guest").some((code) => code.startsWith("trends.")));

  // A database from before tab and card permissions only knew these codes.
  const old = mkdtempSync(path.join(tmpdir(), "c62-role-old-"));
  const oldDb = new DatabaseSync(db.initializeDatabase(old));
  oldDb.exec("PRAGMA foreign_keys=ON");
  oldDb.exec(
    "DELETE FROM permissions WHERE code NOT IN ('dashboard.view','trends.view','reports.view','reports.export','alarms.view','alarms.ack','users.manage','settings.manage')",
  );
  oldDb.exec(
    "INSERT INTO permissions(code,display_name) VALUES('tests.run','功能測試')",
  );
  db.initializeDatabase(old);
  for (const [name, password, code] of [
    ["admin", "SGS@1234", "administrator"],
    ["operator1", "1234", "operator"],
    ["guest", "", "guest"],
  ])
    assert.deepEqual(
      db.login(name, password).session.permissions,
      permissions.defaultPermissions(code),
    );
  assert.equal(
    oldDb.prepare("SELECT 1 FROM permissions WHERE code='tests.run'").get(),
    undefined,
  );
  oldDb.close();
  db.initializeDatabase(directory);
  admin = signIn("admin", "SGS@1234");
});

test("a custom role can be added, edited, used and deleted", () => {
  const { code, roles } = db.saveRole(admin.token, {
    displayName: "  夜班  人員 ",
    description: "只看警報",
    permissions: ["alarms.tab.alarm"],
  });
  const saved = roles.find((item) => item.code === code);
  assert.equal(saved.displayName, "夜班 人員");
  assert.equal(saved.isSystem, false);
  assert.deepEqual(
    saved.permissions.map((item) => item.code),
    ["alarms.view", "alarms.tab.alarm"],
  );
  db.saveUser(admin.token, {
    username: "night",
    displayName: "夜班",
    password: "1234",
    roleCode: code,
    scope: "all",
  });
  const login = db.login("night", "1234");
  assert.deepEqual(
    login.menus.map((menu) => menu.key),
    ["alarms", "help"],
  );
  assert.throws(() => db.deleteRole(admin.token, code), /1 個帳號/);
  db.saveRole(admin.token, {
    code,
    displayName: "夜班",
    description: "",
    permissions: ["reports.table"],
  });
  assert.throws(() => db.queryReport(login.session.token), /登入已失效/);
  const again = signIn("night");
  assert.equal(db.queryReport(again.token).total, 0);
  db.deleteUser(admin.token, again.userId);
  assert.ok(!db.deleteRole(admin.token, code).some((r) => r.code === code));
});

test("invalid roles are rejected and leave data intact", () => {
  const before = db.listRoles(admin.token);
  const valid = { displayName: "X", description: "", permissions: [] };
  for (const [bad, message] of [
    [{ displayName: " " }, /角色名稱需為/],
    [{ displayName: "字".repeat(31) }, /角色名稱需為/],
    [{ description: "字".repeat(121) }, /說明/],
    [{ displayName: "OPERATOR" }, /已存在/],
    [{ permissions: ["unknown.code"] }, /未知/],
    [{ permissions: undefined }, /未知/],
    [{ code: "missing" }, /不存在/],
    [{ code: "administrator" }, /不可修改/],
  ])
    assert.throws(() => db.saveRole(admin.token, { ...valid, ...bad }), message);
  for (const code of ["administrator", "operator", "guest"])
    assert.throws(() => db.deleteRole(admin.token, code), /內建角色/);
  assert.deepEqual(db.listRoles(admin.token), before);
});

test("nobody can raise access beyond their own", () => {
  const { session, code } = userWith([
    "users.accounts.create",
    "users.accounts.edit",
    "users.accounts.delete",
    "users.roles.create",
    "users.roles.edit",
    "users.roles.delete",
  ]);
  const { token } = session;
  assert.throws(
    () =>
      db.saveRole(token, {
        displayName: "越權",
        description: "",
        permissions: ["settings.data.api-token.edit"],
      }),
    /權限不足/,
  );
  assert.throws(() => db.saveRole(token, input("operator", [])), /權限不足/);
  assert.throws(() => db.saveRole(token, input(code, [])), /所屬的角色/);
  const users = db.listUsers(token);
  const administrator = users.find((user) => user.username === "admin");
  assert.throws(
    () => db.saveUser(token, { ...administrator, password: "hacked" }),
    /權限不足/,
  );
  assert.throws(
    () =>
      db.saveUser(token, {
        username: "boss",
        displayName: "Boss",
        roleCode: "administrator",
        scope: "all",
      }),
    /權限不足/,
  );
  const operator = users.find((user) => user.username === "operator1");
  assert.throws(() => db.deleteUser(token, operator.id), /權限不足/);
});

test("each settings card guards its own settings", () => {
  const { session, settings } = userWith(["settings.theme.titles.edit"]);
  const titles = { title: "測試", subtitle: "" };
  assert.deepEqual(
    db.saveSetting(session.token, "ui.titles", titles)["ui.titles"],
    titles,
  );
  for (const key of Object.keys(db.settingsObject()))
    if (key !== "ui.titles")
      assert.throws(
        () => db.saveSetting(session.token, key, ""),
        /權限不足/,
        key,
      );
  const viewer = userWith(["settings.theme.titles"]).session;
  assert.throws(
    () => db.saveSetting(viewer.token, "ui.titles", titles),
    /權限不足/,
  );
  // The token and LINE IDs are only sent to roles that see their cards.
  db.saveSetting(admin.token, "api.auth_token", "secret-token");
  assert.equal(settings["api.auth_token"], "");
  assert.equal(db.visibleSettings()["api.auth_token"], "");
  assert.equal(
    userWith(["settings.data.api-token"]).settings["api.auth_token"],
    "secret-token",
  );
});

test("actions need their own permission, background sync only a session", async () => {
  const { session } = userWith(["sensor.limits", "reports.table"]);
  const { token } = session;
  const snapshot = { channels: [{ id: "001", name: "A", pv: 20, st: 0 }] };
  db.ingestSnapshotAuthorized(token, snapshot);
  assert.equal(db.getAlertSettings(token).soundEnabled, true);
  assert.equal(db.queryReport(token).total, 1);
  for (const call of [
    () => db.saveChannelLimits(token, "001", { low: 1, high: 30 }),
    () => db.saveAlarmLatches(token, {}),
    () => db.releaseAlarm(token, "001", "x"),
    () => db.getAlertSettings(token, true),
    () => db.listUsers(token),
    () => db.listRoles(token),
    () => db.renameReleaseReason(token, "a", "b"),
    () => db.saveLineSettings(token, {}),
  ])
    assert.throws(call, /權限不足/);
  await assert.rejects(db.exportReport(token, {}), /權限不足/);
  await assert.rejects(db.exportAlarmReleases(token, "001"), /權限不足/);
  await assert.rejects(db.cleanupHistory(token), /權限不足/);
  const editor = userWith(["sensor.limits.edit"]).session;
  db.saveChannelLimits(editor.token, "001", { low: 1, high: 30 });
  inspector.close();
});
