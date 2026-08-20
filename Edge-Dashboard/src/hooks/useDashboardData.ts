import { useCallback, useEffect, useRef, useState } from 'react';
import { runtimeConfig } from '../config/runtime';
import { fetchDashboardSnapshot } from '../services/dashboardApi';
import type { DashboardSnapshot } from '../types/dashboard';

export function useDashboardData(token: string) {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pollIntervalMs, setPollIntervalMs] = useState(() => {
    const saved = Number(localStorage.getItem('edge-poll-interval-ms'));
    return Number.isFinite(saved) && saved >= 1000 && saved <= 60000
      ? saved
      : runtimeConfig.pollIntervalMs;
  });
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const snapshot = await fetchDashboardSnapshot(token, controller.signal);
      setData(snapshot);
      setError(null);
    } catch (reason) {
      if ((reason as Error).name !== 'AbortError') {
        setError(reason instanceof Error ? reason.message : '資料讀取失敗');
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(refresh, pollIntervalMs);
    return () => {
      window.clearInterval(intervalId);
      requestRef.current?.abort();
    };
  }, [pollIntervalMs, refresh]);

  const changePollInterval = useCallback((intervalMs: number) => {
    const normalized = Math.min(60000, Math.max(1000, Math.round(intervalMs)));
    localStorage.setItem('edge-poll-interval-ms', String(normalized));
    setPollIntervalMs(normalized);
  }, []);

  return { data, error, loading, refresh, pollIntervalMs, changePollInterval };
}
