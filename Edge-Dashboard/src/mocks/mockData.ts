import type { DashboardSnapshot, SensorChannel } from '../types/dashboard';

const startedAt = Date.now();

const profiles = [
  { sv: 5, low: 2, high: 8 },
  { sv: -25, low: -30, high: -18 },
  { sv: 22, low: 18, high: 26 },
  { sv: 36, low: 33, high: 39 },
];

function sensorName(index: number): string {
  const area = String.fromCharCode(65 + Math.floor((index - 1) / 40));
  const rack = Math.floor(((index - 1) % 40) / 2) + 1;
  const probe = ((index - 1) % 2) + 1;
  return `${area}1-R${String(rack).padStart(2, '0')}-${probe}`;
}

function buildChannel(index: number, now: Date): SensorChannel {
  const profile = profiles[(index - 1) % profiles.length];
  const elapsed = (Date.now() - startedAt) / 1000;
  const connectionError = index % 67 === 0;
  const alarm = index % 29 === 0;
  const wave = Math.sin(elapsed / 13 + index * 0.61) * (0.45 + (index % 5) * 0.08);
  const alarmOffset = alarm ? profile.high - profile.sv + 1.2 : 0;
  const pv = Number((profile.sv + wave + alarmOffset).toFixed(1));
  const history = Array.from({ length: 24 }, (_, pointIndex) => {
    const stamp = new Date(now.getTime() - (23 - pointIndex) * 15_000);
    const value =
      profile.sv +
      Math.sin((pointIndex + index * 0.7) / 3.8) * 0.55 +
      alarmOffset;
    return { time: stamp.toISOString(), value: Number(value.toFixed(1)) };
  });
  const values = history.map((point) => point.value).concat(pv);

  return {
    id: String(index).padStart(3, '0'),
    name: sensorName(index),
    pv: connectionError ? null : pv,
    sv: profile.sv,
    st: connectionError ? 1 : alarm ? 2 : 0,
    time: now.toISOString(),
    history,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
    count: values.length,
    web_lo: profile.low,
    web_hi: profile.high,
    web_alarm: alarm,
    web_alarm_ack: false,
  };
}

export function createMockSnapshot(count = 200): DashboardSnapshot {
  const now = new Date();
  return {
    title: 'E62 / C62 Edge Dashboard',
    language: 'zh',
    version: 'React 1.0',
    status: 'DEMO 已連線 · 獨立模擬資料',
    time: now.toISOString(),
    interval: 3,
    channel_count: count,
    max_channel: count,
    com: 'MOCK-SIMULATOR',
    demo_mode: true,
    channels: Array.from({ length: count }, (_, index) => buildChannel(index + 1, now)),
    web_user: 'demo',
    web_role_name: '展示模式',
  };
}
