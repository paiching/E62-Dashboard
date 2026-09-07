export type ViewKey = 'overview' | 'trends' | 'channels' | 'alarms' | 'permissions' | 'account' | 'settings';
export type SensorState = 'ok' | 'alarm' | 'error';
export type AlarmFilter = 'all' | 'alarm' | 'error';

export interface HistoryPoint { time: string; value: number; }
export interface AlarmLimits { low: number; high: number; }
export interface SensorChannel {
  id: string;
  name: string;
  pv: number | null;
  sv: number | null;
  status?: 'ok' | 'read_error';
  st: number;
  time: string;
  history: HistoryPoint[];
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
  web_lo: number;
  web_hi: number;
  limit_source?: 'default' | 'custom';
  web_alarm: boolean;
  web_alarm_ack: boolean;
  alarm_reason?: string | null;
}

export interface UserSession {
  token: string;
  username: string;
  displayName: string;
  role: string;
  roleCode: string;
  permissions: string[];
}
export interface LocalAccount {
  id?: number;
  username: string;
  displayName: string;
  password?: string;
  role: string;
  roleCode: string;
  scope: string;
  active?: boolean | number;
}

export function sensorState(channel: SensorChannel): SensorState {
  if (channel.status === 'read_error' || channel.st === 2 || channel.pv === null) return 'error';
  if (channel.web_alarm_ack) return 'ok';
  if (channel.st === 3 || channel.web_alarm || channel.pv < channel.web_lo || channel.pv > channel.web_hi) return 'alarm';
  return 'ok';
}

export function sensorReason(channel: SensorChannel): string | null {
  const reasons: string[] = [];
  if (channel.status === 'read_error') reasons.push('PV／SV 讀取失敗');
  else if (channel.st === 2) reasons.push('Sensor 異常');
  else if (channel.pv === null) reasons.push('PV 無讀值');
  if (channel.st === 3) reasons.push('讀值連續五筆相同');
  if (channel.pv !== null && Number.isFinite(channel.web_lo) && channel.pv < channel.web_lo) reasons.push(`低於警報下限 ${channel.web_lo} °C`);
  if (channel.pv !== null && Number.isFinite(channel.web_hi) && channel.pv > channel.web_hi) reasons.push(`高於警報上限 ${channel.web_hi} °C`);
  if (channel.web_alarm) reasons.push('設備警報');
  return channel.alarm_reason || reasons.join('、') || null;
}
