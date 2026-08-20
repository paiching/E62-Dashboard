import type { ReactNode } from 'react';
import type { DashboardSnapshot, SensorState, UserSession, ViewKey } from '../../types/dashboard';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
  children: ReactNode;
  activeView: ViewKey;
  collapsed: boolean;
  mobileOpen: boolean;
  session: UserSession;
  data: DashboardSnapshot | null;
  showDashboardStatus: boolean;
  onNavigate: (view: ViewKey) => void;
  onToggleSidebar: () => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onLogout: () => void;
  onDashboardStatusFilter: (filter: SensorState) => void;
}

export function AppShell(props: AppShellProps) {
  return (
    <div className={`app-shell ${props.collapsed ? 'sidebar-is-collapsed' : ''}`}>
      <Sidebar
        activeView={props.activeView}
        collapsed={props.collapsed}
        mobileOpen={props.mobileOpen}
        session={props.session}
        onNavigate={props.onNavigate}
        onToggle={props.onToggleSidebar}
        onCloseMobile={props.onCloseMenu}
        onLogout={props.onLogout}
      />
      <div className="app-content">
        <TopBar
          activeView={props.activeView}
          data={props.data}
          showDashboardStatus={props.showDashboardStatus}
          onOpenMenu={props.onOpenMenu}
          onDashboardStatusFilter={props.onDashboardStatusFilter}
        />
        <main className="page-content">{props.children}</main>
      </div>
    </div>
  );
}
