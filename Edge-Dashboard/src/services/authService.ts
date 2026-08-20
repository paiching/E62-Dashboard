import { apiUrl, runtimeConfig } from '../config/runtime';
import { findLocalAccount } from './localAccountsService';
import type { UserSession } from '../types/dashboard';

export async function login(username: string, password: string): Promise<UserSession> {
  const normalized = username.trim().toLowerCase();
  if (runtimeConfig.dataMode === 'mock') {
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    const user = findLocalAccount(normalized);
    if (!user || user.password !== password) throw new Error('帳號或密碼錯誤');
    return {
      token: `mock-${normalized}-${Date.now()}`,
      username: normalized,
      displayName: user.displayName,
      role: user.role,
    };
  }

  const response = await fetch(apiUrl('/api/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: normalized, password, lang: 'zh' }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    message?: string;
    token?: string;
    username?: string;
    role?: string;
    role_name?: string;
  };
  if (!response.ok || !payload.ok || !payload.token) {
    throw new Error(payload.message || '登入失敗');
  }
  return {
    token: payload.token,
    username: payload.username || normalized,
    displayName: payload.role_name || payload.username || normalized,
    role: payload.role || 'guest',
  };
}
