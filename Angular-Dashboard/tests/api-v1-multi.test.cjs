const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const db = require("../electron/database.cjs");

const codec = {
  encrypt: (text) => `enc:${Buffer.from(text).toString("base64")}`,
  decrypt: (text) => Buffer.from(text.slice(4), "base64").toString(),
};

function response(status, body, cookie) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: {
      get: (name) => (name === "set-cookie" ? cookie ?? null : null),
      getSetCookie: () => (cookie ? [cookie] : []),
    },
    json: async () => body,
  };
}

test("live-multi signs in to API v1 and maps /channels/current", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "c62-api-v1-multi-"));
  db.initializeDatabase(directory, true);
  db.configureSecretCodec(codec);
  const admin = db.login("admin", "SGS@1234").session;
  assert.equal(db.settingsObject()["api.v1_url"], "http://127.0.0.1:8765");
  assert.throws(
    () => db.saveSetting(admin.token, "data.mode", "bogus"),
    /資料模式/,
  );
  db.saveSetting(admin.token, "data.mode", "live-multi");
  // A pasted endpoint is trimmed back to the API site.
  assert.equal(
    db.saveSetting(
      admin.token,
      "api.v1_url",
      "http://10.0.0.5:8765/api/v1/channels/current",
    )["api.v1_url"],
    "http://10.0.0.5:8765",
  );
  assert.throws(() =>
    db.saveSetting(admin.token, "api.v1_url", "ftp://10.0.0.5"),
  );
  assert.throws(
    () =>
      db.saveSetting(admin.token, "api.v1_credentials", {
        username: "operator",
        password: "",
      }),
    /密碼/,
  );
  const visible = db.saveSetting(admin.token, "api.v1_credentials", {
    username: "operator",
    password: "pw-1",
  })["api.v1_credentials"];
  assert.deepEqual(visible, { username: "operator", hasPassword: true });
  // Blank password keeps the saved one.
  db.saveSetting(admin.token, "api.v1_credentials", {
    username: "operator",
    password: "",
  });

  const calls = [];
  let sessions = 0;
  let expireNext = false;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/v1/auth/login")) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Origin, "http://10.0.0.5:8765");
      assert.deepEqual(JSON.parse(options.body), {
        username: "operator",
        password: "pw-1",
      });
      sessions += 1;
      return response(
        200,
        { id: 1, username: "operator", role: "admin" },
        `edgesense_session=s${sessions}; HttpOnly; SameSite=Strict; Path=/`,
      );
    }
    assert.equal(url, "http://10.0.0.5:8765/api/v1/channels/current");
    if (expireNext) {
      expireNext = false;
      return response(401, { detail: "登入已過期" });
    }
    assert.equal(options.headers.Cookie, `edgesense_session=s${sessions}`);
    return response(200, {
      snapshot_at: "2026-11-26T02:00:05.000+00:00",
      channels: [
        {
          id: "room-temperature",
          name: "環境溫度",
          type: "temperature",
          unit: "°C",
          value: 25.6,
          time: "2026-11-26T02:00:00.000+00:00",
          st: 0,
        },
        {
          id: "room-humidity",
          name: "環境濕度",
          type: "humidity",
          unit: "%",
          value: 82,
          time: "2026-11-26T02:00:00.000+00:00",
          st: 0,
        },
        {
          id: "probe",
          name: "探針",
          type: "humidity",
          unit: "%",
          value: null,
          time: "2026-11-26T02:00:00.000+00:00",
          st: 2,
        },
        {
          id: "new",
          name: "等待中",
          type: "temperature",
          unit: "°C",
          value: null,
          time: null,
          st: null,
        },
      ],
    });
  };
  try {
    const first = await db.syncApi(admin.token);
    const byId = Object.fromEntries(
      first.snapshot.channels.map((channel) => [channel.id, channel]),
    );
    assert.equal(byId["room-humidity"].unit, "%");
    assert.equal(byId["room-humidity"].pv, 82);
    // Humidity uses its type default (30–70), so 82 % is an alarm.
    assert.deepEqual(
      [byId["room-humidity"].web_lo, byId["room-humidity"].web_hi],
      [30, 70],
    );
    assert.equal(byId["room-temperature"].type, "temperature");
    assert.equal(byId.probe.pv, null);
    assert.equal(byId.new.waiting, true);
    assert.equal(
      first.snapshot.collected_at,
      "2026-11-26T02:00:05.000Z",
    );
    assert.equal(first.result.persisted, true);
    assert.equal(sessions, 1);

    // The cookie is reused, and a 401 signs in again once.
    await db.syncApi(admin.token);
    assert.equal(sessions, 1);
    expireNext = true;
    await db.syncApi(admin.token);
    assert.equal(sessions, 2);

    const latest = db.latestSnapshot(admin.token);
    assert.equal(
      latest.find((channel) => channel.id === "room-humidity").unit,
      "%",
    );
    // The encrypted password never reaches the renderer.
    assert.equal(
      JSON.stringify(db.settingsObject()).includes("enc:"),
      false,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("live-multi reports a missing login clearly", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "c62-api-v1-multi-"));
  db.initializeDatabase(directory, true);
  const admin = db.login("admin", "SGS@1234").session;
  db.saveSetting(admin.token, "data.mode", "live-multi");
  await assert.rejects(db.syncApi(admin.token), /帳號與密碼/);
});
