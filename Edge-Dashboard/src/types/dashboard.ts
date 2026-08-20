export type DataMode = 'mock' | 'live';
export type SensorState = 'ok' | 'alarm' | 'error';
export type ViewKey =
  | 'overview'
  | 'channels'
  | 'trends'
  | 'alarms'
  | 'notifications'
  | 'permissions'
  | 'account'
  | 'settings';

export interface HistoryPoint {
  time: string;
  value: number;
}

export interface SensorChannel {
  id: string;
  name: string;
  pv: number | null;
  sv: number | null;
  st: number;
  time: string;
  history: HistoryPoint[];
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
  web_lo: number | null;
  web_hi: number | null;
  web_alarm: boolean;
  web_alarm_ack: boolean;
}

export interface DashboardSnapshot {
  title: string;
  language: string;
  version: string;
  status: string;
  time: string;
  interval: number;
  channel_count: number;
  max_channel: number;
  com: string;
  demo_mode?: boolean;
  channels: SensorChannel[];
  web_user?: string;
  web_role_name?: string;
}

export interface UserSession {
  token: string;
  username: string;
  displayName: string;
  role: string;
}

export function getSensorState(channel: SensorChannel): SensorState {
  if (channel.st === 1 || channel.pv === null) return 'error';
  if (channel.st === 2 || channel.web_alarm) return 'alarm';
  return 'ok';
}
