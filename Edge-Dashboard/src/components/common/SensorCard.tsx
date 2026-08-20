import { getSensorState, type SensorChannel } from '../../types/dashboard';
import { StatusBadge } from './StatusBadge';

const value = (input: number | null) =>
  input === null || !Number.isFinite(input) ? '--' : input.toFixed(1);

export function SensorCard({ channel, onOpen, detailed = false }: { channel: SensorChannel; onOpen?: () => void; detailed?: boolean }) {
  const state = getSensorState(channel);
  return (
    <article className={`sensor-card ${state}`}>
      <div className="sensor-card-heading">
        <div>
          <span>CH{channel.id}</span>
          <button className="sensor-name-button" onClick={onOpen} aria-label={`開啟 CH${channel.id} ${channel.name} 詳情`}>{channel.name}</button>
        </div>
        <StatusBadge state={state} />
      </div>
      <div className="sensor-value">
        <strong>{value(channel.pv)}</strong>
        <span>°C</span>
      </div>
      <div className="sensor-range">
        <span>範圍</span>
        <b>
          {value(channel.web_lo)} ～ {value(channel.web_hi)} °C
        </b>
      </div>
      <div className="sensor-card-footer">
        <span>SV {value(channel.sv)} °C</span>
        <time>{channel.time ? new Date(channel.time).toLocaleTimeString('zh-TW') : '--'}</time>
      </div>
      {detailed && (
        <div className="sensor-card-details">
          <div><span>MIN</span><b>{value(channel.min)} °C</b></div>
          <div><span>AVG</span><b>{value(channel.avg)} °C</b></div>
          <div><span>MAX</span><b>{value(channel.max)} °C</b></div>
          <div><span>筆數</span><b>{channel.count}</b></div>
        </div>
      )}
    </article>
  );
}
