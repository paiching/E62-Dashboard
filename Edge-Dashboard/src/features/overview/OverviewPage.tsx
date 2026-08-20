import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CircleAlert, Grid3X3, Maximize2, PanelsTopLeft, RadioTower, RefreshCcw, X } from 'lucide-react';
import { SensorCard } from '../../components/common/SensorCard';
import { SensorDetailModal } from '../../components/sensors/SensorDetailModal';
import { getSensorState, type DashboardSnapshot, type SensorState, type ViewKey } from '../../types/dashboard';

const PAGE_SIZE = 50;
type DisplayMode = 'compact' | 'detailed' | 'fullscreen';

export function OverviewPage({ data, token, filter, onFilterChange, onNavigate, pollIntervalMs, onPollIntervalChange, onRefresh }: { data: DashboardSnapshot; token: string; filter: 'all' | SensorState; onFilterChange: (filter: 'all' | SensorState) => void; onNavigate: (view: ViewKey, alarmFilter?: 'all' | 'alarm' | 'error') => void; pollIntervalMs: number; onPollIntervalChange: (intervalMs: number) => void; onRefresh: () => Promise<void> }) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshRateOpen, setRefreshRateOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => localStorage.getItem('edge-overview-display') === 'detailed' ? 'detailed' : 'compact');
  const sensorStageRef = useRef<HTMLElement>(null);
  const channels = data.channels;
  const counts = useMemo(() => ({
    ok: channels.filter((channel) => getSensorState(channel) === 'ok').length,
    alarm: channels.filter((channel) => getSensorState(channel) === 'alarm').length,
    error: channels.filter((channel) => getSensorState(channel) === 'error').length,
  }), [channels]);
  const filteredChannels = useMemo(() => channels.filter((channel) => {
    const matchesQuery = !query || `CH${channel.id} ${channel.name}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (filter === 'all' || getSensorState(channel) === filter);
  }), [channels, filter, query]);
  const pages = Math.max(1, Math.ceil(filteredChannels.length / PAGE_SIZE));
  const visibleRows = filteredChannels.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const rangeStart = filteredChannels.length ? page * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, filteredChannels.length);
  const selected = channels.find((channel) => channel.id === selectedId) ?? null;

  useEffect(() => {
    function syncFullscreen() {
      if (!document.fullscreenElement) setDisplayMode((mode) => mode === 'fullscreen' ? 'detailed' : mode);
    }
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => setPage(0), [filter, query]);

  async function selectDisplayMode(mode: DisplayMode) {
    if (mode === 'fullscreen') {
      if (!sensorStageRef.current?.requestFullscreen) return;
      try {
        await sensorStageRef.current.requestFullscreen();
        setDisplayMode('fullscreen');
      } catch {
        setDisplayMode('detailed');
      }
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    localStorage.setItem('edge-overview-display', mode);
    setDisplayMode(mode);
  }

  return (
    <>
      <section className="summary-grid">
        <Summary icon={Activity} label="正常" value={counts.ok} tone="green" onClick={() => onNavigate('channels')} title="前往報表資料" />
        <Summary icon={CircleAlert} label="警報" value={counts.alarm} tone="red" onClick={() => onNavigate('alarms', 'alarm')} title="查看警報通道" />
        <Summary icon={RadioTower} label="斷線" value={counts.error} tone="gray" onClick={() => onNavigate('alarms', 'error')} title="查看斷線通道" />
        <Summary icon={RefreshCcw} label="刷新頻率" value={`${pollIntervalMs / 1000} 秒`} tone="blue" onClick={() => setRefreshRateOpen(true)} title="點擊設定刷新頻率" />
      </section>
      <section className="sensor-toolbar">
        <div className="range-tabs" aria-label="感應器區段">
          {Array.from({ length: pages }, (_, index) => (
            <button key={index} className={page === index ? 'active' : ''} onClick={() => setPage(index)}>
              {filteredChannels.length ? `${index * PAGE_SIZE + 1}–${Math.min((index + 1) * PAGE_SIZE, filteredChannels.length)}` : '0'}
            </button>
          ))}
        </div>
        <div className="sensor-filters">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋編號或名稱" />
          <select value={filter} onChange={(event) => onFilterChange(event.target.value as typeof filter)}>
            <option value="all">全部狀態</option>
            <option value="ok">正常</option>
            <option value="alarm">警報</option>
            <option value="error">斷線</option>
          </select>
        </div>
      </section>
      <section ref={sensorStageRef} className={`sensor-display-stage mode-${displayMode}`}>
        <div className="grid-caption">
          <div><b>感應器 {rangeStart}–{rangeEnd}</b><span>顯示 {visibleRows.length} / {filteredChannels.length} 點</span></div>
          <div className="display-mode-picker" role="group" aria-label="選擇展示模式">
            <span>展示模式</span>
            <button className={displayMode === 'compact' ? 'active' : ''} onClick={() => void selectDisplayMode('compact')} aria-label="精簡卡片" title="精簡卡片"><Grid3X3 size={18} /><em>精簡</em></button>
            <button className={displayMode === 'detailed' ? 'active' : ''} onClick={() => void selectDisplayMode('detailed')} aria-label="詳細大卡" title="詳細大卡"><PanelsTopLeft size={19} /><em>詳細</em></button>
            <button className={displayMode === 'fullscreen' ? 'active' : ''} onClick={() => void selectDisplayMode('fullscreen')} aria-label="全螢幕 Sensor 畫面" title="全螢幕 Sensor 畫面"><Maximize2 size={18} /><em>全螢幕</em></button>
          </div>
        </div>
        <div className="sensor-grid">
          {visibleRows.map((channel) => <SensorCard key={channel.id} channel={channel} detailed={displayMode !== 'compact'} onOpen={() => setSelectedId(channel.id)} />)}
          {!visibleRows.length && <div className="empty-state">沒有符合篩選條件的感應器</div>}
        </div>
      </section>
      {selected && <SensorDetailModal channel={selected} token={token} onClose={() => setSelectedId(null)} onChanged={onRefresh} />}
      {refreshRateOpen && <RefreshRateDialog currentMs={pollIntervalMs} onClose={() => setRefreshRateOpen(false)} onSave={(intervalMs) => { onPollIntervalChange(intervalMs); setRefreshRateOpen(false); }} />}
    </>
  );
}

function Summary({ icon: Icon, label, value, tone, onClick, title }: { icon: typeof Activity; label: string; value: string | number; tone: string; onClick?: () => void; title?: string }) {
  const content = <><span><Icon size={19} /></span><div><b>{value}</b><small>{label}</small></div></>;
  return onClick
    ? <button type="button" className={`summary-card summary-card-button ${tone}`} onClick={onClick} title={title}>{content}</button>
    : <article className={`summary-card ${tone}`}>{content}</article>;
}

const REFRESH_SECONDS = [1, 3, 5, 10, 30, 60];

function RefreshRateDialog({ currentMs, onClose, onSave }: { currentMs: number; onClose: () => void; onSave: (intervalMs: number) => void }) {
  const [seconds, setSeconds] = useState(currentMs / 1000);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="refresh-rate-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="refresh-rate-dialog" role="dialog" aria-modal="true" aria-labelledby="refresh-rate-title">
        <header><div><RefreshCcw size={21} /><h2 id="refresh-rate-title">設定刷新頻率</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="關閉"><X size={18} /></button></header>
        <p>Dashboard 將依照選擇的間隔，自動重新取得 Sensor 資料。</p>
        <div className="refresh-rate-options" role="group" aria-label="刷新間隔">
          {REFRESH_SECONDS.map((option) => <button type="button" key={option} className={seconds === option ? 'active' : ''} aria-pressed={seconds === option} onClick={() => setSeconds(option)}>{option}<span>秒</span></button>)}
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="primary-button" onClick={() => onSave(seconds * 1000)}>套用設定</button></footer>
      </section>
    </div>
  );
}
