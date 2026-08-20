import type { DataMode } from '../types/dashboard';

const rawMode = String(import.meta.env.VITE_DATA_MODE ?? 'mock').toLowerCase();

export const runtimeConfig = {
  dataMode: (rawMode === 'live' ? 'live' : 'mock') as DataMode,
  apiDataUrl:
    String(import.meta.env.VITE_API_DATA_URL ?? '').trim() ||
    'http://127.0.0.1:8080/api/data',
  pollIntervalMs: Math.max(
    1000,
    Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? 3000),
  ),
};

export function apiUrl(path: string): string {
  const dataUrl = new URL(runtimeConfig.apiDataUrl);
  return new URL(path.replace(/^\//, ''), `${dataUrl.origin}/`).toString();
}
