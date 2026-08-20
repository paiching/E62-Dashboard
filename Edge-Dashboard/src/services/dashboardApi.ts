import { runtimeConfig } from '../config/runtime';
import { createMockSnapshot } from '../mocks/mockData';
import { applyMockSensorSettings } from './sensorSettingsService';
import type { DashboardSnapshot, SensorChannel } from '../types/dashboard';

function normalizeChannel(channel: Partial<SensorChannel>, index: number): SensorChannel {
  return {
    id: String(channel.id ?? index + 1).padStart(2, '0'),
    name: String(channel.name ?? `CH${index + 1}`),
    pv: channel.pv === null || channel.pv === undefined ? null : Number(channel.pv),
    sv: channel.sv === null || channel.sv === undefined ? null : Number(channel.sv),
    st: Number(channel.st ?? 0),
    time: String(channel.time ?? ''),
    history: Array.isArray(channel.history) ? channel.history : [],
    min: channel.min === null || channel.min === undefined ? null : Number(channel.min),
    max: channel.max === null || channel.max === undefined ? null : Number(channel.max),
    avg: channel.avg === null || channel.avg === undefined ? null : Number(channel.avg),
    count: Number(channel.count ?? 0),
    web_lo:
      channel.web_lo === null || channel.web_lo === undefined
        ? null
        : Number(channel.web_lo),
    web_hi:
      channel.web_hi === null || channel.web_hi === undefined
        ? null
        : Number(channel.web_hi),
    web_alarm: Boolean(channel.web_alarm),
    web_alarm_ack: Boolean(channel.web_alarm_ack),
  };
}

function normalizeSnapshot(payload: DashboardSnapshot): DashboardSnapshot {
  const channels = Array.isArray(payload.channels)
    ? payload.channels.map(normalizeChannel)
    : [];
  return {
    ...payload,
    title: String(payload.title || 'E62 / C62 Edge Dashboard'),
    status: String(payload.status || '--'),
    time: String(payload.time || new Date().toISOString()),
    interval: Number(payload.interval || 3),
    channel_count: Number(payload.channel_count || channels.length),
    max_channel: Number(payload.max_channel || channels.length),
    com: String(payload.com || '--'),
    channels,
  };
}

export async function fetchDashboardSnapshot(
  token: string,
  signal?: AbortSignal,
): Promise<DashboardSnapshot> {
  if (runtimeConfig.dataMode === 'mock') {
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return applyMockSensorSettings(createMockSnapshot(200));
  }

  const response = await fetch(runtimeConfig.apiDataUrl, {
    cache: 'no-store',
    signal,
    headers: token ? { 'X-EC62-Token': token } : undefined,
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return normalizeSnapshot((await response.json()) as DashboardSnapshot);
}
