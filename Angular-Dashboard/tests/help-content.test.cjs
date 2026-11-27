// Keeps the 使用說明 manual in step with the screens it describes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const app = (file) => readFileSync(path.join(__dirname, "../src/app", file), "utf8");
function loadHelp() {
  const { outputText } = ts.transpileModule(app("help-content.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function("module", "exports", "require", outputText)(module, module.exports, require);
  return module.exports;
}
const help = loadHelp();
const templates = [
  "app.component.html",
  "role-manager.component.html",
  "help-center.component.html",
].map(app).join("\n");
const catalog = JSON.parse(
  readFileSync(path.join(__dirname, "../electron/permission-catalog.json"), "utf8"),
);
const codes = new Set();
(function walk(nodes) {
  for (const node of nodes) {
    codes.add(node.code);
    walk(node.children ?? []);
  }
})(catalog);

test("every tour target still exists in the screen templates", () => {
  for (const chapter of help.HELP_CHAPTERS)
    for (const step of chapter.tour ?? []) {
      const classes = [...step.target.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      const cards = [...step.target.matchAll(/data-card="([\w-]+)"/g)].map((m) => m[1]);
      assert.ok(classes.length || cards.length, `${chapter.id}: ${step.target}`);
      for (const name of classes)
        assert.match(
          templates,
          new RegExp(`class="[^"]*\\b${name}\\b`),
          `${chapter.id}「${step.title}」找不到 .${name}，請更新 help-content.ts`,
        );
      for (const card of cards)
        assert.ok(
          templates.includes(`data-card="${card}"`),
          `${chapter.id}「${step.title}」找不到 data-card="${card}"`,
        );
    }
});

test("permissions named in the manual exist in the permission catalog", () => {
  for (const chapter of help.HELP_CHAPTERS) {
    if (chapter.permission) assert.ok(codes.has(chapter.permission), chapter.permission);
    for (const step of chapter.tour ?? [])
      if (step.permission) assert.ok(codes.has(step.permission), step.permission);
  }
});

test("every menu page has a chapter, and chapters are complete", () => {
  const ids = new Set(help.HELP_CHAPTERS.map((chapter) => chapter.id));
  assert.equal(ids.size, help.HELP_CHAPTERS.length, "chapter ids are unique");
  for (const view of ["overview", "trends", "channels", "alarms", "permissions", "settings", "help"])
    assert.ok(ids.has(help.HELP_CHAPTER_FOR_VIEW[view]), `no chapter for ${view}`);
  for (const chapter of help.HELP_CHAPTERS) {
    assert.ok(chapter.title && chapter.summary && chapter.sections.length, chapter.id);
    for (const section of chapter.sections)
      assert.ok(
        section.text || section.steps?.length || section.bullets?.length,
        `${chapter.id}「${section.heading}」沒有內容`,
      );
  }
  assert.match(help.HELP_UPDATED, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(help.HELP_CHANGELOG[0].date, help.HELP_UPDATED, "最新更新紀錄日期應等於 HELP_UPDATED");
});

test("the 使用說明 menu is open to every account, even one without permissions", () => {
  const db = require("../electron/database.cjs");
  db.initializeDatabase(mkdtempSync(path.join(tmpdir(), "edgebox-help-")), true);
  for (const [user, password] of [["admin", "SGS@1234"], ["operator1", "1234"], ["guest", ""]]) {
    const keys = db.login(user, password).menus.map((menu) => menu.key);
    assert.equal(keys.at(-1), "help", user);
  }
  const { token } = db.login("admin", "SGS@1234").session;
  const { code } = db.saveRole(token, { displayName: "空白角色", description: "", permissions: [] });
  db.saveUser(token, { username: "nobody", displayName: "無權限", password: "1234", roleCode: code, scope: "all" });
  assert.deepEqual(db.login("nobody", "1234").menus.map((menu) => menu.key), ["help"]);
});
