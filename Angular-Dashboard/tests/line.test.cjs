const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const db = require("../electron/database.cjs");
const { createLineNotifier } = require("../electron/line.cjs");

const SECRET = "0123456789abcdef0123456789abcdef";
const USER = `U${"a".repeat(32)}`;
const GROUP = `C${"b".repeat(32)}`;
const config = {
  enabled: true,
  channelId: "1234567890",
  recipients: [USER, GROUP],
  secret: SECRET,
};
const codec = {
  encrypt: (text) => Buffer.from(text).reverse().toString("base64"),
  decrypt: (text) => Buffer.from(text, "base64").reverse().toString(),
};

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), "c62-line-"));
  const file = db.initializeDatabase(directory, true);
  db.configureSecretCodec(codec);
  return { directory, file, ...db.login("admin", "SGS@1234").session };
}

test("LINE settings are validated, encrypted, masked and admin only", () => {
  const { directory, file, token } = setup();
  assert.deepEqual(db.settingsObject()["notifications.line"], {
    enabled: false,
    channelId: "",
    recipients: [],
    hasSecret: false,
  });
  assert.throws(
    () => db.saveLineSettings(token, { ...config, secret: "" }),
    /Channel Secret/,
  );
  for (const [invalid, message] of [
    [{ channelId: "abc" }, /Channel ID/],
    [{ channelId: "" }, /Channel ID/],
    [{ secret: "short" }, /Channel Secret/],
    [{ recipients: [] }, /接收對象/],
    [{ recipients: ["someone@example.com"] }, /接收對象/],
    [{ recipients: "U" }, /接收對象/],
    [{ enabled: "yes" }, /開關/],
  ])
    assert.throws(
      () => db.saveLineSettings(token, { ...config, ...invalid }),
      message,
    );
  const masked = {
    enabled: true,
    channelId: config.channelId,
    recipients: [USER, GROUP],
    hasSecret: true,
  };
  assert.deepEqual(
    db.saveLineSettings(token, { ...config, recipients: [USER, GROUP, USER] })[
      "notifications.line"
    ],
    masked,
  );
  // The secret never reaches a renderer, nor the disk in plain text.
  assert.doesNotMatch(JSON.stringify(db.settingsObject()), /0123456789abcdef/);
  const raw = new DatabaseSync(file);
  const stored = raw
    .prepare("SELECT value_json FROM app_settings WHERE key=?")
    .get("notifications.line").value_json;
  raw.close();
  assert.doesNotMatch(stored, /0123456789abcdef/);
  // A blank secret keeps the saved one, but not for a different channel.
  const kept = db.saveLineSettings(token, {
    ...config,
    enabled: false,
    secret: "",
  });
  assert.deepEqual(kept["notifications.line"], { ...masked, enabled: false });
  assert.throws(
    () =>
      db.saveLineSettings(token, {
        ...config,
        channelId: "9876543210",
        secret: "",
      }),
    /Channel Secret/,
  );
  assert.throws(
    () => db.saveSetting(token, "notifications.line", config),
    /LINE/,
  );
  const guest = db.login("guest", "").session;
  assert.throws(() => db.saveLineSettings(guest.token, config), /權限不足/);
  assert.throws(() => db.getLineDelivery(guest.token, true), /權限不足/);
  db.initializeDatabase(directory, true);
  const admin = db.login("admin", "SGS@1234").session;
  assert.equal(db.getLineDelivery(admin.token, true).secret, SECRET);
  const cleared = db.saveLineSettings(admin.token, {
    enabled: false,
    channelId: "",
    recipients: [],
    secret: "",
  });
  assert.equal(cleared["notifications.line"].hasSecret, false);
  assert.throws(() => db.getLineDelivery(admin.token, true), /LINE/);
});

test("the secret is refused when it cannot be encrypted", () => {
  const { token } = setup();
  db.configureSecretCodec({
    encrypt() {
      throw new Error("無法加密");
    },
    decrypt: codec.decrypt,
  });
  assert.throws(() => db.saveLineSettings(token, config), /無法加密/);
  assert.equal(
    db.settingsObject()["notifications.line"].hasSecret,
    false,
  );
});

function fakeLine(statuses = {}) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, ...options });
    const key = url.endsWith("/token") ? "token" : "push";
    const status = statuses[key] ?? 200;
    if (status === "offline") throw new Error("ECONNREFUSED");
    return {
      ok: status === 200,
      status,
      json: async () => ({ access_token: "access", expires_in: 900 }),
    };
  };
  return { calls, request };
}
const delivery = { ...config, title: "EdgeBox" };

test("LINE logs in with the channel credentials and pushes to every recipient", async () => {
  const { calls, request } = fakeLine();
  const notify = createLineNotifier(() => delivery, request);
  assert.equal((await notify("t", "CH001 警報")).sent, true);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.line.me/oauth2/v3/token",
      "https://api.line.me/v2/bot/message/push",
      "https://api.line.me/v2/bot/message/push",
    ],
  );
  const login = new URLSearchParams(calls[0].body);
  assert.equal(login.get("grant_type"), "client_credentials");
  assert.equal(login.get("client_id"), config.channelId);
  assert.equal(login.get("client_secret"), SECRET);
  assert.equal(calls[1].headers.Authorization, "Bearer access");
  const message = JSON.parse(calls[1].body);
  assert.equal(message.to, USER);
  assert.equal(message.messages[0].text, "【EdgeBox】異常警報\nCH001 警報");
  // The token is reused, so a second alert only pushes.
  await notify("t", "again");
  assert.equal(calls.filter((call) => call.url.endsWith("/token")).length, 1);
});

test("a disabled LINE channel never calls out, except for an explicit test", async () => {
  const { calls, request } = fakeLine();
  const notify = createLineNotifier(
    () => ({ ...delivery, enabled: false }),
    request,
  );
  assert.equal((await notify("t", "alarm")).sent, false);
  assert.equal(calls.length, 0);
  assert.equal((await notify("t", "test", true)).sent, true);
});

test("LINE failures are reported without leaking the secret", async () => {
  for (const [statuses, message] of [
    [{ token: 400 }, /Channel ID 與 Channel Secret/],
    [{ token: "offline" }, /無法連線/],
    [{ push: 400 }, /2／2 .*好友/],
    [{ push: 429 }, /額度/],
    [{ push: 500 }, /500/],
  ]) {
    const { request } = fakeLine(statuses);
    const result = await createLineNotifier(() => delivery, request)("t", "x");
    assert.equal(result.sent, false);
    assert.match(result.message, message);
    assert.doesNotMatch(result.message, new RegExp(SECRET));
  }
});

test("moved cards and the LINE card sit on their settings tabs", () => {
  const html = readFileSync(
    path.join(__dirname, "../src/app/app.component.html"),
    "utf8",
  );
  // Only cards directly inside the panel count, not ones nested in a card.
  const panel = (key) => {
    const body = html
      .replace(/\r/g, "")
      .split(`<ng-container *ngIf="settingsTab === '${key}'">`)[1];
    let depth = 0;
    let direct = "";
    for (const tag of body.matchAll(/<(\/?)(ng-container|article|div)\b[^>]*>/g)) {
      if (tag[1]) {
        if (depth-- === 0) break;
      } else {
        if (depth === 0) direct += tag[0];
        depth++;
      }
    }
    return direct;
  };
  for (const card of ["status-bar", "alarm-sound"])
    assert.match(panel("alarm"), new RegExp(`data-card="${card}"`));
  assert.match(panel("data"), /data-card="retention"/);
  assert.match(panel("notification"), /data-card="line"/);
  for (const card of ["status-bar", "alarm-sound", "retention", "line"])
    assert.equal(html.split(`data-card="${card}"`).length, 2);
});
