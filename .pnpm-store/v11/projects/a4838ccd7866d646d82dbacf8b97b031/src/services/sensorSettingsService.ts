import { apiUrl, runtimeConfig } from '../config/runtime';
import type { DashboardSnapshot } from '../types/dashboard';

interface SensorOverride {
  low: number;
  high: number;
  cleared?: boolean;
}

const storageKey = 'edge-sensor-overrides';
const alarmLatchStorageKey = 'edge-sensor-alarm-latches';
const alarmAcknowledgedStorageKey = 'edge-sensor-alarm-acknowledged';

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

function readAlarmLatches(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(alarmLatchStorageKey) || '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeAlarmLatches(latches: Record<string, boolean>) {
  localStorage.setItem(alarmLatchStorageKey, JSON.stringify(latches));
}

function readAlarmAcknowledgements(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(alarmAcknowledgedStorageKey) || '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeAlarmAcknowledgements(acknowledgements: Record<string, boolean>) {
  localStorage.setItem(alarmAcknowledgedStorageKey, JSON.stringify(acknowledgements));
}

export function applySensorAlarmState(snapshot: DashboardSnapshot): DashboardSnapshot {
  const overrides = readOverrides();
  const latches = readAlarmLatches();
  const acknowledgements = readAlarmAcknowledgements();
  let latchesChanged = false;
  let acknowledgementsChanged = false;
  const channels = snapshot.channels.map((channel) => {
    const override = runtimeConfig.dataMode === 'mock' ? overrides[channel.id] : undefined;
    const low = override?.low ?? channel.web_lo;
    const high = override?.high ?? channel.web_hi;
    const pv = channel.pv;
    const outsideLimits = pv !== null && low !== null && high !== null
      && Number.isFinite(low) && Number.isFinite(high) && (pv < low || pv > high);
    const hasConfiguredLimits = low !== null && high !== null
      && Number.isFinite(low) && Number.isFinite(high);
    const currentlyAbnormal = channel.web_alarm || outsideLimits
      || (!hasConfiguredLimits && channel.st === 2);
    const acknowledged = Boolean(acknowledgements[channel.id] || channel.web_alarm_ack);

    if (acknowledged && currentlyAbnormal) {
      if (!acknowledgements[channel.id]) {
        acknowledgements[channel.id] = true;
        acknowledgementsChanged = true;
      }
      if (latches[channel.id]) {
        latches[channel.id] = false;
        latchesChanged = true;
      }
    } else if (acknowledged && !currentlyAbnormal) {
      if (acknowledgements[channel.id]) {
        acknowledgements[channel.id] = false;
        acknowledgementsChanged = true;
      }
      if (latches[channel.id]) {
        latches[channel.id] = false;
        latchesChanged = true;
      }
    } else if (currentlyAbnormal && !latches[channel.id]) {
      latches[channel.id] = true;
      latchesChanged = true;
    }

    const alarmLatched = Boolean(latches[channel.id]);
    const alarmAcknowledged = Boolean(acknowledgements[channel.id] || channel.web_alarm_ack);
    const result = {
      ...channel,
      web_lo: low,
      web_hi: high,
      web_alarm: alarmLatched,
      web_alarm_ack: alarmAcknowledged,
      st: channel.st === 1 ? 1 : alarmLatched ? 2 : 0,
    };

    if (!override) return result;
    return {
      ...result,
      min: override.cleared ? pv : channel.min,
      max: override.cleared ? pv : channel.max,
      avg: override.cleared ? pv : channel.avg,
      count: override.cleared ? (pv === null ? 0 : 1) : channel.count,
    };
  });

  if (latchesChanged) writeAlarmLatches(latches);
  if (acknowledgementsChanged) writeAlarmAcknowledgements(acknowledgements);
  return {
    ...snapshot,
    channels,
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

async function post(path: string, token: string, body: Record<string, unknown>) {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-EC62-Token': token } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { ok?: boolean; message?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `解除告警失敗 (${response.status})`);
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

export async function acknowledgeSensorAlarm(id: string, token: string) {
  if (runtimeConfig.dataMode !== 'mock') {
    await post('/api/manual_recovery', token, { uid: id });
  }
  const latches = readAlarmLatches();
  latches[id] = false;
  writeAlarmLatches(latches);
  const acknowledgements = readAlarmAcknowledgements();
  acknowledgements[id] = true;
  writeAlarmAcknowledgements(acknowledgements);
}
