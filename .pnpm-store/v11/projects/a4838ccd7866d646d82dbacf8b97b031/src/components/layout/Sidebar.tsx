import { LogOut, X } from 'lucide-react';
import type { UserSession, ViewKey } from '../../types/dashboard';
import { navigationItems } from './navigation';

interface SidebarProps {
  activeView: ViewKey;
  collapsed: boolean;
  mobileOpen: boolean;
  session: UserSession;
  onNavigate: (view: ViewKey) => void;
  onToggle: () => void;
  onCloseMobile: () => void;
  onLogout: () => void;
}

export function Sidebar(props: SidebarProps) {
  return (
    <>
      <button
        className={`sidebar-backdrop ${props.mobileOpen ? 'visible' : ''}`}
        aria-label="關閉選單"
        onClick={props.onCloseMobile}
      />
      <aside
        className={`sidebar ${props.collapsed ? 'collapsed' : ''} ${props.mobileOpen ? 'mobile-open' : ''}`}
      >
        <div className="sidebar-brand-row">
          <button
            className="sidebar-logo"
            type="button"
            onClick={props.onToggle}
            aria-label={props.collapsed ? '展開側邊欄' : '收合側邊欄'}
            aria-expanded={!props.collapsed}
            title={props.collapsed ? '展開側邊欄' : '收合側邊欄'}
          >
            E62
          </button>
          <div className="sidebar-brand-copy">
            <strong>Edge Dashboard</strong>
            <small>感應器監控</small>
          </div>
          <button className="icon-button sidebar-close-mobile" onClick={props.onCloseMobile} aria-label="關閉選單">
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="主要導覽">
          {navigationItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={props.activeView === key ? 'active' : ''}
              title={label}
              onClick={() => props.onNavigate(key)}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <span>{props.session.displayName.slice(0, 1).toUpperCase()}</span>
          <div>
            <b>{props.session.displayName}</b>
            <small>{props.session.role}</small>
          </div>
          <button type="button" className="sidebar-logout" onClick={props.onLogout} aria-label="登出" title="登出"><LogOut size={18} /><span>登出</span></button>
        </div>
      </aside>
    </>
  );
}
