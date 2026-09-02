import { SensorChannel } from './dashboard.model';

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

export function createMockChannels(count = 200): SensorChannel[] {
  const now = new Date();
  const elapsed = (Date.now() - startedAt) / 1000;
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    const profile = profiles[offset % profiles.length]!;
    const communicationError = index % 67 === 0;
    const alarm = index % 29 === 0;
    const wave = Math.sin(elapsed / 13 + index * .61) * (.45 + (index % 5) * .08);
    const alarmOffset = alarm ? profile.high - profile.sv + 1.2 : 0;
    const pv = Number((profile.sv + wave + alarmOffset).toFixed(1));
    const history = Array.from({ length: 24 }, (_, point) => {
      const stamp = new Date(now.getTime() - (23 - point) * 15000);
      const value = profile.sv + Math.sin((point + index * .7) / 3.8) * .55 + alarmOffset;
      return { time: stamp.toISOString(), value: Number(value.toFixed(1)) };
    });
    const values = [...history.map((point) => point.value), pv];
    return {
      id: String(index).padStart(3, '0'), name: sensorName(index), pv: communicationError ? null : pv,
      sv: profile.sv, st: communicationError ? 1 : alarm ? 2 : 0, time: now.toISOString(), history,
      min: Math.min(...values), max: Math.max(...values),
      avg: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
      count: values.length, web_lo: profile.low, web_hi: profile.high,
      web_alarm: alarm, web_alarm_ack: false,
    };
  });
}
