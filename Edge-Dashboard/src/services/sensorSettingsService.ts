import { apiUrl, runtimeConfig } from '../config/runtime';
import type { DashboardSnapshot } from '../types/dashboard';

interface SensorOverride {
  low: number;
  high: number;
  cleared?: boolean;
}

const storageKey = 'edge-sensor-overrides';

function readOverrides(): Record<string, SensorOverride> {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, SensorOverride>;
  } catch {
    return {};
  }
}

function writeOverride(id: string, value: SensorOverride) {
  const overrides = readOverrides();
  overrides[id] = value;
  localStorage.setItem(storageKey, JSON.stringify(overrides));
}

export function applyMockSensorSettings(snapshot: DashboardSnapshot): DashboardSnapshot {
  if (runtimeConfig.dataMode !== 'mock') return snapshot;
  const overrides = readOverrides();
  return {
    ...snapshot,
    channels: snapshot.channels.map((channel) => {
      const override = overrides[channel.id];
      if (!override) return channel;
      const pv = channel.pv;
      const alarm = pv !== null && (pv < override.low || pv > override.high);
      return {
        ...channel,
        web_lo: override.low,
        web_hi: override.high,
        web_alarm: alarm,
        st: channel.st === 1 ? 1 : alarm ? 2 : 0,
        min: override.cleared ? pv : channel.min,
        max: override.cleared ? pv : channel.max,
        avg: override.cleared ? pv : channel.avg,
        count: override.cleared ? (pv === null ? 0 : 1) : channel.count,
      };
    }),
  };
}

async function request(path: string, token: string) {
  const response = await fetch(apiUrl(path), {
    cache: 'no-store',
    headers: token ? { 'X-EC62-Token': token } : undefined,
  });
  const payload = (await response.json()) as { ok?: boolean; message?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `設定失敗 (${response.status})`);
  }
}

export async function saveSensorLimits(id: string, low: number, high: number, token: string) {
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) {
    throw new Error('LOW 必須小於 HIGH');
  }
  if (runtimeConfig.dataMode === 'mock') {
    const current = readOverrides()[id];
    writeOverride(id, { low, high, cleared: current?.cleared });
    return;
  }
  await request(`/api/set_limits?uid=${encodeURIComponent(id)}&lo=${encodeURIComponent(low)}&hi=${encodeURIComponent(high)}`, token);
}

export async function clearSensorStats(id: string, low: number, high: number, token: string) {
  if (runtimeConfig.dataMode === 'mock') {
    writeOverride(id, { low, high, cleared: true });
    return;
  }
  await request(`/api/clear_minmax?uid=${encodeURIComponent(id)}`, token);
}
