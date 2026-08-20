import { useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { AccountPage } from './features/account/AccountPage';
import { AlarmsPage } from './features/alarms/AlarmsPage';
import { LoginPage } from './features/auth/LoginPage';
import { ChannelsPage } from './features/channels/ChannelsPage';
import { OverviewPage } from './features/overview/OverviewPage';
import { PermissionsPage } from './features/permissions/PermissionsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TrendsPage } from './features/trends/TrendsPage';
import { useDashboardData } from './hooks/useDashboardData';
import type { DashboardSnapshot, UserSession, ViewKey } from './types/dashboard';

export function App() {
  const [session, setSession] = useState<UserSession | null>(null);
  if (!session) return <LoginPage onLogin={setSession} />;
  return <AuthenticatedApp session={session} onLogout={() => setSession(null)} />;
}

function AuthenticatedApp({ session, onLogout }: { session: UserSession; onLogout: () => void }) {
  const [view, setView] = useState<ViewKey>('overview');
  const [alarmFilter, setAlarmFilter] = useState<'all' | 'alarm' | 'error'>('all');
  const [overviewFilter, setOverviewFilter] = useState<'all' | 'ok' | 'alarm' | 'error'>('all');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('edge-sidebar-collapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showDashboardStatus, setShowDashboardStatus] = useState(() => localStorage.getItem('edge-show-dashboard-status') !== '0');
  const { data, error, loading, refresh, pollIntervalMs, changePollInterval } = useDashboardData(session.token);

  function navigate(nextView: ViewKey, nextAlarmFilter: 'all' | 'alarm' | 'error' = 'all') {
    setAlarmFilter(nextView === 'alarms' ? nextAlarmFilter : 'all');
    setView(nextView);
    setMobileOpen(false);
  }

  function toggleSidebar() {
    setCollapsed((current) => {
      localStorage.setItem('edge-sidebar-collapsed', current ? '0' : '1');
      return !current;
    });
  }

  function changeDashboardStatusVisibility(visible: boolean) {
    localStorage.setItem('edge-show-dashboard-status', visible ? '1' : '0');
    setShowDashboardStatus(visible);
  }

  return (
    <AppShell activeView={view} collapsed={collapsed} mobileOpen={mobileOpen} session={session} data={data} showDashboardStatus={showDashboardStatus} onDashboardStatusFilter={setOverviewFilter} onNavigate={(nextView) => navigate(nextView)} onToggleSidebar={toggleSidebar} onOpenMenu={() => setMobileOpen(true)} onCloseMenu={() => setMobileOpen(false)} onLogout={onLogout}>
      {error && <div className="api-error" role="alert">API 讀取失敗：{error}</div>}
      {!data && loading ? <div className="loading-state"><span /><p>正在取得感應器資料…</p></div> : data ? <PageRouter view={view} data={data} session={session} alarmFilter={alarmFilter} overviewFilter={overviewFilter} onOverviewFilterChange={setOverviewFilter} onNavigate={navigate} onAlarmFilterChange={setAlarmFilter} pollIntervalMs={pollIntervalMs} onPollIntervalChange={changePollInterval} showDashboardStatus={showDashboardStatus} onShowDashboardStatusChange={changeDashboardStatusVisibility} onLogout={onLogout} onRefresh={refresh} /> : <div className="empty-state">目前沒有可顯示的資料</div>}
    </AppShell>
  );
}

function PageRouter({ view, data, session, alarmFilter, overviewFilter, onOverviewFilterChange, onNavigate, onAlarmFilterChange, pollIntervalMs, onPollIntervalChange, showDashboardStatus, onShowDashboardStatusChange, onLogout, onRefresh }: { view: ViewKey; data: DashboardSnapshot; session: UserSession; alarmFilter: 'all' | 'alarm' | 'error'; overviewFilter: 'all' | 'ok' | 'alarm' | 'error'; onOverviewFilterChange: (filter: 'all' | 'ok' | 'alarm' | 'error') => void; onNavigate: (view: ViewKey, alarmFilter?: 'all' | 'alarm' | 'error') => void; onAlarmFilterChange: (filter: 'all' | 'alarm' | 'error') => void; pollIntervalMs: number; onPollIntervalChange: (intervalMs: number) => void; showDashboardStatus: boolean; onShowDashboardStatusChange: (visible: boolean) => void; onLogout: () => void; onRefresh: () => Promise<void> }) {
  switch (view) {
    case 'channels': return <ChannelsPage data={data} token={session.token} onRefresh={onRefresh} />;
    case 'trends': return <TrendsPage data={data} />;
    case 'alarms': return <AlarmsPage data={data} filter={alarmFilter} onFilterChange={onAlarmFilterChange} />;
    case 'permissions': return <PermissionsPage currentRole={session.role} />;
    case 'account': return <AccountPage />;
    case 'settings': return <SettingsPage pollIntervalMs={pollIntervalMs} showDashboardStatus={showDashboardStatus} onShowDashboardStatusChange={onShowDashboardStatusChange} />;
    default: return <OverviewPage data={data} token={session.token} filter={overviewFilter} onFilterChange={onOverviewFilterChange} onNavigate={onNavigate} pollIntervalMs={pollIntervalMs} onPollIntervalChange={onPollIntervalChange} onRefresh={onRefresh} />;
  }
}
