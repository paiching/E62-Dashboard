import { Injectable } from '@angular/core';
import { AlarmLimits, LocalAccount, SensorChannel, UserSession, ViewKey } from './dashboard.model';

export interface DatabaseMenu { key: ViewKey; label: string; icon: string; route: string; }
export interface DatabaseLogin { session: UserSession; settings: Record<string, unknown>; channelLimits: Record<string, AlarmLimits>; menus: DatabaseMenu[]; }
export interface ReportFilter { query?: string; state?: string; from?: string; to?: string; limit?: number; offset?: number; }
export interface ReportRow { id: string; name: string; pv: number | null; sv: number | null; state: string; web_lo: number | null; web_hi: number | null; time: string; source: string; }
export interface ReportResult { rows: ReportRow[]; total: number; limit: number; offset: number; }
export interface DatabaseStatus { connected: boolean; checkedAt: string; error?: string; }
export interface CleanupResult { canceled: boolean; readingsDeleted?: number; logsDeleted?: number; warning?: string; }
export interface AccountRole { code: string; displayName: string; permissions: Array<{ code: string; label: string }>; }
export interface ApiSnapshot {
  schema_version: number;
  status_version: number;
  st_version: number;
  status: string;
  collected_at: string;
  channel_count: number;
  age_seconds: number;
  stale: boolean;
  channels: SensorChannel[];
}

interface E62DatabaseBridge {
  bootstrap(): Promise<{ settings: Record<string, unknown>; databasePath: string }>;
  status(): Promise<DatabaseStatus>;
  focusEditor?(): Promise<boolean>;
  notify(token: string, body: string, test?: boolean): Promise<{ sent: boolean; message: string }>;
  cleanupHistory(token: string): Promise<CleanupResult>;
  login(username: string, password: string): Promise<DatabaseLogin>;
  logout(token: string): Promise<void>;
  saveSetting(token: string, key: string, value: unknown): Promise<Record<string, unknown>>;
  saveChannelLimits(token: string, channelId: string, limits: AlarmLimits | null): Promise<Record<string, AlarmLimits>>;
  ingestSnapshot(token: string, snapshot: unknown, source?: string): Promise<{ batchId: string; channelCount: number }>;
  syncApi(token: string): Promise<{ snapshot: ApiSnapshot; result: unknown }>;
  latestChannels(token: string): Promise<SensorChannel[]>;
  queryReport(token: string, filter: ReportFilter): Promise<ReportResult>;
  exportReport(token: string, filter: ReportFilter): Promise<{ canceled: boolean; filePath?: string; rowCount?: number }>;
  listUsers(token: string): Promise<LocalAccount[]>;
  saveUser(token: string, user: LocalAccount): Promise<LocalAccount[]>;
  deleteUser(token: string, id: number): Promise<LocalAccount[]>;
  listRoles(token: string): Promise<AccountRole[]>;
}

declare global { interface Window { e62Db?: E62DatabaseBridge; } }

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  get available(): boolean { return Boolean(window.e62Db); }
  get desktopExpected(): boolean { return /Electron\//i.test(navigator.userAgent) || window.location.protocol === 'file:'; }
  focusEditor() { return window.e62Db?.focusEditor?.(); }
  bootstrap() { return window.e62Db?.bootstrap(); }
  status() { return window.e62Db?.status(); }
  notify(token: string, body: string, test = false) { return window.e62Db?.notify(token, body, test); }
  cleanupHistory(token: string) { return window.e62Db?.cleanupHistory(token); }
  login(username: string, password: string) { return window.e62Db?.login(username, password); }
  logout(token: string) { return window.e62Db?.logout(token); }
  saveSetting(token: string, key: string, value: unknown) { return window.e62Db?.saveSetting(token, key, value); }
  saveChannelLimits(token: string, channelId: string, limits: AlarmLimits | null) { return window.e62Db?.saveChannelLimits(token, channelId, limits); }
  ingestSnapshot(token: string, snapshot: unknown, source = 'mock') { return window.e62Db?.ingestSnapshot(token, snapshot, source); }
  syncApi(token: string) { return window.e62Db?.syncApi(token); }
  latestChannels(token: string) { return window.e62Db?.latestChannels(token); }
  queryReport(token: string, filter: ReportFilter) { return window.e62Db?.queryReport(token, filter); }
  exportReport(token: string, filter: ReportFilter) { return window.e62Db?.exportReport(token, filter); }
  listUsers(token: string) { return window.e62Db?.listUsers(token); }
  listRoles(token: string) { return window.e62Db?.listRoles(token); }
  saveUser(token: string, user: LocalAccount) { return window.e62Db?.saveUser(token, user); }
  deleteUser(token: string, id: number) { return window.e62Db?.deleteUser(token, id); }
}
