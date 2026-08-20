export type LocalAccountRole = 'administrator' | 'operator' | 'guest';

export interface LocalAccountPermissions {
  dashboard: boolean;
  alarms: boolean;
  acknowledge: boolean;
  settings: boolean;
  manageUsers: boolean;
}

export interface LocalAccount {
  username: string;
  displayName: string;
  password: string;
  role: LocalAccountRole;
  channelScope: string;
  permissions: LocalAccountPermissions;
}

const STORAGE_KEY = 'edge-local-accounts-v1';

export const DEFAULT_LOCAL_ACCOUNTS: LocalAccount[] = [
  {
    username: 'admin', displayName: '管理員', password: 'SGS@1234', role: 'administrator', channelScope: '全部',
    permissions: { dashboard: true, alarms: true, acknowledge: true, settings: true, manageUsers: true },
  },
  {
    username: 'operator1', displayName: '操作者 1', password: '1234', role: 'operator', channelScope: 'CH001–CH100',
    permissions: { dashboard: true, alarms: true, acknowledge: true, settings: false, manageUsers: false },
  },
  {
    username: 'guest', displayName: '測試者', password: '', role: 'guest', channelScope: '唯讀',
    permissions: { dashboard: true, alarms: true, acknowledge: false, settings: false, manageUsers: false },
  },
];

function copyDefaults() {
  return DEFAULT_LOCAL_ACCOUNTS.map((account) => ({ ...account, permissions: { ...account.permissions } }));
}

function isPermissionSet(value: unknown): value is LocalAccountPermissions {
  if (!value || typeof value !== 'object') return false;
  const permissions = value as Record<string, unknown>;
  return ['dashboard', 'alarms', 'acknowledge', 'settings', 'manageUsers'].every((key) => typeof permissions[key] === 'boolean');
}

function isAccount(value: unknown): value is LocalAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as Record<string, unknown>;
  return typeof account.username === 'string'
    && typeof account.displayName === 'string'
    && typeof account.password === 'string'
    && ['administrator', 'operator', 'guest'].includes(String(account.role))
    && typeof account.channelScope === 'string'
    && isPermissionSet(account.permissions);
}

export function loadLocalAccounts(): LocalAccount[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(parsed) && parsed.length && parsed.every(isAccount)) {
      return parsed.map((account) => ({ ...account, permissions: { ...account.permissions } }));
    }
  } catch {
    // Invalid local data falls back to the built-in demo accounts.
  }
  return copyDefaults();
}

export function saveLocalAccounts(accounts: LocalAccount[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

export function findLocalAccount(username: string) {
  const normalized = username.trim().toLowerCase();
  return loadLocalAccounts().find((account) => account.username.toLowerCase() === normalized);
}
