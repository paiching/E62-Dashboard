export type ViewKey =
  | "overview"
  | "trends"
  | "channels"
  | "alarms"
  | "permissions"
  | "account"
  | "settings";
export type SensorState = "ok" | "alarm" | "error";
export type AlarmFilter = "all" | "alarm" | "error";

export interface HistoryPoint {
  time: string;
  value: number;
}
export interface AlarmLimits {
  low: number;
  high: number;
}
export interface AlarmRelease {
  reason: string;
  username: string;
  displayName?: string;
  releasedAt: string;
}
/** An alarm cleared only by editing limits; it stays until released. */
export interface AlarmLatch {
  reason: string;
  latchedAt: string;
}
/** A release silences a channel for one minute, then the alarm re-arms. */
export const ALARM_RELEASE_DURATION_MS = 60_000;
export function alarmReleaseExpired(
  release: AlarmRelease,
  now = Date.now(),
): boolean {
  const at = Date.parse(release.releasedAt);
  return !Number.isFinite(at) || now - at >= ALARM_RELEASE_DURATION_MS;
}
export interface SensorChannel {
  id: string;
  name: string;
  /** API v1 measurement kind, e.g. "temperature" or "humidity". */
  type?: string;
  /** API v1 display unit, e.g. "°C" or "%"; may be an empty string. */
  unit?: string;
  pv: number | null;
  sv: number | null;
  status?: "ok" | "read_error";
  st: number;
  time: string;
  history: HistoryPoint[];
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
  web_lo: number;
  web_hi: number;
  limit_source?: "default" | "custom";
  web_alarm: boolean;
  web_alarm_ack: boolean;
  alarm_reason?: string | null;
  alarm_release?: AlarmRelease | null;
  alarm_latch?: AlarmLatch | null;
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
  phone?: string;
  email?: string;
  password?: string;
  role: string;
  roleCode: string;
  scope: string;
  active?: boolean | number;
}

/** Channels from older APIs carry no type; they are temperature probes. */
export const DEFAULT_CHANNEL_TYPE = "temperature";
const CHANNEL_TYPE_LABELS: Record<string, string> = {
  temperature: "溫度",
  humidity: "濕度",
};
const CHANNEL_TYPE_UNITS: Record<string, string> = {
  temperature: "°C",
  humidity: "%",
};
/** Matches the database seed; used when no setting has been loaded. */
export const SEED_TYPE_DEFAULT_LIMITS: Record<string, AlarmLimits> = {
  humidity: { low: 30, high: 70 },
};
/** Types always offered in settings, even before any channel reports them. */
export const KNOWN_CHANNEL_TYPES = Object.keys(CHANNEL_TYPE_LABELS);
/**
 * "alarms.default_limits" holds the temperature default; other types read
 * "alarms.type_default_limits" and fall back to the temperature default.
 */
export function typeDefaultLimits(
  byType: unknown,
  type: string,
): AlarmLimits | null {
  if (type === DEFAULT_CHANNEL_TYPE || !byType || typeof byType !== "object")
    return null;
  const limits = (byType as Record<string, AlarmLimits>)[type];
  return limits &&
    Number.isFinite(limits.low) &&
    Number.isFinite(limits.high) &&
    limits.low < limits.high
    ? limits
    : null;
}
export function typeUnit(type: string): string {
  return CHANNEL_TYPE_UNITS[type] ?? "";
}
export function channelType(channel: Pick<SensorChannel, "type">): string {
  return channel.type?.trim() || DEFAULT_CHANNEL_TYPE;
}
export function channelUnit(
  channel: Pick<SensorChannel, "type" | "unit">,
): string {
  return typeof channel.unit === "string"
    ? channel.unit
    : (CHANNEL_TYPE_UNITS[channelType(channel)] ?? "");
}
export function channelTypeLabel(type: string): string {
  return CHANNEL_TYPE_LABELS[type] ?? type;
}
export function withUnit(value: string, unit: string): string {
  return unit ? `${value} ${unit}` : value;
}

export function sensorState(channel: SensorChannel): SensorState {
  // A Dashboard release (with reason) silences the current alarm or error episode.
  if (channel.alarm_release) return "ok";
  if (
    channel.status === "read_error" ||
    channel.st === 2 ||
    channel.pv === null
  )
    return "error";
  if (channel.alarm_latch) return "alarm";
  if (channel.web_alarm_ack) return "ok";
  if (
    channel.st === 3 ||
    channel.web_alarm ||
    channel.pv < channel.web_lo ||
    channel.pv > channel.web_hi
  )
    return "alarm";
  return "ok";
}

/** Outside the saved limits. A faulty sensor has no value to compare. */
export function outsideLimits(channel: SensorChannel): boolean {
  if (
    channel.status === "read_error" ||
    channel.st === 2 ||
    channel.pv === null
  )
    return false;
  return channel.pv < channel.web_lo || channel.pv > channel.web_hi;
}

export function sensorReason(channel: SensorChannel): string | null {
  const reasons: string[] = [];
  if (channel.status === "read_error") reasons.push("PV／SV 讀取失敗");
  else if (channel.st === 2) reasons.push("Sensor 異常");
  else if (channel.pv === null) reasons.push("PV 無讀值");
  if (channel.st === 3) reasons.push("讀值連續五筆相同");
  if (
    channel.pv !== null &&
    Number.isFinite(channel.web_lo) &&
    channel.pv < channel.web_lo
  )
    reasons.push(
      `低於警報下限 ${withUnit(String(channel.web_lo), channelUnit(channel))}`,
    );
  if (
    channel.pv !== null &&
    Number.isFinite(channel.web_hi) &&
    channel.pv > channel.web_hi
  )
    reasons.push(
      `高於警報上限 ${withUnit(String(channel.web_hi), channelUnit(channel))}`,
    );
  if (channel.web_alarm) reasons.push("設備警報");
  if (!reasons.length && channel.alarm_latch)
    reasons.push(`${channel.alarm_latch.reason}（範圍已調整，需手動解除）`);
  return channel.alarm_reason || reasons.join("、") || null;
}
