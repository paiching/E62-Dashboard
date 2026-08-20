import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Search, TrendingUp, X } from 'lucide-react';
import { getSensorState, type DashboardSnapshot, type SensorChannel, type SensorState } from '../../types/dashboard';

interface TrendPoint { timestamp: number; value: number }
type TrendHistory = Record<string, TrendPoint[]>;

const SERIES_COLORS = ['#2364aa', '#f28e2b', '#16856b', '#c53b4b', '#7a5dc7', '#9a604e', '#087e8b', '#c77d10'];
const POINT_OPTIONS = [30, 60, 120, 300, 500];

function timestamp(value: string, fallback: number) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function initialPoints(channel: SensorChannel): TrendPoint[] {
  const now = Date.now();
  const history = channel.history
    .filter((point) => Number.isFinite(point.value))
    .map((point, index) => ({ timestamp: timestamp(point.time, now - (channel.history.length - index) * 1000), value: point.value }));
  if (history.length) return history;
  return channel.pv === null ? [] : [{ timestamp: timestamp(channel.time, now), value: channel.pv }];
}

export function TrendsPage({ data }: { data: DashboardSnapshot }) {
  const [selectedIds, setSelectedIds] = useState(() => data.channels.slice(0, 4).map((channel) => channel.id));
  const [history, setHistory] = useState<TrendHistory>({});
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | SensorState>('all');
  const [pointLimit, setPointLimit] = useState(120);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setHistory((current) => {
      const next = { ...current };
      selectedIds.forEach((id) => {
        const channel = data.channels.find((item) => item.id === id);
        if (!channel) return;
        let points = next[id] || initialPoints(channel);
        if (!paused && channel.pv !== null) {
          const latest: TrendPoint = { timestamp: timestamp(channel.time, Date.now()), value: channel.pv };
          const last = points[points.length - 1];
          points = last?.timestamp === latest.timestamp ? [...points.slice(0, -1), latest] : [...points, latest];
        }
        next[id] = points.slice(-pointLimit);
      });
      return next;
    });
  }, [data.channels, data.time, paused, pointLimit, selectedIds]);

  const filteredChannels = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('zh-TW');
    return data.channels.filter((channel) => (!text || `CH${channel.id} ${channel.name}`.toLocaleLowerCase('zh-TW').includes(text)) && (status === 'all' || getSensorState(channel) === status));
  }, [data.channels, query, status]);

  function toggleChannel(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) { setMessage(''); return current.filter((item) => item !== id); }
      if (current.length >= 8) { setMessage('最多可同時比較 8 個通道'); return current; }
      setMessage('');
      return [...current, id];
    });
  }

  const selectedChannels = selectedIds.flatMap((id) => {
    const channel = data.channels.find((item) => item.id === id);
    return channel ? [channel] : [];
  });

  return <>
    <section className="trend-toolbar panel">
      <label>保留點數<select value={pointLimit} onChange={(event) => setPointLimit(Number(event.target.value))}>{POINT_OPTIONS.map((option) => <option key={option} value={option}>{option} 點</option>)}</select></label>
      <button type="button" className={paused ? 'primary-button' : 'secondary-button'} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={17} /> : <Pause size={17} />}{paused ? '繼續即時更新' : '暫停更新'}</button>
      <span>更新時間：{data.time ? new Date(data.time).toLocaleTimeString('zh-TW') : '--'}</span>
    </section>
    <section className="trend-workspace">
      <aside className="panel trend-channel-panel">
        <h3>選擇通道 <span>{selectedIds.length}/8</span></h3>
        <div className="trend-channel-search"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋編號或名稱" /></div>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="篩選 Sensor 狀態"><option value="all">全部狀態</option><option value="ok">正常</option><option value="alarm">警報</option><option value="error">斷線</option></select>
        {message && <p className="trend-limit-message">{message}</p>}
        <div className="trend-channel-list">{filteredChannels.map((channel) => <label key={channel.id}><input type="checkbox" checked={selectedIds.includes(channel.id)} onChange={() => toggleChannel(channel.id)} /><span><b>CH{channel.id}</b><small>{channel.name}</small></span><em>{channel.pv?.toFixed(1) ?? '--'} °C</em></label>)}{!filteredChannels.length && <p>沒有符合條件的通道</p>}</div>
      </aside>
      <div className="panel trend-chart-panel">
        <div className="trend-chart-heading"><div><TrendingUp size={20} /><div><h3>PV 即時溫度</h3><p>{selectedChannels.length ? `${selectedChannels.length} 個通道比較` : '請選擇通道'}</p></div></div></div>
        <div className="trend-legend">{selectedChannels.map((channel, index) => <button type="button" key={channel.id} onClick={() => toggleChannel(channel.id)} title="從圖表移除"><i style={{ background: SERIES_COLORS[index] }} /><span>CH{channel.id} {channel.name}</span><X size={13} /></button>)}</div>
        <TrendChart channels={selectedChannels} history={history} />
      </div>
    </section>
  </>;
}

function TrendChart({ channels, history }: { channels: SensorChannel[]; history: TrendHistory }) {
  const width = 1000; const height = 430;
  const margin = { top: 22, right: 28, bottom: 48, left: 68 };
  const allPoints = channels.flatMap((channel) => history[channel.id] || []);
  if (!allPoints.length) return <div className="trend-chart-empty"><TrendingUp size={34} /><p>選擇 Sensor 後開始顯示即時趨勢</p></div>;
  const values = allPoints.map((point) => point.value);
  const times = allPoints.map((point) => point.timestamp);
  const rawMin = Math.min(...values); const rawMax = Math.max(...values);
  const padding = Math.max(1, (rawMax - rawMin) * .12);
  const yMin = rawMin - padding; const yMax = rawMax + padding;
  const xMin = Math.min(...times); const xMax = Math.max(...times); const xRange = Math.max(1000, xMax - xMin);
  const x = (value: number) => margin.left + ((value - xMin) / xRange) * (width - margin.left - margin.right);
  const y = (value: number) => margin.top + ((yMax - value) / (yMax - yMin)) * (height - margin.top - margin.bottom);
  const yTicks = Array.from({ length: 6 }, (_, index) => yMin + ((yMax - yMin) / 5) * index);
  const xTicks = Array.from({ length: 6 }, (_, index) => xMin + (xRange / 5) * index);
  return <div className="trend-chart-scroll"><svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${channels.length} 個 Sensor 的即時溫度趨勢圖`}>
    <title>Sensor PV 即時溫度趨勢</title>
    <rect className="trend-plot-background" x={margin.left} y={margin.top} width={width - margin.left - margin.right} height={height - margin.top - margin.bottom} />
    {yTicks.map((tick) => <g key={tick}><line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} /><text x={margin.left - 10} y={y(tick) + 4} textAnchor="end">{tick.toFixed(1)}</text></g>)}
    {xTicks.map((tick) => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} /><text x={x(tick)} y={height - margin.bottom + 22} textAnchor="middle">{new Date(tick).toLocaleTimeString('zh-TW', { hour12: false })}</text></g>)}
    <text className="trend-axis-title" x={width / 2} y={height - 8} textAnchor="middle">時間</text><text className="trend-axis-title" transform={`translate(18 ${height / 2}) rotate(-90)`} textAnchor="middle">溫度 (°C)</text>
    {channels.map((channel, index) => { const points = history[channel.id] || []; const latest = points[points.length - 1]; return <g className="trend-series" key={channel.id}><polyline points={points.map((point) => `${x(point.timestamp)},${y(point.value)}`).join(' ')} style={{ stroke: SERIES_COLORS[index] }} />{latest && <><circle cx={x(latest.timestamp)} cy={y(latest.value)} r="4" style={{ fill: SERIES_COLORS[index] }} /><text className="trend-latest-value" x={Math.min(width - margin.right - 4, x(latest.timestamp) + 8)} y={y(latest.value) - 7}>{latest.value.toFixed(1)}</text></>}</g>; })}
  </svg></div>;
}
