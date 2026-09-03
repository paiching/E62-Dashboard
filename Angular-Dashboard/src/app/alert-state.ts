import { SensorChannel, SensorState } from './dashboard.model';

/** One alert per channel state transition; recovery permits a later new alert. */
export class AlarmTracker {
  private states = new Map<string, SensorState>();
  private syncFailed = false;

  collect(channels: SensorChannel[], state: (channel: SensorChannel) => SensorState): SensorChannel[] {
    const changed = channels.filter(channel => {
      const next = state(channel);
      return next !== 'ok' && next !== this.states.get(channel.id);
    });
    this.states = new Map(channels.map(channel => [channel.id, state(channel)]));
    this.syncFailed = false;
    return changed;
  }

  fail(): boolean { const first = !this.syncFailed; this.syncFailed = true; return first; }
  reset(): void { this.states.clear(); this.syncFailed = false; }
}
