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
