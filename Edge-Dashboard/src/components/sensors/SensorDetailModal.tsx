import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Activity, RotateCcw, Save, SlidersHorizontal, X } from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import { clearSensorStats, saveSensorLimits } from '../../services/sensorSettingsService';
import { getSensorState, type SensorChannel } from '../../types/dashboard';

interface SensorDetailModalProps {
  channel: SensorChannel;
  token: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

const value = (input: number | null) => input === null || !Number.isFinite(input) ? '--' : input.toFixed(1);

export function SensorDetailModal({ channel, token, onClose, onChanged }: SensorDetailModalProps) {
  const [low, setLow] = useState(String(channel.web_lo ?? ''));
  const [high, setHigh] = useState(String(channel.web_hi ?? ''));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const state = getSensorState(channel);

  useEffect(() => {
    setLow(String(channel.web_lo ?? ''));
    setHigh(String(channel.web_hi ?? ''));
  }, [channel.id, channel.web_lo, channel.web_hi]);

  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const points = useMemo(() => {
    const rows = channel.history.slice(-24);
    if (!rows.length) return '';
    const values = rows.map((row) => row.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    return values.map((item, index) => `${(index / Math.max(1, values.length - 1)) * 100},${36 - ((item - min) / range) * 32}`).join(' ');
  }, [channel.history]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      await saveSensorLimits(channel.id, Number(low), Number(high), token);
      await onChanged();
      setMessage('LOW / HIGH 設定已儲存');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '設定失敗'); }
    finally { setBusy(false); }
  }

  async function clearStats() {
    setBusy(true); setMessage('');
    try {
      await clearSensorStats(channel.id, Number(low), Number(high), token);
      await onChanged();
      setMessage('MIN / MAX 已清除');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '清除失敗'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sensor-modal" role="dialog" aria-modal="true" aria-labelledby="sensor-modal-title">
        <header className="sensor-modal-header">
          <div><span>CH{channel.id}</span><h2 id="sensor-modal-title">{channel.name}</h2></div>
          <StatusBadge state={state} />
          <button className="icon-button" onClick={onClose} aria-label="關閉"><X size={19} /></button>
        </header>
        <div className="sensor-modal-reading"><strong>{value(channel.pv)}</strong><span>°C</span><small>SV {value(channel.sv)} °C</small></div>
        <div className="trend-panel">
          <div><Activity size={16} /><b>最近趨勢</b><span>{channel.history.length} 筆</span></div>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="最近溫度趨勢圖">
            <line x1="0" y1="10" x2="100" y2="10" /><line x1="0" y1="20" x2="100" y2="20" /><line x1="0" y1="30" x2="100" y2="30" />
            {points && <polyline points={points} />}
          </svg>
        </div>
        <div className="sensor-stats"><div><span>MIN</span><b>{value(channel.min)}</b></div><div><span>AVG</span><b>{value(channel.avg)}</b></div><div><span>MAX</span><b>{value(channel.max)}</b></div></div>
        <form className="sensor-settings-form" onSubmit={submit}>
          <div className="sensor-settings-title"><SlidersHorizontal size={18} /><b>警戒範圍設定</b></div>
          <div className="limit-inputs"><label>LOW °C<input type="number" step="0.1" value={low} onChange={(event) => setLow(event.target.value)} required /></label><label>HIGH °C<input type="number" step="0.1" value={high} onChange={(event) => setHigh(event.target.value)} required /></label></div>
          {message && <p className="modal-message">{message}</p>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={clearStats} disabled={busy}><RotateCcw size={17} />清除 MIN / MAX</button><button className="primary-button" disabled={busy}><Save size={17} />儲存設定</button></div>
        </form>
        <footer className="sensor-modal-footer"><span>Slave ID：{channel.id}</span><span>更新：{channel.time ? new Date(channel.time).toLocaleString('zh-TW') : '--'}</span><span>COUNT：{channel.count}</span></footer>
      </section>
    </div>
  );
}
