import { useEffect, useMemo, useState } from 'react';
import { Activity, Clock3, Menu, RadioTower, Siren } from 'lucide-react';
import { getSensorState, type DashboardSnapshot, type SensorState, type ViewKey } from '../../types/dashboard';

const VIEW_TITLES: Record<ViewKey, string> = {
  overview: '儀錶板', trends: '即時趨勢圖', channels: '報表資料', alarms: '警報中心',
  notifications: '通知設定', permissions: '帳號權限', account: '系統測試', settings: '系統設定',
};

interface TopBarProps {
  activeView: ViewKey;
  data: DashboardSnapshot | null;
  showDashboardStatus: boolean;
  onOpenMenu: () => void;
  onDashboardStatusFilter: (filter: SensorState) => void;
}

function channelList(channels: DashboardSnapshot['channels']) {
  const visible = channels.slice(0, 8).map((channel) => `CH${channel.id}`).join('、');
  return channels.length > 8 ? `${visible} ＋${channels.length - 8}` : visible;
}

export function TopBar({ activeView, data, showDashboardStatus, onOpenMenu, onDashboardStatusFilter }: TopBarProps) {
  const [clock, setClock] = useState(() => new Date());
  const alarms = useMemo(() => data?.channels.filter((channel) => getSensorState(channel) === 'alarm') || [], [data?.channels]);
  const errors = useMemo(() => data?.channels.filter((channel) => getSensorState(channel) === 'error') || [], [data?.channels]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <header className={`topbar ${activeView === 'overview' ? 'topbar-overview' : ''}`}>
    <button className="icon-button mobile-menu" onClick={onOpenMenu} aria-label="開啟選單"><Menu size={21} /></button>
    <div className="topbar-title"><strong>{VIEW_TITLES[activeView]}</strong></div>
    {activeView === 'overview' && <div className="topbar-status-slot">{showDashboardStatus && <HeaderStatus alarms={alarms} errors={errors} onFilter={onDashboardStatusFilter} />}</div>}
    {activeView === 'overview' && <div className="topbar-live-clock"><span className="live-pill">LIVE</span><Clock3 size={15} /><time>{clock.toLocaleString('zh-TW', { hour12: false })}</time></div>}
  </header>;
}

function HeaderStatus({ alarms, errors, onFilter }: { alarms: DashboardSnapshot['channels']; errors: DashboardSnapshot['channels']; onFilter: (filter: SensorState) => void }) {
  if (alarms.length) return <button type="button" className="topbar-system-status alarm" onClick={() => onFilter('alarm')} title="篩選警報 Sensor"><Siren size={16} /><b>警報：</b><span>{channelList(alarms)}</span>{errors.length > 0 && <em>另 {errors.length} 點斷線</em>}</button>;
  if (errors.length) return <button type="button" className="topbar-system-status error" onClick={() => onFilter('error')} title="篩選斷線 Sensor"><RadioTower size={16} /><b>斷線：</b><span>{channelList(errors)}</span></button>;
  return <button type="button" className="topbar-system-status ok" onClick={() => onFilter('ok')} title="篩選正常 Sensor"><Activity size={16} /><b>系統正常</b></button>;
}
