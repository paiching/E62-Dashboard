const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const db = require('../electron/database.cjs');

test('new /api/v1/latest response is normalized and enriched', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'e62-api-v1-'));
  db.initializeDatabase(directory);
  const admin = db.login('admin', 'SGS@1234').session;
  assert.equal(db.settingsObject()['data.mode'], 'live');
  assert.equal(db.settingsObject()['api.data_url'], 'http://192.168.68.50:8088/api/v1/latest');
  const originalFetch = global.fetch;
  const collectedAt = '2026-09-04T10:59:34.622737+08:00';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      schema_version: 1, status_version: 1, st_version: 2,
      status: 'connected', collected_at: collectedAt, channel_count: 3,
      channels: [
        { id: '01', name: 'CH01', pv: 25.3, sv: 5, status: 'ok', st: 3 },
        { id: '02', name: 'CH02', pv: null, sv: 24, status: 'read_error', st: 2 },
        { id: '03', name: 'CH03', pv: 5, sv: 5, status: 'ok', st: 1 },
      ],
      age_seconds: 4.314, stale: false,
    }),
  });
  try {
    const result = await db.syncApi(admin.token);
    assert.equal(result.snapshot.collected_at, new Date(collectedAt).toISOString());
    assert.deepEqual(result.snapshot.channels.map(channel => channel.id), ['01', '02', '03']);
    assert.ok(result.snapshot.channels.every(channel => channel.time === new Date(collectedAt).toISOString()));
    assert.deepEqual(result.snapshot.channels.map(channel => channel.history.length), [1, 0, 1]);
    assert.deepEqual(result.snapshot.channels.map(channel => channel.count), [1, 0, 1]);
    assert.ok(result.snapshot.channels.every(channel => channel.limit_source === 'default'));
    assert.deepEqual(db.latestSnapshot(admin.token).map(channel => channel.id), ['01', '02', '03']);
    assert.deepEqual(db.queryReport(admin.token, { limit: 10 }).rows.map(row => row.state), ['alarm', 'error', 'ok']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('unsupported API versions and inconsistent channel counts are rejected', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'e62-api-version-'));
  db.initializeDatabase(directory);
  const admin = db.login('admin', 'SGS@1234').session;
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ schema_version: 2, status_version: 1, st_version: 2, channel_count: 1, channels: [{ id: '01' }] }) });
    await assert.rejects(db.syncApi(admin.token), /API 版本不支援/);
    global.fetch = async () => ({ ok: true, json: async () => ({ schema_version: 1, status_version: 1, st_version: 2, channel_count: 2, channels: [{ id: '01' }] }) });
    await assert.rejects(db.syncApi(admin.token), /channel_count/);
  } finally {
    global.fetch = originalFetch;
  }
});
