import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { StatusBadge } from '../../components/common/StatusBadge';
import { getSensorState, type DashboardSnapshot, type SensorState } from '../../types/dashboard';

type AlarmFilter = 'all' | Exclude<SensorState, 'ok'>;

export function AlarmsPage({ data, filter, onFilterChange }: { data: DashboardSnapshot; filter: AlarmFilter; onFilterChange: (filter: AlarmFilter) => void }) {
  const allAlarms = data.channels.filter((channel) => getSensorState(channel) !== 'ok');
  const counts = {
    alarm: allAlarms.filter((channel) => getSensorState(channel) === 'alarm').length,
    error: allAlarms.filter((channel) => getSensorState(channel) === 'error').length,
  };
  const alarms = filter === 'all' ? allAlarms : allAlarms.filter((channel) => getSensorState(channel) === filter);
  return (
    <>
      <div className="alarm-filter-tabs" role="group" aria-label="篩選警報狀態">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => onFilterChange('all')}>全部 <b>{allAlarms.length}</b></button>
        <button className={filter === 'alarm' ? 'active' : ''} onClick={() => onFilterChange('alarm')}>警報 <b>{counts.alarm}</b></button>
        <button className={filter === 'error' ? 'active' : ''} onClick={() => onFilterChange('error')}>斷線 <b>{counts.error}</b></button>
      </div>
      {!alarms.length ? <div className="panel empty-message"><CheckCircle2 size={32} /><h3>目前沒有{filter === 'error' ? '斷線' : filter === 'alarm' ? '警報' : '異常'}</h3><p>沒有符合目前篩選條件的感應器。</p></div> : <section className="alarm-list">{alarms.map((channel) => { const state = getSensorState(channel); return <article key={channel.id}><span className={`alarm-icon ${state}`}><TriangleAlert size={21} /></span><div><b>CH{channel.id} · {channel.name}</b><p>{state === 'error' ? '感應器通訊中斷' : `溫度 ${channel.pv?.toFixed(1)} °C 超出 ${channel.web_lo}～${channel.web_hi} °C`}</p></div><StatusBadge state={state} /><time>{new Date(channel.time).toLocaleTimeString('zh-TW')}</time></article>; })}</section>}
    </>
  );
}
