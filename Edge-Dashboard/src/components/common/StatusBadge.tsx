import type { SensorState } from '../../types/dashboard';

const labels: Record<SensorState, string> = {
  ok: '正常',
  alarm: '警報',
  error: '斷線',
};

export function StatusBadge({ state }: { state: SensorState }) {
  return <span className={`status-badge ${state}`}>{labels[state]}</span>;
}
